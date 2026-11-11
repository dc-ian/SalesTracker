// Money is stored as integer cents. Parsing avoids floating point entirely.
function parseMoney(input) {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(String(input == null ? '' : input));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

function formatMoney(cents) {
  const n = Number(cents) || 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${n < 0 ? '-' : ''}${whole}.${frac}`;
}

module.exports = { parseMoney, formatMoney };
