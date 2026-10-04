#!/bin/bash
# Terraform template (rendered via templatefile() in main.tf) — anything
# written as a single dollar sign followed by curly braces below is a
# Terraform variable substituted in at plan time; anything written with
# a doubled dollar sign is a literal shell variable, escaped so Terraform
# leaves it alone and bash evaluates it at boot time instead. (Written
# this way, rather than showing the literal syntax, because this comment
# itself gets parsed by templatefile() same as the rest of the file —
# writing the literal single-dollar form here previously broke the plan
# with a parse error.)
set -euo pipefail

exec > >(tee -a /var/log/user-data.log) 2>&1
echo "=== CoolChange backend bootstrap starting: $(date) ==="

# --- System packages ---
apt-get update -y
apt-get install -y curl gnupg jq git unzip

# --- Node.js 20 (NodeSource — Ubuntu's own repos only carry older LTS) ---
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# --- AWS CLI v2 (not preinstalled on this AMI) ---
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/awscliv2.zip /tmp/aws

# --- Dedicated, unprivileged user to actually run the app (never root) ---
id -u coolchange &>/dev/null || useradd --system --create-home --home-dir /opt/coolchange --shell /usr/sbin/nologin coolchange

APP_DIR=/opt/coolchange/app
mkdir -p "$${APP_DIR}"

# --- Fetch the read-only GitHub deploy key from Secrets Manager ---
mkdir -p /root/.ssh
aws secretsmanager get-secret-value \
  --region "${aws_region}" \
  --secret-id "${deploy_key_secret_arn}" \
  --query SecretString --output text > /root/.ssh/coolchange_deploy_key
chmod 600 /root/.ssh/coolchange_deploy_key

# GitHub SSH over port 443 instead of the default 22 — the backend
# security group only allows outbound HTTP/HTTPS (80/443), so rather
# than opening another egress port for this one operation, we use
# GitHub's officially supported ssh.github.com:443 endpoint instead.
#
# No ssh-keyscan step here to pre-populate known_hosts (an earlier
# version had one, targeting github.com on the default port 22 — which
# this security group blocks, causing it to hang/fail silently and
# abort the whole script under set -e). StrictHostKeyChecking
# accept-new below already makes SSH trust and save a new host's key
# automatically on first connection, so the pre-population step wasn't
# actually needed even before it broke.
cat > /root/.ssh/config <<EOF
Host github.com
  Hostname ssh.github.com
  Port 443
  IdentityFile /root/.ssh/coolchange_deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
chmod 600 /root/.ssh/config

# --- Give the coolchange user its own copy of the same SSH access. CI's
# redeploy step (deploybackend.yml) runs git fetch as this user, not root,
# via SSM Run Command — without this, that fetch falls back to default
# SSH on port 22 straight to github.com, which the security group blocks
# outbound, and hangs until it times out instead of failing fast.
#
# This is its own key file + config, not a copy of root's — root's own
# files live under /root, which the unprivileged coolchange user can't
# read regardless of what IdentityFile path a config points at, so the
# config below has to reference this directory's own copy of the key.
mkdir -p /opt/coolchange/.ssh
cp /root/.ssh/coolchange_deploy_key /opt/coolchange/.ssh/coolchange_deploy_key

cat > /opt/coolchange/.ssh/config <<EOF
Host github.com
  Hostname ssh.github.com
  Port 443
  IdentityFile /opt/coolchange/.ssh/coolchange_deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF

chown -R coolchange:coolchange /opt/coolchange/.ssh
chmod 700 /opt/coolchange/.ssh
chmod 600 /opt/coolchange/.ssh/coolchange_deploy_key /opt/coolchange/.ssh/config

# --- Clone (or update) the backend repo, development branch only ---
if [ ! -d "$${APP_DIR}/.git" ]; then
  git clone --branch development --single-branch "${repo_ssh_url}" "$${APP_DIR}"
else
  cd "$${APP_DIR}"
  git fetch origin development
  git checkout development
  git reset --hard origin/development
fi

cd "$${APP_DIR}/backend"
npm ci --omit=dev

# --- Build DATABASE_URL from the DB secret and write the env file the
# systemd service will read its configuration from ---
DB_JSON=$(aws secretsmanager get-secret-value \
  --region "${aws_region}" \
  --secret-id "${db_secret_arn}" \
  --query SecretString --output text)

DB_HOST=$(echo "$${DB_JSON}" | jq -r .host)
DB_PORT=$(echo "$${DB_JSON}" | jq -r .port)
DB_NAME=$(echo "$${DB_JSON}" | jq -r .dbname)
DB_USER=$(echo "$${DB_JSON}" | jq -r '.username | @uri')
DB_PASS=$(echo "$${DB_JSON}" | jq -r '.password | @uri')

cat > /etc/coolchange-backend.env <<EOF
PORT=${app_port}
NODE_ENV=production
DATABASE_URL=postgres://$${DB_USER}:$${DB_PASS}@$${DB_HOST}:$${DB_PORT}/$${DB_NAME}
DATABASE_SSL=true
EOF
chmod 600 /etc/coolchange-backend.env
chown coolchange:coolchange /etc/coolchange-backend.env

chown -R coolchange:coolchange /opt/coolchange

# --- systemd service: keeps the app running and restarts it if it crashes ---
cat > /etc/systemd/system/coolchange-backend.service <<EOF
[Unit]
Description=CoolChange backend API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=coolchange
Group=coolchange
WorkingDirectory=$${APP_DIR}/backend
EnvironmentFile=/etc/coolchange-backend.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable coolchange-backend
systemctl restart coolchange-backend

echo "=== CoolChange backend bootstrap finished: $(date) ==="