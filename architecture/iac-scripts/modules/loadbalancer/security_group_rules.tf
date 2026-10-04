# Internet -> ALB: anyone can reach the load balancer on plain HTTP...
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = var.alb_security_group_id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"

  description = "Allow inbound HTTP from anywhere (redirected to HTTPS)"
}

# ...and on HTTPS, which is the one that actually serves traffic.
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = var.alb_security_group_id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"

  description = "Allow inbound HTTPS from anywhere"
}

# ALB -> backend: the only outbound path this security group needs is
# forwarding traffic to the backend on its app port (the shell has zero
# rules by default, same as every other SG so far).
resource "aws_vpc_security_group_egress_rule" "alb_to_backend" {
  security_group_id            = var.alb_security_group_id
  referenced_security_group_id = var.backend_security_group_id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"

  description = "Allow outbound traffic to the backend only"
}
