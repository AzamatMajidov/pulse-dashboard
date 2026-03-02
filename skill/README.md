# Pulse Dashboard — OpenClaw Skill

This folder is an [OpenClaw](https://openclaw.ai) agent skill for **Pulse Dashboard**.

Once installed, your OpenClaw agent will know how to install, configure, and troubleshoot Pulse Dashboard on your server.

## Install

Copy this `skill` folder into your OpenClaw workspace skills directory:

```bash
# Clone the repo (or download the skill folder)
git clone https://github.com/AzamatMajidov/pulse-dashboard.git
cp -r pulse-dashboard/skill ~/.openclaw/workspace/skills/pulse-dashboard
```

Or one-liner:

```bash
mkdir -p ~/.openclaw/workspace/skills && \
  git clone --depth=1 --filter=blob:none --sparse https://github.com/AzamatMajidov/pulse-dashboard.git /tmp/pulse-skill && \
  cd /tmp/pulse-skill && git sparse-checkout set skill && \
  cp -r skill ~/.openclaw/workspace/skills/pulse-dashboard && \
  cd ~ && rm -rf /tmp/pulse-skill
```

## What it does

After installing the skill, just ask your OpenClaw agent:

- *"Install Pulse Dashboard on my server"*
- *"Set up server monitoring"*
- *"Check Pulse status"*
- *"Configure Telegram alerts in Pulse"*

The agent will guide you through the full setup.

## About Pulse Dashboard

Lightweight self-hosted server monitoring for Linux. Shows CPU/RAM/disk/network, systemd services, Docker containers, OpenClaw bot status, Telegram alerts, and more.

- **Repo:** https://github.com/AzamatMajidov/pulse-dashboard
- **Free & open source** — MIT license, all features included
