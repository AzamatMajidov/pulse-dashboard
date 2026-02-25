# Pulse — Roadmap

## ✅ Done
- Single-machine monitoring dashboard (CPU, RAM, disk, network, Docker, systemd, bots, weather)
- Configurable via `config.json` (no hardcoded values)
- Web-based setup UI (`/setup`) — first-run wizard with auto-detect buttons
- Web-based settings UI (`/settings`) — accessible from dashboard header
- Basic Auth middleware (username/password, disabled by default)
- Auto-discover network interface, Docker containers, systemd services
- `setup.sh` — one-command install with systemd service
- Restart overlay — polls `/api/health` and redirects when back up
- `config.json` gitignored — user config never committed

---

## 🔜 Right Now (this week)

### Let friend install
- Make repo public OR add friend as collaborator
- Walk through install flow, note friction points
- Fix any install bugs that surface

### HTTPS support
- Basic auth over plain HTTP on VPS is a security risk
- Options:
  - Option A: nginx reverse proxy guide in README (recommended)
  - Option B: built-in self-signed cert support
- Blocker for charging anyone

### Telegram alerts
- Highest-value feature for a monitoring dashboard
- Trigger conditions: service goes down, CPU > 90% sustained, disk > 85%, bot offline
- Config: `alerts.telegram.botToken` + `alerts.telegram.chatId`
- Without alerts, user has to keep the tab open — defeats the purpose

---

## 📅 Medium Term (SaaS foundation)

### Landing page
- Domain: `pulsedash.io` or similar
- Simple: hero shot, screenshot, one-line install command, pricing
- No framework needed — static HTML like the dashboard itself

### License / paywall
- Free tier: basic monitoring (current feature set)
- Pro tier: alerts, historical charts, multi-machine
- Implementation: license key → POST to validation server → signed JWT → Pulse checks on startup
- Keep it simple for MVP — no Stripe integration yet, manual key issuing is fine

### ClawhHub listing
- Package Pulse as an OpenClaw skill
- `openclaw skill install pulse`
- Instant access to OpenClaw's existing user base
- OpenClaw integration is the moat (bot status, session stats, cron visibility)

---

## 🔭 Longer Term

### Historical charts
- 7/30-day graphs for CPU, RAM, disk
- Stored locally (SQLite or flat JSON) — no cloud required
- Chart library: Chart.js (lightweight, no build step)

### Multi-machine aggregator
- Single dashboard showing N machines
- Each machine runs Pulse agent, reports to a central instance
- Or: browser aggregates from multiple URLs directly

### Session-based auth
- Replace Basic Auth with proper login page + session cookie
- Required before team/org tier

### Team / org tier
- Multiple users, shared dashboards
- Role-based access (admin vs read-only)
- ~$20-30/month

---

## Notes
- No cloud infra until validated demand (Phase 1 = self-hosted only)
- OpenClaw integration is the moat — lean into it
- Friend's install friction = real roadmap input
- HTTPS is a blocker for monetization
