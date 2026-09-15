# modules/team_access — one IAM user per team member, all in a shared group,
# with full access to this project's services but read-only IAM and no
# billing/account access. Mirrors the scoping philosophy already used for
# github-actions-terraform-role (scoped by service, not full admin).

# ---------------------------------------------------------------------------
# variables.tf
# ---------------------------------------------------------------------------
variable "team_members" {
  description = "IAM usernames to create, one per team member (e.g. first names or GitHub handles)"
  type        = list(string)
  # Replace with your actual team roster before applying.
  default     = ["savio", "priyanshu", "yu", "yipu", "sheng", "linda"]
}

variable "secret_prefix" {
  description = "Secrets Manager prefix for storing each member's initial credentials"
  type        = string
  default     = "coolchange-dev/team"
}

# ---------------------------------------------------------------------------
# main.tf
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "team_member" {
  # Full access to every service this project actually uses.
  statement {
    sid    = "ProjectServicesFullAccess"
    effect = "Allow"
    actions = [
      "ec2:*",
      "rds:*",
      "s3:*",
      "secretsmanager:*",
      "ssm:*",
      "ssmmessages:*",
      "ec2messages:*",
      "acm:*",
      "cloudfront:*",
      "dynamodb:*",
      "elasticloadbalancing:*",
    ]
    resources = ["*"]
  }

  # Read-only IAM — can see roles/policies/users to understand the setup,
  # cannot create or modify any of them (blocks privilege escalation).
  statement {
    sid    = "IAMReadOnly"
    effect = "Allow"
    actions = [
      "iam:Get*",
      "iam:List*",
      "iam:GenerateCredentialReport",
      "iam:GenerateServiceLastAccessedDetails",
    ]
    resources = ["*"]
  }

  # Each user can manage only their OWN password/keys/MFA — not anyone else's.
  statement {
    sid    = "SelfServiceCredentials"
    effect = "Allow"
    actions = [
      "iam:ChangePassword",
      "iam:CreateAccessKey",
      "iam:DeleteAccessKey",
      "iam:ListAccessKeys",
      "iam:UpdateAccessKey",
      "iam:CreateVirtualMFADevice",
      "iam:EnableMFADevice",
      "iam:ResyncMFADevice",
      "iam:ListMFADevices",
    ]
    resources = [
      "arn:aws:iam::*:user/$${aws:username}",
      "arn:aws:iam::*:mfa/$${aws:username}",
    ]
  }

  statement {
    sid       = "WhoAmI"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }

  # No statement grants billing, account settings, Organizations, or
  # write access to IAM users/roles/policies belonging to anyone else —
  # that's the deliberate gap versus AdministratorAccess.
}

resource "aws_iam_policy" "team_member" {
  name        = "coolchange-dev-team-member-policy"
  description = "Full access to CoolChange project services; read-only IAM; no billing/account access"
  policy      = data.aws_iam_policy_document.team_member.json
}

resource "aws_iam_group" "team" {
  name = "coolchange-dev-team"
}

resource "aws_iam_group_policy_attachment" "team" {
  group      = aws_iam_group.team.name
  policy_arn = aws_iam_policy.team_member.arn
}

resource "aws_iam_user" "member" {
  for_each = toset(var.team_members)
  name     = "coolchange-dev-${each.value}"
}

resource "aws_iam_group_membership" "team" {
  name  = "coolchange-dev-team-membership"
  group = aws_iam_group.team.name
  users = [for u in aws_iam_user.member : u.name]
}

# Console access — AWS auto-generates the initial password; each person must
# reset it on first login (they set their own, no admin ever knows it).
resource "aws_iam_user_login_profile" "member" {
  for_each                = toset(var.team_members)
  user                    = aws_iam_user.member[each.key].name
  password_reset_required = true
}

# CLI/Terraform access key, for exactly the kind of work we did today
# (aws ssm start-session, aws secretsmanager get-secret-value, etc.)
resource "aws_iam_access_key" "member" {
  for_each = toset(var.team_members)
  user     = aws_iam_user.member[each.key].name
}

# Each member's initial credentials, handed off via Secrets Manager rather
# than pasted anywhere — same pattern as the DB and deploy-key secrets.
# NOTE: unlike the RDS master password (which uses manage_master_user_password
# so Terraform never sees the plaintext), aws_iam_user_login_profile and
# aws_iam_access_key DO put their values in Terraform state. Treat the state
# file as sensitive (it already is, given the DB/deploy-key secrets it holds)
# and don't run `terraform output` for these without -json | piping somewhere
# private.
resource "aws_secretsmanager_secret" "member_credentials" {
  for_each    = toset(var.team_members)
  name        = "${var.secret_prefix}/${each.value}-credentials"
  description = "Initial console password + CLI access key for ${each.value}"
}

resource "aws_secretsmanager_secret_version" "member_credentials" {
  for_each  = toset(var.team_members)
  secret_id = aws_secretsmanager_secret.member_credentials[each.key].id
  secret_string = jsonencode({
    iam_username      = aws_iam_user.member[each.key].name
    console_password  = aws_iam_user_login_profile.member[each.key].password
    access_key_id     = aws_iam_access_key.member[each.key].id
    secret_access_key = aws_iam_access_key.member[each.key].secret
  })
}

# ---------------------------------------------------------------------------
# outputs.tf
# ---------------------------------------------------------------------------
output "team_member_secret_names" {
  description = "Secrets Manager secret name holding each member's initial credentials"
  value       = { for k, v in aws_secretsmanager_secret.member_credentials : k => v.name }
}
