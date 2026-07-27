#!/usr/bin/env bash
# ==============================================================================
# TenderPocket Remote Server Auto-Deployment Tool
# Deploys TenderPocket Spring Boot + PostgreSQL on any Client Linux/Mac Server via SSH
# ==============================================================================

set -e

# Default parameters
SERVER_IP=""
SSH_USER="root"
SSH_PORT="22"
DB_PASS="postgres_secret_123"
APP_PORT="8080"
JAR_PATH="client-package/TenderPocket.jar"

usage() {
    echo "Usage: $0 -h <SERVER_IP> [-u <SSH_USER>] [-p <SSH_PORT>] [-P <DB_PASSWORD>] [-port <APP_PORT>]"
    echo ""
    echo "Options:"
    echo "  -h  Target client server IP address or hostname (Required)"
    echo "  -u  SSH username (Default: root)"
    echo "  -p  SSH port (Default: 22)"
    echo "  -P  PostgreSQL password to configure (Default: postgres_secret_123)"
    echo "  -port App HTTP port (Default: 8080)"
    echo ""
    echo "Example:"
    echo "  ./deploy/deploy-remote.sh -h 192.168.1.100 -u ubuntu -P MySecretPass123"
    exit 1
}

while getopts "h:u:p:P:port:" opt; do
    case ${opt} in
        h) SERVER_IP=$OPTARG ;;
        u) SSH_USER=$OPTARG ;;
        p) SSH_PORT=$OPTARG ;;
        P) DB_PASS=$OPTARG ;;
        port) APP_PORT=$OPTARG ;;
        *) usage ;;
    esac
done

if [ -z "$SERVER_IP" ]; then
    echo "❌ Error: Client server IP (-h) is required."
    usage
fi

echo "=========================================================="
echo "🚀 Deploying TenderPocket to Client Server: ${SSH_USER}@${SERVER_IP}:${SSH_PORT}"
echo "=========================================================="

# 1. Build latest production JAR if needed
if [ ! -f "$JAR_PATH" ]; then
    echo "📦 Building TenderPocket production JAR..."
    mvn clean package -DskipTests
    cp target/tender-pocket-spring-0.0.1-SNAPSHOT.jar client-package/TenderPocket.jar
fi

# 2. Test SSH connection
echo "🔐 Verifying SSH connection to ${SSH_USER}@${SERVER_IP}..."
ssh -p ${SSH_PORT} -o BatchMode=yes -o ConnectTimeout=5 ${SSH_USER}@${SERVER_IP} "echo 'SSH Connection Verified'" || {
    echo "❌ SSH connection failed. Please verify credentials or set up SSH keys."
    exit 1
}

# 3. Create remote target directory
echo "📁 Setting up remote installation directory /opt/tender-pocket..."
ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP} "sudo mkdir -p /opt/tender-pocket /opt/tender-pocket/public/documents && sudo chown -R \$USER:\$USER /opt/tender-pocket"

# 4. Copy JAR and application properties
echo "📤 Uploading executable binary and configuration to client server..."
scp -P ${SSH_PORT} ${JAR_PATH} ${SSH_USER}@${SERVER_IP}:/opt/tender-pocket/TenderPocket.jar

# Create remote application.properties
ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP} "cat << 'EOF' > /opt/tender-pocket/application.properties
server.port=${APP_PORT}
spring.datasource.url=jdbc:postgresql://localhost:5432/tender_pocket?sslmode=disable
spring.datasource.username=postgres
spring.datasource.password=${DB_PASS}
spring.datasource.driver-class-name=org.postgresql.Driver
spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect
spring.jpa.hibernate.ddl-auto=update
EOF"

# 5. Provision PostgreSQL & Java 21 on target machine
echo "⚙️ Installing Java 21 & PostgreSQL on client server..."
ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP} "
if command -v apt-get &> /dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq openjdk-21-jre-headless postgresql postgresql-contrib
elif command -v yum &> /dev/null; then
    sudo yum install -y java-21-openjdk-headless postgresql-server postgresql-contrib
elif command -v brew &> /dev/null; then
    brew install openjdk@21 postgresql@16
fi
"

# 6. Initialize PostgreSQL database and user
echo "🐘 Configuring PostgreSQL database 'tender_pocket'..."
ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP} "
sudo -u postgres psql -c \"ALTER USER postgres WITH PASSWORD '${DB_PASS}';\" 2>/dev/null || true
sudo -u postgres psql -c \"CREATE DATABASE tender_pocket;\" 2>/dev/null || true
"

# 7. Install & Enable Systemd Service for 24/7 background operation & auto-restart
echo "🔧 Installing systemd background service (tenderpocket.service)..."
ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP} "
cat << 'EOF' | sudo tee /etc/systemd/system/tenderpocket.service > /dev/null
[Unit]
Description=TenderPocket Spring Boot Workflow Service
After=network.target postgresql.service

[Service]
User=\$USER
WorkingDirectory=/opt/tender-pocket
ExecStart=/usr/bin/java -jar /opt/tender-pocket/TenderPocket.jar
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=tenderpocket

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tenderpocket.service
sudo systemctl restart tenderpocket.service
"

echo ""
echo "=========================================================="
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "=========================================================="
echo "📍 Application URL: http://${SERVER_IP}:${APP_PORT}"
echo "🛡 Service Status:  ssh ${SSH_USER}@${SERVER_IP} 'sudo systemctl status tenderpocket'"
echo "=========================================================="
