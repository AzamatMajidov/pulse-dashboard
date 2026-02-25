# Pulse — Install Guide

**Time:** ~5 minutes  
**Requirements:** Linux VPS, OpenClaw installed, internet access

---

## Step 1 — Install Node.js (if not installed)

Check if you have it:
```bash
node --version
```

Need v18 or higher. If missing or outdated:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:
```bash
node --version  # should say v20.x.x or higher
```

---

## Step 2 — Install Git (if not installed)

```bash
sudo apt-get install -y git
```

---

## Step 3 — Clone and install Pulse

```bash
git clone https://github.com/AzamatMajidov/pulse-dashboard.git
cd pulse-dashboard
bash setup.sh
```

`setup.sh` will install dependencies, set up the systemd service, and start Pulse automatically.

---

## Step 4 — Open the setup page

Open your browser and go to:
```
http://YOUR-VPS-IP:6682
```

You'll be redirected to the setup page. Fill in:

- **Server Label** — a name for this machine (e.g. "My VPS")
- **Port** — leave as `6682` unless it conflicts
- **Weather City** — your city name
- **Network Interface** — click 🔍 Auto-detect
- **Docker Containers** — Auto-discover (or Manual if you want specific ones)
- **Systemd Services** — click 🔍 Discover, select what you want to monitor
- **Security** — enable Basic Auth, set a username and password
- **OpenClaw Bots** — expand the section, add your bot name (leave Profile empty for default)

Hit **Save & Restart**. Wait for the spinner to finish — it'll redirect you to the dashboard automatically.

---

## Step 5 — Open the firewall

If your VPS has a firewall (UFW):
```bash
sudo ufw allow 6682
sudo ufw status  # verify
```

If you're on a cloud provider (AWS, GCP, DigitalOcean, Hetzner), also open port `6682` in your cloud firewall / security group settings.

---

## That's it 🎉

Your dashboard is live at `http://YOUR-VPS-IP:6682`

---

## Useful commands

```bash
# View logs
journalctl --user -u pulse -f

# Restart
systemctl --user restart pulse

# Stop
systemctl --user stop pulse

# Change settings anytime
# → click the ⚙ icon in the top-right of the dashboard
```

---

## Troubleshooting

**Can't access the dashboard?**
- Check Pulse is running: `systemctl --user status pulse`
- Check the port is open: `sudo ufw status`
- Check your cloud provider's firewall (security groups)

**Setup page not showing?**
- Make sure you're going to `http://IP:6682` not `https://`
- Try: `curl http://localhost:6682/api/health` — should return `{"ok":true}`

**Port already in use?**
```bash
sudo lsof -i :6682
```
Change the port in `config.json` and restart: `systemctl --user restart pulse`

**Pulse not starting after reboot?**  
Enable lingering so your user services start without login:
```bash
loginctl enable-linger $USER
```
