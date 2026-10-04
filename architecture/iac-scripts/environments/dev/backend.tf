# Points at the bucket/table created by ../../bootstrap. Run bootstrap's
# `terraform apply` once, first — this backend block will fail to init
# until that bucket and table exist.
terraform {
  backend "s3" {
    bucket         = "coolchange-terraform-state-177835492852"
    key            = "dev/terraform.tfstate"
    region         = "ap-southeast-4"
    dynamodb_table = "coolchange-terraform-locks"
    encrypt        = true
  }
}
