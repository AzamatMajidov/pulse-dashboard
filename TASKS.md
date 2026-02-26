# Pulse — Task Breakdown

**Last updated:** 2026-02-26
**Total tasks:** 84 (71 done · 13 todo)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 1 — Telegram Alerts (F05)

### Backend
- [x] T01 Auto-detect Telegram credentials — read `botToken` from `~/.openclaw/openclaw.json`, `chatId` from `~/.openclaw/credentials/telegram-allowFrom.json`
- [x] T02 `sendTelegramMessage(text)` — plain HTTP POST to Bot API, no deps, with error handling
- [x] T03 Alert state manager — tracks per-rule state: `idle | firing | resolved`, last fired time, cooldown
- [x] T04 Metric snapshot — lightweight function that returns latest values (cpu%, ram%, disk%, service states, docker states, bot states) without full metrics API overhead
- [x] T05 Rules evaluator — per rule type: `cpu/ram/disk` (threshold + duration accumulator), `service_down`, `container_down`, `bot_offline`
- [x] T06 Background alert worker — runs every 30s, evaluates all rules, fires/resolves alerts, respects cooldown
- [x] T07 Alert history — in-memory ring buffer, last 20 alerts `{ rule, message, firedAt, resolvedAt }`
- [x] T08 `GET /api/alerts/status` — returns `{ active: [], history: [] }`

### Frontend — Settings (`/settings`)
- [x] T09 Add collapsible "Alerts" section to `setup.html` — between Security and Bots
- [x] T10 Telegram credentials row — shows auto-detected values with "Auto-detected from OpenClaw" badge; override toggle to enter manually
- [x] T11 "Send test alert" button — POST to `/api/alerts/test`, shows success/fail inline
- [x] T12 Cooldown input — minutes field, default 15
- [x] T13 Rule builder — table of rules, each row: `[metric ▼] [threshold] [duration] [name field] [× remove]`
- [x] T14 Metric dropdown options: `CPU` `RAM` `Disk` `Service down` `Container down` `Bot offline`
- [x] T15 "Add rule" button — appends new empty rule row
- [x] T16 Wire alerts config into existing save flow (`POST /api/setup`)

### Frontend — Dashboard (`index.html`)
- [x] T17 Bell icon `🔔` in hero bar — right side, next to ⚙ gear icon
- [x] T18 Badge — red counter, shows count of currently active alerts, hidden when 0
- [x] T19 Alert dropdown — click bell → shows last 5 alerts with timestamp, metric, status (active 🔴 / resolved ✅)
- [x] T20 `GET /api/alerts/status` poll — refresh every 30s to update badge count

---

## Phase 2 — Service Restart Actions (F06)

- [x] T21 `POST /api/action/restart-service { name }` — runs `systemctl --user restart NAME`, returns new status
- [x] T22 `POST /api/action/restart-docker { name }` — runs `docker restart NAME`, returns new status
- [x] T23 Restart button `[⟳]` on each systemd service row — always visible, small
- [x] T24 Restart button `[⟳]` on each Docker container row — always visible, small
- [x] T25 "Logs" button `[📋]` placeholder on service rows (wired in F08)
- [x] T26 Inline confirmation — clicking `[⟳]` replaces it with `Restart X? [✓] [✗]`
- [x] T27 Spinner during restart — row shows spinner, disables buttons
- [x] T28 Auto-refresh row status after restart completes (re-fetch that service only)

---

## Phase 3 — Gateway Controls + Model Switch (F07)

