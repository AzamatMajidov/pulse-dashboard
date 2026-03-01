# 🫀 Pulse

A lightweight, self-hosted server monitoring dashboard for [OpenClaw](https://openclaw.ai) users.

Dark UI. Zero cloud dependencies. Runs on anything — home server, VPS, Raspberry Pi.

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Free](https://img.shields.io/badge/price-free-success)

## Features

- **System metrics** — CPU, RAM, disk, network with historical sparklines (24h/7d/30d)
- **Docker containers** — auto-discover or pick specific ones; restart & live logs
- **Systemd services** — monitor system or user services; restart & live logs
- **OpenClaw agents** — online/offline status, model, active sessions, token usage; model switcher; gateway controls
- **Cost tracker** — daily/weekly/monthly cost breakdown with per-model pricing
- **Cron monitor** — view, create, toggle, delete, and run OpenClaw cron jobs
- **Telegram alerts** — CPU/RAM/disk thresholds, service/container/bot down; auto-detects OpenClaw credentials
- **Live log tail** — stream journalctl or Docker logs in-browser with auto-scroll & maximize
- **Historical charts** — background collector; sparklines on every card; full-screen charts
- **Self-update** — one-click update from Settings (no terminal needed)
- **Weather widget** — current conditions for your city via Open-Meteo
- **Basic auth** — protect your dashboard with username/password
- **Zero build step** — plain Node.js + Express, no bundler, no framework

## Screenshots

<!-- TODO: Add screenshots/GIF -->

## Quick Start

```bash
git clone https://github.com/AzamatMajidov/pulse-dashboard.git ~/pulse
cd ~/pulse && bash setup.sh
```

That's it. `setup.sh` handles everything:
1. ✅ Checks Node.js ≥ 18
2. 📦 Installs dependencies
3. ⚙️ Creates config from template
4. 🔧 Sets up systemd service (auto-start on boot)
5. 🚀 Starts Pulse

Open `http://YOUR-IP:6682` → fill in the setup form → done.

### Prerequisites

- **Linux with systemd** (Ubuntu, Debian, Fedora, Raspberry Pi OS, etc.)
- **Node.js ≥ 18** — [install guide](https://nodejs.org)
- **OpenClaw** (optional) — agent monitoring requires OpenClaw installed

### Firewall (VPS)

```bash
sudo ufw allow 6682
```

## Configuration

Everything is configured through the web UI at `/settings`. Config is saved to `config.json`.

<details>
<summary>Example config.json</summary>

```json
{
  "label": "My Server",
  "port": 6682,
  "networkIface": "auto",
  "weatherLocation": "London",
  "dockerContainers": "auto",
  "systemdServices": ["my-app", "nginx"],
  "auth": {
    "enabled": true,
    "username": "admin",
    "password": "your-secure-password"
  },
  "bots": [
    { "name": "My Bot", "profile": null }
  ],
  "alerts": {
    "cooldownMinutes": 15,
    "rules": [
      { "metric": "cpu", "op": "gt", "threshold": 85, "durationSeconds": 60 },
      { "metric": "ram", "op": "gt", "threshold": 90 },
      { "metric": "service_down", "target": "my-app" },
      { "metric": "bot_offline", "target": "My Bot" }
    ]
  }
}
```

</details>

### Key settings

| Key | Default | Description |
|-----|---------|-------------|
| `port` | `6682` | HTTP port |
| `networkIface` | `"auto"` | Network interface or `"auto"` to detect |
| `weatherLocation` | — | City name for weather widget |
| `dockerContainers` | `"auto"` | `"auto"` = all running, or `["name1","name2"]` |
| `systemdServices` | `[]` | Systemd services to monitor |
| `auth.enabled` | `false` | Enable HTTP Basic Auth |
| `bots` | `[]` | OpenClaw bot profiles (`profile: null` = default) |

### Alert rules

Pulse auto-detects Telegram credentials from OpenClaw. Rules are evaluated every 10 seconds.

| Metric | Description |
|--------|-------------|
| `cpu` | CPU % — `op: "gt"`, `threshold`, optional `durationSeconds` |
| `ram` | RAM % — same as cpu |
| `disk` | Disk % — same as cpu |
| `service_down` | Systemd service offline — `target: "name"` |
| `container_down` | Docker container stopped — `target: "name"` |
| `bot_offline` | OpenClaw bot offline — `target: "Bot Name"` |

### Multiple bots

```json
"bots": [
  { "name": "Work Bot", "profile": null },
  { "name": "Personal Bot", "profile": "personal" }
]
```

`profile` matches the OpenClaw profile name (`openclaw --profile <name>`). Use `null` for default.

## Management

```bash
# Running as root (VPS)
systemctl status pulse
systemctl restart pulse
journalctl -u pulse -f

# Running as regular user
systemctl --user status pulse
systemctl --user restart pulse
journalctl --user -u pulse -f
```

## Stack

- **Backend:** Node.js + Express (single file, ~1700 lines)
- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step
- **Data:** `/proc` filesystem, `systemctl`, `docker`, `sensors`
- **Charts:** Chart.js (CDN)
- **Alerts:** Telegram Bot API (direct HTTP, no deps)

## FAQ

**Does it work without OpenClaw?**
Yes. System metrics, Docker, systemd services, weather, and alerts all work standalone. The agents section will show "No OpenClaw agents detected."

**Does it work without Docker?**
Yes. The Docker section gracefully hides when Docker isn't installed.

**Can I monitor multiple servers?**
Each server runs its own Pulse instance. There's no centralized multi-server view (yet).

**How much resources does it use?**
~25MB RAM, near-zero CPU. Designed to run on a Raspberry Pi.

## License

MIT — free forever, no paywalls.

---

Built by [Azamat Majidov](https://linkedin.com/in/azamat-majidov) for the [OpenClaw](https://openclaw.ai) community.

If you find it useful, consider starring ⭐ the repo or buying me a coffee:

<a href="https://buymeacoffee.com/azamatmajidov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="40"></a>
