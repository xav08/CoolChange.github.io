# Data sources: these READ information that already exists in your AWS
# account rather than creating anything. Needed here to build an exact
# ARN (Amazon Resource Name) for the policy below without hardcoding
# your account ID.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Generates the actual permissions document. This is an alternative to
# the jsonencode() approach used for the trust policy in main.tf — same
# end result (a JSON policy string), just a more structured way to write
# it when the policy has real logic to it, like the resource pattern below.
data "aws_iam_policy_document" "backend_secrets" {
  statement {
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue",
    ]

    # Least-privilege: only secrets whose name starts with this project's
    # prefix (e.g. coolchange-dev/*) — not every secret in the account.
    # These secrets don't exist yet (they're created in Phase 7), but the
    # ARN pattern is based on naming, so it's valid to reference now.
    resources = [
      "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:${var.name_prefix}/*",
    ]
  }
}

resource "aws_iam_policy" "backend_secrets" {
  name_prefix = "${var.name_prefix}-backend-secrets-"
  description = "Allows the backend to read only this project's Secrets Manager secrets"
  policy      = data.aws_iam_policy_document.backend_secrets.json

  tags = var.common_tags
}

# Policies and roles are separate resources in Terraform — this is what
# actually links the permissions document above to the backend role from
# main.tf. Attaching things as their own resource (rather than nesting)
# is the same pattern we used for security groups in Phase 1.
resource "aws_iam_role_policy_attachment" "backend_secrets" {
  role       = aws_iam_role.backend.name
  policy_arn = aws_iam_policy.backend_secrets.arn
}


data "aws_iam_policy_document" "backend_s3" {
  statement {
    effect = "Allow"

    actions = [
      "s3:GetObject",
    ]

    # Least-privilege: only the simulator data bucket, not every bucket
    # in the account.
    resources = [
      "arn:aws:s3:::coolchange-model-transfer-yipu-20260914/*",
    ]
  }
}

resource "aws_iam_policy" "backend_s3" {
  name_prefix = "${var.name_prefix}-backend-s3-"
  description = "Allows the backend to read simulator export files from S3"
  policy      = data.aws_iam_policy_document.backend_s3.json

  tags = var.common_tags
}

resource "aws_iam_role_policy_attachment" "backend_s3" {
  role       = aws_iam_role.backend.name
  policy_arn = aws_iam_policy.backend_s3.arn
}
