const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

// --- Setup Mode ---
let setupMode = false;

// --- Load Config ---
async function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  const examplePath = path.join(__dirname, 'config.example.json');
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    setupMode = false;
    return JSON.parse(raw);
  } catch {
    setupMode = true;
    console.log('⚙️  No config.json found — running in setup mode');
    try {
      const raw = await fs.promises.readFile(examplePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Absolute fallback
      return { port: 6682, bots: [], systemdServices: [], dockerContainers: 'auto', weatherLocation: 'London', networkIface: 'auto', auth: { enabled: false } };
    }
  }
}

// --- Auto-detect network interface ---
async function detectNetworkIface() {
  try {
    const raw = await fs.promises.readFile('/proc/net/dev', 'utf8');
    const lines = raw.split('\n').slice(2).filter(Boolean);
    for (const line of lines) {
      const name = line.trim().split(':')[0].trim();
      if (name && name !== 'lo') return name;
    }
  } catch (err) {
    console.error('detectNetworkIface failed:', err.message);
  }
  return 'eth0';
}

let CONFIG = {};

const app = express();
app.use(express.json());

// --- Auth Middleware (skips /setup, /api/setup, /api/health, /api/detect/*) ---
app.use((req, res, next) => {
  const publicPaths = ['/setup', '/api/setup', '/api/health'];
  const isPublic = publicPaths.includes(req.path) || req.path.startsWith('/api/detect');
  if (isPublic) return next();
  if (!CONFIG.auth || !CONFIG.auth.enabled) return next();
  const header = req.headers.authorization || '';
  const b64 = header.startsWith('Basic ') ? header.slice(6) : '';
  const decoded = Buffer.from(b64, 'base64').toString();
  const colon = decoded.indexOf(':');
  const user = colon >= 0 ? decoded.slice(0, colon) : '';
  const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
  if (user === CONFIG.auth.username && pass === CONFIG.auth.password) return next();
  res.set('WWW-Authenticate', 'Basic realm="Pulse"');
  res.status(401).send('Unauthorized');
});

// --- Setup Mode Redirect Middleware ---
app.use((req, res, next) => {
  if (!setupMode) return next();
  const allowed = ['/setup', '/api/setup', '/api/health'];
  const isAllowed = allowed.includes(req.path) || req.path.startsWith('/api/detect');
  if (isAllowed) return next();
  // Allow static assets for setup page
  if (req.path.match(/\.(js|css|ico|png|svg|woff|woff2)$/)) return next();
  if (req.path !== '/') return res.redirect('/setup');
  res.redirect('/setup');
});

// Serve static files
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

// --- CPU Usage ---
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

// --- RAM ---
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

// --- Network Speed ---
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
    if (CONFIG.dockerContainers === 'auto') {
      return lines.map(line => {
        const [name, ...rest] = line.split('|');
        const statusFull = rest.join('|');
        const running = statusFull.toLowerCase().startsWith('up');
        return { name, running, uptime: running ? statusFull.replace(/^Up\s+/i, '') : 'stopped' };
      });
    }
    return CONFIG.dockerContainers.map(name => {
      const line = lines.find(l => l.startsWith(name + '|'));
      if (!line) return { name, running: false, uptime: '' };
      const [, statusFull] = line.split('|');
      const running = statusFull.toLowerCase().startsWith('up');
      return { name, running, uptime: running ? statusFull.replace(/^Up\s+/i, '') : 'stopped' };
    });
  } catch (err) {
    console.error('getDockerContainers failed:', err.message);
    return [];
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

// --- Bot Status ---
const botCache = {};

async function fetchBotStatus(name, profile) {
  const key = profile || 'main';
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
    botCache[key] = { time: Date.now(), data: result, refreshing: false };
    return { name, ...result };
  } catch (err) {
    console.error(`fetchBotStatus(${key}) failed:`, err.message);
    if (botCache[key]) botCache[key].refreshing = false;
    return null;
  }
}

function getBotStatus(name, profile) {
  const key = profile || 'main';
  const now = Date.now();
  const cached = botCache[key];

  // Cache is fresh — return immediately
  if (cached && now - cached.time < CONFIG.botCacheTtl) {
    return Promise.resolve({ name, ...cached.data });
  }

  // Stale or no cache — return immediately (stale data or empty), refresh in background
  if (!cached || !cached.refreshing) {
    if (cached) cached.refreshing = true;
    else botCache[key] = { time: 0, data: { online: false, lastActive: '...', model: '...', uptime: '...' }, refreshing: true };
    fetchBotStatus(name, profile).catch(() => {});
  }

  return Promise.resolve({ name, ...(cached ? cached.data : { online: false, lastActive: '...', model: '...', uptime: '...' }) });
}

// --- Weather ---
let weatherCache = null;
let weatherCacheTime = 0;

