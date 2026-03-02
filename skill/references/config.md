# Pulse config.json Reference

Located at `<install-dir>/config.json`. Edit manually then `systemctl --user restart pulse`.
The web UI (Settings ⚙️) writes this file automatically — manual edits only needed for advanced options.

## Full Schema

```json
{
  "label": "My Server",
  "port": 6682,
  "networkIface": "eth0",
  "weatherLocation": "Tashkent",
  "weatherLat": 41.2995,
  "weatherLon": 69.2401,
  "weatherCacheTtl": 600,
  "botCacheTtl": 30,
  "dockerContainers": "auto",
  "systemdServices": ["my-app", "nginx"],
  "auth": {
    "enabled": true,
    "username": "admin",
    "password": "secure-password"
  },
  "bots": [
    { "name": "My Bot", "profile": null },
    { "name": "Work Bot", "profile": "work" }
  ],
  "alerts": {
    "telegram": {
      "botToken": "123:ABC",
      "chatId": "45118778"
    },
    "cooldownMinutes": 15,
    "rules": [
      { "metric": "cpu", "op": "gt", "threshold": 85, "durationSeconds": 60 },
      { "metric": "ram", "op": "gt", "threshold": 90, "durationSeconds": 30 },
      { "metric": "disk", "op": "gt", "threshold": 95 },
      { "metric": "service_down", "target": "my-app" },
      { "metric": "container_down", "target": "my-container" },
      { "metric": "bot_offline", "target": "My Bot" }
    ]
  }
}
```

## Field Reference

| Field | Default | Description |
|-------|---------|-------------|
| `label` | hostname | Display name shown in dashboard header |
| `port` | `6682` | HTTP port Pulse listens on |
| `networkIface` | `"auto"` | NIC name (e.g. `eth0`, `ens3`) or `"auto"` to detect |
| `weatherLocation` | — | City name for weather widget |
| `weatherLat` / `weatherLon` | — | Auto-set when city is saved via UI; skip manual edit |
| `weatherCacheTtl` | `600` | Weather cache in seconds |
| `botCacheTtl` | `30` | OpenClaw bot status cache in seconds |
| `dockerContainers` | `"auto"` | `"auto"` = all running; or array `["name1","name2"]` |
| `systemdServices` | `[]` | Systemd user services to monitor |
| `auth.enabled` | `false` | Enable HTTP Basic Auth (recommended for VPS) |
| `auth.username` | `"admin"` | Basic auth username |
| `auth.password` | — | Basic auth password |
| `bots` | `[]` | OpenClaw bot profiles. `profile: null` = default profile |

## Alerts

Pulse auto-detects Telegram credentials from OpenClaw (`~/.openclaw/openclaw.json`). Manual override:

```json
"alerts": {
  "telegram": { "botToken": "...", "chatId": "..." }
}
```

`cooldownMinutes` (default 15) — minimum gap between repeated alerts for the same rule.

### Alert Rule Metrics

| metric | description | threshold |
|--------|-------------|-----------|
| `cpu` | CPU usage % | number (0–100) |
| `ram` | RAM usage % | number (0–100) |
| `disk` | Disk usage % | number (0–100) |
| `service_down` | Systemd service offline | use `target` field |
| `container_down` | Docker container stopped | use `target` field |
| `bot_offline` | OpenClaw bot offline | use `target` field |

`op` values: `gt` (greater than), `lt` (less than)  
`durationSeconds` — optional, alert only after condition holds this long (avoids spikes)
