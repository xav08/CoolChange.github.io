# What the deploy role is actually allowed to do — reuses the same
# aws_caller_identity/aws_region data sources already declared in
# policies.tf, since they're available anywhere in this module.
data "aws_iam_policy_document" "ci_deploy" {
  # Trigger a redeploy on the backend instance via SSM Run Command — no
  # SSH, matching how this instance is already managed. Can't scope to
  # the exact instance ARN without a circular module dependency (compute
  # already depends on iam for its role), so this is narrowed by account
  # + region instead, with a tight action list.
  statement {
    sid    = "TriggerBackendDeploy"
    effect = "Allow"
    actions = [
      "ssm:SendCommand",
    ]
    resources = [
      "arn:aws:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:instance/*",
      "arn:aws:ssm:${data.aws_region.current.name}::document/AWS-RunShellScript",
    ]
  }

  # GetCommandInvocation doesn't support resource-level permissions at all
  # (AWS's own IAM action reference lists no resource types for it) — every
  # working example scopes it to "*". In practice this isn't materially
  # broader access than the statement above: it only lets you read back the
  # status/output of a command whose ID your own SendCommand call already
  # returned, not send new commands or touch anything you don't already
  # have SendCommand access to.
  statement {
    sid    = "ReadBackendDeployStatus"
    effect = "Allow"
    actions = [
      "ssm:GetCommandInvocation",
    ]
    resources = ["*"]
  }

  # Upload the built frontend to its bucket. The bucket name is
  # predictable (set explicitly in the frontend module, not
  # auto-generated), so this can be scoped precisely without needing a
  # cross-module reference.
  statement {
    sid    = "SyncFrontendBucket"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      "arn:aws:s3:::${var.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}",
      "arn:aws:s3:::${var.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}/*", 
    ]
  }

  # Invalidate the CloudFront cache after a frontend deploy, so visitors
  # see the new files immediately instead of a cached old version.
  # Distribution IDs are auto-generated (unlike the bucket name), so
  # this is scoped by account rather than an exact distribution.
  statement {
    sid     = "InvalidateFrontendCache"
    effect  = "Allow"
    actions = ["cloudfront:CreateInvalidation"]
    resources = [
      "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*",
    ]
  }
}

resource "aws_iam_policy" "ci_deploy" {
  name        = "${var.name_prefix}-github-actions-deploy"
  description = "Permissions for GitHub Actions to deploy frontend and backend changes"
  policy      = data.aws_iam_policy_document.ci_deploy.json
}

resource "aws_iam_role_policy_attachment" "ci_deploy" {
  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = aws_iam_policy.ci_deploy.arn
}