// shared.js — small helpers reused across pages. No frameworks, no build step.

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function money(n) {
  return '£' + (Number(n) || 0).toFixed(2);
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function daysLabel(n) {
  if (n < 0) return Math.abs(n) + 'd overdue';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return 'In ' + n + 'd';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderNav(active) {
  const items = [
    ['/index.html', 'Brief'],
    ['/rota.html', 'Rota'],
    ['/board.html', 'Board'],
    ['/money.html', 'Money'],
    ['/settings.html', 'Settings']
  ];
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.innerHTML = items.map(([href, label]) =>
    `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`
  ).join('');
  document.body.appendChild(nav);
}

async function requireAuth() {
  const status = await fetch('/api/status').then(r => r.json());
  if (!status.authed) {
    window.location.href = status.passwordSet ? '/login.html' : '/setup.html';
  }
}
