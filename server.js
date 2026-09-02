// server.js — Home Front, a single-user personal assistant app.
// Built entirely on Node.js built-ins (http + node:sqlite) — no npm install required.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./src/db');
const auth = require('./src/auth');
const rota = require('./src/rota');
const priority = require('./src/priority');
const money = require('./src/money');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- tiny helpers ----------

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) { req.destroy(); reject(new Error('Payload too large')); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function getSessionToken(req) {
  return parseCookies(req).session;
}

function isAuthed(req) {
  return auth.isValidSession(getSessionToken(req));
}

// ---------- API handlers ----------

const api = {};

api['GET /api/status'] = (req, res) => {
  sendJSON(res, 200, { passwordSet: auth.isPasswordSet(), authed: isAuthed(req) });
};

api['POST /api/setup-password'] = async (req, res) => {
  if (auth.isPasswordSet()) return sendJSON(res, 400, { error: 'Password already set' });
  const { password } = await readBody(req);
  if (!password || password.length < 6) return sendJSON(res, 400, { error: 'Password must be at least 6 characters' });
  auth.setPassword(password);
  const token = auth.createSession();
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/`);
  sendJSON(res, 200, { ok: true });
};

api['POST /api/login'] = async (req, res) => {
  const { password } = await readBody(req);
  if (!auth.checkPassword(password || '')) return sendJSON(res, 401, { error: 'Wrong password' });
  const token = auth.createSession();
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/`);
  sendJSON(res, 200, { ok: true });
};

api['POST /api/logout'] = async (req, res) => {
  auth.destroySession(getSessionToken(req));
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');
  sendJSON(res, 200, { ok: true });
};

api['POST /api/change-password'] = async (req, res) => {
  const { currentPassword, newPassword } = await readBody(req);
  if (!auth.checkPassword(currentPassword || '')) return sendJSON(res, 401, { error: 'Current password is wrong' });
  if (!newPassword || newPassword.length < 6) return sendJSON(res, 400, { error: 'New password must be at least 6 characters' });
  auth.setPassword(newPassword);
  sendJSON(res, 200, { ok: true });
};

// ----- Rota -----

api['GET /api/rota'] = (req, res, query) => {
  const start = query.start || money.todayUTC().toISOString().slice(0, 10);
  const days = Math.min(parseInt(query.days || '14', 10), 90);
  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(startDate.getTime() + days * 86400000);
  const range = rota.getRange(start, endDate.toISOString().slice(0, 10));
  sendJSON(res, 200, { days: range });
};

api['GET /api/rota/settings'] = (req, res) => {
  sendJSON(res, 200, { anchorDate: rota.getAnchorDate() });
};

api['POST /api/rota/settings'] = async (req, res) => {
  const { anchorDate } = await readBody(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate || '')) return sendJSON(res, 400, { error: 'anchorDate must be YYYY-MM-DD' });
  rota.setAnchorDate(anchorDate);
  sendJSON(res, 200, { ok: true });
};

// ----- Reminders (The Board) -----

