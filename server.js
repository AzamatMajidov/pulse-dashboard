const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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

// ============================================================
// Alert System
// ============================================================

let lastMetricSnapshot = null;
let alertHistory = [];          // ring buffer, max 20
const alertState = new Map();   // key = rule index, value = { status, firedAt, resolvedAt, accumulator }

// T01 — Auto-detect Telegram credentials
async function getTelegramCredentials() {
  // Manual override in config
  const manual = CONFIG.alerts?.telegram;
  if (manual?.botToken && manual?.chatId) {
    return { botToken: manual.botToken, chatId: manual.chatId, source: 'manual' };
  }
  // Auto-detect from OpenClaw
  try {
    const ocPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const afPath = path.join(os.homedir(), '.openclaw', 'credentials', 'telegram-allowFrom.json');
    const [ocRaw, afRaw] = await Promise.all([
      fs.promises.readFile(ocPath, 'utf8'),
      fs.promises.readFile(afPath, 'utf8')
    ]);
    const oc = JSON.parse(ocRaw);
    const af = JSON.parse(afRaw);
    const botToken = oc?.channels?.telegram?.botToken;
    const chatId = af?.allowFrom?.[0];
    if (botToken && chatId) return { botToken, chatId, source: 'openclaw' };
  } catch {}
  return null;
}

// T02 — Send Telegram message
async function sendTelegramMessage(text) {
  try {
    const creds = await getTelegramCredentials();
    if (!creds) { console.error('sendTelegramMessage: no credentials'); return false; }
    const body = JSON.stringify({ chat_id: creds.chatId, text, parse_mode: 'HTML' });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${creds.botToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.setTimeout(8000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    return true;
  } catch (err) {
    console.error('sendTelegramMessage failed:', err.message);
    return false;
  }
}

// T05 — Evaluate a single rule against snapshot
function evaluateRule(rule, snapshot) {
  if (!snapshot) return false;
  switch (rule.metric) {
    case 'cpu':    return (snapshot.cpu ?? 0) >= rule.threshold;
    case 'ram':    return (snapshot.ram ?? 0) >= rule.threshold;
    case 'disk':   return (snapshot.disk ?? 0) >= rule.threshold;
    case 'service_down':
      return (snapshot.services || []).some(s => s.name === rule.name && !s.active);
    case 'container_down':
      return (snapshot.docker || []).some(c => c.name === rule.name && !c.running);
    case 'bot_offline':
      return (snapshot.bots || []).some(b => b.name === rule.name && !b.online);
    default: return false;
  }
}

function ruleLabel(rule) {
  switch (rule.metric) {
    case 'cpu':    return `CPU above ${rule.threshold}%`;
    case 'ram':    return `RAM above ${rule.threshold}%`;
    case 'disk':   return `Disk above ${rule.threshold}%`;
    case 'service_down':    return `Service <b>${rule.name}</b> is down`;
    case 'container_down':  return `Container <b>${rule.name}</b> is down`;
    case 'bot_offline':     return `Bot <b>${rule.name}</b> is offline`;
    default: return rule.metric;
  }
}

function ruleValue(rule, snapshot) {
  switch (rule.metric) {
    case 'cpu':   return `currently ${snapshot?.cpu ?? '?'}%`;
    case 'ram':   return `currently ${snapshot?.ram ?? '?'}%`;
    case 'disk':  return `currently ${snapshot?.disk ?? '?'}%`;
    default: return '';
  }
}

// T03/T06 — Background alert worker
function startAlertWorker() {
  const INTERVAL = 30 * 1000;
  const STEP_SECONDS = 30;

  setInterval(async () => {
    const rules = CONFIG.alerts?.rules;
    if (!rules?.length || !lastMetricSnapshot) return;

    const cooldownMs = (CONFIG.alerts?.cooldownMinutes ?? 15) * 60 * 1000;
    const serverLabel = CONFIG.label || 'Server';
    const now = Date.now();
    const timeStr = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!alertState.has(i)) alertState.set(i, { status: 'idle', firedAt: null, resolvedAt: null, accumulator: 0 });
      const state = alertState.get(i);
      const triggered = evaluateRule(rule, lastMetricSnapshot);

      // Duration accumulator for threshold rules
      if (['cpu', 'ram', 'disk'].includes(rule.metric) && rule.duration) {
        state.accumulator = triggered ? state.accumulator + STEP_SECONDS : 0;
        const shouldFire = state.accumulator >= (rule.duration || 0);
        if (!shouldFire && state.status === 'idle') continue;
        if (!shouldFire && state.status === 'firing') {
          // Resolved
          state.status = 'resolved';
          state.resolvedAt = now;
          const entry = alertHistory.find(e => e.ruleIndex === i && e.active);
          if (entry) { entry.active = false; entry.resolvedAt = now; }
          const val = ruleValue(rule, lastMetricSnapshot);
          sendTelegramMessage(`✅ <b>Pulse Recovered</b> — ${serverLabel}\n${ruleLabel(rule).replace('above', 'back to normal')} ${val}\n${timeStr}`).catch(() => {});
          continue;
        }
        if (shouldFire && state.status !== 'firing') {
          if (state.firedAt && now - state.firedAt < cooldownMs) continue;
          state.status = 'firing';
          state.firedAt = now;
          const val = ruleValue(rule, lastMetricSnapshot);
          const msg = `🔴 <b>Pulse Alert</b> — ${serverLabel}\n${ruleLabel(rule)} ${val}\n${timeStr}`;
          pushHistory({ ruleIndex: i, metric: rule.metric, message: msg, firedAt: now });
          sendTelegramMessage(msg).catch(() => {});
        }
      } else {
        // Binary rules (service_down, container_down, bot_offline)
        if (triggered && state.status !== 'firing') {
          if (state.firedAt && now - state.firedAt < cooldownMs) continue;
          state.status = 'firing';
          state.firedAt = now;
          const msg = `🔴 <b>Pulse Alert</b> — ${serverLabel}\n${ruleLabel(rule)}\n${timeStr}`;
          pushHistory({ ruleIndex: i, metric: rule.metric, message: msg, firedAt: now });
          sendTelegramMessage(msg).catch(() => {});
        } else if (!triggered && state.status === 'firing') {
          state.status = 'resolved';
          state.resolvedAt = now;
          const entry = alertHistory.find(e => e.ruleIndex === i && e.active);
          if (entry) { entry.active = false; entry.resolvedAt = now; }
          sendTelegramMessage(`✅ <b>Pulse Recovered</b> — ${serverLabel}\n${ruleLabel(rule)} resolved\n${timeStr}`).catch(() => {});
        }
      }
    }
  }, INTERVAL);

  console.log('🔔 Alert worker started');
}

