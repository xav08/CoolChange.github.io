# What you need to point DNS at the ALB, once everything's applied.
output "alb_dns_name" {
  description = "The ALB's own AWS-assigned hostname — Namecheap CNAME target for api.coolchange.me once the cert is validated"
  value       = aws_lb.backend.dns_name
}

# The certificate validation record — copy these three values into a new
# CNAME record in Namecheap's DNS panel after the *first* apply, before
# running the second apply that completes validation.
output "certificate_validation_record_name" {
  description = "CNAME record name AWS expects to see for domain validation"
  value       = tolist(aws_acm_certificate.backend.domain_validation_options)[0].resource_record_name
}

output "certificate_validation_record_value" {
  description = "CNAME record value AWS expects to see for domain validation"
  value       = tolist(aws_acm_certificate.backend.domain_validation_options)[0].resource_record_value
}

output "certificate_arn" {
  description = "ARN of the backend's ACM certificate, for reference"
  value       = aws_acm_certificate.backend.arn
}

output "web_acl_arn" {
  description = "ARN of the WAF web ACL attached to the ALB"
  value       = aws_wafv2_web_acl.backend.arn
}
