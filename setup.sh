#!/usr/bin/env bash
set -e

echo ""
echo "🫀 Pulse Dashboard Setup"
echo "========================"
echo ""

# Check Node.js >= 18
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js >= 18 first."
  echo "   https://nodejs.org or: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js >= 18 required. Current: $(node --version)"
  exit 1
fi

echo "✅ Node.js $(node --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install --silent
echo "✅ Dependencies installed"

# Create config.json from example if not exists
if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo ""
  echo "📝 Created config.json from template"
  echo "   ⚠️  Edit config.json with your settings before proceeding!"
else
  echo ""
  echo "✅ config.json already exists"
fi

# Create systemd service
PULSE_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(which node)"

if [ "$(id -u)" -eq 0 ]; then
  # Running as root — use system-level service
  SERVICE_FILE="/etc/systemd/system/pulse.service"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Pulse Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${PULSE_DIR}
ExecStart=${NODE_BIN} ${PULSE_DIR}/server.js
Restart=always
RestartSec=2
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable pulse
  systemctl start pulse
  echo "✅ Systemd service created (system-level)"
else
  # Running as regular user — use user-level service + linger
  SERVICE_DIR="$HOME/.config/systemd/user"
  SERVICE_FILE="$SERVICE_DIR/pulse.service"
  mkdir -p "$SERVICE_DIR"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Pulse Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${PULSE_DIR}
ExecStart=${NODE_BIN} ${PULSE_DIR}/server.js
Restart=always
RestartSec=2
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable pulse
  systemctl --user start pulse

  # Enable linger so service survives logout/reboot
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$(whoami)" 2>/dev/null && \
      echo "✅ Linger enabled (service survives reboot)" || \
      echo "⚠️  Run: sudo loginctl enable-linger $(whoami)  — so Pulse survives reboot"
  fi
  echo "✅ Systemd service created (user-level)"
fi

echo ""
echo "✅ Pulse is running!"
echo ""

# Get port from config.json
PORT=$(node -e "try { const c = require('./config.json'); process.stdout.write(String(c.port || 6682)); } catch { process.stdout.write('6682'); }")
IP=$(hostname -I | awk '{print $1}')

echo "🌐 Access your dashboard at:"
echo "   http://localhost:${PORT}"
echo "   http://${IP}:${PORT}"
echo ""
if [ "$(id -u)" -eq 0 ]; then
  echo "📝 Manage:"
  echo "   systemctl restart pulse"
  echo "   systemctl status pulse"
  echo ""
  echo "📋 Logs:"
  echo "   journalctl -u pulse -f"
else
  echo "📝 Manage:"
  echo "   systemctl --user restart pulse"
  echo "   systemctl --user status pulse"
  echo ""
  echo "📋 Logs:"
  echo "   journalctl --user -u pulse -f"
fi
echo ""

# Firewall hint if ufw is present
if command -v ufw &>/dev/null; then
  UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1 || echo "inactive")
  if echo "$UFW_STATUS" | grep -q "active"; then
    echo "🔒 Firewall detected. To allow external access:"
    echo "   sudo ufw allow ${PORT}"
    echo ""
  fi
fi
