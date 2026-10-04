# ALB -> backend: only the load balancer can reach the app port.
resource "aws_vpc_security_group_ingress_rule" "backend_from_alb" {
  security_group_id            = var.backend_security_group_id
  referenced_security_group_id = var.alb_security_group_id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"

  description = "Allow app traffic from the ALB only"
}

# Backend -> internet: HTTPS, for external APIs, Secrets Manager, the
# GitHub SSH-over-443 clone, NodeSource, and the AWS CLI installer.
# Needed because there's no NAT gateway and the backend's security group
# otherwise has zero outbound rules beyond the database access rule
# added in Phase 3.
resource "aws_vpc_security_group_egress_rule" "backend_to_internet_https" {
  security_group_id = var.backend_security_group_id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"

  description = "Allow outbound HTTPS to anywhere"
}

# Backend -> internet: HTTP. Added in Phase 9 after the boot script
# actually failed on this — Ubuntu's default apt mirrors
# (*.ec2.archive.ubuntu.com, security.ubuntu.com) serve packages over
# plain HTTP, not HTTPS, so apt-get install had no way to reach them
# with only port 443 open. The original Phase 5 comment assumed HTTPS
# alone would cover "OS package updates" — it doesn't, for this
# specific case.
resource "aws_vpc_security_group_egress_rule" "backend_to_internet_http" {
  security_group_id = var.backend_security_group_id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"

  description = "Allow outbound HTTP to anywhere (needed for apt package mirrors)"
}

# SSM Session Manager access — lets the team open a shell on this
# instance from the AWS Console/CLI without SSH or opening port 22.
# Attached here, not in the iam module from Phase 2, because it's
# specifically about managing this compute instance.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = var.backend_role_name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Optional direct SSH — off by default, since admin_cidr_blocks defaults
# to an empty list (meaning for_each creates zero rules). One rule per
# CIDR provided, since this rule type only accepts a single source per
# resource — can't pass a list of CIDRs into one rule.
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each = toset(var.admin_cidr_blocks)

  security_group_id = var.backend_security_group_id
  cidr_ipv4         = each.value
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"

  description = "Direct SSH access (admin_cidr_blocks override)"
}