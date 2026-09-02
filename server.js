cat > server.js << 'ENDOFFILE'
// server.js — Second Brain, a single-user personal assistant app.
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
const telegram = require('./src/telegram');

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

ENDOFFILE
wc -l server.js
