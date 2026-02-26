# Pulse — Task Breakdown

**Last updated:** 2026-02-26
**Total tasks:** 116 (79 done · 37 todo)

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
- [x] T77 Session tracker — extended `fetchBotStatus` to use `openclaw status --json`, parsing sessions, tokens, context %, heartbeat, lastActiveAgeMs, sessionStarted. Stored in botCache alongside existing fields.
- [x] T78 Active sessions counter — count sessions with `updatedAt` within last 24h as `activeSessions24h`. Response time derived from `lastActiveAgeMs`.
- [x] T79 `GET /api/bots/stats` — returns per-bot enriched stats: `{ sessions, totalTokens, contextTokens, contextPercent, heartbeatEnabled, heartbeatInterval, heartbeatEveryMs, lastActiveAgeMs, sessionStarted, activeSessions24h }`.
- [x] T80 Daily reset — skipped; tokens/sessions naturally reset with OpenClaw sessions.

### Frontend — Bot Card Enhancement
- [x] T81 Stats row in bot card — second row below Model/LastActive/Uptime: `Sessions: 3 | Tokens: 165k/200k (83%) | Heartbeat: 1h`
- [x] T82 Heartbeat indicator — pulsing ❤️ CSS animation next to bot name when heartbeat is enabled.
- [x] T83 Context bar — thin progress bar (cyan/yellow/red) at bottom of bot card showing context % used.
- [x] T84 Mini sparkline — skipped; not enough data points from openclaw status.

### Technical Notes
- `openclaw status` already returns: gateway reachable, active time, model. Need to check if `--json` flag exists for structured output, otherwise regex parse.
- Message count: parse from OpenClaw session logs or gateway metrics if exposed. Fallback: count inbound webhook hits via a lightweight middleware counter.
- Response time: measure time between gateway receiving a message and sending the reply. Parse from journalctl timestamps.
- Heartbeat data: OpenClaw fires heartbeats on a schedule. Parse `HEARTBEAT.md` interval + last execution from gateway logs.
- `data/bot-stats.json` schema: `{ "main": { "messagesToday": 47, "avgResponseMs": 2300, "heartbeats": 12, "nextBeatSecs": 840, "sessionStarted": "2026-02-26T05:31:00Z", "hourlyMessages": [0,0,1,3,5,...] }, "personal": { ... } }`

---

## Phase 9 — Cost Tracker

### Backend
- [ ] T85 Model pricing table — hardcoded map in server.js: `{ "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }` (per 1M tokens, USD). Config override in config.json for custom models.
- [ ] T86 Cost calculation — extend `fetchBotStatus` to extract per-session `inputTokens`, `outputTokens`, `cacheRead`, `cacheWrite` from `openclaw status --json`. Multiply by pricing. Store daily totals in `data/cost-history.jsonl` (schema: `{ ts, date, model, inputTokens, outputTokens, cacheRead, cacheWrite, costUsd }`).
- [ ] T87 Daily cost aggregation — background collector (alongside history collector every 5 min): read all sessions from `openclaw status --json`, sum tokens by model, compute cost, append to `data/cost-history.jsonl`. Deduplicate by date (one entry per day, updated on each collection).
- [ ] T88 `GET /api/costs` — returns `{ today: { tokens, cost }, week: { tokens, cost }, month: { tokens, cost }, daily: [{ date, tokens, cost }], byModel: [{ model, tokens, cost, percent }], bySession: [{ key, type, tokens, cost }], budget: { monthly, warning } }`.
- [ ] T89 Budget alerts — if monthly cost exceeds `config.json` budget threshold, include `budgetExceeded: true` in cost API response. Trigger Telegram alert using existing alert system.

### Frontend
- [ ] T90 Cost summary card — new card on dashboard below bot cards: "Costs Today: $0.42 | This Week: $2.80 | This Month: $8.50". Cyan text for under budget, red for over.
- [ ] T91 Cost breakdown modal — click cost card → modal with: daily bar chart (last 30 days, Chart.js), model breakdown pie/donut, session type breakdown (main vs sub-agent vs cron).
- [ ] T92 Budget setting — in Settings page: monthly budget input ($), warning threshold (%). Saved to config.json.

---

## Phase 10 — Cron Monitor

### Backend
- [ ] T93 `GET /api/cron` — runs `openclaw cron list --json`, parses jobs: id, name, schedule, enabled, lastRun, nextRun, duration, status, description. Cache with 30s TTL.
- [ ] T94 `POST /api/cron/:id/toggle` — enable/disable cron job. Uses OpenClaw gateway WebSocket invoke: `{ action: "update", jobId, patch: { enabled } }`. Gateway connection: ws://127.0.0.1:18789 with auth token from `~/.openclaw/openclaw.json`.
- [ ] T95 `POST /api/cron/:id/run` — trigger immediate run. Gateway invoke: `{ action: "run", jobId }`.
- [ ] T96 `POST /api/cron/create` — create new cron job. Gateway invoke: `{ action: "add", job: { name, schedule, payload } }`. Validate schedule format.
- [ ] T97 `DELETE /api/cron/:id` — delete cron job. Gateway invoke: `{ action: "remove", jobId }`.
- [ ] T98 Gateway WebSocket helper — reusable `gatewayInvoke(action, params)` function. Connect to `ws://127.0.0.1:{port}`, send JSON with auth token, await response, close. Read port + token from `~/.openclaw/openclaw.json`.

