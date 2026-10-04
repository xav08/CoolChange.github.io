variable "name_prefix" {
  description = "Prefix for resource names, e.g. coolchange-dev"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource this module creates"
  type        = map(string)
  default     = {}
}

variable "domain_name" {
  description = "Full domain name CloudFront serves the frontend on, e.g. www.coolchange.me"
  type        = string
}

variable "extra_domain_names" {
  description = "Additional hostnames on the certificate and distribution, e.g. www1.coolchange.me"
  type        = list(string)
  default     = []
}

variable "attach_primary_alias" {
  description = "Attach domain_name as a CloudFront alias. False while another distribution (e.g. in the old AWS account) still owns it."
  type        = bool
  default     = true
}