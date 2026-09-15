module "networking" {
  source = "../../modules/networking"

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  # vpc_cidr and availability_zones both use the module's defaults
  # (10.0.0.0/16, ap-southeast-4a/4b) — override here later if dev ever
  # needs something different.
}

module "iam" {
  source = "../../modules/iam"

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  # New in Phase 9 — scopes the OIDC trust policy (oidc.tf) to only
  # accept workflow runs from this exact repo.
  github_org  = local.github_org
  github_repo = local.github_repo
}

module "database" {
  source = "../../modules/database"

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  private_subnet_ids         = module.networking.private_subnet_ids
  database_security_group_id = module.networking.database_security_group_id
  backend_security_group_id  = module.networking.backend_security_group_id

  # engine_version, instance_class, allocated_storage, db_name, and
  # db_username all use the module's small/cheap dev defaults.
}

module "compute" {
  source = "../../modules/compute"

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  public_subnet_ids         = module.networking.public_subnet_ids
  backend_security_group_id = module.networking.backend_security_group_id
  alb_security_group_id     = module.networking.alb_security_group_id

  instance_profile_name = module.iam.backend_instance_profile_name
  backend_role_name     = module.iam.backend_role_name

  # instance_type and admin_cidr_blocks use the module's defaults.
  app_port = local.backend_app_port

  # New in Phase 9 — everything the boot script (user_data.sh.tpl) needs
  # to pull the backend code and wire it up to the database.
  github_repo_ssh_url   = local.github_repo_ssh_url
  deploy_key_secret_arn = module.secrets.secret_arns["github-deploy-key"]
  db_secret_arn         = module.database.db_secret_arn
  aws_region             = var.region
}

module "loadbalancer" {
  source = "../../modules/loadbalancer"

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  vpc_id                     = module.networking.vpc_id
  public_subnet_ids          = module.networking.public_subnet_ids
  alb_security_group_id      = module.networking.alb_security_group_id
  backend_security_group_id  = module.networking.backend_security_group_id

  backend_instance_id = module.compute.instance_id

  domain_name = local.backend_domain_name

  # app_port passed explicitly from the same shared local as the compute
  # module above, so the two can no longer drift out of sync the way
  # they did earlier in Phase 9. health_check_path uses the module's
  # default, now corrected to the confirmed real value ("/health") — see
  # modules/loadbalancer/variables.tf.
  app_port = local.backend_app_port
}

module "frontend" {
  source = "../../modules/frontend"

  # Hands this module both AWS connections: the default one (for S3 and
  # CloudFront, which aren't region-scoped) and the us_east_1-aliased one
  # from provider.tf (required for the ACM certificate). The module's own
  # configuration_aliases declaration in acm.tf is what makes it able to
  # accept this second one at all.
  providers = {
    aws            = aws
    aws.us_east_1  = aws.us_east_1
  }

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  domain_name = "www.${local.domain_name}"
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix = local.name_prefix
  common_tags = local.common_tags

  # First real entry, added in Phase 9: the backend instance's GitHub
  # SSH key, read from the gitignored terraform.tfvars value rather
  # than hardcoded here. Becomes coolchange-dev/github-deploy-key in
  # Secrets Manager — already readable by the backend thanks to Phase
  # 2's IAM policy, and referenced by the compute module above via
  # module.secrets.secret_arns["github-deploy-key"].
  app_secrets = {
    "github-deploy-key" = var.backend_deploy_key
  }
}

module "team_access" {
  source       = "../../modules/team_access"
  team_members = ["savio", "priyanshu", "yu", "yipu", "sheng", "linda"]
}