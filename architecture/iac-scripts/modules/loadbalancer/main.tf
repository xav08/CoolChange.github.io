# The load balancer itself. Sits in the public subnets (it needs to be
# reachable from the internet), fronted by the ALB security group.
resource "aws_lb" "backend" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [var.alb_security_group_id]

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-alb"
  })
}

# Where the ALB sends traffic. Points at the backend instance on its app
# port, with a periodic health check so the ALB knows if it stops
# responding.
resource "aws_lb_target_group" "backend" {
  # name_prefix instead of a fixed name — required for the
  # create_before_destroy lifecycle below to actually work. AWS target
  # group names must be unique, so if this still had a fixed name,
  # Terraform couldn't create the replacement while the original (with
  # that same name) still exists; name_prefix lets AWS append its own
  # random suffix so both can briefly coexist. Capped at 6 characters —
  # an AWS-specific limit for this argument, tighter than most other
  # resources' name_prefix.
  name_prefix = "tg-"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = var.health_check_path
    protocol            = "HTTP"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-backend-tg"
  })

  # Learned the hard way in Phase 9: without this, changing port (or
  # anything else that forces replacement) makes Terraform try to
  # delete the old target group before creating a new one — but AWS
  # refuses that delete while a listener still points at it, since the
  # listener update itself can't happen until the new target group
  # exists. This flips the order: create the new one, repoint the
  # listener, THEN delete the old one — no gap with a broken listener.
  lifecycle {
    create_before_destroy = true
  }
}

# Registers the actual backend EC2 instance (from Phase 5) as the one
# thing this target group sends traffic to.
resource "aws_lb_target_group_attachment" "backend" {
  target_group_arn = aws_lb_target_group.backend.arn
  target_id        = var.backend_instance_id
  port             = var.app_port
}

# Port 80: no plaintext traffic served, just an immediate redirect to
# HTTPS on the same host/path.
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.backend.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Port 443: the real listener. Uses the validated certificate from
# acm.tf, so this resource implicitly waits for that certificate to
# finish validating before it can be created.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.backend.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.backend.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}