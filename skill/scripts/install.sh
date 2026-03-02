#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/AzamatMajidov/pulse-dashboard.git"
INSTALL_DIR="${1:-$HOME/pulse-dashboard}"

echo ""
echo "🫀 Pulse Dashboard Installer"
echo "============================="
echo ""

# Check git
if ! command -v git &>/dev/null; then
  echo "❌ git is not installed."
  echo "   Install with: sudo apt-get install -y git"
  exit 1
fi
echo "✅ git found"

# Check Node.js >= 18
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is not installed. Need v18+."
  echo "   Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js >= 18 required. Current: $(node --version)"
  exit 1
fi
echo "✅ Node.js $(node --version)"

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo ""
  echo "📁 Found existing install at $INSTALL_DIR — pulling latest..."
  cd "$INSTALL_DIR"
  git pull
else
  echo ""
  echo "📥 Cloning Pulse Dashboard to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Run the built-in setup
echo ""
bash setup.sh
