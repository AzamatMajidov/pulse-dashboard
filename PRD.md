# Pulse — Product Requirements Document

**Version:** 2.0  
**Updated:** 2026-02-25  
**Status:** In progress

---

## 1. Product Overview

Pulse is a self-hosted server monitoring and management dashboard built for [OpenClaw](https://openclaw.ai) users. It runs on the user's own machine — home server, VPS, Raspberry Pi — and provides real-time metrics, service management, and OpenClaw-specific controls from a browser.

**Target user:** Developer or power user running OpenClaw on a server. Technical enough to install via CLI, but wants a dashboard without configuring Grafana/Prometheus stacks.

**Moat:** Deep OpenClaw integration — bot status, model switching, gateway control, token usage, session management. No other monitoring tool has this.

---

## 2. Distribution & Monetization

### Distribution channels
1. **ClawhHub** — OpenClaw's skill marketplace. Primary channel. `openclaw skill install pulse`
2. **GitHub** — Organic discovery
3. **ProductHunt** — One-time launch spike
4. **OpenClaw Discord** — `#show-and-tell`

### Pricing
| Tier | Price | Features |
|---|---|---|
| Free | $0 | Core monitoring + setup UI |
| Pro | $7/month or $49/year | Alerts + Actions + History + Logs |

### License validation
Offline crypto signature — no backend dependency.
- Owner generates signed license key locally (Ed25519 private key)
- Public key embedded in Pulse binary
- Pulse verifies signature on startup
- License payload: `{ email, tier, expiresAt, signature }`

---

## 3. Feature Tiers

### Free Tier ✅ (Shipped)
- System metrics (CPU, RAM, disk, network)
- Docker containers monitoring
- Systemd services monitoring
- OpenClaw bot status (online/offline, model, uptime)
- Weather widget
- Web-based setup wizard (`/setup`)
- Web-based settings (`/settings`)
- Basic auth (HTTP Basic)
- Auto-detect network interface, Docker, services
- `setup.sh` one-command installer
- Restart overlay with health polling

### Pro Tier 🔜 (Planned)
- Telegram + email alerts
- Service restart actions (systemd + Docker)
- Gateway restart + model switch (OpenClaw actions)
- Live log tail (SSE streaming)
- Historical charts (7/30-day)
- Token usage + cost tracker
- Multi-machine aggregation

---

## 4. Feature Specifications

---

### F01 — System Metrics ✅ SHIPPED

**Description:** Real-time system health cards — CPU, RAM, disk, network.

**How it works:**
| Metric | Source | Method |
|---|---|---|
| CPU usage | `/proc/stat` | Two reads 500ms apart, calculate idle delta |
| CPU temp | `sensors -j` | Parse `coretemp-isa-0000 → Package id 0` |
| RAM | `/proc/meminfo` | `MemTotal - MemAvailable` |
| Disk | `df -B1 /` | Parse output, `/` mount only |
| Network speed | `/proc/net/dev` | Delta between two reads, divide by time |

**API:** `GET /api/metrics` → `system.cpu`, `system.ram`, `system.disk`, `system.network`

**Notes:**
- CPU temp returns `null` on VMs (no hardware sensors) — display hidden if null
- Network interface is auto-detected or set in config

---

### F02 — Services Monitoring ✅ SHIPPED

**Description:** Status cards for Docker containers and systemd user services.

**How it works:**
- **Docker:** `docker ps -a --format "{{.Names}}|{{.Status}}"` — configurable list or auto-discover all
- **Systemd:** `systemctl --user is-active SERVICE` + `show --property=ActiveEnterTimestamp`

**Config:**
```json
"dockerContainers": "auto",
"systemdServices": ["kuydirchi", "my-app"]
```

**API:** `GET /api/metrics` → `services.docker[]`, `services.systemd[]`

---

### F03 — OpenClaw Bot Status ✅ SHIPPED

**Description:** Shows online/offline status, model, uptime, last active time for each configured bot.

**How it works:**
- Runs `openclaw status` (or `openclaw --profile NAME status`) per bot
- Parses text output for: online/offline, model name, last active, uptime
- Results cached 5 minutes; stale cache served immediately, refresh in background (non-blocking)

**Config:**
```json
"bots": [
  { "name": "My Bot", "profile": null },
  { "name": "Personal Bot", "profile": "personal" }
]
```

**API:** `GET /api/metrics` → `bots[]`

**Known limitation:** `openclaw status` takes ~8-15s. Mitigated by background refresh pattern + 5-min cache TTL.

---

### F04 — Setup Wizard & Settings UI ✅ SHIPPED

**Description:** Web-based first-run config wizard at `/setup`. Settings panel at `/settings`. Same UI, dual-purpose.

**How it works:**
- On startup, if no `config.json` → `setupMode = true`
- All routes redirect to `/setup` in setup mode
- User fills form → `POST /api/setup` → writes `config.json` → `process.exit(0)` → systemd restarts
- Restart overlay polls `GET /api/health` → redirects when back up
- `/settings` pre-fills form from `GET /api/config`, same save flow

**Auto-detect endpoints:**
- `GET /api/detect/iface` — first non-loopback interface from `/proc/net/dev`
- `GET /api/detect/docker` — `docker ps --format "{{.Names}}"`
- `GET /api/detect/services` — `systemctl --user list-units --state=active`

**Port change handling:** If port changes, restart overlay redirects to new port origin.

---

### F05 — Telegram / Email Alerts 🔜 PRO

**Description:** Rule-based alerting. Sends a message when a metric crosses a threshold or a service goes down.

**How it works:**
- Background worker runs every 30s (separate from metrics API)
- Evaluates each alert rule against latest metric snapshot
- For threshold rules (CPU, RAM, disk): must be above threshold for `duration` seconds before firing (avoids spikes)
- For binary rules (service_down, bot_offline): fires immediately on state change
- Per-rule cooldown (default 15 min) — no spam
- Sends via Telegram Bot API: `POST https://api.telegram.org/botTOKEN/sendMessage`

**Alert rule types:**
| Type | Trigger | Example |
|---|---|---|
| `cpu` | CPU % > threshold for duration | `{ metric: "cpu", threshold: 90, duration: 60 }` |
| `ram` | RAM % > threshold | `{ metric: "ram", threshold: 85 }` |
| `disk` | Disk % > threshold | `{ metric: "disk", threshold: 90 }` |
| `service_down` | Systemd service inactive | `{ metric: "service_down", name: "kuydirchi" }` |
| `container_down` | Docker container not running | `{ metric: "container_down", name: "roast-postgres" }` |
| `bot_offline` | OpenClaw bot offline | `{ metric: "bot_offline", name: "My Bot" }` |

**Telegram credential resolution (in priority order):**
1. `config.json` → `alerts.telegram.botToken` / `chatId` (manual override)
2. Auto-detect from OpenClaw config:
   - Token: `~/.openclaw/openclaw.json` → `channels.telegram.botToken`
   - Chat ID: `~/.openclaw/credentials/telegram-allowFrom.json` → `allowFrom[0]`

For users with OpenClaw + Telegram configured: **zero alert setup required**.
Alerts send directly via Telegram Bot API (HTTP) — does not depend on OpenClaw gateway being online.

**Config:**
```json
"alerts": {
  "telegram": {
    "botToken": "",
    "chatId": ""
  },
  "cooldownMinutes": 15,
  "rules": [
    { "metric": "cpu", "threshold": 90, "duration": 60 },
    { "metric": "disk", "threshold": 85 },
    { "metric": "service_down", "name": "kuydirchi" },
    { "metric": "bot_offline", "name": "My Bot" }
  ]
}
```

> Leave `botToken` and `chatId` empty to auto-detect from OpenClaw config.

**Alert message format:**
```
🔴 Pulse Alert — My Server
CPU above 90% for 60s (currently 94%)
Wed 25 Feb · 21:04
```

Recovery message (when metric goes back to normal):
```
✅ Pulse Recovered — My Server
CPU back to normal (currently 42%)
Wed 25 Feb · 21:09
```

**API changes:**
- `GET /api/alerts/status` — returns active alerts + last fired times
- Alert history widget on dashboard (last 5 alerts)

**Settings UI:** Add "Alerts" section in `/settings` — configure bot token, chat ID, rules with add/remove.

---

### F06 — Service Restart Actions 🔜 PRO

**Description:** Restart buttons on Docker container and systemd service cards.

**How it works:**
- Button on each card: `⟳ Restart`
- Confirmation dialog before executing
- `POST /api/action/restart-service` → `systemctl --user restart SERVICE`
- `POST /api/action/restart-docker` → `docker restart CONTAINER`
- Response includes new status after restart
- Auth required — endpoint returns 401 if no valid session

**API:**
```
POST /api/action/restart-service  { "name": "kuydirchi" }
POST /api/action/restart-docker   { "name": "roast-postgres" }
```

**Response:**
```json
{ "ok": true, "name": "kuydirchi", "active": true, "uptime": "0s" }
```

**UI:** Small restart icon button on each service/container card. Shows spinner during restart, updates status after.

**Security:** Only available when auth is enabled. Actions logged to server console.

---

### F07 — OpenClaw Gateway Controls 🔜 PRO

**Description:** Restart, stop, start the OpenClaw gateway. Switch model. Clear sessions. Directly from the dashboard — no SSH needed.

**How it works:**

| Action | Command |
|---|---|
| Restart gateway | `openclaw gateway restart` |
| Stop gateway | `openclaw gateway stop` |
| Start gateway | `openclaw gateway start` |
| Switch model | Edit `~/.openclaw/openclaw.json` → `agents.defaults.model.primary` → restart gateway |
| Clear sessions | `openclaw sessions clear` (or delete session files) |

**Model switch flow:**
1. Bot card dropdown is populated dynamically from `GET /api/openclaw/models`
2. Source: `~/.openclaw/openclaw.json` → `agents.defaults.models` (all configured models + aliases)
3. User selects any model from the list — not hardcoded, reflects actual OpenClaw config
4. `POST /api/openclaw/model` → Pulse edits `agents.defaults.model.primary` → restarts gateway
5. Bot card refreshes on next poll showing new active model

**API:**
```
GET  /api/openclaw/models                 → { primary, models: [{ id, alias, active }] }
POST /api/openclaw/gateway                { "action": "restart|stop|start" }
POST /api/openclaw/model                  { "model": "anthropic/claude-opus-4-6" }
POST /api/openclaw/clear-sessions         { "profile": null }
```

**Note:** v1 changes global default (`agents.defaults.model.primary`). Per-profile model override is v2.

**UI:** Action buttons on bot card: `⟳ Restart` · `⏹ Stop` · model dropdown. Confirmation required for destructive actions.

**Profiles:** Each action applies to a specific profile (default or named). Supports multiple bots.

---

### F08 — Live Log Tail 🔜 PRO

**Description:** Stream live logs from any systemd service or Docker container directly in the browser. No SSH required.

**How it works:**
- Server-Sent Events (SSE) — one-way stream from server to browser, built into HTTP/1.1
- Backend spawns: `journalctl --user -u SERVICE -f --no-pager -n 50`
- Streams stdout line by line to SSE endpoint
- Frontend `EventSource` receives lines, appends to log panel
- Auto-scroll to bottom (user can pause scroll)
- Stream closes when user navigates away or closes panel

**API:**
```
GET /api/logs/service/:name   → SSE stream
GET /api/logs/docker/:name    → SSE stream (docker logs -f --tail 50)
```

**UI:**
- "View Logs" button on each service/container card
- Slide-up panel (full-width, dark, monospace JetBrains Mono)
- Last 50 lines on open, then live stream
- ANSI color support (basic: green/red/yellow)
- Close button, auto-scroll toggle

**No extra dependencies** — SSE is native to Node.js and browsers.

---

### F09 — Historical Charts 🔜 PRO

**Description:** 7/30-day charts for CPU, RAM, disk usage stored locally.

**How it works:**
- Background collector runs every 5 minutes
- Appends snapshot to `data/history.json` (newline-delimited JSON, one entry per sample)
- Retention: auto-prune entries older than 30 days
- Frontend renders with **Chart.js** (loaded from CDN, no build step)

**Data stored per sample:**
```json
{
  "ts": 1772034401,
  "cpu": 12,
  "ram": 26,
  "disk": 20,
  "net_up": 9699,
  "net_down": 2769
}
```

**API:**
```
GET /api/history?metric=cpu&hours=168    → last 7 days
GET /api/history?metric=ram&hours=720    → last 30 days
```

**UI:** Charts section below system metrics — tabbed: CPU / RAM / Disk / Network. Toggle 24h / 7d / 30d. Line chart, cyan fill.

**Storage estimate:** 5min interval × 30 days = 8,640 samples × ~100 bytes = ~860KB. Negligible.

**No new npm deps** — Chart.js from CDN.

---

### F10 — Token Usage & Cost Tracker 🔜 PRO

**Description:** Shows how many tokens and dollars each OpenClaw bot has consumed.

**How it works:**
- Parse `openclaw status` output for session stats
- Or read OpenClaw session files directly: `~/.openclaw/agents/*/sessions/sessions.json`
- Calculate cost based on known model pricing (Opus: $15/$75 per M tokens, Sonnet: $3/$15)
- Reset counter monthly (track `month` field)

**Display:**
- Per-bot: tokens in / out, estimated cost this month
- Total across all bots

**API:** `GET /api/openclaw/usage` → `[{ name, tokensIn, tokensOut, costUSD, month }]`

**Note:** Needs investigation of OpenClaw session file format. May require `openclaw` CLI command if available.

---

### F11 — Multi-Machine Aggregation 🔜 PRO

**Description:** Monitor multiple servers from a single Pulse dashboard.

**How it works:**
- Central Pulse instance polls remote Pulse instances' `/api/metrics`
- Remote instances act as agents — no extra software needed, they're already running Pulse
- Authentication between instances via shared API key in config
- Central dashboard shows all machines in a tabbed or grid view

**Config (on central instance):**
```json
"remotes": [
  { "name": "VPS 1", "url": "http://1.2.3.4:6682", "apiKey": "abc123" },
  { "name": "Home Server", "url": "http://192.168.1.100:6682", "apiKey": "xyz789" }
]
```

**API:** `GET /api/remote-metrics` → aggregated metrics from all remotes

**UI:** Machine selector tabs at top of dashboard. "All Machines" overview with status tiles.

**Fallback:** If a remote is unreachable, show last-known data + "unreachable" badge.

---

## 5. Config Schema (Full)

```json
{
  "port": 6682,
  "label": "My Server",
  "networkIface": "auto",
  "weatherLocation": "London",
  "dockerContainers": "auto",
  "systemdServices": ["my-service"],
  "botCacheTtl": 300000,
  "weatherCacheTtl": 600000,
  "auth": {
    "enabled": true,
    "username": "admin",
    "password": "changeme"
  },
  "bots": [
    { "name": "My Bot", "profile": null }
  ],
  "alerts": {
    "telegram": {
      "botToken": "",
      "chatId": ""
    },
    "cooldownMinutes": 15,
    "rules": []
  },
  "license": {
    "key": ""
  },
  "remotes": []
}
```

---

## 6. API Surface (Full)

### Existing
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/metrics` | ✅ | All system metrics |
| GET | `/api/health` | ❌ | Health check (for restart poller) |
| GET | `/api/config` | ✅ | Current config (settings pre-fill) |
| POST | `/api/setup` | ❌ | Save config + restart |
| GET | `/api/detect/iface` | ❌ | Auto-detect network interface |
| GET | `/api/detect/docker` | ❌ | Discover Docker containers |
| GET | `/api/detect/services` | ❌ | Discover systemd services |

### Planned (Pro)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/alerts/status` | ✅ | Active alerts + history |
| POST | `/api/action/restart-service` | ✅ | Restart systemd service |
| POST | `/api/action/restart-docker` | ✅ | Restart Docker container |
| POST | `/api/openclaw/gateway` | ✅ | Restart/stop/start gateway |
| POST | `/api/openclaw/model` | ✅ | Switch model |
| POST | `/api/openclaw/clear-sessions` | ✅ | Clear active sessions |
| GET | `/api/logs/service/:name` | ✅ | Live log stream (SSE) |
| GET | `/api/logs/docker/:name` | ✅ | Docker log stream (SSE) |
| GET | `/api/history` | ✅ | Historical metric data |
| GET | `/api/openclaw/usage` | ✅ | Token usage + cost |
| GET | `/api/remote-metrics` | ✅ | Aggregated remote metrics |
| POST | `/api/license/activate` | ❌ | Activate license key |

---

## 7. Tech Stack

| Layer | Tech | Reason |
|---|---|---|
| Backend | Node.js + Express | Already in use, no change |
| Frontend | Vanilla HTML/CSS/JS | No build step, lightweight |
| Charts | Chart.js (CDN) | No npm, lightweight |
| Storage | Flat JSON files | No extra deps for history |
| Log streaming | SSE (native) | No WebSocket lib needed |
| License | Ed25519 (Node crypto) | Built-in, no extra deps |
| Alerts | HTTP to Telegram API | No extra deps |

**Rule:** No new npm dependencies unless absolutely unavoidable.

---

## 8. Build Order

| Priority | Feature | Effort | Value |
|---|---|---|---|
| 1 | Telegram alerts (F05) | Medium | 🔥 High |
| 2 | Service restart actions (F06) | Small | High |
| 3 | Gateway controls + model switch (F07) | Small | 🔥 High (moat) |
| 4 | License / paywall (gate F05-F07) | Medium | Critical for SaaS |
| 5 | Live log tail (F08) | Medium | High |
| 6 | Historical charts (F09) | Medium | Medium |
| 7 | Landing page | Small | Critical for distribution |
| 8 | ClawhHub listing | Small | Critical for distribution |
| 9 | Token usage tracker (F10) | Medium | Medium |
| 10 | Multi-machine (F11) | Large | High (but later) |

---

## 9. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Alerts v1 channels | **Telegram only** — email in v2 |
| 2 | License key generation UI | **Simple web UI** — owner opens `/admin/license`, generates + signs keys |
| 3 | Alerts config location | **Existing `/settings` page** — add Alerts section |
| 4 | Multi-machine | **Pull** — central instance polls agents (simpler, no agent changes needed) |
| 5 | Token usage source | TBD — needs investigation of openclaw session file format |
