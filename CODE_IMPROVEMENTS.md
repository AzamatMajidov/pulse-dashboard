# Code Improvement Recommendations

Prioritized list of improvements for the Pulse Dashboard codebase.

---

## High Priority

### 1. XSS via `innerHTML` in Frontend

**Files:** `public/index.html:746-757`, `public/index.html:763-774`

`renderDocker()` and `renderSystemd()` inject server data directly into the DOM
using template literals inside `innerHTML`. Container names from `docker ps` are
inserted without sanitization.

**Fix:** Use `textContent` for data values, or build DOM elements
programmatically instead of string-interpolating into `innerHTML`.

---

## Medium Priority

### 2. Wildcard CORS Header

**File:** `server.js:14`

`Access-Control-Allow-Origin: *` allows any website to read system metrics
(CPU, RAM, disk, running services) from the API. Unnecessary for a same-origin
dashboard.

**Fix:** Remove the CORS header entirely (same-origin requests don't need it),
or restrict to specific trusted origins.

### 3. Anti-pattern: `async` Inside `new Promise()`

**File:** `server.js:239`

`fetchWeather()` wraps an `async` function inside a Promise constructor. If the
async body throws before the first `await`, the rejection is silently swallowed,
causing a hang with no error.

**Fix:** Convert to a plain `async function` with `try/catch`:

```js
async function fetchWeather() {
  const now = Date.now();
  if (weatherCache && now - weatherCacheTime < 10 * 60 * 1000) {
    return weatherCache;
  }
  try {
    const data = await httpGet('https://wttr.in/Tashkent?format=j1');
    const json = JSON.parse(data);
    // ... parse and cache
    return weatherCache;
  } catch {
    return { temp: null, description: 'N/A', icon: '...' };
  }
}
```

### 4. Silent `catch {}` Blocks

**File:** `server.js:65, 101, 150, 174, 215, 255`

Six bare `catch {}` blocks swallow all errors with no logging. When something
breaks, there is no diagnostic output.

**Fix:** Add `console.error` in each catch block:

```js
} catch (err) {
  console.error('getCpuTemp failed:', err.message);
  return null;
}
```

### 5. Synchronous File I/O Blocking the Event Loop

**File:** `server.js:36, 71, 109`

`readCpuStats()`, `getRam()`, and `readNetStats()` use `fs.readFileSync()`,
blocking the Node.js event loop. Combined with the 500ms `sleep()` in
`getCpuUsage()` (line 45), each `/api/metrics` request blocks the server for
at least 500ms.

**Fix:** Replace `readFileSync` with `fs.promises.readFile`. Consider sampling
CPU on a background interval instead of blocking inside each request.

---

## Low Priority

### 6. Hardcoded Configuration Values

**Files:** `server.js:9-10, 138, 183, 241, 245, 293-294` and `public/index.html:554, 599, 796`

Port, network interface, weather location, Docker container names, bot profiles,
and cache TTLs are all hardcoded. Some values are duplicated across server and
client.

**Fix:** Centralize into environment variables or a config object. Have the API
return configurable values so the frontend doesn't duplicate them.

### 7. No Graceful Shutdown Handler

**File:** `server.js:323-329`

No `SIGTERM`/`SIGINT` handler exists. Systemd restarts drop in-flight requests
without cleanup.

**Fix:**

```js
const server = app.listen(PORT, '0.0.0.0', () => { ... });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

### 8. No Tests

The parsing logic in `getCpuTemp`, `getRam`, `getDisk`, and `getBotStatus` uses
regex and string splits on shell output — exactly the code that breaks silently
when output formats change. Zero tests exist.

**Fix:** Add unit tests for parsing functions using Node's built-in `node:test`
runner. No external framework needed.

### 9. No Linting or Formatting Config

No ESLint or Prettier configuration exists.

**Fix:** Add a minimal `.eslintrc.json` for consistency.

### 10. Monolithic Frontend File

**File:** `public/index.html` (862 lines)

All CSS, HTML, and JavaScript are inline in a single file. Manageable at current
size but increasingly difficult to navigate as features are added.

**Fix:** When the file grows further, split into `style.css` and `app.js` served
as static files. No build step needed.
