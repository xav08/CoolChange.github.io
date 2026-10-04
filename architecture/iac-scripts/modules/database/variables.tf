variable "name_prefix" {
  description = "Prefix for resource names, e.g. coolchange-dev"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource this module creates"
  type        = map(string)
  default     = {}
}

# From the networking module (Phase 1) — passed in rather than looked up,
# so this module doesn't need to know how the network is built.
variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "database_security_group_id" {
  description = "Security group ID for the database"
  type        = string
}

variable "backend_security_group_id" {
  description = "Security group ID for the backend — the only thing allowed to reach the DB"
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "16.15" # 16.4 isn't offered in ap-southeast-4 — confirmed
  # available versions via `aws rds describe-db-engine-versions`
}

variable "instance_class" {
  description = "RDS instance size — smallest available, fine for a dev database"
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Storage size in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Initial database name"
  type        = string
  default     = "coolchange"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "coolchange_admin"
}
