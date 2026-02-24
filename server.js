const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

// --- Config ---
const CONFIG = {
  port: 6682,
  networkIface: 'enp2s0',
  weatherLocation: 'Tashkent',
  weatherCacheTtl: 10 * 60 * 1000,   // 10 minutes
  botCacheTtl: 30 * 1000,             // 30 seconds
  dockerContainers: ['roast-postgres', 'mongo', 'roast-redis'],
  systemdServices: ['kuydirchi'],
};

const app = express();

// Serve static files (same-origin requests don't need CORS)
app.use(express.static(path.join(__dirname, 'public')));

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

// --- CPU Usage (async file I/O) ---
async function readCpuStats() {
  const raw = await fs.promises.readFile('/proc/stat', 'utf8');
  const parts = raw.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + parts[4];
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

async function getCpuUsage() {
  try {
    const a = await readCpuStats();
    await sleep(500);
    const b = await readCpuStats();
    const idleDelta = b.idle - a.idle;
    const totalDelta = b.total - a.total;
    return totalDelta === 0 ? 0 : Math.round((1 - idleDelta / totalDelta) * 100);
  } catch (err) {
    console.error('getCpuUsage failed:', err.message);
    return null;
  }
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
    const acpi = data['acpitz-acpi-0'];
    if (acpi && acpi.temp1) return Math.round(Object.values(acpi.temp1).find(v => typeof v === 'number' && v > 0));
  } catch (err) {
    console.error('getCpuTemp failed:', err.message);
  }
  return null;
}

// --- RAM (async file I/O) ---
async function getRam() {
  try {
    const raw = await fs.promises.readFile('/proc/meminfo', 'utf8');
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
  } catch (err) {
    console.error('getRam failed:', err.message);
    return null;
  }
}

// --- Disk ---
async function getDisk() {
  try {
    const out = await run('df -B1 /');
    const parts = out.split('\n')[1].trim().split(/\s+/);
    const total = parseInt(parts[1]);
    const used = parseInt(parts[2]);
    const free = parseInt(parts[3]);
    return {
      total: +(total / 1e9).toFixed(1),
      used: +(used / 1e9).toFixed(1),
      free: +(free / 1e9).toFixed(1),
      percent: Math.round((used / total) * 100)
    };
  } catch (err) {
    console.error('getDisk failed:', err.message);
    return null;
  }
}

// --- Network Speed (async file I/O) ---
let lastNetStats = null;
let lastNetTime = null;

async function readNetStats() {
  const raw = await fs.promises.readFile('/proc/net/dev', 'utf8');
  const line = raw.split('\n').find(l => l.includes(CONFIG.networkIface));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return { rx: parseInt(parts[1]), tx: parseInt(parts[9]) };
}

async function getNetworkSpeed() {
  try {
    const now = Date.now();
    const current = await readNetStats();
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
    return { up: Math.max(0, up), down: Math.max(0, down) };
  } catch (err) {
    console.error('getNetworkSpeed failed:', err.message);
    return { up: 0, down: 0 };
  }
}

// --- Docker ---
async function getDockerContainers() {
  try {
    const out = await run('docker ps -a --format "{{.Names}}|{{.Status}}"');
    const lines = out.split('\n').filter(Boolean);
    return CONFIG.dockerContainers.map(name => {
      const line = lines.find(l => l.startsWith(name + '|'));
      if (!line) return { name, running: false, uptime: '' };
      const [, statusFull] = line.split('|');
      const running = statusFull.toLowerCase().startsWith('up');
      const uptime = statusFull.replace(/^Up\s+/i, '').replace(/^Exited.*/, 'stopped');
      return { name, running, uptime: running ? uptime : 'stopped' };
    });
  } catch (err) {
    console.error('getDockerContainers failed:', err.message);
    return CONFIG.dockerContainers.map(name => ({ name, running: false, uptime: 'N/A' }));
  }
}

