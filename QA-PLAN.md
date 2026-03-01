# Pulse Dashboard — QA Test Plan

**Goal:** Verify all features work on a fresh device (no OpenClaw, no Docker, partial setup)
**Environments:**
- 🔲 Local (azamat-Intel, full stack)
- 🔲 Fresh Ubuntu VPS (no OpenClaw)
- 🔲 Raspberry Pi / ARM
- 🔲 Browsers: Chrome, Firefox, Safari (mobile)

---

## 1. Installation & Setup

| # | Scenario | Expected |
|---|----------|----------|
| 1.1 | Fresh install: `git clone` → `npm install` → `node server.js` | Starts on 6682, redirects to `/setup` |
| 1.2 | Setup page loads | All sections render, auto-detection runs |
| 1.3 | Network interface detection (`/api/detect/iface`) | Returns interfaces list |
| 1.4 | Docker detection (`/api/detect/docker`) | Returns containers or empty gracefully |
| 1.5 | Service detection (`/api/detect/services`) | Returns services or empty gracefully |
| 1.6 | Save config → redirect to dashboard | Config saved to `config.json` |
| 1.7 | **No OpenClaw installed** | Dashboard loads, bot section graceful empty state |
| 1.8 | **No Docker installed** | Dashboard loads, container section hidden/empty |
| 1.9 | Config persistence after restart | Settings preserved |

## 2. Dashboard — Core Metrics

| # | Scenario | Expected |
|---|----------|----------|
| 2.1 | Dashboard loads (`/`) | All metric cards render (CPU, RAM, Disk, Network) |
| 2.2 | Auto-refresh (10s) | Values update without page reload |
| 2.3 | CPU metric | 0-100 number |
| 2.4 | RAM metric | `used`/`total` present, percentage correct |
| 2.5 | Disk metric | `used`/`total` present |
| 2.6 | Network metric | `up`/`down` present |
| 2.7 | Hostname in header | Correct hostname |

## 3. Weather Widget

| # | Scenario | Expected |
|---|----------|----------|
| 3.1 | Valid city set | Weather pill shows temp + icon |
| 3.2 | Invalid city in settings | Error message, rejected |
| 3.3 | No city configured | Weather pill hidden, no console errors |
| 3.4 | Hover weather pill | Full description tooltip |

## 4. Services (systemd)

| # | Scenario | Expected |
|---|----------|----------|
| 4.1 | Services configured | Show on dashboard with status |
| 4.2 | Running service | Green/active indicator |
| 4.3 | Stopped service | Inactive indicator |
| 4.4 | Restart → Confirm | Service restarts, status refreshes |
| 4.5 | Restart → Cancel | No restart, UI returns to normal |
| 4.6 | Click 📋 Logs | Log drawer opens with recent logs |
| 4.7 | No services configured | Section hidden or empty state |

## 5. Docker Containers

| # | Scenario | Expected |
|---|----------|----------|
| 5.1 | Containers configured | Show with status |
| 5.2 | Running container | Green status |
| 5.3 | Restart container | Container restarts |
| 5.4 | Container logs (📋) | Log drawer opens |
| 5.5 | **No Docker on machine** | No crash, section gracefully hidden |

## 6. Live Log Tail

| # | Scenario | Expected |
|---|----------|----------|
| 6.1 | Open log drawer | Drawer slides up, logs stream via SSE |
| 6.2 | Auto-scroll | Scrolls to bottom on new lines |
| 6.3 | Manual scroll up | Auto-scroll pauses, resume button appears |
| 6.4 | Click resume | Scrolls to bottom, auto-scroll resumes |
| 6.5 | Maximize (⛶) | Drawer goes full-screen |
| 6.6 | Un-maximize (▽) | Returns to half-screen |
| 6.7 | Close drawer | Drawer closes, SSE connection closed |
| 6.8 | ANSI stripping | No raw escape codes visible |
| 6.9 | Invalid service name (`../../etc`) | 400 error, path traversal blocked |
| 6.10 | SSE cleanup on tab close | Server-side process killed |

## 7. Historical Charts

| # | Scenario | Expected |
|---|----------|----------|
| 7.1 | Sparklines with data | Mini charts on metric cards |
| 7.2 | **Fresh install, no history** | "Collecting data…", no errors |
| 7.3 | Click sparkline | Modal opens with full chart |
| 7.4 | Time range tabs (24h/7d/30d) | Chart data updates |
| 7.5 | Close modal (ESC) | Modal closes |
| 7.6 | Close modal (click backdrop) | Modal closes |
| 7.7 | History API (`/api/history?metric=cpu&hours=24`) | Returns data array |

## 8. Bot Status & Analytics

| # | Scenario | Expected |
|---|----------|----------|
| 8.1 | Bot cards (OpenClaw running) | Show name, status, model |
| 8.2 | Stats row | Sessions, tokens, context % visible |
| 8.3 | Heartbeat indicator | Pulsing ❤️ when enabled |
| 8.4 | Context bar | Progress bar at bottom of card |
| 8.5 | Model dropdown | Shows available models |
| 8.6 | Switch model | Model changes, gateway restarts |
| 8.7 | Restart gateway | Gateway restarts, status refreshes |
| 8.8 | Stop gateway | Gateway stops |
| 8.9 | **No OpenClaw on machine** | Graceful empty state, no crash |

