// db.js — SQLite setup using Node's built-in node:sqlite module (Node 22+).
// No external dependencies needed for the database layer.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'homefront.db');

// Make sure the data directory exists (Render disks etc.)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rota_templates (
      template TEXT NOT NULL,
      day_number INTEGER NOT NULL,
      kids INTEGER NOT NULL,
      shift TEXT NOT NULL,
      PRIMARY KEY (template, day_number)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      repeat_annual INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'medium',
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      due_day INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target REAL NOT NULL,
      current REAL NOT NULL DEFAULT 0,
      target_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS income (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      amount REAL NOT NULL DEFAULT 0,
      payday_day INTEGER NOT NULL DEFAULT 28
    );

    CREATE TABLE IF NOT EXISTS school_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      lead_weeks INTEGER NOT NULL DEFAULT 6
    );
  `);

  // Ensure a single income row exists
  const incomeRow = db.prepare('SELECT id FROM income WHERE id = 1').get();
  if (!incomeRow) {
    db.prepare('INSERT INTO income (id, amount, payday_day) VALUES (1, 0, 28)').run();
  }

  // Seed rota templates only if empty
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM rota_templates').get();
  if (countRow.c === 0) {
    seedRotaTemplates();
  }

  // Default settings
  const defaults = {
    rota_anchor_date: '2026-09-21', // Day 1 of Template A
    priority_high_days: '14',
    priority_medium_days: '7',
    priority_low_days: '2'
  };
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    if (!getSetting.get(k)) setSetting.run(k, v);
  }
}

// Confirmed 28-day rota data: [dayNumber, kids(0/1), shift]
const TEMPLATE_A = [
  [1, 1, 'OFF'], [2, 1, 'EF'], [3, 0, 'Late'], [4, 0, 'Early'], [5, 0, 'LF'],
  [6, 1, 'OFF'], [7, 1, 'OFF'], [8, 0, 'EF'], [9, 0, 'Late'], [10, 1, 'Early'],
  [11, 1, 'OFF'], [12, 0, 'Late'], [13, 0, 'Early'], [14, 0, 'Late'], [15, 1, 'Early'],
  [16, 1, 'OFF'], [17, 0, 'OFF'], [18, 0, 'Late'], [19, 1, 'Early'], [20, 1, 'OFF'],
  [21, 1, 'OFF'], [22, 0, 'Late'], [23, 1, 'Early'], [24, 1, 'Meeting'], [25, 0, 'LF'],
  [26, 1, 'OFF'], [27, 0, 'Late'], [28, 0, 'Early']
];

const TEMPLATE_B = [
  [1, 1, 'OFF'], [2, 0, 'LF'], [3, 0, 'Late'], [4, 1, 'Early'], [5, 0, 'EF'],
  [6, 1, 'OFF'], [7, 1, 'OFF'], [8, 0, 'LF'], [9, 0, 'Late'], [10, 1, 'Early'],
  [11, 1, 'OFF'], [12, 0, 'Late'], [13, 0, 'Early'], [14, 0, 'Late'], [15, 1, 'Early'],
  [16, 1, 'OFF'], [17, 0, 'OFF'], [18, 0, 'Late'], [19, 1, 'Early'], [20, 1, 'OFF'],
  [21, 1, 'OFF'], [22, 0, 'Late'], [23, 1, 'Early'], [24, 1, 'Meeting'], [25, 0, 'EF'],
  [26, 1, 'OFF'], [27, 0, 'Late'], [28, 0, 'Early']
];

function seedRotaTemplates() {
  const insert = db.prepare(
    'INSERT INTO rota_templates (template, day_number, kids, shift) VALUES (?, ?, ?, ?)'
  );
  for (const [day, kids, shift] of TEMPLATE_A) insert.run('A', day, kids, shift);
  for (const [day, kids, shift] of TEMPLATE_B) insert.run('B', day, kids, shift);
}

migrate();

module.exports = db;
