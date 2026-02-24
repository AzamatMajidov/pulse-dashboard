# CLAUDE.md — Pulse Dashboard

## What is this?
Home server monitoring dashboard. Node.js backend + plain HTML/CSS/JS frontend. No build step.

## Stack
- **Backend:** `server.js` — Express, Node.js built-ins only (no heavy deps)
- **Frontend:** `public/index.html` — single file, inline CSS + JS, vanilla DOM
- **No React, no bundler, no TypeScript**

## Run & Restart
```bash
# Development (direct)
npm start

# Production (systemd service — preferred)
systemctl --user restart pulse
systemctl --user status pulse
journalctl --user -u pulse -f   # live logs
```

## Test the API
```bash
curl -s http://localhost:6682/api/metrics | python3 -m json.tool
```

## File Structure
```
pulse/
  server.js          # All backend logic + Express server
  package.json       # Only dependency: express
  public/
    index.html       # Entire frontend (HTML + CSS + JS)
  REQUIREMENTS.md    # Product spec
  CLAUDE.md          # This file
  README.md
```

## Config (top of server.js)
All tunables live in the `CONFIG` object:
```js
const CONFIG = {
  port: 6682,
  networkIface: 'enp2s0',
  weatherLocation: 'Tashkent',
  weatherCacheTtl: 10 * 60 * 1000,
  botCacheTtl: 30 * 1000,
  dockerContainers: ['roast-postgres', 'mongo', 'roast-redis'],
  systemdServices: ['kuydirchi'],
};
```

## Key Gotchas

### Bot status is slow
`openclaw status` takes ~8 seconds. Bot data is cached for 30s (`CONFIG.botCacheTtl`).
Cache warms up on startup. Don't remove the cache or the API will be slow.

### No CORS header
Removed intentionally — same-origin requests don't need it.

### XSS prevention
`renderDocker()` and `renderSystemd()` use the DOM API (`textContent`, `createElement`).
Do NOT switch back to `innerHTML` with server data.

### Async I/O only
All file reads use `fs.promises.readFile`. Do not use `fs.readFileSync` — it blocks the event loop.

### Systemd environment
When running as a systemd service, PATH is limited. `openclaw` is found via the `Environment=PATH=...`
line in `~/.config/systemd/user/pulse.service`. If you add new shell commands, make sure their
binary is in that PATH.

## Adding a New Widget

**Backend (`server.js`):**
1. Write an async function that returns the data
2. Add it to the `Promise.all([...])` in `GET /api/metrics`
3. Include it in the `res.json({...})` response

**Frontend (`public/index.html`):**
1. Add the HTML structure in the appropriate section
2. Update `fetchMetrics()` to read and render the new data
3. Use `textContent` for any server-provided strings (never interpolate into innerHTML)

## Deployment
The service auto-starts on boot and auto-restarts on crash.
After code changes: `systemctl --user restart pulse`
