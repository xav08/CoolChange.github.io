locals {
  project = "coolchange"

  # Applied to every resource in this environment via the provider's
  # default_tags (see provider.tf) — nothing created from Phase 1
  # onward needs to tag itself manually.
  common_tags = {
    Project     = local.project
    Iteration   = "1"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # Naming convention for resources created by modules going forward:
  # ${local.name_prefix}-<resource>, e.g. coolchange-dev-vpc,
  # coolchange-dev-rds, coolchange-dev-alb.
  name_prefix = "${local.project}-${var.environment}"

  # Registered via GitHub Student Developer Pack (Namecheap). One place
  # to change it — both the loadbalancer module (Phase 6) and the
  # frontend module (Phase 7) build their subdomains off this.
  domain_name         = "coolchange.me"
  backend_domain_name = "api.${local.domain_name}"

  # New in Phase 9 — identifies the repo GitHub Actions is allowed to
  # deploy from (used in the iam module's OIDC trust policy) and the
  # SSH clone URL the backend instance's boot script pulls from. One
  # place to change either if the repo is ever renamed or transferred.
  github_org          = "xav08"
  github_repo         = "CoolChange.github.io"
  github_repo_ssh_url = "git@github.com:${local.github_org}/${local.github_repo}.git"

  # Single source of truth for the backend's listening port — passed
  # explicitly into both the compute and loadbalancer modules below,
  # rather than relying on their two separate app_port variables'
  # defaults happening to match each other. Change it here once if the
  # app's port ever changes, instead of hunting through multiple files.
  backend_app_port = 3000

  # Test hostnames for the account migration — the new stack serves these
  # before cutover. The real www/api names move across in Step 15.
  frontend_test_domain_name = "www1.${local.domain_name}"
  backend_test_domain_name  = "api1.${local.domain_name}"

  # False until cutover: the old AWS account's CloudFront distribution still
  # owns www.coolchange.me, and CloudFront aliases are exclusive across accounts.
  frontend_attach_primary_alias = true
}