// --- Systemd Services ---
async function getSystemdServices() {
  const results = [];
  for (const svc of CONFIG.systemdServices) {
    try {
      const status = await run(`systemctl --user is-active ${svc}`);
      const tsRaw = await run(`systemctl --user show ${svc} --property=ActiveEnterTimestamp`);
      const ts = tsRaw.replace('ActiveEnterTimestamp=', '').trim();
      const active = status === 'active';
      let uptime = 'N/A';
      if (active && ts) {
        const since = new Date(ts);
        if (!isNaN(since)) uptime = formatDuration(Math.floor((Date.now() - since) / 1000));
      }
      results.push({ name: svc, active, uptime });
    } catch (err) {
      console.error(`getSystemdServices failed for ${svc}:`, err.message);
      results.push({ name: svc, active: false, uptime: 'N/A' });
    }
  }
  return results;
}

// --- Bot Status (cached, openclaw takes ~8s) ---
const botCache = {};

async function getBotStatus(profile) {
  const key = profile || 'main';
  const now = Date.now();
  if (botCache[key] && now - botCache[key].time < CONFIG.botCacheTtl) {
    return botCache[key].data;
  }
  try {
    const cmd = profile ? `openclaw --profile ${profile} status` : 'openclaw status';
    const out = await run(cmd, 15000);
    const online = out.includes('reachable') && !out.includes('unreachable') && !out.includes('error');
    const lastMatch = out.match(/active\s+(just now|\d+[smhd]\s+ago|\d+\s+\w+\s+ago)/i);
    const lastActive = lastMatch ? lastMatch[1].trim() : 'unknown';
    const modelMatch = out.match(/claude-[a-z0-9.-]+/);
    const model = modelMatch ? modelMatch[0] : 'unknown';
    const svcName = profile ? `openclaw-${profile}` : 'openclaw-gateway';
    const tsRaw = await run(`systemctl --user show ${svcName} --property=ActiveEnterTimestamp`);
    const ts = tsRaw.replace('ActiveEnterTimestamp=', '').trim();
    let uptime = 'N/A';
    if (ts) {
      const since = new Date(ts);
      if (!isNaN(since)) uptime = formatDuration(Math.floor((Date.now() - since) / 1000));
    }
    const result = { online, lastActive, model, uptime };
    botCache[key] = { time: now, data: result };
    return result;
  } catch (err) {
    console.error(`getBotStatus(${key}) failed:`, err.message);
    return { online: false, lastActive: 'N/A', model: 'N/A', uptime: 'N/A' };
  }
}

// --- Weather (cached) ---
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

async function fetchWeather() {
  const now = Date.now();
  if (weatherCache && now - weatherCacheTime < CONFIG.weatherCacheTtl) {
    return weatherCache;
  }
  try {
    const data = await httpGet(`https://wttr.in/${CONFIG.weatherLocation}?format=j1`);
    const json = JSON.parse(data);
    const current = json.current_condition[0];
    const temp = parseInt(current.temp_C);
    const desc = current.weatherDesc[0].value;
    const icon = weatherIcon(parseInt(current.weatherCode));
    weatherCache = { temp, description: desc, icon };
    weatherCacheTime = now;
    return weatherCache;
  } catch (err) {
    console.error('fetchWeather failed:', err.message);
    return { temp: null, description: 'N/A', icon: '🌡️' };
  }
}

function weatherIcon(code) {
  if (code === 113) return '☀️';
  if (code === 116) return '⛅';
  if ([119, 122].includes(code)) return '☁️';
  if ([143, 248, 260].includes(code)) return '🌫️';
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317,
       350, 353, 356, 359, 362, 365, 374, 377].includes(code)) return '🌧️';
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
    const [cpuUsage, cpuTemp, ram, disk, network, docker, systemd, qulvachcha, oshna, weather] = await Promise.all([
      getCpuUsage(),
      getCpuTemp(),
      getRam(),
      getDisk(),
      getNetworkSpeed(),
      getDockerContainers(),
      getSystemdServices(),
      getBotStatus(null),
      getBotStatus('personal'),
      fetchWeather()
    ]);

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
    console.error('API /metrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Server + Graceful Shutdown ---
const server = app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`\n🫀 Pulse running on http://0.0.0.0:${CONFIG.port}\n`);
  Promise.all([getBotStatus(null), getBotStatus('personal')])
    .then(() => console.log('Bot status cache warmed up'))
    .catch(err => console.error('Bot cache warmup failed:', err.message));
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
