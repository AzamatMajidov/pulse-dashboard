# 🫀 Pulse

A lightweight, self-hosted server monitoring dashboard for [OpenClaw](https://openclaw.ai) users.

Dark UI. Zero cloud dependencies. Runs on anything — home server, VPS, Raspberry Pi.

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **System metrics** — CPU (+ temp), RAM, disk, network speed with historical sparklines (24h/7d/30d)
- **Docker containers** — auto-discover or watch specific ones; restart buttons
- **Systemd services** — monitor any user or system service; restart buttons
- **OpenClaw bots** — online/offline status, model, uptime, analytics; gateway controls; per-bot model switcher with per-profile model dropdown
- **Bot analytics** — session counts, token usage, and cost tracking per bot
- **Cost tracker** — today/month cost totals with daily breakdown chart; accurate per-model pricing with real token breakdown
- **Cron monitor** — view, create, toggle, delete, and run OpenClaw cron jobs from the dashboard; human-readable schedule badges
- **Multi-bot cron** — per-profile tabs and profile selector for managing cron jobs across multiple bots; supports `OPENCLAW_STATE_DIR`-based instances
- **Telegram alerts** — rule-based alerts (CPU/RAM/disk thresholds, service/container/bot down); auto-detects OpenClaw credentials
- **Live log tail** — stream `journalctl` or Docker logs in-browser with auto-scroll
- **Historical charts** — background metrics collector; sparklines on every card; full-screen 24h/7d/30d charts
- **Self-update** — Settings → Updates → Update Now (git pull + restart, no terminal needed)
- **Weather widget** — current conditions for your city
- **Basic auth** — protect your dashboard with username/password
- **Zero build step** — plain Node.js + Express, no bundler, no framework

## Install

### Quick install (one line)

```bash
git clone https://github.com/AzamatMajidov/pulse-dashboard.git ~/pulse-dashboard && cd ~/pulse-dashboard && bash setup.sh
```

`setup.sh` will:
1. Check Node.js ≥18
2. Run `npm install`
3. Create `config.json` from the template
4. Install and start a systemd user service

### Prerequisites

- Linux with systemd (Ubuntu, Debian, Fedora, Raspberry Pi OS, etc.)
- Node.js ≥18 — [install guide](https://nodejs.org)
- OpenClaw installed (optional — bots section empty without it)

### Open firewall (VPS)

```bash
sudo ufw allow 6682
```

Cloud providers (AWS, GCP, Hetzner, DigitalOcean): also open port 6682 in your security group / firewall rules.

## First-time setup

Open `http://YOUR-SERVER-IP:6682` in your browser — you'll land on the setup page.

Fill in:
- **Server Label** — a name for this machine
- **Port** — default 6682
- **Weather City** — your city name
- **Network Interface** — click 🔍 Auto-detect
- **Docker Containers** — Auto-discover or manual list
- **Systemd Services** — click 🔍 Discover, select what to monitor
- **Security** — enable Basic Auth, set username + password
- **OpenClaw Bots** — add your bot name (leave Profile empty for default)

Hit **Save & Restart** → you'll be redirected to the dashboard automatically.

## Configuration

Config lives in `config.json`. The web UI writes it for you — manual editing only needed for advanced options like custom alert rules.

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

### Config reference

| Key | Default | Description |
|-----|---------|-------------|
| `label` | hostname | Display name in dashboard header |
| `port` | `6682` | HTTP port |
| `networkIface` | `"auto"` | NIC name or `"auto"` to detect |
| `weatherLocation` | — | City name for weather widget |
| `dockerContainers` | `"auto"` | `"auto"` = all running; or `["name1","name2"]` |
| `systemdServices` | `[]` | Systemd services to monitor |
| `auth.enabled` | `false` | Enable HTTP Basic Auth |
| `bots` | `[]` | OpenClaw bot profiles (`profile: null` = default) |
| `alerts.cooldownMinutes` | `15` | Minimum gap between repeated alerts |
| `alerts.rules` | `[]` | Alert rules (see below) |

### Alert rules

Pulse auto-detects Telegram credentials from your OpenClaw config. Rules are evaluated every 10 seconds.

| metric | description |
|--------|-------------|
| `cpu` | CPU usage % — use with `op: "gt"`, `threshold`, optional `durationSeconds` |
| `ram` | RAM usage % — same as cpu |
| `disk` | Disk usage % — same as cpu |
| `service_down` | Systemd service offline — use `target: "service-name"` |
| `container_down` | Docker container stopped — use `target: "container-name"` |
| `bot_offline` | OpenClaw bot offline — use `target: "Bot Name"` |

## Management

```bash
systemctl --user status pulse      # check status
systemctl --user restart pulse     # restart
systemctl --user stop pulse        # stop
journalctl --user -u pulse -f      # live logs
loginctl enable-linger $USER       # keep service running without login (VPS)
```

## Multiple bots

```json
"bots": [
  { "name": "Work Bot", "profile": null },
  { "name": "Personal Bot", "profile": "personal" }
]
```

`profile` matches the OpenClaw profile name (`openclaw --profile <name>`). Use `null` for default.

## Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step
- **Metrics:** `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `df`, `sensors`, `docker`, `systemctl`

## License

MIT

---

## Changelog

### 2026-02-27
- **Per-bot model dropdown** — each bot card shows its own configured models (not a shared global dropdown)
- **Human-readable cron badges** — schedule displayed as "Every day at 9:00 AM" instead of raw cron expression
- **Accurate cost calculation** — correct per-model pricing, more models covered, real input/output token breakdown
- **stateDir support** — `bots[].stateDir` config option for `OPENCLAW_STATE_DIR`-based multi-profile setups
- **UX:** bots show "Loading…" during cache warmup instead of "Offline"; cost and cron sections render immediately with a loading state

### 2026-02-26
- Phase 10.1: multi-bot cron monitor with per-profile tabs
- Phase 9: cost tracker with daily breakdown chart
- Phase 10: cron monitor (view, create, toggle, delete, run cron jobs)
- Phase 8: bot analytics (sessions, token usage, cost per bot)

### 2026-02-25
- Phase 7: distribution — one-line install, setup.sh, systemd service, README overhaul
- Phase 6: license / paywall (Ed25519 offline license, Pro tier, upgrade modal)
- Phase 5: historical charts (sparklines, full-screen 24h/7d/30d, background collector)
- Phase 4: live log tail (SSE, auto-scroll, ANSI strip, maximize)
- Phases 1–3: Telegram alerts, restart buttons, gateway controls

---

## Support

Pulse is **free and open source** — all features included, no paywalls.

If you find it useful, consider buying me a coffee ☕

<a href="https://buymeacoffee.com/azamatmajidov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="40"></a>
