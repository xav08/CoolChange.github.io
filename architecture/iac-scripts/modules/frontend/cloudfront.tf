# Origin Access Control — lets CloudFront authenticate directly to the
# private S3 bucket using signed requests, without the bucket needing to
# be public. This is the modern replacement for the older Origin Access
# Identity mechanism.
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.name_prefix}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed cache policy — a ready-made, sensible caching configuration
# (cache by URL only, ignore headers/cookies/query strings) rather than
# hand-rolling cache rules from scratch.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = [var.domain_name]

  # PriceClass_100 = cheapest tier, uses edge locations in North America
  # and Europe only. Visitors elsewhere (including Melbourne) still get
  # served — CloudFront just routes them to the nearest *included* edge
  # rather than a local one, adding some latency. Reasonable trade-off
  # for a student project on a budget; switch to PriceClass_200 or
  # PriceClass_All later if Australian load times become a real concern.
  price_class = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.frontend.id
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = aws_s3_bucket.frontend.id
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  # SPA routing: S3 has no real object at e.g. /methodology, so it
  # answers with 403 (private bucket) or 404. Instead of showing that
  # error, CloudFront serves index.html with a 200 status, and your
  # client-side router takes over from there.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-frontend-cdn"
  })
}

# Only this exact CloudFront distribution may read from the bucket — the
# condition checks the distribution's own ARN, not just "any CloudFront
# distribution in the account".
data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json
}


# Iteration-aware SPA routing, evaluated before the S3 origin is hit.
# The custom_error_response blocks below stay as a dumb fallback safety
# net — they just won't normally fire anymore, since this function
# resolves extensionless paths itself.
resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.name_prefix}-spa-routing"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/cloudfront-functions/spa-routing.js")
}