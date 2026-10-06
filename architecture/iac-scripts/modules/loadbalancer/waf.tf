# Rate limiting for the API. The ALB has no request counter of its own, so
# this lives in AWS WAF: a web ACL with one rate-based rule, attached to the
# ALB below. Requests over the limit get a 429 from the ALB and never reach
# the backend instance.
resource "aws_wafv2_web_acl" "backend" {
  name  = "${var.name_prefix}-api"
  scope = "REGIONAL" # ALB = regional. (CloudFront would be CLOUDFRONT, us-east-1 only.)

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 1

    action {
      block {
        custom_response {
          response_code = 429

          # Without this, a blocked request has no CORS headers and the
          # browser reports a CORS error instead of "too many requests".
          response_header {
            name  = "Access-Control-Allow-Origin"
            value = var.cors_allowed_origin
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit                 = var.rate_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-api"
    sampled_requests_enabled   = true
  }

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-api-waf"
  })
}

resource "aws_wafv2_web_acl_association" "backend" {
  resource_arn = aws_lb.backend.arn
  web_acl_arn  = aws_wafv2_web_acl.backend.arn
}