function httpGet(url, redirects = 5, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'pulse-dashboard/1.0' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        return resolve(httpGet(res.headers.location, redirects - 1, timeoutMs));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function fetchWeather() {
  const now = Date.now();
  // Return cache if fresh (success) OR if recently failed (back off 2 min)
  if (weatherCacheTime && now - weatherCacheTime < CONFIG.weatherCacheTtl) {
    return weatherCache || { temp: null, description: 'N/A', icon: '🌡️' };
  }
  try {
    const data = await httpGet(`https://wttr.in/${encodeURIComponent(CONFIG.weatherLocation)}?format=j1`);
    const json = JSON.parse(data);
    const current = json.current_condition[0];
    const temp = parseInt(current.temp_C);
    const desc = current.weatherDesc[0].value;
    const icon = weatherIcon(parseInt(current.weatherCode));
    weatherCache = { temp, description: desc, icon };
  } catch (err) {
    console.error('fetchWeather failed:', err.message);
    // Keep stale cache if available, else null
  }
  weatherCacheTime = now;
  return weatherCache || { temp: null, description: 'N/A', icon: '🌡️' };
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

// ============================================================
// API Routes
// ============================================================

// --- Health check ---
app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- Current config (for settings form pre-fill) ---
app.get('/api/config', (req, res) => res.json(CONFIG));

// --- Save config + restart ---
app.post('/api/setup', async (req, res) => {
  try {
    const cfg = req.body;

    // Basic validation
    if (!cfg.port || isNaN(parseInt(cfg.port))) return res.status(400).json({ error: 'Invalid port' });
    if (!cfg.weatherLocation) return res.status(400).json({ error: 'Weather location required' });

    // Normalize types
    cfg.port = parseInt(cfg.port);
    if (Array.isArray(cfg.dockerContainers) && cfg.dockerContainers.length === 0) {
      cfg.dockerContainers = 'auto';
    }
    if (!Array.isArray(cfg.systemdServices)) cfg.systemdServices = [];
    if (!Array.isArray(cfg.bots)) cfg.bots = [];

    const configPath = path.join(__dirname, 'config.json');
    await fs.promises.writeFile(configPath, JSON.stringify(cfg, null, 2));

    res.json({ ok: true, port: cfg.port });

    // Restart after response is sent
    setTimeout(() => {
      console.log('Config saved — restarting...');
      process.exit(0);
    }, 300);
  } catch (err) {
    console.error('POST /api/setup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Auto-detect: network interface ---
app.get('/api/detect/iface', async (req, res) => {
  const iface = await detectNetworkIface();
  res.json({ iface });
});

// --- Auto-detect: Docker containers ---
app.get('/api/detect/docker', async (req, res) => {
  try {
    const out = await run('docker ps --format "{{.Names}}"');
    const containers = out.split('\n').filter(Boolean);
    res.json({ containers });
  } catch {
    res.json({ containers: [] });
  }
});

// --- Auto-detect: systemd user services ---
app.get('/api/detect/services', async (req, res) => {
  try {
    const out = await run('systemctl --user list-units --type=service --state=active --no-legend --no-pager');
    const services = out.split('\n')
      .filter(Boolean)
      .map(line => line.trim().split(/\s+/)[0].replace('.service', ''))
      .filter(s => s && !s.startsWith('dbus') && !s.startsWith('xdg'));
    res.json({ services });
  } catch {
    res.json({ services: [] });
  }
});

// --- Metrics ---
app.get('/api/metrics', async (req, res) => {
  try {
    const botPromises = (CONFIG.bots || []).map(b => getBotStatus(b.name, b.profile));
    const [cpuUsage, cpuTemp, ram, disk, network, docker, systemd, weather, ...botResults] = await Promise.all([
      getCpuUsage(), getCpuTemp(), getRam(), getDisk(),
      getNetworkSpeed(), getDockerContainers(), getSystemdServices(),
      fetchWeather(), ...botPromises
    ]);
    res.json({
      system: {
        cpu: { usage: cpuUsage, temp: cpuTemp },
        ram, disk,
        network: {
          up: network.up, down: network.down,
          upFormatted: formatBytes(network.up),
          downFormatted: formatBytes(network.down)
        }
      },
      services: { docker, systemd },
      bots: botResults,
      weather,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('API /metrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Setup + Settings page ---
app.get('/setup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));

// ============================================================
// Startup
// ============================================================
async function start() {
  CONFIG = await loadConfig();

  if (CONFIG.networkIface === 'auto') {
    CONFIG.networkIface = await detectNetworkIface();
    console.log(`🌐 Network interface: ${CONFIG.networkIface}`);
  }

  CONFIG.botCacheTtl = CONFIG.botCacheTtl || 5 * 60 * 1000;
  CONFIG.weatherCacheTtl = CONFIG.weatherCacheTtl || 10 * 60 * 1000;
  if (!CONFIG.bots) CONFIG.bots = [];
  if (!CONFIG.systemdServices) CONFIG.systemdServices = [];

  const server = app.listen(CONFIG.port, '0.0.0.0', () => {
    if (setupMode) {
      console.log(`\n⚙️  Pulse is in setup mode — open http://0.0.0.0:${CONFIG.port}/setup\n`);
    } else {
      console.log(`\n🫀 Pulse running on http://0.0.0.0:${CONFIG.port}\n`);
      if (CONFIG.bots.length > 0) {
        Promise.all(CONFIG.bots.map(b => getBotStatus(b.name, b.profile)))
          .then(() => console.log('Bot status cache warmed up'))
          .catch(err => console.error('Bot cache warmup failed:', err.message));
      }
    }
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => process.exit(0));
  });

  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

start().catch(err => {
  console.error('Failed to start Pulse:', err.message);
  process.exit(1);
});
