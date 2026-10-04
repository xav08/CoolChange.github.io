data "aws_caller_identity" "current" {}

# Private bucket holding the built frontend (HTML/JS/CSS). Nothing here
# is ever reached directly — only CloudFront is allowed to read from it
# (see cloudfront.tf), matching the security plan's requirement that the
# frontend bucket stays private and is served only through CloudFront.
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-frontend"
  })
}

# Versioning means a bad deploy can be rolled back to the previous set of
# files by restoring older object versions, same reasoning as the
# Terraform state bucket in Phase 0.
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Blocks every form of public access at the bucket level. CloudFront
# still reaches in via its Origin Access Control identity (cloudfront.tf)
# — that's a signed-request mechanism, not "public access", so this
# block doesn't interfere with it.
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
