# CloudFront requires its certificate to exist in us-east-1 specifically,
# no matter which region everything else lives in — an AWS-wide rule for
# every CloudFront distribution. Since our default provider is configured
# for ap-southeast-4, this module needs a *second* AWS provider connection
# pointed at us-east-1 to request it. Terraform requires every module
# that uses a non-default provider to explicitly declare that it accepts
# one — this block is that declaration. The actual us-east-1 connection
# itself is configured once in environments/dev/provider.tf and handed to
# this module from environments/dev/main.tf.
terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

resource "aws_acm_certificate" "frontend" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = var.extra_domain_names
  validation_method         = "DNS"

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-frontend-cert"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Same wait-for-DNS pattern as Phase 6's backend certificate: this
# resource does nothing itself, it just waits until AWS sees the
# validation CNAME record you'll add manually in Namecheap.
resource "aws_acm_certificate_validation" "frontend" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_acm_certificate.frontend.domain_validation_options : record.resource_record_name]
}