// T07 — Push to alert history (ring buffer, max 20)
function pushHistory(entry) {
  alertHistory.unshift({ ...entry, active: true, resolvedAt: null });
  if (alertHistory.length > 20) alertHistory = alertHistory.slice(0, 20);
}

const app = express();
app.use(express.json());

// --- Auth Middleware (skips /setup, /api/setup, /api/health, /api/detect/*) ---
app.use((req, res, next) => {
  const publicPaths = ['/setup', '/api/setup', '/api/health', '/api/alerts/test', '/admin/license', '/api/license/generate', '/api/license/activate', '/api/license/status'];
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
  const allowed = ['/setup', '/api/setup', '/api/health', '/admin/license', '/api/license/generate'];
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
const BOT_CACHE_FILE = path.join(__dirname, 'data', 'bot-cache.json');

// Load persisted bot cache on startup (survives restarts)
try {
  const saved = JSON.parse(require('fs').readFileSync(BOT_CACHE_FILE, 'utf8'));
  for (const [key, entry] of Object.entries(saved)) {
    botCache[key] = { time: entry.time, data: entry.data, refreshing: false };
  }
} catch (_) { /* no cache file yet, that's fine */ }

function persistBotCache() {
  const serializable = {};
  for (const [key, entry] of Object.entries(botCache)) {
    serializable[key] = { time: entry.time, data: entry.data };
  }
  const dir = path.dirname(BOT_CACHE_FILE);
  require('fs').mkdirSync(dir, { recursive: true });
  require('fs').writeFileSync(BOT_CACHE_FILE, JSON.stringify(serializable));
}

async function fetchBotStatus(name, profile) {
  const key = profile || 'main';
  try {
    const cmd = openclawCmd(profile, 'status --json');
    const out = await run(cmd, 15000);

    // Parse JSON output from openclaw status --json
    let json;
    try { json = JSON.parse(out); } catch { json = null; }

    let online = false, lastActive = 'unknown', model = 'unknown';
    let sessions = 0, totalTokens = 0, contextTokens = 200000, contextPercent = 0;
    let heartbeatEnabled = false, heartbeatInterval = null, heartbeatEveryMs = null;
    let lastActiveAgeMs = null, sessionStarted = null, activeSessions24h = 0;

    if (json) {
      // Gateway is reachable if we got valid JSON with sessions
      online = !!(json.sessions && json.sessions.count >= 0);

      // Sessions data
      const recent = json.sessions?.recent || [];
      sessions = json.sessions?.count || 0;
      contextTokens = json.sessions?.defaults?.contextTokens || 200000;

      // Aggregate tokens across all recent sessions
      let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;
      for (const s of recent) {
        inputTokens += s.inputTokens || 0;
        outputTokens += s.outputTokens || 0;
        cacheRead += s.cacheRead || 0;
        cacheWrite += s.cacheWrite || 0;
      }

      // Main session (first/most recent)
      if (recent.length > 0) {
        const main = recent[0];
        totalTokens = main.totalTokens || 0;
        contextPercent = main.percentUsed || 0;
        model = main.model || json.sessions?.defaults?.model || 'unknown';
        if (main.updatedAt) {
          sessionStarted = new Date(main.updatedAt).toISOString();
        }
        // Format lastActive from age (ms)
        if (main.age != null) {
          lastActive = main.age < 60000 ? 'just now' : formatDuration(Math.floor(main.age / 1000)) + ' ago';
        }
      }

      // Count sessions active within last 24h
      const dayAgo = 24 * 60 * 60 * 1000;
      activeSessions24h = recent.filter(s => s.age != null && s.age < dayAgo).length;

      // Heartbeat data
      const hbAgents = json.heartbeat?.agents || [];
      if (hbAgents.length > 0) {
        const hb = hbAgents[0];
        heartbeatEnabled = !!hb.enabled;
        heartbeatInterval = hb.every || null;
        heartbeatEveryMs = hb.everyMs || null;
      }

      // Agent data (lastActiveAgeMs)
      const agents = json.agents?.agents || [];
      if (agents.length > 0) {
        lastActiveAgeMs = agents[0].lastActiveAgeMs ?? null;
      }
    } else {
      // Fallback: parse text output (backward compat)
      online = out.includes('reachable') && !out.includes('unreachable') && !out.includes('error');
      const lastMatch = out.match(/active\s+(just now|\d+[smhd]\s+ago|\d+\s+\w+\s+ago)/i);
      lastActive = lastMatch ? lastMatch[1].trim() : 'unknown';
      const modelMatch = out.match(/claude-[a-z0-9.-]+/);
      model = modelMatch ? modelMatch[0] : 'unknown';
    }

    // Uptime from systemd
    const svcName = profile ? `openclaw-${profile}` : 'openclaw-gateway';
    const tsRaw = await run(`systemctl --user show ${svcName} --property=ActiveEnterTimestamp`);
    const ts = tsRaw.replace('ActiveEnterTimestamp=', '').trim();
    let uptime = 'N/A';
    if (ts) {
      const since = new Date(ts);
      if (!isNaN(since)) uptime = formatDuration(Math.floor((Date.now() - since) / 1000));
    }

    const result = {
      online, lastActive, model, uptime,
      sessions, totalTokens, contextTokens, contextPercent,
      inputTokens, outputTokens, cacheRead, cacheWrite,
      heartbeatEnabled, heartbeatInterval, heartbeatEveryMs,
      lastActiveAgeMs, sessionStarted, activeSessions24h
    };
    botCache[key] = { time: Date.now(), data: result, refreshing: false };
    persistBotCache();
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
    else botCache[key] = { time: 0, data: { online: false, lastActive: '...', model: '...', uptime: '...', sessions: 0, totalTokens: 0, contextTokens: 200000, contextPercent: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, heartbeatEnabled: false, heartbeatInterval: null, heartbeatEveryMs: null, lastActiveAgeMs: null, sessionStarted: null, activeSessions24h: 0 }, refreshing: true };
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
    // Resolve lat/lon from location name via Open-Meteo geocoding
    let lat = CONFIG.weatherLat, lon = CONFIG.weatherLon;
    if (!lat || !lon) {
      // Fallback geocode if lat/lon not cached in config (e.g. old config)
      const loc = CONFIG.weatherLocation || 'London';
      const geoData = await httpGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1`);
      const geoJson = JSON.parse(geoData);
      if (!geoJson.results || !geoJson.results.length) throw new Error('Location not found: ' + loc);
      lat = geoJson.results[0].latitude; lon = geoJson.results[0].longitude;
    }
    const data = await httpGet(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
    const json = JSON.parse(data);
    const temp = Math.round(json.current.temperature_2m);
    const wmoCode = json.current.weather_code;
    const desc = wmoDescription(wmoCode);
    const icon = wmoIcon(wmoCode);
    weatherCache = { temp, description: desc, icon };
  } catch (err) {
    console.error('fetchWeather failed:', err.message);
    // Keep stale cache if available, else null
  }
  weatherCacheTime = now;
  return weatherCache || { temp: null, description: 'N/A', icon: '🌡️' };
}

function wmoIcon(code) {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if ([2, 3].includes(code)) return '⛅';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
}

function wmoDescription(code) {
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Light snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail'
  };
  return map[code] || 'Unknown';
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
// T63-T68: License System (Phase 6)
// ============================================================

const LICENSE_KEYS_DIR = path.join(__dirname, 'data', 'license-keys');
const LICENSE_PRIVATE_KEY = path.join(LICENSE_KEYS_DIR, 'private.pem');
const LICENSE_PUBLIC_KEY = path.join(LICENSE_KEYS_DIR, 'public.pem');

// T63 — Generate Ed25519 key pair on first start if not exists
async function ensureLicenseKeys() {
  try {
    await fs.promises.access(LICENSE_PRIVATE_KEY);
    await fs.promises.access(LICENSE_PUBLIC_KEY);
  } catch {
    await fs.promises.mkdir(LICENSE_KEYS_DIR, { recursive: true });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    await fs.promises.writeFile(LICENSE_PRIVATE_KEY, privateKey);
    await fs.promises.writeFile(LICENSE_PUBLIC_KEY, publicKey);
    console.log('🔑 License keys generated');
  }
}

// Base64url helpers
function toBase64Url(buf) {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// T64 — Create a signed license key string
async function createLicense({ email, tier, expiresAt }) {
  const privateKeyPem = await fs.promises.readFile(LICENSE_PRIVATE_KEY, 'utf8');
  const payload = JSON.stringify({ email, tier, expiresAt });
  const payloadB64 = toBase64Url(payload);
  const signature = crypto.sign(null, Buffer.from(payload), privateKeyPem);
  const sigB64 = toBase64Url(signature);
  return payloadB64 + '.' + sigB64;
}

// T66 — Verify a license key string
async function verifyLicense(keyString) {
  try {
    const parts = keyString.split('.');
    if (parts.length !== 2) return { valid: false, error: 'Invalid format' };
    const [payloadB64, sigB64] = parts;
    const payloadBuf = fromBase64Url(payloadB64);
    const sigBuf = fromBase64Url(sigB64);
    const publicKeyPem = await fs.promises.readFile(LICENSE_PUBLIC_KEY, 'utf8');
    const valid = crypto.verify(null, payloadBuf, publicKeyPem, sigBuf);
    if (!valid) return { valid: false, error: 'Invalid signature' };
    const payload = JSON.parse(payloadBuf.toString());
    if (new Date(payload.expiresAt).getTime() < Date.now()) {
      return { valid: false, error: 'License expired' };
    }
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// T69 — Pro middleware: returns 402 if no valid pro license
async function requirePro(req, res, next) {
  try {
    const license = CONFIG.license;
    if (!license) {
      return res.status(402).json({ error: 'pro_required', message: 'This feature requires a Pro license' });
    }
    const result = await verifyLicense(license);
    if (!result.valid || result.payload.tier !== 'pro') {
      return res.status(402).json({ error: 'pro_required', message: 'This feature requires a Pro license' });
    }
    next();
  } catch {
    res.status(402).json({ error: 'pro_required', message: 'This feature requires a Pro license' });
  }
}

// ============================================================
// T49-T51: History Collector (Phase 5)
// ============================================================

const HISTORY_FILE = path.join(__dirname, 'data', 'history.jsonl');
const HISTORY_INTERVAL = 5 * 60 * 1000; // 5 minutes
const HISTORY_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// T49 — Collect a snapshot and append to history.jsonl
async function collectHistorySample() {
  try {
    const [cpu, ram, disk, netStats] = await Promise.all([
      getCpuUsage(), getRam(), getDisk(), readNetStats()
    ]);
    // T50 — Data schema
    const sample = {
      ts: Date.now(),
      cpu: cpu ?? 0,
      ram: ram?.percent ?? 0,
      disk: disk?.percent ?? 0,
      netUp: netStats?.tx ?? 0,
      netDown: netStats?.rx ?? 0
    };
    const dir = path.dirname(HISTORY_FILE);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(HISTORY_FILE, JSON.stringify(sample) + '\n');
    // T51 — Prune entries older than 30 days
    await pruneHistory();
  } catch (err) {
    console.error('History collector error:', err.message);
  }
}

// T51 — Remove entries older than 30 days
async function pruneHistory() {
  try {
    const raw = await fs.promises.readFile(HISTORY_FILE, 'utf8');
    const cutoff = Date.now() - HISTORY_MAX_AGE;
    const lines = raw.split('\n').filter(Boolean);
    const kept = lines.filter(line => {
      try { return JSON.parse(line).ts >= cutoff; } catch { return false; }
    });
    if (kept.length < lines.length) {
      await fs.promises.writeFile(HISTORY_FILE, kept.join('\n') + '\n');
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('History prune error:', err.message);
  }
}

function startHistoryCollector() {
  // Collect first sample after a short delay (let metrics settle)
  setTimeout(() => {
    collectHistorySample();
    collectCostSample();
    setInterval(collectHistorySample, HISTORY_INTERVAL);
    setInterval(collectCostSample, HISTORY_INTERVAL);
  }, 10000);
  console.log('📊 History collector started (every 5 min)');
}

// ============================================================
// T85-T89: Cost Tracker (Phase 9)
// ============================================================

// T85 — Model pricing table (per 1M tokens, USD)
// Source: https://docs.anthropic.com/en/docs/about-claude/models
const DEFAULT_MODEL_PRICING = {
  // Opus
  'claude-opus-4-6':   { input: 5,  output: 25,  cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-5':   { input: 5,  output: 25,  cacheRead: 0.5,  cacheWrite: 6.25 },
  // Sonnet
  'claude-sonnet-4-6': { input: 3,  output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3,  output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
  // Haiku
  'claude-haiku-4-5':  { input: 1,  output: 5,   cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-haiku-3-5':  { input: 0.8, output: 4,  cacheRead: 0.08, cacheWrite: 1 },
  // GPT (approximate — users can override in config.json)
  'gpt-4o':            { input: 2.5, output: 10,  cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-4o-mini':       { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  'gpt-4.1':           { input: 2,  output: 8,   cacheRead: 0.5,  cacheWrite: 2 },
  'gpt-4.1-mini':      { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
  'gpt-4.1-nano':      { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
  // Gemini
  'gemini-2.5-pro':    { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
  'gemini-2.5-flash':  { input: 0.15, output: 0.6, cacheRead: 0.04, cacheWrite: 0.15 },
};

function getModelPricing() {
  const overrides = CONFIG.modelPricing || {};
  return { ...DEFAULT_MODEL_PRICING, ...overrides };
}

function computeCost(model, inputTokens, outputTokens, cacheRead, cacheWrite) {
  const pricing = getModelPricing();
  // Try exact match, then strip "anthropic/" prefix, then fuzzy
  let rates = pricing[model];
  if (!rates && model) {
    const stripped = model.replace('anthropic/', '');
    rates = pricing[stripped];
  }
  if (!rates) {
    // Default to sonnet pricing if unknown
    rates = pricing['claude-sonnet-4-6'] || { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  }
  return (
    (inputTokens / 1e6) * rates.input +
    (outputTokens / 1e6) * rates.output +
    ((cacheRead || 0) / 1e6) * rates.cacheRead +
    ((cacheWrite || 0) / 1e6) * rates.cacheWrite
  );
}

const COST_HISTORY_FILE = path.join(__dirname, 'data', 'cost-history.jsonl');

// T87 — Background cost collector: sum tokens from bot cache, compute cost, write to cost-history.jsonl
async function collectCostSample() {
  try {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const byModel = {};

    // Gather token data from all bot caches
    for (const bot of (CONFIG.bots || [])) {
      const key = bot.profile || 'main';
      const cached = botCache[key];
      if (!cached || !cached.data) continue;

      const d = cached.data;
      const model = (d.model || 'unknown').replace('anthropic/', '');
      if (!byModel[model]) {
        byModel[model] = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
      }
      // totalTokens from openclaw status is combined; estimate input/output split
      // If we have separate fields use them, otherwise approximate (80% input, 20% output)
      const total = d.totalTokens || 0;
      if (d.inputTokens != null) {
        byModel[model].inputTokens += d.inputTokens || 0;
        byModel[model].outputTokens += d.outputTokens || 0;
      } else {
        byModel[model].inputTokens += Math.round(total * 0.8);
        byModel[model].outputTokens += Math.round(total * 0.2);
      }
      byModel[model].cacheRead += d.cacheRead || 0;
      byModel[model].cacheWrite += d.cacheWrite || 0;
    }

    // Read existing entries for today to deduplicate
    const dir = path.dirname(COST_HISTORY_FILE);
    await fs.promises.mkdir(dir, { recursive: true });

    let existingLines = [];
    try {
      const raw = await fs.promises.readFile(COST_HISTORY_FILE, 'utf8');
      existingLines = raw.split('\n').filter(Boolean);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Remove old entries for today (will be replaced)
    const keptLines = existingLines.filter(line => {
      try {
        const entry = JSON.parse(line);
        if (entry.date === today) return false; // remove today's old entries
        // Also prune entries older than 30 days
        if (entry.ts && entry.ts < now - 30 * 24 * 60 * 60 * 1000) return false;
        return true;
      } catch { return false; }
    });

    // Write new entries for today
    for (const [model, tokens] of Object.entries(byModel)) {
      const costUsd = computeCost(model, tokens.inputTokens, tokens.outputTokens, tokens.cacheRead, tokens.cacheWrite);
      keptLines.push(JSON.stringify({
        ts: now,
        date: today,
        model,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheRead: tokens.cacheRead,
        cacheWrite: tokens.cacheWrite,
        costUsd: Math.round(costUsd * 1e6) / 1e6
      }));
    }

    await fs.promises.writeFile(COST_HISTORY_FILE, keptLines.join('\n') + '\n');

    // T89 — Budget alert check
    await checkBudgetAlert(keptLines);
  } catch (err) {
    console.error('Cost collector error:', err.message);
  }
}

// T89 — Check if monthly cost exceeds budget, send Telegram alert
let _budgetAlertSent = false; // prevent repeated alerts within same month

async function checkBudgetAlert(lines) {
  const budget = CONFIG.budget || {};
  const monthlyBudget = budget.monthly;
  if (!monthlyBudget || monthlyBudget <= 0) return;

  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  let monthCost = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.date && entry.date.startsWith(thisMonth)) {
        monthCost += entry.costUsd || 0;
      }
    } catch {}
  }

  const currentMonth = new Date().getMonth();
  if (_budgetAlertSent === currentMonth) return; // already alerted this month

  if (monthCost >= monthlyBudget) {
    _budgetAlertSent = currentMonth;
    const serverLabel = CONFIG.label || 'Server';
    const timeStr = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    sendTelegramMessage(
      `💰 <b>Pulse Budget Alert</b> — ${serverLabel}\nMonthly cost $${monthCost.toFixed(2)} exceeds budget $${monthlyBudget.toFixed(2)}\n${timeStr}`
    ).catch(() => {});
  }
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

    // Validate & geocode weather location
    try {
      const geoData = await httpGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cfg.weatherLocation)}&count=1`);
      const geoJson = JSON.parse(geoData);
      if (!geoJson.results || !geoJson.results.length) {
        return res.status(400).json({ error: `City not found: "${cfg.weatherLocation}". Check spelling.` });
      }
      cfg.weatherLat = geoJson.results[0].latitude;
      cfg.weatherLon = geoJson.results[0].longitude;
      cfg.weatherLocation = geoJson.results[0].name; // normalize to canonical name
    } catch (geoErr) {
      return res.status(500).json({ error: 'Failed to validate city: ' + geoErr.message });
    }

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
    const result = {
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
    };

    // Update snapshot for alert worker (T04)
    lastMetricSnapshot = {
      cpu: cpuUsage,
      ram: ram?.percent,
      disk: disk?.percent,
      services: systemd,
      docker,
      bots: botResults
    };

    res.json(result);
  } catch (err) {
    console.error('API /metrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- T79: Bot analytics stats ---
app.get('/api/bots/stats', (req, res) => {
  const stats = {};
  for (const bot of (CONFIG.bots || [])) {
    const key = bot.profile || 'main';
    const cached = botCache[key];
    if (cached && cached.data) {
      const d = cached.data;
      stats[key] = {
        sessions: d.sessions || 0,
        totalTokens: d.totalTokens || 0,
        contextTokens: d.contextTokens || 200000,
        contextPercent: d.contextPercent || 0,
        heartbeatEnabled: d.heartbeatEnabled || false,
        heartbeatInterval: d.heartbeatInterval || null,
        heartbeatEveryMs: d.heartbeatEveryMs || null,
        lastActiveAgeMs: d.lastActiveAgeMs ?? null,
        sessionStarted: d.sessionStarted || null,
        activeSessions24h: d.activeSessions24h || 0
      };
    }
  }
  res.json(stats);
});

// --- T88: GET /api/costs ---
app.get('/api/costs', requirePro, async (req, res) => {
  try {
    let lines = [];
    try {
      const raw = await fs.promises.readFile(COST_HISTORY_FILE, 'utf8');
      lines = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthStr = new Date().toISOString().slice(0, 7);

    let todayTokens = 0, todayCost = 0;
    let weekTokens = 0, weekCost = 0;
    let monthTokens = 0, monthCost = 0;
    const dailyMap = {};
    const modelMap = {};

    for (const entry of lines) {
      const entryTokens = (entry.inputTokens || 0) + (entry.outputTokens || 0) + (entry.cacheRead || 0) + (entry.cacheWrite || 0);
      const cost = entry.costUsd || 0;

      // Today
      if (entry.date === todayStr) {
        todayTokens += entryTokens;
        todayCost += cost;
      }

      // This week
      if (entry.ts && entry.ts >= weekAgo) {
        weekTokens += entryTokens;
        weekCost += cost;
      }

      // This month
      if (entry.date && entry.date.startsWith(monthStr)) {
        monthTokens += entryTokens;
        monthCost += cost;
      }

      // Daily aggregation (last 30 days)
      if (entry.date) {
        if (!dailyMap[entry.date]) dailyMap[entry.date] = { tokens: 0, cost: 0 };
        dailyMap[entry.date].tokens += entryTokens;
        dailyMap[entry.date].cost += cost;
      }

      // Model breakdown (this month)
      if (entry.date && entry.date.startsWith(monthStr) && entry.model) {
        if (!modelMap[entry.model]) modelMap[entry.model] = { tokens: 0, cost: 0 };
        modelMap[entry.model].tokens += entryTokens;
        modelMap[entry.model].cost += cost;
      }
    }

    const daily = Object.entries(dailyMap)
      .map(([date, d]) => ({ date, tokens: d.tokens, cost: Math.round(d.cost * 1e6) / 1e6 }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    const byModel = Object.entries(modelMap)
      .map(([model, d]) => ({
        model,
        tokens: d.tokens,
        cost: Math.round(d.cost * 1e6) / 1e6,
        percent: monthCost > 0 ? Math.round(d.cost / monthCost * 100) : 0
      }))
      .sort((a, b) => b.cost - a.cost);

    const budget = CONFIG.budget || {};
    const budgetExceeded = budget.monthly > 0 && monthCost >= budget.monthly;

    res.json({
      today: { tokens: todayTokens, cost: Math.round(todayCost * 1e6) / 1e6 },
      week: { tokens: weekTokens, cost: Math.round(weekCost * 1e6) / 1e6 },
      month: { tokens: monthTokens, cost: Math.round(monthCost * 1e6) / 1e6 },
      daily,
      byModel,
      budget: { monthly: budget.monthly || 0, warning: budget.warning || 80 },
      budgetExceeded
    });
  } catch (err) {
    console.error('GET /api/costs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- T08: Alert status ---
app.get('/api/alerts/status', async (req, res) => {
  const creds = await getTelegramCredentials();
  const active = alertHistory.filter(e => e.active);
  res.json({
    active,
    history: alertHistory.slice(0, 20),
    telegram: {
      configured: !!creds,
      source: creds?.source || 'none'
    }
  });
});

// --- T09: Test alert ---
app.post('/api/alerts/test', async (req, res) => {
  const creds = await getTelegramCredentials();
  if (!creds) return res.json({ ok: false, error: 'No Telegram credentials found. Configure in settings or set up OpenClaw Telegram.' });
  const ok = await sendTelegramMessage(`🔔 <b>Pulse Test Alert</b>\nAlerts are working! Your dashboard is configured correctly.\n${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  res.json({ ok, source: creds.source });
});

// T21 — POST /api/action/restart-service
app.post('/api/action/restart-service', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9._@:-]+$/.test(name)) {
      return res.status(400).json({ ok: false, error: 'Invalid service name' });
    }
    if (!CONFIG.systemdServices.includes(name)) {
      return res.status(400).json({ ok: false, error: 'Unknown service' });
    }
    await run(`systemctl --user restart ${name}`, 10000);
    await sleep(1500);
    const status = await run(`systemctl --user is-active ${name}`);
    res.json({ ok: true, name, status: status || 'unknown' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T22 — POST /api/action/restart-docker
app.post('/api/action/restart-docker', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      return res.status(400).json({ ok: false, error: 'Invalid container name' });
    }
    let knownContainers;
    if (CONFIG.dockerContainers === 'auto') {
      const out = await run('docker ps -a --format "{{.Names}}"');
      knownContainers = out.split('\n').filter(Boolean);
    } else {
      knownContainers = CONFIG.dockerContainers;
    }
    if (!knownContainers.includes(name)) {
      return res.status(400).json({ ok: false, error: 'Unknown container' });
    }
    await run(`docker restart ${name}`, 15000);
    await sleep(1500);
    const status = await run(`docker inspect --format '{{.State.Status}}' ${name}`);
    res.json({ ok: true, name, status: status || 'unknown' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T29 — GET /api/openclaw/models
app.get('/api/openclaw/models', async (req, res) => {
  try {
    const ocPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const raw = await fs.promises.readFile(ocPath, 'utf8');
    const oc = JSON.parse(raw);
    const primary = oc?.agents?.defaults?.model?.primary || null;
    const modelsObj = oc?.agents?.defaults?.models || {};
    const models = Object.entries(modelsObj).map(([id, meta]) => ({
      id,
      alias: meta.alias || null,
      active: id === primary
    }));
    res.json({ primary, models });
  } catch {
    res.json({ primary: null, models: [] });
  }
});

// T30 — POST /api/openclaw/gateway
app.post('/api/openclaw/gateway', async (req, res) => {
  try {
    const { action } = req.body;
    if (!['restart', 'stop', 'start'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'Invalid action. Must be restart, stop, or start.' });
    }
    await run(`openclaw gateway ${action}`, 15000);
    res.json({ ok: true, action });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T31 — POST /api/openclaw/model
app.post('/api/openclaw/model', async (req, res) => {
  try {
    const { model } = req.body;
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ ok: false, error: 'Model is required' });
    }
    const ocPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const raw = await fs.promises.readFile(ocPath, 'utf8');
    const oc = JSON.parse(raw);
    if (!oc.agents) oc.agents = {};
    if (!oc.agents.defaults) oc.agents.defaults = {};
    if (!oc.agents.defaults.model) oc.agents.defaults.model = {};
    oc.agents.defaults.model.primary = model;
    await fs.promises.writeFile(ocPath, JSON.stringify(oc, null, 2));
    await run('openclaw gateway restart', 15000);
    // Invalidate bot cache so next fetch gets fresh status
    Object.keys(botCache).forEach(k => { botCache[k].time = 0; });
    res.json({ ok: true, model });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T32 — POST /api/openclaw/clear-sessions
app.post('/api/openclaw/clear-sessions', async (req, res) => {
  try {
    const { profile } = req.body;
    const cmd = openclawCmd(profile, 'sessions clear');
    await run(cmd, 15000);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T52 — GET /api/history — historical metric data
app.get('/api/history', async (req, res) => {
  try {
    const metric = req.query.metric;
    const hours = parseInt(req.query.hours) || 168; // default 7 days
    const validMetrics = ['cpu', 'ram', 'disk', 'netUp', 'netDown'];
    if (!metric || !validMetrics.includes(metric)) {
      return res.status(400).json({ error: 'Invalid metric. Use: ' + validMetrics.join(', ') });
    }
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    let raw;
    try {
      raw = await fs.promises.readFile(HISTORY_FILE, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return res.json([]);
      throw err;
    }
    // Bucket size: 5min for 24h, 1h for 7d, 4h for 30d
    const bucketMs = hours <= 24 ? 5 * 60 * 1000
                   : hours <= 168 ? 60 * 60 * 1000
                   : 4 * 60 * 60 * 1000;

    const buckets = new Map();
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.ts >= cutoff) {
          const bucket = Math.floor(entry.ts / bucketMs) * bucketMs;
          if (!buckets.has(bucket)) buckets.set(bucket, { sum: 0, count: 0 });
          const b = buckets.get(bucket);
          b.sum += entry[metric] ?? 0;
          b.count++;
        }
      } catch {}
    }

    const result = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, b]) => ({ ts: ts + bucketMs / 2, value: Math.round(b.sum / b.count * 10) / 10 }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// T48 — Strip ANSI escape codes from log lines
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// T38 — GET /api/logs/service/:name — SSE endpoint for systemd service logs
app.get('/api/logs/service/:name', (req, res) => {
  const { name } = req.params;
  // Validate name against CONFIG (security)
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9._@:-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid service name' });
  }
  if (!CONFIG.systemdServices.includes(name)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const child = spawn('journalctl', ['--user', '-u', name, '-f', '--no-pager', '-n', '50'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  function onData(chunk) {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = stripAnsi(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      res.write('event: log\ndata: ' + line + '\n\n');
    }
  }

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  // T40 — Cleanup on client disconnect
  res.on('close', () => {
    child.kill('SIGTERM');
  });

  child.on('error', () => {
    res.write('event: error\ndata: Failed to spawn journalctl\n\n');
    res.end();
  });

  child.on('exit', () => {
    res.end();
  });
});

// T39 — GET /api/logs/docker/:name — SSE endpoint for Docker container logs
app.get('/api/logs/docker/:name', async (req, res) => {
  const { name } = req.params;
  // Validate name (security)
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid container name' });
  }
  let knownContainers;
  if (CONFIG.dockerContainers === 'auto') {
    const out = await run('docker ps -a --format "{{.Names}}"');
    knownContainers = out.split('\n').filter(Boolean);
  } else {
    knownContainers = CONFIG.dockerContainers;
  }
  if (!knownContainers.includes(name)) {
    return res.status(400).json({ error: 'Unknown container' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const child = spawn('docker', ['logs', '-f', '--tail', '50', name], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  function onData(chunk) {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = stripAnsi(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      res.write('event: log\ndata: ' + line + '\n\n');
    }
  }

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  // T40 — Cleanup on client disconnect
  res.on('close', () => {
    child.kill('SIGTERM');
  });

  child.on('error', () => {
    res.write('event: error\ndata: Failed to spawn docker logs\n\n');
    res.end();
  });

  child.on('exit', () => {
    res.end();
  });
});

// ============================================================
// T65-T68: License Routes (Phase 6)
// ============================================================

// T65 — Admin license page
app.get('/admin/license', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-license.html')));

// T65 — Generate a license key (admin-only endpoint)
app.post('/api/license/generate', async (req, res) => {
  try {
    const { email, tier, expiresAt } = req.body;
    if (!email || !tier || !expiresAt) {
      return res.status(400).json({ error: 'email, tier, and expiresAt are required' });
    }
    if (tier !== 'pro') {
      return res.status(400).json({ error: 'Only "pro" tier is supported' });
    }
    const expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime())) {
      return res.status(400).json({ error: 'Invalid expiry date' });
    }
    const key = await createLicense({ email, tier, expiresAt: expDate.toISOString() });
    res.json({ ok: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// T67 — Activate a license key
app.post('/api/license/activate', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ ok: false, error: 'License key is required' });
    }
    const result = await verifyLicense(key.trim());
    if (!result.valid) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    // Store in config.json (read fresh, add license field, write back)
    CONFIG.license = key.trim();
    const configPath = path.join(__dirname, 'config.json');
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const diskConfig = JSON.parse(raw);
    diskConfig.license = key.trim();
    await fs.promises.writeFile(configPath, JSON.stringify(diskConfig, null, 2));
    res.json({ ok: true, tier: result.payload.tier, email: result.payload.email, expiresAt: result.payload.expiresAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T68 — License status
app.get('/api/license/status', async (req, res) => {
  try {
    const license = CONFIG.license;
    if (!license) {
      return res.json({ tier: 'free', email: null, expiresAt: null, valid: false });
    }
    const result = await verifyLicense(license);
    if (!result.valid) {
      return res.json({ tier: 'free', email: null, expiresAt: null, valid: false });
    }
    res.json({ tier: result.payload.tier, email: result.payload.email, expiresAt: result.payload.expiresAt, valid: true });
  } catch {
    res.json({ tier: 'free', email: null, expiresAt: null, valid: false });
  }
});

// --- Update ---
app.get('/api/update/check', async (req, res) => {
  try {
    // Get current local commit
    const localHash = (await run('git -C ' + __dirname + ' rev-parse --short HEAD', 5000)).trim();
    // Fetch latest from remote
    await run('git -C ' + __dirname + ' fetch origin main --quiet', 15000);
    const remoteHash = (await run('git -C ' + __dirname + ' rev-parse --short origin/main', 5000)).trim();
    const behind = parseInt((await run('git -C ' + __dirname + ' rev-list --count HEAD..origin/main', 5000)).trim()) || 0;
    res.json({ current: localHash, latest: remoteHash, behind, updateAvailable: behind > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update/apply', async (req, res) => {
  try {
    // Stash any local changes
    await run('git -C ' + __dirname + ' stash --quiet', 5000).catch(() => {});
    // Pull latest
    const pullOutput = await run('git -C ' + __dirname + ' pull origin main', 30000);
    res.json({ ok: true, output: pullOutput.trim() });
    // Restart after short delay so response gets sent
    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// T93-T97: Cron Monitor (Phase 10)
// ============================================================

const cronCaches = {};
const CRON_CACHE_TTL = 30 * 1000;
function getCronCache(profile) {
  const key = profile || 'main';
  if (!cronCaches[key]) cronCaches[key] = { data: null, time: 0 };
  return cronCaches[key];
}
function profileFlag(p) { return p && p !== 'main' ? '--profile ' + p + ' ' : ''; }

function openclawCmd(profile, cmd) {
  const bot = (CONFIG.bots || []).find(b => (b.profile || null) === (profile || null));
  if (bot && bot.stateDir) {
    return `OPENCLAW_STATE_DIR=${bot.stateDir} openclaw ${cmd}`;
  }
  return profileFlag(profile) + `openclaw ${cmd}`;
}

// T101 — GET /api/cron/profiles
app.get('/api/cron/profiles', requirePro, (req, res) => {
  const bots = CONFIG.bots || [];
  if (bots.length <= 1) return res.json([]);
  res.json(bots.map(b => ({ name: b.name, profile: b.profile || 'main' })));
});

// Helper: read cron jobs — prefer direct file read when stateDir is configured
async function getCronJobs(profile) {
  const bot = (CONFIG.bots || []).find(b => (b.profile || null) === (profile || null));
  if (bot && bot.stateDir) {
    try {
      const data = JSON.parse(await fs.promises.readFile(path.join(bot.stateDir, 'cron', 'jobs.json'), 'utf8'));
      return data.jobs || [];
    } catch { return []; }
  }
  // Fallback to CLI for bots without stateDir
  const out = await run(openclawCmd(profile, 'cron list --json'), 10000);
  if (!out) return [];
  try { const d = JSON.parse(out); return Array.isArray(d) ? d : d.jobs || d.crons || []; } catch { return []; }
}

// T93 — GET /api/cron
app.get('/api/cron', requirePro, async (req, res) => {
  try {
    const profile = req.query.profile || 'main';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      return res.status(400).json({ error: 'Invalid profile' });
    }
    const cache = getCronCache(profile);
    const now = Date.now();
    if (cache.data && now - cache.time < CRON_CACHE_TTL) {
      return res.json(cache.data);
    }
    const jobs = await getCronJobs(profile);
    cache.data = jobs; cache.time = now;
    res.json(jobs);
  } catch (err) {
    if (err.message && (err.message.includes('not found') || err.message.includes('ENOENT'))) {
      return res.status(501).json({ error: 'not_supported' });
    }
    res.status(501).json({ error: 'not_supported' });
  }
});

// T94 — POST /api/cron/:id/toggle
app.post('/api/cron/:id/toggle', requirePro, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9._:-]+$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid cron job ID' });
    }
    const profile = req.body.profile || 'main';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      return res.status(400).json({ ok: false, error: 'Invalid profile' });
    }
    const { enabled } = req.body;
    const action = enabled ? 'enable' : 'disable';
    await run(openclawCmd(profile, `cron ${action} ${id}`), 10000);
    getCronCache(profile).time = 0;
    res.json({ ok: true, id, enabled: !!enabled });
  } catch (err) {
    if (err.message && (err.message.includes('not found') || err.message.includes('ENOENT'))) {
      return res.status(501).json({ error: 'not_supported' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T95 — POST /api/cron/:id/run
app.post('/api/cron/:id/run', requirePro, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9._:-]+$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid cron job ID' });
    }
    const profile = req.body.profile || 'main';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      return res.status(400).json({ ok: false, error: 'Invalid profile' });
    }
    await run(openclawCmd(profile, `cron run ${id}`), 15000);
    getCronCache(profile).time = 0;
    res.json({ ok: true, id });
  } catch (err) {
    if (err.message && (err.message.includes('not found') || err.message.includes('ENOENT'))) {
      return res.status(501).json({ error: 'not_supported' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T96 — POST /api/cron/create
app.post('/api/cron/create', requirePro, async (req, res) => {
  try {
    const { name, schedule, payload } = req.body;
    const profile = req.body.profile || 'main';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      return res.status(400).json({ ok: false, error: 'Invalid profile' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Name is required' });
    }
    if (!schedule || typeof schedule !== 'string') {
      return res.status(400).json({ ok: false, error: 'Schedule is required' });
    }
    // Basic cron expression validation (5 or 6 fields, or shorthand like @daily)
    const trimmed = schedule.trim();
    const isShorthand = /^@(yearly|annually|monthly|weekly|daily|hourly|reboot)$/.test(trimmed);
    const isCronExpr = /^(\S+\s+){4}\S+$/.test(trimmed) || /^(\S+\s+){5}\S+$/.test(trimmed);
    if (!isShorthand && !isCronExpr) {
      return res.status(400).json({ ok: false, error: 'Invalid cron schedule expression' });
    }
    if (!payload || typeof payload !== 'string') {
      return res.status(400).json({ ok: false, error: 'Payload/task is required' });
    }
    // Sanitize name for shell safety
    const safeName = name.replace(/[^a-zA-Z0-9 _.-]/g, '').trim();
    if (!safeName) {
      return res.status(400).json({ ok: false, error: 'Invalid name' });
    }
    await run(openclawCmd(profile, `cron add --name "${safeName}" --schedule "${trimmed}" --payload "${payload.replace(/"/g, '\\"')}"`), 10000);
    getCronCache(profile).time = 0;
    res.json({ ok: true, name: safeName });
  } catch (err) {
    if (err.message && (err.message.includes('not found') || err.message.includes('ENOENT'))) {
      return res.status(501).json({ error: 'not_supported' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// T97 — DELETE /api/cron/:id
app.delete('/api/cron/:id', requirePro, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9._:-]+$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid cron job ID' });
    }
    const profile = req.query.profile || 'main';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      return res.status(400).json({ ok: false, error: 'Invalid profile' });
    }
    const cache = getCronCache(profile);
    // Verify job exists by checking cached list or fetching fresh
    let jobs = cache.data;
    if (!jobs || Date.now() - cache.time >= CRON_CACHE_TTL) {
      jobs = await getCronJobs(profile);
      if (!jobs || !jobs.length) return res.status(501).json({ error: 'not_supported' });
    }
    const exists = Array.isArray(jobs) && jobs.some(j => (j.id || j.name) === id);
    if (!exists) {
      return res.status(404).json({ ok: false, error: 'Cron job not found' });
    }
    await run(openclawCmd(profile, `cron remove ${id}`), 10000);
    cache.time = 0;
    res.json({ ok: true, id });
  } catch (err) {
    if (err.message && (err.message.includes('not found') || err.message.includes('ENOENT'))) {
      return res.status(501).json({ error: 'not_supported' });
    }
    res.status(404).json({ ok: false, error: 'Cron job not found' });
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
  await ensureLicenseKeys();

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
      startAlertWorker();
      startHistoryCollector();
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