function nextOccurrence(dateStr, repeatAnnual, from = money.todayUTC()) {
  let d = new Date(dateStr + 'T00:00:00Z');
  if (repeatAnnual) {
    d = new Date(Date.UTC(from.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    if (d < from) d = new Date(Date.UTC(from.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  }
  return d;
}

function reminderWithMeta(r) {
  const from = money.todayUTC();
  const occ = nextOccurrence(r.date, r.repeat_annual, from);
  const daysUntil = Math.round((occ - from) / 86400000);
  return {
    ...r,
    repeat_annual: !!r.repeat_annual,
    done: !!r.done,
    nextDate: occ.toISOString().slice(0, 10),
    daysUntil,
    urgency: priority.urgencyLevel(r.priority, daysUntil)
  };
}

api['GET /api/reminders'] = (req, res) => {
  const rows = db.prepare('SELECT * FROM reminders ORDER BY date ASC').all();
  const withMeta = rows.map(reminderWithMeta).sort((a, b) => (a.done - b.done) || (a.daysUntil - b.daysUntil));
  sendJSON(res, 200, { reminders: withMeta });
};

api['POST /api/reminders'] = async (req, res) => {
  const { title, category, date, repeatAnnual, priority: pri } = await readBody(req);
  if (!title || !date) return sendJSON(res, 400, { error: 'title and date are required' });
  const info = db.prepare(
    'INSERT INTO reminders (title, category, date, repeat_annual, priority) VALUES (?, ?, ?, ?, ?)'
  ).run(title, category || 'other', date, repeatAnnual ? 1 : 0, pri || 'medium');
  sendJSON(res, 200, { id: info.lastInsertRowid });
};

api['PATCH /api/reminders/:id'] = async (req, res, query, params) => {
  const { done, title, category, date, repeatAnnual, priority: pri } = await readBody(req);
  const existing = db.prepare('SELECT * FROM reminders WHERE id = ?').get(params.id);
  if (!existing) return sendJSON(res, 404, { error: 'Not found' });
  db.prepare(
    'UPDATE reminders SET title=?, category=?, date=?, repeat_annual=?, priority=?, done=? WHERE id=?'
  ).run(
    title ?? existing.title,
    category ?? existing.category,
    date ?? existing.date,
    repeatAnnual === undefined ? existing.repeat_annual : (repeatAnnual ? 1 : 0),
    pri ?? existing.priority,
    done === undefined ? existing.done : (done ? 1 : 0),
    params.id
  );
  sendJSON(res, 200, { ok: true });
};

api['DELETE /api/reminders/:id'] = (req, res, query, params) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
};

// ----- Bills -----

api['GET /api/bills'] = (req, res) => {
  sendJSON(res, 200, { bills: db.prepare('SELECT * FROM bills ORDER BY due_day ASC').all() });
};

api['POST /api/bills'] = async (req, res) => {
  const { name, amount, dueDay } = await readBody(req);
  if (!name || !amount || !dueDay) return sendJSON(res, 400, { error: 'name, amount, dueDay are required' });
  const info = db.prepare('INSERT INTO bills (name, amount, due_day) VALUES (?, ?, ?)').run(name, amount, dueDay);
  sendJSON(res, 200, { id: info.lastInsertRowid });
};

api['DELETE /api/bills/:id'] = (req, res, query, params) => {
  db.prepare('DELETE FROM bills WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
};

// ----- Savings goals -----

api['GET /api/goals'] = (req, res) => {
  const goals = db.prepare('SELECT * FROM savings_goals ORDER BY target_date ASC').all();
  const withContribution = goals.map(g => ({ ...g, monthlyContribution: money.goalMonthlyContribution(g) }));
  sendJSON(res, 200, { goals: withContribution });
};

api['POST /api/goals'] = async (req, res) => {
  const { name, target, current, targetDate } = await readBody(req);
  if (!name || !target || !targetDate) return sendJSON(res, 400, { error: 'name, target, targetDate are required' });
  const info = db.prepare(
    'INSERT INTO savings_goals (name, target, current, target_date) VALUES (?, ?, ?, ?)'
  ).run(name, target, current || 0, targetDate);
  sendJSON(res, 200, { id: info.lastInsertRowid });
};

api['PATCH /api/goals/:id'] = async (req, res, query, params) => {
  const { current } = await readBody(req);
  db.prepare('UPDATE savings_goals SET current = ? WHERE id = ?').run(current, params.id);
  sendJSON(res, 200, { ok: true });
};

api['DELETE /api/goals/:id'] = (req, res, query, params) => {
  db.prepare('DELETE FROM savings_goals WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
};

// ----- Income / money summary -----

api['GET /api/income'] = (req, res) => {
  sendJSON(res, 200, { income: db.prepare('SELECT * FROM income WHERE id = 1').get() });
};

api['POST /api/income'] = async (req, res) => {
  const { amount, paydayDay } = await readBody(req);
  db.prepare('UPDATE income SET amount = ?, payday_day = ? WHERE id = 1').run(amount || 0, paydayDay || 28);
  sendJSON(res, 200, { ok: true });
};

api['GET /api/money-summary'] = (req, res) => {
  const income = db.prepare('SELECT * FROM income WHERE id = 1').get();
  const bills = db.prepare('SELECT * FROM bills').all();
  const goals = db.prepare('SELECT * FROM savings_goals').all();
  sendJSON(res, 200, {
    summary: money.monthlySummary(income, bills, goals),
    forecast: money.forecastToPayday(income, bills)
  });
};

// ----- Morning briefing -----

api['GET /api/briefing'] = (req, res) => {
  const todayStr = money.todayUTC().toISOString().slice(0, 10);
  const todayInfo = rota.getDayInfo(todayStr);
  const nextChange = rota.nextTransition(todayStr, todayInfo.kids);

  const reminders = db.prepare('SELECT * FROM reminders WHERE done = 0').all()
    .map(reminderWithMeta)
    .filter(r => r.daysUntil <= 14)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 8);

  const income = db.prepare('SELECT * FROM income WHERE id = 1').get();
  const bills = db.prepare('SELECT * FROM bills').all();
  const goals = db.prepare('SELECT * FROM savings_goals').all();
  const summary = money.monthlySummary(income, bills, goals);

  sendJSON(res, 200, {
    date: todayStr,
    rota: { ...todayInfo, nextChange },
    reminders,
    money: { leftover: summary.leftover }
  });
};

// ----- Settings (priority thresholds) -----

api['GET /api/settings/priority'] = (req, res) => {
  sendJSON(res, 200, priority.getThresholds());
};

api['POST /api/settings/priority'] = async (req, res) => {
  const { high, medium, low } = await readBody(req);
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  if (high) set.run('priority_high_days', String(high));
  if (medium) set.run('priority_medium_days', String(medium));
  if (low) set.run('priority_low_days', String(low));
  sendJSON(res, 200, { ok: true });
};

// ---------- routing ----------

function matchRoute(method, pathname) {
  const key = `${method} ${pathname}`;
  if (api[key]) return { handler: api[key], params: {} };

  // Try param routes like /api/reminders/:id
  for (const routeKey of Object.keys(api)) {
    const [routeMethod, routePath] = routeKey.split(' ');
    if (routeMethod !== method) continue;
    if (!routePath.includes(':')) continue;
    const routeParts = routePath.split('/');
    const pathParts = pathname.split('/');
    if (routeParts.length !== pathParts.length) continue;
    const params = {};
    let match = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        match = false; break;
      }
    }
    if (match) return { handler: api[routeKey], params };
  }
  return null;
}

const PUBLIC_PAGES = new Set(['/login.html', '/setup.html']);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // API routes
  if (pathname.startsWith('/api/')) {
    const match = matchRoute(req.method, pathname);
    if (!match) return sendJSON(res, 404, { error: 'Not found' });

    const isPublic = ['/api/status', '/api/login', '/api/setup-password'].includes(pathname);
    if (!isPublic && !isAuthed(req)) return sendJSON(res, 401, { error: 'Not authenticated' });

    try {
      await match.handler(req, res, parsed.query, match.params);
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: 'Server error' });
    }
    return;
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(PUBLIC_DIR, filePath);

  // Guard: page requests (html) require auth, except login/setup
  if (filePath.endsWith('.html') && !PUBLIC_PAGES.has(filePath)) {
    if (!isAuthed(req)) {
      res.writeHead(302, { Location: auth.isPasswordSet() ? '/login.html' : '/setup.html' });
      return res.end();
    }
  }

  serveStatic(req, res, fullPath);
});

// Clean up expired sessions once a day
setInterval(() => auth.cleanupExpiredSessions(), 24 * 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Home Front running on http://localhost:${PORT}`);
});
