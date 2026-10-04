# ACM certificate for the backend's custom domain. DNS validation proves
# ownership by requiring a specific CNAME record to exist wherever the
# domain's DNS is hosted — Namecheap in our case, not AWS, so Terraform
# can request the certificate but can't add that DNS record itself.
# That record gets added manually between the two applies for this phase.
resource "aws_acm_certificate" "backend" {
  domain_name               = var.domain_name
  subject_alternative_names = var.extra_domain_names
  validation_method         = "DNS"

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-backend-cert"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Waits for AWS to see the validation CNAME record in DNS and mark the
# certificate issued. Stays pending — and will eventually time out — until
# that record exists, so this is the resource that completes on the
# *second* apply, after the CNAME has been added at Namecheap.
resource "aws_acm_certificate_validation" "backend" {
  certificate_arn         = aws_acm_certificate.backend.arn
  validation_record_fqdns = [for record in aws_acm_certificate.backend.domain_validation_options : record.resource_record_name]
}