### Frontend
- [ ] T99 Cron section on dashboard — collapsible section below services: table with columns: Name, Schedule, Status (active/idle/disabled), Last Run, Next Run, Actions.
- [ ] T100 Toggle switch — per-job enable/disable toggle. Calls POST /api/cron/:id/toggle. Optimistic UI update.
- [ ] T101 Run Now button — per-job "▶ Run" button. Calls POST /api/cron/:id/run. Shows spinner, then refreshes.
- [ ] T102 Create cron modal — "+" button opens modal: name input, schedule dropdown (presets: every 15m, 30m, 1h, 6h, daily 9am, custom cron expression), task/message textarea. Calls POST /api/cron/create.
- [ ] T103 Delete button — per-job "🗑" with confirm dialog. Calls DELETE /api/cron/:id.

---

## Phase 11 — Activity Feed

### Backend
- [ ] T104 Event logger — write events to `data/activity.jsonl` on: alert triggered, alert resolved, service restart, docker restart, model switch, gateway restart, license activated, cron job run. Schema: `{ ts, type, icon, title, detail, source }`.
- [ ] T105 `GET /api/activity` — reads `data/activity.jsonl` + cron last runs from `/api/cron`. Merges, sorts by timestamp desc, returns last 50 events. Cache 30s.
- [ ] T106 Hook existing actions — add `logActivity(type, title, detail)` calls to: restart-service, restart-docker, alerts/test, openclaw/model, openclaw/gateway, license/activate endpoints.

### Frontend
- [ ] T107 Activity feed card — new card on dashboard (right side or below metrics): scrollable timeline, max-height 400px. Each entry: icon + title + detail + relative timestamp ("2m ago").
- [ ] T108 Activity icons — color-coded by type: 🔔 alert (red), 🔄 restart (yellow), 🤖 model switch (cyan), ⏰ cron (purple), 🔑 license (green).
- [ ] T109 Auto-refresh — feed refreshes with dashboard (every 10s). New items fade in with CSS animation.

---

## Phase 12 — Conversations Browser

### Backend
- [ ] T110 `GET /api/sessions` — reads `~/.openclaw/agents/main/sessions/sessions.json` (and personal profile). For each session: key, sessionId, updatedAt, model, totalTokens, contextTokens, percentUsed, label, type (main/cron/slash/sub-agent). Categorize by key pattern: `agent:main:main` → main, `agent:main:cron:*` → cron, `telegram:slash:*` → slash command, `*:subagent:*` → sub-agent. Cache 60s.
- [ ] T111 `GET /api/sessions/:sessionId/history` — finds JSONL transcript at `~/.openclaw/agents/main/sessions/{sessionId}.jsonl`. Parses lines with `type: "message"`, extracts role + content text. Filters out toolUse/toolResult. Returns `{ messages: [{ role, content, ts }] }`. Limit to last 100 messages. Content truncated to 3000 chars per message.
- [ ] T112 Session search — `GET /api/sessions?q=keyword` — basic text search: filter sessions by label or key containing query string.

### Frontend
- [ ] T113 Sessions page — new page at `/conversations` (or section on dashboard). List view: session cards showing key (prettified), model badge, token count, last active time, type icon (💬 main, ⏰ cron, ⚡ slash, 🤖 sub-agent).
- [ ] T114 Session detail modal — click session → modal with conversation history. Chat-bubble style: user messages right-aligned (cyan), assistant messages left-aligned (gray). Timestamps between messages. Scrollable.
- [ ] T115 Filters — filter bar: All | Main | Cron | Sub-agents | Slash. Token count sort toggle.
- [ ] T116 Search bar — text input at top, filters sessions by keyword match on key/label.

---

## Technical Notes for All Phases

### Gateway WebSocket Invoke (needed for Phase 10)
```
Port: 18789 (from ~/.openclaw/openclaw.json → gateway.port)
Token: ~/.openclaw/openclaw.json → gateway.auth.token
Protocol: ws://127.0.0.1:{port}
Auth: send token in connection header or first message
Used by: cron toggle/run/create/delete
```

### Session Transcripts (needed for Phase 12)
```
Location: ~/.openclaw/agents/main/sessions/{sessionId}.jsonl
Format: JSONL, each line is JSON object
Message lines: { type: "message", message: { role: "user"|"assistant", content: "text" | [{type:"text",text:"..."}] }, timestamp: "ISO" }
Other line types: session, model_change, thinking_level_change (skip these)
Match sessionId from sessions.json to find transcript file
```

### Model Pricing (needed for Phase 9)
```
Claude Opus 4.6:   input $15/MTok, output $75/MTok, cache read $1.50/MTok, cache write $18.75/MTok
Claude Sonnet 4.6: input $3/MTok,  output $15/MTok, cache read $0.30/MTok, cache write $3.75/MTok
```

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
| 9 — Cost Tracker | T85–T92 | Token costs, daily chart, model breakdown, budget alerts |
| 10 — Cron Monitor | T93–T103 | Visual cron management, toggle, run now, create/delete |
| 11 — Activity Feed | T104–T109 | Real-time event timeline, auto-refresh |
| 12 — Conversations | T110–T116 | Session browser, chat history viewer, filters |

**Total: 116 tasks (79 done · 37 todo)**
