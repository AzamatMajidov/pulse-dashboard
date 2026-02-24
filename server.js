const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = 6682;
const NETWORK_IFACE = 'enp2s0';

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// --- Helpers ---

function run(cmd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- CPU Usage ---
let lastCpuStats = null;

function readCpuStats() {
  const raw = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const parts = raw.trim().split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + parts[4];
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

async function getCpuUsage() {
  const a = readCpuStats();
  await sleep(500);
  const b = readCpuStats();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  return totalDelta === 0 ? 0 : Math.round((1 - idleDelta / totalDelta) * 100);
}

// --- CPU Temp ---
async function getCpuTemp() {
  try {
    const out = await run('sensors -j');
    const data = JSON.parse(out);
    const core = data['coretemp-isa-0000'];
    if (core) {
      const pkg = core['Package id 0'];
      if (pkg) return Math.round(Object.values(pkg).find(v => typeof v === 'number' && v > 0));
    }
    // fallback: acpi
    const acpi = data['acpitz-acpi-0'];
    if (acpi && acpi.temp1) return Math.round(Object.values(acpi.temp1).find(v => typeof v === 'number' && v > 0));
  } catch {}
  return null;
}

// --- RAM ---
function getRam() {
  const raw = fs.readFileSync('/proc/meminfo', 'utf8');
  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1]) * 1024 : 0;
  };
  const total = get('MemTotal');
  const available = get('MemAvailable');
  const used = total - available;
  return {
    used: +(used / 1e9).toFixed(1),
    total: +(total / 1e9).toFixed(1),
    percent: Math.round((used / total) * 100)
  };
}

// --- Disk ---
async function getDisk() {
  try {
    const out = await run('df -B1 /');
    const lines = out.split('\n');
    const parts = lines[1].trim().split(/\s+/);
    const total = parseInt(parts[1]);
    const used = parseInt(parts[2]);
    const free = parseInt(parts[3]);
    return {
      total: +(total / 1e9).toFixed(1),
      used: +(used / 1e9).toFixed(1),
      free: +(free / 1e9).toFixed(1),
      percent: Math.round((used / total) * 100)
    };
  } catch { return null; }
}

// --- Network Speed ---
let lastNetStats = null;
let lastNetTime = null;

function readNetStats() {
  const raw = fs.readFileSync('/proc/net/dev', 'utf8');
  const line = raw.split('\n').find(l => l.includes(NETWORK_IFACE));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return { rx: parseInt(parts[1]), tx: parseInt(parts[9]) };
}

function getNetworkSpeed() {
  const now = Date.now();
  const current = readNetStats();
  if (!current) return { up: 0, down: 0 };
  if (!lastNetStats || !lastNetTime) {
    lastNetStats = current;
    lastNetTime = now;
    return { up: 0, down: 0 };
  }
  const dt = (now - lastNetTime) / 1000;
  const down = Math.round((current.rx - lastNetStats.rx) / dt);
  const up = Math.round((current.tx - lastNetStats.tx) / dt);
  lastNetStats = current;
  lastNetTime = now;
  return {
    up: Math.max(0, up),
    down: Math.max(0, down)
  };
}

// --- Docker ---
async function getDockerContainers() {
  const targets = ['roast-postgres', 'mongo', 'roast-redis'];
  try {
    const out = await run('docker ps -a --format "{{.Names}}|{{.Status}}"');
    const lines = out.split('\n').filter(Boolean);
    return targets.map(name => {
      const line = lines.find(l => l.startsWith(name + '|'));
      if (!line) return { name, status: 'not found', running: false, uptime: '' };
      const [, statusFull] = line.split('|');
      const running = statusFull.toLowerCase().startsWith('up');
      const uptime = statusFull.replace(/^Up\s+/i, '').replace(/^Exited.*/, 'stopped');
      return { name, running, uptime: running ? uptime : 'stopped' };
    });
  } catch {
    return targets.map(name => ({ name, running: false, uptime: 'N/A' }));
  }
}

// --- Systemd Services ---
async function getSystemdServices() {
  const services = ['kuydirchi'];
  const results = [];
  for (const svc of services) {
    try {
      const status = await run(`systemctl --user is-active ${svc}`);
      const tsRaw = await run(`systemctl --user show ${svc} --property=ActiveEnterTimestamp`);
      const ts = tsRaw.replace('ActiveEnterTimestamp=', '').trim();
      const active = status === 'active';
      let uptime = 'N/A';
      if (active && ts) {
        const since = new Date(ts);
        if (!isNaN(since)) {
          const diff = Math.floor((Date.now() - since) / 1000);
          uptime = formatDuration(diff);
        }
      }
      results.push({ name: svc, active, uptime });
    } catch {
      results.push({ name: svc, active: false, uptime: 'N/A' });
    }
  }
  return results;
}

