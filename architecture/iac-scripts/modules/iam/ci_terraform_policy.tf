# Permissions for the github_actions_terraform role — the one CI uses to
# run `terraform plan`/`apply`. Deliberately broader than ci_deploy_policy.tf:
# scoped by SERVICE (one wildcarded statement per AWS service this project's
# Terraform touches) rather than by individual action or exact resource ARN.
#
# Why: true least-privilege here would mean enumerating every single action
# Terraform calls across EC2, RDS, S3, IAM, ACM, ELB, CloudFront, Secrets
# Manager, SSM, and DynamoDB — and updating that list every time a future
# phase adds a new resource type, or `terraform apply` from CI just starts
# failing with AccessDenied. For a project this size that maintenance cost
# isn't worth it, so this trades resource/action-level precision for a
# policy that's easy to keep working, while still being scoped to only the
# services this project actually uses (not full AdministratorAccess).
#
# Known trade-off worth being aware of: iam:* below means this role can
# modify IAM itself, including its own trust policy — a form of privilege
# escalation if the role's credentials were ever leaked. The mitigating
# control is the trust policy in oidc.tf: only GitHub Actions runs from
# SagpariyaPriyanshu/CoolChange.github.io can assume this role in the first
# place, and OIDC tokens are short-lived (minutes), not long-lived keys.
data "aws_iam_policy_document" "ci_terraform" {
  statement {
    sid    = "ManageNetworkingAndCompute"
    effect = "Allow"
    # Covers VPC, subnets, security groups, and the EC2 instance itself —
    # all under the ec2:* action namespace in AWS's own API.
    actions   = ["ec2:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageLoadBalancer"
    effect    = "Allow"
    actions   = ["elasticloadbalancing:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageWaf"
    effect    = "Allow"
    actions   = ["wafv2:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageDatabase"
    effect    = "Allow"
    actions   = ["rds:*"]
    resources = ["*"]
  }

  statement {
    sid    = "ManageStorage"
    effect = "Allow"
    # Covers the frontend bucket AND the Terraform state bucket itself.
    actions   = ["s3:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageStateLocking"
    effect    = "Allow"
    actions   = ["dynamodb:*"]
    resources = ["*"]
  }

  statement {
    sid    = "ManageIam"
    effect = "Allow"
    # Broadest and most sensitive statement here — see the trade-off note
    # above. Needed because Terraform creates/updates the roles, policies,
    # and instance profile this whole project runs on.
    actions   = ["iam:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageCertificates"
    effect    = "Allow"
    actions   = ["acm:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageCdn"
    effect    = "Allow"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:*"]
    resources = ["*"]
  }

  statement {
    sid    = "ManageSsm"
    effect = "Allow"
    # Terraform doesn't manage SSM resources directly today, but the
    # backend role/policy Terraform creates references ssm: actions — kept
    # here so a plan/apply involving those never hits AccessDenied.
    actions   = ["ssm:*"]
    resources = ["*"]
  }

  statement {
    sid    = "AllowCallerIdentityLookup"
    effect = "Allow"
    # Terraform calls this itself (via data.aws_caller_identity / the STS
    # GetCallerIdentity API) just to work out which account it's running
    # in — harmless read-only metadata, not covered by any statement above.
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "ci_terraform" {
  name        = "${var.name_prefix}-github-actions-terraform"
  description = "Permissions for GitHub Actions to run terraform plan/apply"
  policy      = data.aws_iam_policy_document.ci_terraform.json
}

resource "aws_iam_role_policy_attachment" "ci_terraform" {
  role       = aws_iam_role.github_actions_terraform.name
  policy_arn = aws_iam_policy.ci_terraform.arn
}
