// auth.js — single-user password auth with scrypt hashing and DB-backed sessions.
'use strict';

const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(attempt, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isPasswordSet() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('password_hash');
  return !!(row && row.value);
}

function setPassword(password) {
  const hashed = hashPassword(password);
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('password_hash', hashed);
}

function checkPassword(password) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('password_hash');
  return verifyPassword(password, row && row.value);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expires);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  return new Date(row.expires_at) > new Date();
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanupExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

module.exports = {
  isPasswordSet, setPassword, checkPassword,
  createSession, isValidSession, destroySession, cleanupExpiredSessions
};
