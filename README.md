# 🫀 Pulse

Home server monitoring dashboard. Dark, clean, real-time.

## What it shows
- **System:** CPU usage + temp, RAM, Disk, Network speed
- **Services:** Docker containers, systemd services
- **Agents:** Qulvachcha 🐣 + Oshna 🌸 (OpenClaw bots)
- **Personal:** Live clock, date, Tashkent weather

## Stack
- Node.js + Express backend
- Plain HTML/CSS/Vanilla JS — zero build step
- Auto-refreshes every 10 seconds

## Run
```bash
npm install
npm start
# → http://0.0.0.0:6682
```

## Access
- Home network: `http://192.168.x.x:6682`
- Tailscale: `http://100.x.x.x:6682`

## Autostart (systemd)
```bash
# Create ~/.config/systemd/user/pulse.service
[Unit]
Description=Pulse Dashboard
After=network.target

[Service]
WorkingDirectory=/home/azamat/Projects/pulse
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=default.target

# Enable
systemctl --user enable pulse
systemctl --user start pulse
```
