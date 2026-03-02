---
name: pulse-dashboard
description: "Install, configure, and manage Pulse Dashboard — a lightweight self-hosted server monitoring dashboard for Linux. Use when a user asks to: install Pulse, set up server monitoring, monitor their VPS or home server with Pulse, check Pulse status, configure alerts, or troubleshoot an existing Pulse install. Pulse shows CPU/RAM/disk/network, systemd services, Docker containers, OpenClaw bot status, Telegram alerts, restart buttons, live log tail, historical charts, bot analytics, and gateway controls. Free and open source — all features included."
---

# Pulse Dashboard Skill

Repo: https://github.com/AzamatMajidov/pulse-dashboard
Free & open source. MIT license. All features included.

## When to Use

- User asks to **install** or **set up** server monitoring
- User wants to **monitor** their VPS, home server, or Raspberry Pi
- User asks about **Pulse status**, config, alerts, or troubleshooting
- User wants to **check** CPU, RAM, disk, services, Docker, or OpenClaw bots from a dashboard

## Install

### Option 1: One-liner (recommended)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/AzamatMajidov/pulse-dashboard/main/scripts/install.sh)
```

### Option 2: Manual

```bash
git clone https://github.com/AzamatMajidov/pulse-dashboard.git ~/pulse-dashboard
cd ~/pulse-dashboard && bash setup.sh
```

### Option 3: Skill script (handles install + update)

```bash
bash scripts/install.sh [/custom/path]   # default: ~/pulse-dashboard
```

### What setup.sh does

1. Checks Node.js ≥ 18
2. Runs `npm install`
3. Creates `config.json` from template
4. Creates systemd service:
   - **Root (VPS):** system-level at `/etc/systemd/system/pulse.service`
   - **Regular user:** user-level at `~/.config/systemd/user/pulse.service` + enables linger
5. Starts Pulse on port 6682

### Prerequisites

- Linux with systemd (Ubuntu, Debian, Fedora, Raspberry Pi OS)
- Node.js ≥ 18 — install: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
- git

### Firewall (if VPS)

```bash
sudo ufw allow 6682
```

Cloud providers: also open port 6682 in security group / firewall rules.

## First-Time Setup

After install, tell the user to open `http://SERVER-IP:6682`. They'll see the setup page.

Walk them through:

1. **Port** — default 6682 (change if needed)
2. **Weather City** — their city name (validated against Open-Meteo)
3. **Network Interface** — click 🔍 Auto-detect
4. **Docker Containers** — Auto-discover (finds all running) or manual list
5. **Systemd Services** — click 🔍 Discover, select what to monitor
6. **Security** — enable Basic Auth for VPS (set username + password)
7. **Telegram Alerts** — auto-detected from OpenClaw, or enter manually
8. **Alert Rules** — add CPU/RAM/disk thresholds, service/bot down rules
9. **OpenClaw Bots** — add bot name (leave Profile empty for default profile)

Hit **Save Settings** → redirected to dashboard.

## Check Status

```bash
# Root (VPS)
systemctl status pulse
journalctl -u pulse -f

# Regular user
systemctl --user status pulse
journalctl --user -u pulse -f
```

Quick health check:
```bash
curl -s http://localhost:6682/api/health
# Should return: {"ok":true}
```

## Update Pulse

### From the dashboard
Settings → Updates → Check for Updates → Update Now

### From terminal
```bash
cd ~/pulse-dashboard && git pull && systemctl restart pulse
# or: systemctl --user restart pulse
```

## Features Reference

| Feature | Description |
|---------|-------------|
| System metrics | CPU, RAM, disk, network with 24h/7d/30d sparklines |
| Docker | Auto-discover containers, restart, live logs |
| Systemd | Monitor system + user services, restart, live logs |
| OpenClaw agents | Online/offline, model, tokens, active sessions, model switcher |
| Cost tracker | Daily/weekly/monthly cost with per-model breakdown |
| Cron monitor | View, create, toggle, delete, run OpenClaw cron jobs |
| Telegram alerts | Threshold-based alerts with cooldown |
| Live log tail | Stream journalctl/Docker logs, auto-scroll, maximize |
| Historical charts | Background collector, sparklines, full-screen charts |
| Self-update | One-click update from Settings |
| Weather | Current conditions via Open-Meteo (free, no API key) |
| Basic auth | Username/password protection |

## Config

Config file: `<install-dir>/config.json`
Web UI handles it — manual editing rarely needed.
See **references/config.md** for full schema and alert rule reference.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't reach dashboard | Check: `systemctl status pulse` and firewall rules |
| Setup page not loading | Use `http://` not `https://`; try `curl http://localhost:6682/api/health` |
| Port conflict | Edit `config.json` → change `port` → restart |
| Service stops on logout | Run `loginctl enable-linger $USER` |
| Bots show offline | Check if OpenClaw gateway is running: `openclaw status` |
| Empty Docker section | Docker not installed, or no running containers |
| Logs empty | Service may be system-level; Pulse auto-detects both |
| Weather not showing | Set a valid city in Settings (validates against Open-Meteo) |
| Metrics stale | Check `journalctl -u pulse -f` for errors |
| Node.js too old | Need ≥ 18: `node -v` to check |

## Multiple Bots

```json
"bots": [
  { "name": "Main Bot", "profile": null },
  { "name": "Personal Bot", "profile": "personal" }
]
```

`profile` matches `openclaw --profile <name>`. Use `null` for default profile.

## Architecture

- **Backend:** Node.js + Express (single `server.js`, ~1700 lines)
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Data:** Reads from `/proc`, `systemctl`, `docker`, `sensors`
- **Storage:** `config.json` + `data/` directory (history, bot cache)
- **~25MB RAM**, near-zero CPU — runs on anything