- [x] T29 `GET /api/openclaw/models` — reads `~/.openclaw/openclaw.json`, returns `{ primary, models: [{ id, alias, active }] }`
- [x] T30 `POST /api/openclaw/gateway { action: restart|stop|start }` — runs `openclaw gateway ACTION`
- [x] T31 `POST /api/openclaw/model { model }` — edits `agents.defaults.model.primary` in `openclaw.json` → restarts gateway
- [x] T32 `POST /api/openclaw/clear-sessions { profile }` — clears OpenClaw sessions
- [x] T33 Bot card action bar — add bottom section to bot card: `[⟳ Restart] [⏹ Stop]` + model dropdown
- [x] T34 Model dropdown — populated from `GET /api/openclaw/models` on page load; shows alias if set (e.g. "sonnet"), shows `✓` on active model
- [x] T35 Confirmation on destructive actions (Stop, Restart) — inline dialog on card
- [x] T36 Spinner on bot card during gateway restart — card dims, spinner shows
- [x] T37 Bot card updates after action — re-fetch bot status once action completes

---

## Phase 4 — Live Log Tail (F08)

- [x] T38 `GET /api/logs/service/:name` — SSE endpoint, spawns `journalctl --user -u NAME -f --no-pager -n 50`, streams lines
- [x] T39 `GET /api/logs/docker/:name` — SSE endpoint, spawns `docker logs -f --tail 50 NAME`, streams lines
- [x] T40 SSE cleanup — kill spawned process when client disconnects (`res.on('close')`)
- [x] T41 Log drawer HTML/CSS — bottom panel, slides up with CSS transition, z-index above dashboard
- [x] T42 `[📋 Logs]` button wired on service rows (T25) → opens drawer for that service
- [x] T43 `[📋 Logs]` button on Docker rows → opens drawer for that container
- [x] T44 `EventSource` lifecycle — open on drawer open, close on drawer close
- [x] T45 Log line rendering — append lines to log panel (DOM API, no innerHTML)
- [x] T46 Auto-scroll — follow tail by default, pause on manual scroll up, resume button
- [x] T47 Maximize toggle `[⛶]` — toggles drawer between half-screen and full-screen
- [x] T48 ANSI escape code stripping — remove `\x1b[...m` sequences from raw log lines

---

## Phase 5 — Historical Charts (F09)

- [x] T49 History collector — background interval every 5 min, appends JSON line to `data/history.jsonl`
- [x] T50 Data schema — `{ ts, cpu, ram, disk, netUp, netDown }` per sample
- [x] T51 30-day pruning — on each write, remove entries older than 30 days
- [x] T52 `GET /api/history?metric=cpu&hours=168` — reads jsonl, filters by time range, returns array
- [x] T53 Chart.js from CDN — add to `index.html`, no npm
- [x] T54 Sparkline component — reusable function `renderSparkline(canvasEl, data)`, mini line chart, cyan
- [x] T55 Sparkline on CPU card — last 24h of CPU%, rendered in card footer
- [x] T56 Sparkline on RAM card
- [x] T57 Sparkline on Disk card
- [x] T58 Sparkline on Network card (upload + download as two lines)
- [x] T59 Card expand on sparkline click — card expands to full-width, shows full Chart.js chart
- [x] T60 Full chart time range toggle — `24h · 7d · 30d` tabs
- [x] T61 Card collapse — click again to restore original size
- [x] T62 History starts empty — graceful empty state while data accumulates ("Collecting data…")

---

## Phase 6 — License / Paywall

- [x] T63 Ed25519 key pair — generate `private.pem` + `public.pem` in `data/license-keys/` (one-time, on first start)
- [x] T64 License struct — `{ email, tier, expiresAt }` → sign with Ed25519 private key → `payload.signature` base64url format
- [x] T65 `/admin/license` page — owner-only web UI: input email + tier + expiry → generates signed key → copy button
- [x] T66 License verification function — verifies Ed25519 signature using public key, checks expiry
- [x] T67 `POST /api/license/activate { key }` — verifies key, stores in `config.json`
- [x] T68 `GET /api/license/status` — returns `{ tier: free|pro, email, expiresAt, valid }`
- [x] T69 Pro middleware — wraps Pro endpoints (F05–F08), returns `402 { error: "pro_required" }` if no valid license
- [x] T70 License section in `/settings` — shows current tier + expiry, input for license key, activate button
- [x] T71 Frontend Pro gate — lock icon on Pro features when on free tier; clicking shows "Pro feature" toast

