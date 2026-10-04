variable "name_prefix" {
  description = "Prefix for resource names, e.g. coolchange-dev"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource this module creates"
  type        = map(string)
  default     = {}
}

# From the networking module (Phase 1)
variable "vpc_id" {
  description = "VPC ID — the ALB and its target group both need this"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs — the ALB itself runs across these"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "backend_security_group_id" {
  description = "Security group ID for the backend — the ALB needs an egress rule to reach it"
  type        = string
}

# From the compute module (Phase 5)
variable "backend_instance_id" {
  description = "EC2 instance ID to attach to the target group"
  type        = string
}

variable "app_port" {
  description = "Port the backend application listens on — must match the compute module's app_port"
  type        = number
  default     = 3000

  # Was 8000, same placeholder-turned-stale-value bug as the compute
  # module's app_port. Fixed here in Phase 9 after discovering the ALB's
  # target group was still routing to 8000 (its own separate variable,
  # never updated when compute's was corrected) even though the backend
  # itself was healthy on 3000 — every request 504'd with no target
  # group ever going healthy. Both environments/dev/main.tf module calls
  # now also pass this explicitly from one shared local, so the two
  # defaults matching each other by convention is a fallback, not the
  # only thing keeping them in sync.
}

# New for this phase
variable "domain_name" {
  description = "Full domain name the ALB serves, e.g. api.coolchange.me — the ACM certificate is issued for this exact name"
  type        = string
}

variable "health_check_path" {
  description = "Path the ALB hits to check the backend is healthy"
  type        = string
  default     = "/health"

  # Was "/" (a placeholder) through Phases 6-8. Confirmed the real value
  # in Phase 9 by inspecting the running app's own startup log, which
  # advertises "/health" — the root path "/" isn't a defined route and
  # returns 404, which was silently failing the ALB's health check and
  # causing every request through the ALB to 504, even once the backend
  # itself was fully working.
}

variable "extra_domain_names" {
  description = "Additional hostnames on the ALB certificate, e.g. api1.coolchange.me"
  type        = list(string)
  default     = []
}