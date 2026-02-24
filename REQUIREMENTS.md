# Pulse Dashboard — Requirements

## Overview
A home server monitoring dashboard displayed on the connected monitor and accessible from any device on the home network (or via Tailscale).

## Name
**Pulse**

## Repo
- GitHub: `AzamatMajidov/pulse-dashboard` (private)
- Local: `~/Projects/pulse/`

---

## Stack
- **Backend:** Node.js + Express (`server.js`)
- **Frontend:** Plain HTML + CSS + Vanilla JS (`public/index.html`) — no framework, no build step
- **No React, no bundler, no extra complexity**

## Access
- **Port:** `6682`
- **Bind:** `0.0.0.0` (accessible on home network + Tailscale)
- **Auth:** None — secured by network boundary (no Tailscale Funnel)
- **Launch:** Manual (open browser, no auto-kiosk for now)

## Display
- **Resolution:** 2K (2560×1440), single page
- **Design:** Dark charcoal (`#0f1117`) + Cyan accent (`#22d3ee`)
- **Font:** Inter (Google Fonts)
- **Layout:** CSS Grid, responsive

## Auto-refresh
Frontend polls `/api/metrics` every **10 seconds**

---

## Widgets

### Row 1 — Hero Bar
| Widget | Details |
|--------|---------|
| Clock | Live HH:MM:SS (JS update every second) |
| Date | Full format: Tuesday, 25 February 2026 |
| Weather | Tashkent · temp °C + condition · source: wttr.in · cached 10min |

### Row 2 — System Metrics (4 cards)
| Widget | Details |
|--------|---------|
| CPU | Usage % + Package temp (via `sensors -j`) |
| RAM | Used / Total GB + usage % (via `/proc/meminfo`) |
| Disk | Used / Free / Total for `/` (via `df -h`) |
| Network | Upload / Download speed on `enp2s0` (delta from `/proc/net/dev`) |

### Row 3 — Services
| Widget | Details |
|--------|---------|
| Docker | `roast-postgres`, `mongo`, `roast-redis` — name + status + uptime (via `docker ps -a`) |
| Systemd | `kuydirchi` — status + uptime (via `systemctl --user`) |

### Row 4 — Bots (2 cards)
| Widget | Details |
|--------|---------|
| Qulvachcha 🐣 | Status · Last active · Model · Uptime (from `openclaw status`) |
| Oshna 🌸 | Status · Last active · Model · Uptime (from `openclaw --profile personal status`) |

Each bot card shows:
- 🟢 Online / 🔴 Offline
- Last active timestamp
- Model name (e.g. `claude-opus-4-6`)
- Uptime (from systemd `ActiveEnterTimestamp`)

> **Not included (yet):** Kuydirchi/job-hunter app metrics, Telegram activity, Calendar

---

## Backend API

### `GET /api/metrics`
Returns single JSON object:
```json
{
  "system": {
    "cpu": { "usage": 12.4, "temp": 31 },
    "ram": { "used": 1.4, "total": 5.6, "percent": 25 },
    "disk": { "used": 22, "free": 87, "total": 114, "percent": 20 },
    "network": { "up": 1024, "down": 2048 }
  },
  "services": {
    "docker": [
      { "name": "roast-postgres", "status": "running", "uptime": "2 days" },
      { "name": "mongo", "status": "running", "uptime": "2 days" },
      { "name": "redis", "status": "running", "uptime": "2 days" }
    ],
    "systemd": [
      { "name": "kuydirchi", "status": "active", "uptime": "6h ago" }
    ]
  },
  "bots": {
    "qulvachcha": { "online": true, "lastActive": "just now", "model": "claude-opus-4-6", "uptime": "6h" },
    "oshna": { "online": true, "lastActive": "35m ago", "model": "claude-sonnet-4-6", "uptime": "6h" }
  },
  "weather": { "temp": 5, "description": "Sunny", "icon": "☀️" },
  "timestamp": 1740429600000
}
```

---

## Data Sources
| Metric | Source |
|--------|--------|
| CPU usage | `/proc/stat` delta (2× with 500ms gap) |
| CPU temp | `sensors -j` → `coretemp-isa-0000.Package id 0` |
| RAM | `/proc/meminfo` |
| Disk | `df -h /` |
| Network speed | `/proc/net/dev` delta for `enp2s0` |
| Docker | `docker ps -a --format json` |
| Systemd | `systemctl --user is-active` + `show --property=ActiveEnterTimestamp` |
| Qulvachcha | `openclaw status` (parse text) |
| Oshna | `openclaw --profile personal status` (parse text) |
| Weather | `https://wttr.in/Tashkent?format=j1` (cached 10min) |

---

## File Structure
```
~/Projects/pulse/
  server.js          # Express backend
  package.json       # { start: "node server.js" }
  public/
    index.html       # All HTML + CSS + JS inline
  REQUIREMENTS.md    # This file
  README.md
```

---

## Systemd Service ✅ Done
Service file: `~/.config/systemd/user/pulse.service`
```bash
systemctl --user status pulse     # check
systemctl --user restart pulse    # restart
journalctl --user -u pulse -f     # logs
```
Enabled + running. Auto-starts on boot, auto-restarts on crash.

---

## Out of Scope (for now)
- Kuydirchi / Job Hunter metrics
- Telegram activity feed
- Google Calendar integration
- Auth / login
- Chromium kiosk autostart
- Tailscale Funnel (keep private)
