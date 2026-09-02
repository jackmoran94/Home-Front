// priority.js — turns (priority tier + days-until-due) into an urgency level for display.
'use strict';

const db = require('./db');

function getThresholds() {
  const get = (k, fallback) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    return row ? parseInt(row.value, 10) : fallback;
  };
  return {
    high: get('priority_high_days', 14),
    medium: get('priority_medium_days', 7),
    low: get('priority_low_days', 2)
  };
}

// Returns 'overdue' | 'urgent' | 'soon' | 'later'
function urgencyLevel(priority, daysUntil) {
  if (daysUntil < 0) return 'overdue';
  const thresholds = getThresholds();
  const threshold = thresholds[priority] ?? thresholds.medium;
  if (daysUntil <= threshold) return 'urgent';
  if (daysUntil <= threshold * 2) return 'soon';
  return 'later';
}

module.exports = { getThresholds, urgencyLevel };