## 9. Telegram Alerts

| # | Scenario | Expected |
|---|----------|----------|
| 9.1 | Alert config in Settings | Telegram creds shown (auto-detected or manual) |
| 9.2 | Send test alert | Telegram message received |
| 9.3 | Test alert — no creds | Clear error message |
| 9.4 | Add CPU > 90% rule | Rule saved |
| 9.5 | Rule triggers (stress CPU) | Alert fires, Telegram sent |
| 9.6 | Cooldown suppression | Second alert within cooldown suppressed |
| 9.7 | Alert bell badge | Active alert → 🔔 red badge |
| 9.8 | Alert dropdown | Click 🔔 → recent alerts shown |
| 9.9 | Alert resolves | Resolution notification, badge clears |

## 10. License & Paywall

| # | Scenario | Expected |
|---|----------|----------|
| 10.1 | Free tier (no license) | Free badge, lock icons on Pro features |
| 10.2 | Click locked feature | Upgrade modal with pricing |
| 10.3 | Admin page (`/admin/license`) | Key generation form |
| 10.4 | Generate license key | Key shown, copyable |
| 10.5 | Activate valid license | Pro badge, features unlocked |
| 10.6 | Activate expired license | Rejected with clear error |
| 10.7 | Activate garbage key | Rejected with clear error |
| 10.8 | Pro API after activation | 200 OK (not 402) |
| 10.9 | Pro API without license | 402 `pro_required` |
| 10.10 | Click Free badge | Upgrade modal ($3/mo, $19/yr) |

## 11. Settings Page

| # | Scenario | Expected |
|---|----------|----------|
| 11.1 | Settings load | All sections with current values |
| 11.2 | Save settings | Config updated, confirmation |
| 11.3 | Invalid weather city | Error, not saved |
| 11.4 | Security settings | Token/auth visible |
| 11.5 | License section | Current tier + activation input |

## 12. Self-Update

| # | Scenario | Expected |
|---|----------|----------|
| 12.1 | Check for updates | Shows current vs latest, commits behind |
| 12.2 | Already up to date | "Up to date" message |
| 12.3 | Update available | Shows "Update Now" button |
| 12.4 | Apply update | `git pull` + restart |

## 13. Cron Monitor (if implemented)

| # | Scenario | Expected |
|---|----------|----------|
| 13.1 | Cron list on dashboard | Shows jobs with status |
| 13.2 | Toggle enable/disable | Job toggled |
| 13.3 | Run now (▶) | Job executes |
| 13.4 | Create cron (+) | New job created |
| 13.5 | Delete cron (🗑) | Job deleted |
| 13.6 | No cron jobs | Empty state |

## 14. Cross-Browser & Responsive

| # | Scenario | Expected |
|---|----------|----------|
| 14.1 | Chrome desktop | Full layout, all features |
| 14.2 | Firefox desktop | Same |
| 14.3 | Safari desktop | Same |
| 14.4 | Mobile Chrome | Responsive, cards stack |
| 14.5 | Mobile Safari | Same |
| 14.6 | Tablet | Appropriate layout |

## 15. Security

| # | Scenario | Expected |
|---|----------|----------|
| 15.1 | Path traversal — logs service | 400 rejected |
| 15.2 | Path traversal — logs docker | 400 rejected |
| 15.3 | Command injection — restart service (`; rm -rf /`) | Rejected, name validated |
| 15.4 | Command injection — restart docker | Rejected |
| 15.5 | XSS in log output (`<script>`) | Escaped, no execution |
| 15.6 | API without auth (if enabled) | 401 unauthorized |

## 16. Error Handling & Edge Cases

| # | Scenario | Expected |
|---|----------|----------|
| 16.1 | Kill & restart Pulse | Starts cleanly, config preserved |
| 16.2 | Corrupted `config.json` | Graceful error or defaults |
| 16.3 | Disk full | Shows 100%, no crash |
| 16.4 | Network down → weather | Graceful failure, dashboard works |
| 16.5 | 30+ days history data | Pruning works, no perf issues |
| 16.6 | 3+ concurrent browser tabs | All update, no conflicts |

---

## Priority for Fresh Device Testing

**P0 — Must work:** 1.1, 1.7, 1.8, 2.1–2.6, 7.2, 8.9, 10.1, 15.x
**P1 — Should work:** 3.x, 4.x, 5.x, 6.x, 9.x, 11.x
**P2 — Nice to have:** 7.x, 8.x, 12.x, 14.x

## Test Tracker

| Environment | Date | Pass | Fail | Blocked | Notes |
|---|---|---|---|---|---|
| Local (azamat-Intel) | | | | | |
| Fresh Ubuntu VPS | | | | | |
| Mobile browser | | | | | |
