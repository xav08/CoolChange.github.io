# Map of secret name => ARN, one entry per secret in var.app_secrets.
# Backend app config (or CI/CD, later) can look up "how do I find secret
# X" without hardcoding ARNs anywhere.
output "secret_arns" {
  description = "Map of app secret name to its Secrets Manager ARN"
  value       = { for name, version in aws_secretsmanager_secret_version.app : name => version.arn }
}
