/**
 * Signature animation: the "live passbook" ticker on the landing page, and
 * the odometer-style balance digit flip used on the dashboard.
 *
 * Before there is real traffic to sample from, SAMPLE_LINES below are
 * illustrative placeholders and must be labeled as such in the UI copy
 * (a small "sample activity" caption) — never presented as real user data
 * until backed by an actual query against recent task_completions.
 */

const SAMPLE_LINES = [
  { name: 'Chidinma', action: 'completed a survey', amount: '+₦450' },
  { name: 'Tunde', action: 'watched a rewarded ad', amount: '+₦20' },
  { name: 'Amara', action: 'finished an app install offer', amount: '+₦900' },
  { name: 'Femi', action: 'completed a captcha set', amount: '+₦35' },
  { name: 'Ngozi', action: 'tested a mobile app', amount: '+₦1,200' },
  { name: 'Bayo', action: 'referred a friend', amount: '+₦300' },
];

function renderLedgerLine(container, line, index) {
  const el = document.createElement('div');
  el.className = 'ef-ledger-line';
  el.style.animationDelay = `${index * 0.08}s`;
  el.innerHTML = `<span>${line.name} ${line.action}</span><span class="amt">${line.amount}</span>`;
  container.prepend(el);
  while (container.children.length > 6) {
    container.removeChild(container.lastChild);
  }
}

function initLiveLedger() {
  const container = document.getElementById('ef-live-ledger');
  if (!container) return;

  let i = 0;
  SAMPLE_LINES.forEach((line, idx) => renderLedgerLine(container, line, idx));

  setInterval(() => {
    const line = SAMPLE_LINES[i % SAMPLE_LINES.length];
    renderLedgerLine(container, line, 0);
    i++;
  }, 3200);
}

/** Odometer-style digit flip when the balance changes. */
function animateBalance(newValueFormatted) {
  const el = document.getElementById('ef-balance-digits');
  if (!el) return;
  const chars = newValueFormatted.split('');
  el.innerHTML = chars
    .map((c) => `<span class="ef-digit flip">${c}</span>`)
    .join('');
}

document.addEventListener('DOMContentLoaded', initLiveLedger);