---

## Phase 7 — Distribution

- [ ] T72 Domain — register `getpulse.dev` or similar
- [ ] T73 Landing page — static HTML, same design language as dashboard: hero, one-line install command, screenshot, pricing table
- [ ] T74 Landing page deploy — GitHub Pages or Cloudflare Pages (free)
- [ ] T75 ClawhHub skill packaging — `skill.json` manifest, install script, README
- [ ] T76 ProductHunt launch assets — tagline, description, screenshots, GIF demo

---

## Phase 8 — Bot Analytics (F16)

### Backend — Data Collection
- [ ] T77 Session tracker — on each `GET /api/metrics` that returns bot data, parse `openclaw status` output to extract: session start time, message count today, heartbeat count, last heartbeat time, next heartbeat ETA. Store in `data/bot-stats.json` (per bot key, refreshed with bot cache).
- [ ] T78 Response time tracker — new SSE listener on OpenClaw gateway logs (`journalctl -u openclaw-gateway -f`). Parse inbound→response pairs, compute rolling average response time (last 1h). Store in `data/bot-stats.json`.
- [ ] T79 `GET /api/bots/stats` — returns per-bot stats: `{ messagesToday, avgResponseMs, heartbeats, nextBeatSecs, sessionStarted }`. Falls back to `openclaw status --json` if available, otherwise parses text output.
- [ ] T80 Daily reset — at midnight (local time), reset `messagesToday` and `heartbeats` counters to 0. Use a background interval check (same pattern as history collector).

### Frontend — Bot Card Enhancement
- [ ] T81 Stats row in bot card — below the existing Model/LastActive/Uptime stats, add a second row: `Messages Today: 47 | Avg Response: 2.3s`
- [ ] T82 Heartbeat indicator — small pulsing heart icon (💓) with beat count and "Next: 14m" countdown. Updates every 10s with dashboard refresh.
- [ ] T83 Session info — "Session started: 10:31 AM" line in bot card, derived from `sessionStarted` timestamp.
- [ ] T84 Mini activity sparkline — tiny inline sparkline (50x20px) in bot card showing message count per hour over last 24h. Reuse `renderSparkline()` from Phase 5.

### Technical Notes
- `openclaw status` already returns: gateway reachable, active time, model. Need to check if `--json` flag exists for structured output, otherwise regex parse.
- Message count: parse from OpenClaw session logs or gateway metrics if exposed. Fallback: count inbound webhook hits via a lightweight middleware counter.
- Response time: measure time between gateway receiving a message and sending the reply. Parse from journalctl timestamps.
- Heartbeat data: OpenClaw fires heartbeats on a schedule. Parse `HEARTBEAT.md` interval + last execution from gateway logs.
- `data/bot-stats.json` schema: `{ "main": { "messagesToday": 47, "avgResponseMs": 2300, "heartbeats": 12, "nextBeatSecs": 840, "sessionStarted": "2026-02-26T05:31:00Z", "hourlyMessages": [0,0,1,3,5,...] }, "personal": { ... } }`

---

## Summary by Phase

| Phase | Tasks | Description |
|---|---|---|
| 1 — Alerts | T01–T20 | Telegram alerts + bell icon |
| 2 — Restart | T21–T28 | Service + Docker restart actions |
| 3 — Gateway | T29–T37 | OpenClaw gateway controls + model switch |
| 4 — Logs | T38–T48 | Live log tail drawer |
| 5 — History | T49–T62 | Sparklines + historical charts |
| 6 — License | T63–T71 | Paywall + license management |
| 7 — Distribution | T72–T76 | Landing page + ClawhHub + ProductHunt |
| 8 — Bot Analytics | T77–T84 | Message count, response time, heartbeats, session info |

**Total: 84 tasks (71 done · 13 todo)**
