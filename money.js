// money.js — pure calculation helpers for the Money Management page.
// No bank linking, no CSV import — everything here is manually entered by the user.
'use strict';

function todayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Next occurrence of a day-of-month (1-31), clamped to shorter months, on/after today.
function nextDayOfMonth(day, from = todayUTC()) {
  const clamp = (year, month) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Math.min(day, lastDay);
  };
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  let candidate = new Date(Date.UTC(year, month, clamp(year, month)));
  if (candidate < from) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    candidate = new Date(Date.UTC(year, month, clamp(year, month)));
  }
  return candidate;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function monthsUntil(dateStr, from = todayUTC()) {
  const target = new Date(dateStr + 'T00:00:00Z');
  let months = (target.getUTCFullYear() - from.getUTCFullYear()) * 12 + (target.getUTCMonth() - from.getUTCMonth());
  if (target.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(months, 0);
}

function goalMonthlyContribution(goal, from = todayUTC()) {
  const remaining = Math.max(goal.target - goal.current, 0);
  const months = monthsUntil(goal.target_date, from);
  return months > 0 ? remaining / months : remaining;
}

// Full monthly summary: income, bills, goal contributions, leftover.
function monthlySummary(income, bills, goals) {
  const billTotal = bills.reduce((s, b) => s + b.amount, 0);
  const goalTotal = goals.reduce((s, g) => s + goalMonthlyContribution(g), 0);
  const leftover = (income.amount || 0) - billTotal - goalTotal;
  return {
    income: income.amount || 0,
    billTotal,
    goalTotal,
    leftover
  };
}

// Forecast: bills due between today and the next payday (short-term cashflow check).
function forecastToPayday(income, bills, from = todayUTC()) {
  const payday = nextDayOfMonth(income.payday_day, from);
  const dueBefore = bills
    .map(b => ({ ...b, nextDue: nextDayOfMonth(b.due_day, from) }))
    .filter(b => b.nextDue <= payday)
    .sort((a, b) => a.nextDue - b.nextDue);
  const total = dueBefore.reduce((s, b) => s + b.amount, 0);
  return {
    paydayDate: payday.toISOString().slice(0, 10),
    daysUntilPayday: daysBetween(from, payday),
    billsDue: dueBefore.map(b => ({
      id: b.id, name: b.name, amount: b.amount, dueDate: b.nextDue.toISOString().slice(0, 10)
    })),
    totalDueBeforePayday: total
  };
}

module.exports = { nextDayOfMonth, monthsUntil, goalMonthlyContribution, monthlySummary, forecastToPayday, todayUTC };
