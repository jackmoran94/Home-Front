// rota.js — pure date logic for the alternating 28-day rota templates.
'use strict';

const db = require('./db');

function getAnchorDate() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rota_anchor_date');
  return row.value; // 'YYYY-MM-DD', Day 1 of Template A
}

function setAnchorDate(dateStr) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('rota_anchor_date', dateStr);
}

function toUTCDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// Returns { date, template, dayNumber, kids, shift } for a given YYYY-MM-DD date.
// Dates before the anchor return { beforeAnchor: true } since the pattern isn't valid before then.
function getDayInfo(dateStr) {
  const anchor = toUTCDate(getAnchorDate());
  const target = toUTCDate(dateStr);

  if (target < anchor) {
    return { date: dateStr, beforeAnchor: true, kids: null, shift: null };
  }

  let diff = daysBetween(anchor, target);
  diff = diff % 56;

  const template = diff < 28 ? 'A' : 'B';
  const dayNumber = (diff % 28) + 1;

  const row = db.prepare(
    'SELECT kids, shift FROM rota_templates WHERE template = ? AND day_number = ?'
  ).get(template, dayNumber);

  return {
    date: dateStr,
    beforeAnchor: false,
    template,
    dayNumber,
    kids: !!row.kids,
    shift: row.shift
  };
}

// Returns an array of getDayInfo results for [startDate, endDate) — endDate exclusive.
function getRange(startDate, endDate) {
  const out = [];
  let cur = toUTCDate(startDate);
  const end = toUTCDate(endDate);
  while (cur < end) {
    const iso = cur.toISOString().slice(0, 10);
    out.push(getDayInfo(iso));
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

// Finds the next date (>= fromDate, exclusive of fromDate unless includeFrom) where kids status changes.
function nextTransition(fromDate, currentKidsStatus) {
  let cur = toUTCDate(fromDate);
  for (let i = 0; i < 56; i++) {
    cur = new Date(cur.getTime() + 86400000);
    const iso = cur.toISOString().slice(0, 10);
    const info = getDayInfo(iso);
    if (info.kids !== currentKidsStatus) return info;
  }
  return null;
}

module.exports = { getAnchorDate, setAnchorDate, getDayInfo, getRange, nextTransition };
