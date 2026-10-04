# Bootstrap: creates the remote state bucket + lock table used by
# every other Terraform config in this project (environments/dev, and
# later environments/staging etc.).
#
# Run this ONCE, manually, before anything in environments/ will work:
#   cd bootstrap
#   terraform init
#   terraform plan
#   terraform apply
#
# After the first apply, this config is essentially never touched again.

resource "aws_s3_bucket" "terraform_state" {
  bucket = "coolchange-terraform-state-177835492852"

  # Guards against `terraform destroy` accidentally wiping out state
  # for every other environment.
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Project     = "coolchange"
    Iteration   = "1"
    Environment = "shared"
    Purpose     = "terraform-state"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "coolchange-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Project     = "coolchange"
    Iteration   = "1"
    Environment = "shared"
    Purpose     = "terraform-state-locking"
  }
}