// --- Bot Status Cache (openclaw status takes ~8s) ---
const botCache = {};
const BOT_CACHE_TTL = 30000;

async function getBotStatus(profile) {
  const key = profile || 'main';
  const now = Date.now();
  if (botCache[key] && now - botCache[key].time < BOT_CACHE_TTL) {
    return botCache[key].data;
  }
  try {
    const cmd = profile ? `openclaw --profile ${profile} status` : 'openclaw status';
    const out = await run(cmd, 15000);
    const online = out.includes('state active') || out.includes('running');
    // Parse "default main active 4m ago" or "active just now"
    const lastMatch = out.match(/active\s+(just now|\d+[smhd]\s+ago|\d+\s+\w+\s+ago)/i);
    const lastActive = lastMatch ? lastMatch[1].trim() : 'unknown';
    const modelMatch = out.match(/claude-[a-z0-9.-]+/);
    const model = modelMatch ? modelMatch[0] : 'unknown';
    // Uptime from systemd
    const svcName = profile ? `openclaw-${profile}` : 'openclaw-gateway';
    const tsRaw = await run(`systemctl --user show ${svcName} --property=ActiveEnterTimestamp`);
    const ts = tsRaw.replace('ActiveEnterTimestamp=', '').trim();
    let uptime = 'N/A';
    if (ts) {
      const since = new Date(ts);
      if (!isNaN(since)) {
        const diff = Math.floor((Date.now() - since) / 1000);
        uptime = formatDuration(diff);
      }
    }
    const result = { online, lastActive, model, uptime };
    botCache[key] = { time: now, data: result };
    return result;
  } catch {
    return { online: false, lastActive: 'N/A', model: 'N/A', uptime: 'N/A' };
  }
}

// --- Weather Cache ---
let weatherCache = null;
let weatherCacheTime = 0;

function httpGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : http;
    mod.get(url, { headers: { 'User-Agent': 'pulse-dashboard/1.0' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        return resolve(httpGet(res.headers.location, redirects - 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchWeather() {
  return new Promise(async (resolve) => {
    const now = Date.now();
    if (weatherCache && now - weatherCacheTime < 10 * 60 * 1000) {
      return resolve(weatherCache);
    }
    try {
      const data = await httpGet('https://wttr.in/Tashkent?format=j1');
      const json = JSON.parse(data);
      const current = json.current_condition[0];
      const temp = parseInt(current.temp_C);
      const desc = current.weatherDesc[0].value;
      const code = parseInt(current.weatherCode);
      const icon = weatherIcon(code);
      weatherCache = { temp, description: desc, icon };
      weatherCacheTime = now;
      resolve(weatherCache);
    } catch { resolve({ temp: null, description: 'N/A', icon: '🌡️' }); }
  });
}

function weatherIcon(code) {
  if (code === 113) return '☀️';
  if (code === 116) return '⛅';
  if ([119, 122].includes(code)) return '☁️';
  if ([143, 248, 260].includes(code)) return '🌫️';
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 350, 353, 356, 359, 362, 365, 374, 377].includes(code)) return '🌧️';
  if ([179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371, 395].includes(code)) return '❄️';
  if ([200, 386, 389, 392].includes(code)) return '⛈️';
  return '🌡️';
}

// --- Utils ---
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

// --- API ---
app.get('/api/metrics', async (req, res) => {
  try {
    const [cpuUsage, cpuTemp, disk, docker, systemd, qulvachcha, oshna, weather] = await Promise.all([
      getCpuUsage(),
      getCpuTemp(),
      getDisk(),
      getDockerContainers(),
      getSystemdServices(),
      getBotStatus(null),
      getBotStatus('personal'),
      fetchWeather()
    ]);

    const ram = getRam();
    const network = getNetworkSpeed();

    res.json({
      system: {
        cpu: { usage: cpuUsage, temp: cpuTemp },
        ram,
        disk,
        network: {
          up: network.up,
          down: network.down,
          upFormatted: formatBytes(network.up),
          downFormatted: formatBytes(network.down)
        }
      },
      services: { docker, systemd },
      bots: { qulvachcha, oshna },
      weather,
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🫀 Pulse running on http://0.0.0.0:${PORT}\n`);
  // Warm up bot cache in background (openclaw status takes ~8s)
  Promise.all([getBotStatus(null), getBotStatus('personal')])
    .then(() => console.log('Bot status cache warmed up'))
    .catch(() => {});
});
