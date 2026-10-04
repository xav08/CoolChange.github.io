# Values Phase 4 (backend compute) and later Phase 8 (secrets/app wiring)
# will need — the backend doesn't get the password directly from here,
# it gets the secret's ARN and reads the value itself at runtime via its
# IAM role's permissions (Phase 2).

output "db_endpoint" {
  description = "Database hostname (no port)"
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "Database port"
  value       = aws_db_instance.main.port
}

output "db_secret_arn" {
  description = "ARN of the Secrets Manager secret holding DB connection info"
  value       = aws_secretsmanager_secret_version.db.arn
}
