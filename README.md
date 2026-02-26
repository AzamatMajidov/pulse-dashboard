# 🫀 Pulse

A lightweight, self-hosted server monitoring dashboard for [OpenClaw](https://openclaw.ai) users.

Dark UI. Zero cloud dependencies. Runs on anything — home server, VPS, Raspberry Pi.

![Pulse Dashboard](https://img.shields.io/badge/stack-Node.js%20%2B%20Express-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **System metrics** — CPU usage + temperature, RAM, disk, network speed
- **Docker containers** — auto-discover all running containers or watch specific ones
- **Systemd services** — monitor any user or system services
- **OpenClaw bots** — see your bot(s) online/offline status, model, uptime
- **Weather** — current conditions for your city
- **Auto-refresh** every 10 seconds
- **Basic auth** — protect your dashboard with a username/password
- **Zero build step** — plain Node.js + Express, no bundler needed

## Install

### Prerequisites

- Node.js >= 18
- Linux with systemd (Ubuntu, Debian, Fedora, etc.)
- OpenClaw installed (optional — bots section will be empty otherwise)

### Quick Install

```bash
git clone https://github.com/AzamatMajidov/pulse-dashboard.git
cd pulse-dashboard
bash setup.sh
```

`setup.sh` will:
1. Check Node.js version
2. Run `npm install`
3. Create `config.json` from the template
4. Install and start a systemd user service

### Configure

Edit `config.json` with your settings:

```json
{
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
  ]
}
```

| Key | Description |
|---|---|
| `port` | Port to listen on (default: 6682) |
| `networkIface` | Network interface name, or `"auto"` to detect automatically |
| `weatherLocation` | City name for weather widget |
| `dockerContainers` | `"auto"` to show all running containers, or `["name1", "name2"]` for specific ones |
| `systemdServices` | List of systemd user services to monitor |
| `auth.enabled` | Set `true` to enable HTTP Basic Auth (recommended for VPS) |
| `bots` | List of OpenClaw bot profiles. `profile: null` = default profile |

After editing config:

```bash
systemctl --user restart pulse
```

### Open firewall (VPS)

If running on a VPS with UFW:

```bash
sudo ufw allow 6682
```

## Access

```
http://YOUR-SERVER-IP:6682
```

Or locally: `http://localhost:6682`

## Multiple bots

If you run multiple OpenClaw profiles:

```json
"bots": [
  { "name": "Work Bot", "profile": null },
  { "name": "Personal Bot", "profile": "personal" }
]
```

Set `profile` to the OpenClaw profile name (`openclaw --profile <name>`). Use `null` for the default profile.

## Management

```bash
# Status
systemctl --user status pulse

# Restart
systemctl --user restart pulse

# Logs
journalctl --user -u pulse -f

# Stop
systemctl --user stop pulse
```

## Stack

- **Backend:** Node.js + Express (no extra dependencies)
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no build step)
- **Metrics source:** `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `df`, `sensors`, `docker`, `systemctl`

## License

MIT

---

## Pro

Pulse is free for basic monitoring. **Pro** unlocks the full toolkit:

| Feature | Free | Pro |
|---------|:----:|:---:|
| System metrics (CPU, RAM, Disk, Network) | ✅ | ✅ |
| Weather widget | ✅ | ✅ |
| Bot status cards | ✅ | ✅ |
| Historical charts & sparklines | ✅ | ✅ |
| Telegram alerts | ❌ | ✅ |
| Service & Docker restart | ❌ | ✅ |
| Gateway controls & model switch | ❌ | ✅ |
| Live log tail | ❌ | ✅ |

**Pricing:** $7/mo or $49/yr (save 42%)

To get a license key, reach out: **azamat.z.majidov@gmail.com**

Activate in Settings → License → paste your key → done.
