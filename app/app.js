/* ---------- Constants ---------- */
const $ = id => document.getElementById(id);
// The published copy on maclaine.se keeps its data in the browser; the local one talks to server.mjs
const WEB = document.documentElement.dataset.mode === 'web';
const TYPES = {
  cash:        { label: 'Cash',          group: 'cash' },
  savings:     { label: 'Savings',       group: 'cash' },
  investments: { label: 'Investments',   group: 'inv' },
  pension:     { label: 'Pension',       group: 'pen' },
  property:    { label: 'Property',      group: 'home' },
  vehicle:     { label: 'Vehicle',       group: 'other' },
  other:       { label: 'Other asset',   group: 'other' },
  loan:        { label: 'Loan',          group: 'debt' },
  student:     { label: 'Student loan',  group: 'debt' },
  debt:        { label: 'Other debt',    group: 'debt' },
};
// Fixed categorical order, validated with the dataviz palette checker.
const GROUPS = [
  { key: 'pen',   label: 'Pensions',         color: 'var(--series-1)' },
  { key: 'inv',   label: 'Investments',      color: 'var(--series-2)' },
  { key: 'cash',  label: 'Cash and savings', color: 'var(--series-3)' },
  { key: 'home',  label: 'Home equity',      color: 'var(--series-4)' },
  { key: 'other', label: 'Car and other',    color: 'var(--series-5)' },
];
const DEBT = { key: 'debt', label: 'Debts', color: 'var(--debt)' };
// People come from the data: one to four names, plus Joint once there are two
const MAX_PEOPLE = 4;
let PEOPLE = [], OWNERS = {};
function setPeople() {
  PEOPLE = db.people.map((p, i) => ({ key: p.key, label: p.name, color: `var(--series-${i + 1})` }));
  if (db.people.length > 1) PEOPLE.push({ key: 'J', label: 'Joint', color: `var(--series-${db.people.length + 1})` });
  OWNERS = Object.fromEntries(PEOPLE.map(p => [p.key, p.label]));
}
const solo = () => db.people.length < 2;
const persons = () => PEOPLE.filter(p => p.key !== 'J');
// With one person there is no owner to show
const ownerOf = k => solo() ? '' : esc(OWNERS[k] || '');
const isDebt = t => TYPES[t].group === 'debt';
// Student loans can be left out of every total in Settings: repaid from income, written off at retirement.
const inTotals = a => a.type !== 'student' || db.settings.countStudent;
// "Within reach": cash, savings and investments. Not the home, cars or pensions.
const REACH = ['cash', 'inv'];

/* ---------- Formatting ---------- */
// Totals are counted in one main currency; any account can be in another and is converted at each snapshot's rate
const CURRENCIES = {
  SEK: { sym: 'kr', after: true,  locale: 'sv-SE' },
  NOK: { sym: 'kr', after: true,  locale: 'nb-NO' },
  DKK: { sym: 'kr', after: true,  locale: 'da-DK' },
  EUR: { sym: '€',  after: false, locale: 'en-IE' },
  GBP: { sym: '£',  after: false, locale: 'en-GB' },
  USD: { sym: '$',  after: false, locale: 'en-US' },
  CHF: { sym: 'CHF', after: false, locale: 'de-CH' },
};
const base = () => db.settings.currency;
const loc = () => CURRENCIES[base()].locale;
const nfs = {};
const nf = (cur = base()) => nfs[cur] ||= new Intl.NumberFormat(CURRENCIES[cur].locale, { maximumFractionDigits: 0 });
// Three currencies write "kr", so a foreign one shows its code instead
const symOf = cur => cur !== base() && CURRENCIES[cur].sym === CURRENCIES[base()].sym ? cur : CURRENCIES[cur].sym;
function money(v, cur = base()) {
  const s = symOf(cur), n = nf(cur).format(Math.round(v));
  return CURRENCIES[cur].after ? n + ' ' + s : s.length > 1 ? s + ' ' + n : s + n;
}
const amt = v => money(v);
// A figure with its currency as a smaller unit, for the big numbers
function unitHtml(n, cur = base(), sign = '') {
  const s = esc(symOf(cur));
  return CURRENCIES[cur].after ? `${sign}${n}<span class="unit">${s}</span>` : `${sign}<span class="unit pre">${s}</span>${n}`;
}
const compact = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString(loc(), { maximumFractionDigits: 1 }) + ' mn';
  if (a >= 1e3) return Math.round(v / 1e3) + ' k';
  return String(Math.round(v));
};
const compactMoney = v => CURRENCIES[base()].after ? compact(v) + ' ' + symOf(base()) : symOf(base()) + compact(v);
const fmtRate = r => r.toLocaleString(loc(), { maximumFractionDigits: 4 });
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDay = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
const fmtTime = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtWeekday = d => new Date(d).toLocaleDateString('en-GB', { weekday: 'long' });
function delta(v, fmt = amt) {
  if (Math.round(v) === 0) return '<span class="delta muted">no change</span>';
  const up = v > 0;
  return `<span class="delta ${up ? 'up' : 'down'}"><span class="arr" aria-hidden="true">${up ? '▲' : '▼'}</span>${up ? '+' : '−'}${fmt(Math.abs(v))}</span>`;
}
function debtDelta(before, now, fmt) {
  const d = before - now;
  if (Math.round(d) === 0) return '<span class="delta muted">no change</span>';
  return d > 0
    ? `<span class="delta up"><span class="arr" aria-hidden="true">▼</span>${fmt(d)} paid off</span>`
    : `<span class="delta down"><span class="arr" aria-hidden="true">▲</span>${fmt(-d)} more owed</span>`;
}
function parseMoney(s) {
  if (s == null) return null;
  let t = String(s).trim().toLowerCase().replace(/kr|sek|nok|dkk|eur|gbp|usd|chf|[£€$]/g, '').replace(/[\s  ,’']/g, '');
  if (!t) return null;
  let mult = 1;
  if (t.endsWith('k')) { mult = 1e3; t = t.slice(0, -1); }
  else if (t.endsWith('m')) { mult = 1e6; t = t.slice(0, -1); }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n * mult : NaN;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- State ---------- */
const defaultSettings = () => ({ currency: 'SEK', pay: { est: {} }, ukState: { on: false, who: null, years: 0, age: 68, born: null, rate: 241.30, forecast: null }, goal: null, showGrowth: false, hideFigures: false, theme: 'auto', countStudent: false, householdTab: false, reminder: { on: false, days: 30 } });
let db = { version: 1, settings: defaultSettings(), people: [], accounts: [], snapshots: [], household: [] };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Locally everything goes through the server; changes need the x-nw1 header.
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-nw1': '1' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
// On the web the data is one item in localStorage, with the same version check as the server
const STORE = 'nw1';
const stored = () => localStorage.getItem(STORE);
async function load() {
  if (!WEB) return api('/api/data');
  return JSON.parse(stored() || '{}');
}
async function write(d) {
  if (ui.demo) return { rev: d.rev };
  if (!WEB) return api('/api/data', { method: 'PUT', body: JSON.stringify(d) });
  const current = JSON.parse(stored() || '{}');
  if ((current.rev ?? 0) !== (d.rev ?? 0)) throw new Error('The data changed somewhere else. Reload the page.');
  const rev = (d.rev ?? 0) + 1;
  localStorage.setItem(STORE, JSON.stringify({ ...d, rev }));
  return { rev };
}
async function reload() {
  db = normalise(await load()); setPeople(); sortSnaps(); applySettings(); ownerButtons(); render();
}
let saving = Promise.resolve();
function persist() {
  // Serialise at send time, so queued saves carry the latest version number
  saving = saving.then(() => write(db))
    .then(r => { db.rev = r.rev; })
    .catch(async e => {
      if (/changed somewhere else/.test(e.message)) {
        await reload();
        toast(`Net worth was changed in another ${WEB ? 'tab' : 'window'}, so this page has reloaded. Please redo your last change.`);
      } else toast(WEB ? `Not saved: ${e.message}. The browser may be out of space for this site.` : `Not saved: ${e.message}. Is the Net worth window still open?`);
    });
  return saving;
}
// Another tab saved: show its version, unless this one is showing the example
window.addEventListener('storage', e => {
  if (!WEB || ui.demo || e.key !== STORE) return;
  reload().then(() => toast('Updated from another tab'));
});

const ui = { fetched: {}, view: 'overview', chart: 'total', range: 'all', home: 'with', table: false, openAcc: null, openSnap: null, editSnap: null, showArchived: false, addOwner: null, hhOwner: null, demo: false };
let draft = {};          // accId -> string, or { worth, owed } for property
let draftEst = {};       // accId -> true when the figure is a placeholder
let draftSpread = {};    // accId -> true to ease a new asset value in since the last valuation
let rateDraft = {};      // currency -> typed rate

/* ---------- Model ---------- */
const accById = id => db.accounts.find(a => a.id === id);
const activeAt = (a, iso) => !a.archivedAt || iso < a.archivedAt;

// Latest native value of every account as of each snapshot, plus SEK totals.
function timeline() {
  const last = {}, rates = {}, firstFx = {};
  // A snapshot without a rate for a currency uses the one before, or the first one known
  for (const s of db.snapshots) for (const c in s.fx || {}) firstFx[c] ??= s.fx[c];
  return db.snapshots.map(s => {
    Object.assign(last, s.values);
    Object.assign(rates, s.fx);
    const row = { at: s.at, total: 0, exHome: 0, reach: 0, groups: {}, people: Object.fromEntries(PEOPLE.map(p => [p.key, 0])), acc: {}, parts: {} };
    GROUPS.concat(DEBT).forEach(g => row.groups[g.key] = 0);
    for (const a of db.accounts) {
      if (!(a.id in last) || !activeAt(a, s.at) || !inTotals(a)) continue;
      const fx = a.currency === base() ? 1 : rates[a.currency] ?? firstFx[a.currency] ?? 1;
      const v = last[a.id];
      let sek;
      if (a.type === 'property') sek = (v.worth - v.owed) * fx;
      else sek = (isDebt(a.type) ? -v : v) * fx;
      row.acc[a.id] = sek;
      if (a.type === 'property') row.parts[a.id] = { own: v.worth * fx, owe: v.owed * fx };
      else row.parts[a.id] = isDebt(a.type) ? { own: 0, owe: v * fx } : { own: v * fx, owe: 0 };
      row.groups[TYPES[a.type].group] += sek;
      row.people[a.owner] += sek;
      row.total += sek;
      if (a.type !== 'property') row.exHome += sek;
      if (REACH.includes(TYPES[a.type].group)) row.reach += sek;
    }
    return row;
  });
}
function lastValue(accId, beforeIndex = db.snapshots.length) {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const v = db.snapshots[i].values[accId];
    if (v !== undefined) return { v, i, at: db.snapshots[i].at };
  }
  return null;
}
// Assets that hold a value (home, vehicles, other) can have a change spread over time
const SPREADABLE = ['property', 'vehicle', 'other'];
const assetVal = (a, v) => a.type === 'property' ? v.worth : v;
// Index of the snapshot where the current value was first recorded (the last valuation)
function plateauStart(a, beforeIndex) {
  let start = null, prev;
  for (let i = 0; i < beforeIndex; i++) {
    const v = db.snapshots[i].values[a.id];
    if (v === undefined) continue;
    const x = assetVal(a, v);
    if (prev === undefined || x !== prev) start = i;
    prev = x;
  }
  return start;
}
// Ease the value in a straight line from the last valuation to the new snapshot
function spreadValues(a, snap) {
  const end = db.snapshots.indexOf(snap);
  const k = plateauStart(a, end);
  if (k == null) return;
  const t0 = +new Date(db.snapshots[k].at), t1 = +new Date(snap.at);
  const v0 = assetVal(a, db.snapshots[k].values[a.id]), v1 = assetVal(a, snap.values[a.id]);
  for (let j = k + 1; j < end; j++) {
    const s = db.snapshots[j], v = s.values[a.id];
    if (v === undefined) continue;
    const w = Math.round((v0 + (v1 - v0) * (+new Date(s.at) - t0) / (t1 - t0)) / 1000) * 1000;
    s.values[a.id] = a.type === 'property' ? { ...v, worth: w } : w;
  }
}
function isEstimate(accId) {
  const lv = lastValue(accId);
  return !!(lv && db.snapshots[lv.i].est?.[accId]);
}
const estTag = '<span class="tag" title="A placeholder figure, correct it in History">estimate</span>';
// When backdating, compare against what was known just before that date
function asOfIso() { return ui.asOf ? new Date(ui.asOf + 'T12:00:00').toISOString() : null; }
function refIndex() { const iso = asOfIso(); return iso ? db.snapshots.filter(s => s.at < iso).length : db.snapshots.length; }
function sortSnaps() { db.snapshots.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0); }
const dayKey = () => ui.asOf || new Date().toISOString().slice(0, 10);
// Rates are base currency per one unit of the other, stored with each snapshot
const foreign = () => [...new Set(db.accounts.filter(a => !a.archivedAt && a.currency !== base()).map(a => a.currency))];
const fxKey = (cur, day = dayKey()) => `${day}|${cur}|${base()}`;
function lastFx(cur, beforeIndex = db.snapshots.length) {
  for (let i = beforeIndex - 1; i >= 0; i--) { const r = db.snapshots[i].fx?.[cur]; if (r) return r; }
  return null;
}
function currentRate(cur) {
  if (cur === base()) return 1;
  return rateDraft[cur] ?? ui.fetched[fxKey(cur)]?.rate ?? lastFx(cur, refIndex()) ?? lastFx(cur);
}
// ECB reference rates via Frankfurter: through the server locally, straight from the browser on the web
async function fetchRate(cur, day = dayKey()) {
  const k = fxKey(cur, day);
  if (ui.fetched[k]) return ui.fetched[k];
  try {
    let r;
    if (WEB) {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`https://api.frankfurter.dev/v1/${day === today ? 'latest' : day}?from=${cur}&to=${base()}`);
      if (!res.ok) throw new Error('Rate service answered ' + res.status);
      const j = await res.json();
      r = { rate: j.rates[base()], source: j.date };
    } else r = await api(`/api/rate?date=${day}&from=${cur}&to=${base()}`);
    ui.fetched[k] = r;
    return r;
  } catch { return null; }
}
const rateLabel = cur => (CURRENCIES[cur].after ? '1 ' + cur : CURRENCIES[cur].sym + '1') + ' =';
function renderRates() {
  $('rates').innerHTML = foreign().map(c => `<label class="rate">${rateLabel(c)}
    <input data-rate="${c}" inputmode="decimal" aria-label="${c} to ${base()} rate"> ${esc(symOf(base()))} <span class="muted" data-rate-src="${c}"></span></label>`).join('');
  showRates();
}
function showRates() {
  for (const c of foreign()) {
    const inp = document.querySelector(`[data-rate="${c}"]`), src = document.querySelector(`[data-rate-src="${c}"]`);
    if (!inp) continue;
    const r = currentRate(c);
    if (rateDraft[c] == null) inp.value = r ? fmtRate(r) : '';
    const f = ui.fetched[fxKey(c)];
    src.textContent = rateDraft[c] != null ? 'typed in' : f ? `ECB rate for ${fmtDay(f.source)}` : r ? 'last saved rate' : 'type the rate';
  }
}
const parseRate = t => { const v = Number(String(t).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : null; };

/* ---------- Charts ---------- */
const NS = 'http://www.w3.org/2000/svg';
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(v);
  return out;
}
function monthTicks(t0, t1, maxTicks) {
  const out = [];
  const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
  const months = [];
  while (d.getTime() <= t1) { months.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  const every = Math.max(1, Math.ceil(months.length / maxTicks));
  months.forEach((m, i) => { if (i % every === 0) out.push(m); });
  return out;
}

/**
 * cfg: { dates, series:[{key,label,color,vals}], stack:bool, total:{label,vals}|null,
 *        neg:{label,color,vals}|null, height, directLabels:bool, endDot:bool }
 */
function renderChart(el, cfg) {
  el.innerHTML = '';
  const W = Math.max(320, el.clientWidth), H = cfg.height || 340;
  const showLabels = cfg.directLabels && cfg.series.length <= 4 && W > 600;
  const m = { t: 12, r: showLabels ? 108 : 16, b: 28, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = cfg.dates.length;
  if (!n) { el.innerHTML = '<p class="muted">Nothing to draw yet.</p>'; return; }
  const ts = cfg.dates.map(d => +new Date(d));
  const t0 = ts[0], t1 = n > 1 ? ts[n - 1] : ts[0] + 864e5;

  // Values to plot
  let layers = [];
  let lo = Infinity, hi = -Infinity;
  if (cfg.stack) {
    const base = new Array(n).fill(0);
    for (const s of cfg.series) {
      const y0 = base.slice(), y1 = base.map((b, i) => b + Math.max(0, s.vals[i]));
      layers.push({ s, y0, y1 }); y1.forEach((v, i) => base[i] = v);
    }
    hi = Math.max(...base);
    const negs = cfg.negs || (cfg.neg ? [cfg.neg] : []);
    lo = negs.length ? Math.min(0, ...cfg.dates.map((_, i) => negs.reduce((s, ng) => s + Math.min(0, ng.vals[i]), 0))) : 0;
    if (cfg.total) hi = Math.max(hi, ...cfg.total.vals);
  } else {
    for (const s of cfg.series) s.vals.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    if (cfg.goal) hi = Math.max(hi, cfg.goal);
    if (cfg.zeroBase) lo = Math.min(0, lo);
    else { const pad = (hi - lo) * 0.12 || hi * 0.05; lo -= pad; hi += pad; }
  }
  const ticks = niceTicks(lo, hi, 5);
  const yMin = ticks[0], yMax = ticks.at(-1);
  const x = t => m.l + (n > 1 ? (t - t0) / (t1 - t0) * iw : iw / 2);
  const y = v => m.t + ih - (v - yMin) / (yMax - yMin) * ih;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', cfg.aria || 'Chart');
  const add = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e); return e;
  };

  // Grid and axes
  const grid = add('g', { class: 'grid' });
  const axis = add('g', { class: 'axis' });
  for (const v of ticks) {
    add('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : '' }, grid);
    const tx = add('text', { x: m.l - 10, y: y(v) + 4, 'text-anchor': 'end' }, axis);
    tx.textContent = v === 0 ? '0' : compact(v);
  }
  for (const d of monthTicks(t0, t1, Math.floor(iw / 80))) {
    const tx = add('text', { x: x(+d), y: H - 6, 'text-anchor': 'middle' }, axis);
    tx.textContent = d.getMonth() === 0 ? d.getFullYear() : d.toLocaleDateString('en-GB', { month: 'short' });
  }

  const pathOf = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(ts[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const areaOf = (top, bot) => {
    let d = top.map((v, i) => `${i ? 'L' : 'M'}${x(ts[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
    for (let i = n - 1; i >= 0; i--) d += `L${x(ts[i]).toFixed(1)},${y(bot[i]).toFixed(1)}`;
    return d + 'Z';
  };

  if (cfg.stack) {
    for (const L of layers) add('path', { d: areaOf(L.y1, L.y0), fill: L.s.color, stroke: 'var(--bg)', 'stroke-width': 2, 'stroke-linejoin': 'round' });
    const nbase = new Array(n).fill(0);
    for (const ng of (cfg.negs || (cfg.neg ? [cfg.neg] : []))) {
      const top = nbase.slice(), bot = nbase.map((b, i) => b + Math.min(0, ng.vals[i]));
      add('path', { d: areaOf(top, bot), fill: ng.color, stroke: 'var(--bg)', 'stroke-width': 2 });
      bot.forEach((v, i) => nbase[i] = v);
    }
    if (cfg.ownedFill) add('path', { d: pathOf(layers[0].y1), fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2 });
    if (cfg.total) add('path', { d: pathOf(cfg.total.vals), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-dasharray': '1 0', 'stroke-linejoin': 'round' });
  } else {
    for (const s of cfg.series) {
      if (cfg.area) {
        add('path', { d: areaOf(s.vals, new Array(n).fill(yMin)), fill: s.color, opacity: 0.08 });
      }
      add('path', { d: pathOf(s.vals), fill: 'none', stroke: s.color, 'stroke-width': cfg.weight || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    }
    if (showLabels) {
      // Direct labels at the line ends, nudged apart so they never overlap
      const ends = cfg.series.map(s => ({ s, y: y(s.vals[n - 1]) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
      for (const e of ends) {
        const tx = add('text', { x: m.l + iw + 10, y: e.y + 4, fill: 'var(--ink-2)', 'font-size': 13 });
        tx.textContent = e.s.label;
      }
    }
    if (cfg.goal) {
      add('line', { x1: m.l, x2: m.l + iw, y1: y(cfg.goal), y2: y(cfg.goal), stroke: 'var(--ink-2)', 'stroke-dasharray': '6 5', 'stroke-width': 1.5 });
      const gt = add('text', { x: m.l + 6, y: y(cfg.goal) - 8, fill: 'var(--ink-2)', 'font-size': 12, 'font-weight': 600 });
      gt.textContent = 'Goal ' + compactMoney(cfg.goal);
    }
    if (cfg.endDot) for (const s of cfg.series) add('circle', { cx: x(ts[n - 1]), cy: y(s.vals[n - 1]), r: 4.5, fill: s.color, stroke: 'var(--bg)', 'stroke-width': 2, class: 'enddot' });
    // Milestones: hollow ring and a small label where a line first crosses a round figure
    let lastX = -Infinity;
    for (const mk of cfg.marks || []) {
      const mx = x(ts[mk.i]), my = y(cfg.series[0].vals[mk.i]);
      if (mx - lastX < 70) continue;
      lastX = mx;
      add('circle', { cx: mx, cy: my, r: 5, fill: 'var(--bg)', stroke: 'var(--ink)', 'stroke-width': 1.5 });
      const tx = add('text', { x: mx, y: my - 13, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 12, 'font-weight': 600 });
      tx.textContent = mk.label;
    }
  }
  // Notes: small markers along the bottom of the plot
  if (cfg.notes) cfg.notes.forEach((t, i) => {
    if (!t) return;
    add('path', { d: `M${x(ts[i]) - 5},${m.t + ih + 1} L${x(ts[i]) + 5},${m.t + ih + 1} L${x(ts[i])},${m.t + ih - 7} Z`, fill: 'var(--ink-2)' });
  });

  // Hover layer
  const guide = add('line', { y1: m.t, y2: m.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1, opacity: 0 });
  const dotG = add('g', {});
  const hit = add('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent' });
  const tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip);
  el.prepend(svg);
  if (cfg.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    svg.querySelectorAll('path[fill="none"]').forEach(p => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.style.transition = 'stroke-dashoffset 1100ms cubic-bezier(.3,.7,.2,1)';
      p.style.strokeDashoffset = 0;
    });
    svg.querySelectorAll('path[opacity], .enddot').forEach(p => {
      p.style.opacity = 0; p.getBoundingClientRect();
      p.style.transition = 'opacity 500ms 900ms'; p.style.opacity = '';
    });
  }
  const hide = () => { guide.setAttribute('opacity', 0); dotG.innerHTML = ''; tip.classList.remove('on'); };
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    let best = 0, bd = Infinity;
    ts.forEach((t, i) => { const d = Math.abs(x(t) - px); if (d < bd) { bd = d; best = i; } });
    const gx = x(ts[best]);
    guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); guide.setAttribute('opacity', 0.6);
    dotG.innerHTML = '';
    const pts = cfg.stack
      ? (cfg.total ? [{ v: cfg.total.vals[best], c: 'var(--ink)' }] : [])
      : cfg.series.map(s => ({ v: s.vals[best], c: s.color }));
    for (const p of pts) add('circle', { cx: gx, cy: y(p.v), r: 4.5, fill: p.c, stroke: 'var(--bg)', 'stroke-width': 2 }, dotG);
    let html = `<div class="when">${fmtDate(cfg.dates[best])}</div>`;
    const rows = cfg.stack ? cfg.series.slice().reverse() : cfg.series;
    for (const s of rows) html += `<div class="row"><span><i class="swatch" style="background:${s.color}"></i>${esc(s.label)}</span><span>${amt(s.vals[best])}</span></div>`;
    for (const ng of (cfg.negs || (cfg.neg ? [cfg.neg] : []))) html += `<div class="row"><span><i class="swatch" style="background:${ng.color}"></i>${esc(ng.label)}</span><span>${amt(ng.vals[best])}</span></div>`;
    if (cfg.total) html += `<div class="row total"><span>${cfg.total.label}</span><span>${amt(cfg.total.vals[best])}</span></div>`;
    if (cfg.notes?.[best]) html += `<div style="margin-top:6px;color:var(--ink-2)">${esc(cfg.notes[best])}</div>`;
    tip.innerHTML = html;
    tip.classList.add('on');
    const scale = r.width / W;
    let left = gx * scale + 14;
    if (left + tip.offsetWidth > r.width) left = gx * scale - tip.offsetWidth - 14;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, (ev.clientY - r.top) - tip.offsetHeight / 2) + 'px';
  });
}

/* ---------- Overview ---------- */
function rangeFilter(tl) {
  if (ui.range === 'all') return tl;
  const cut = new Date(); cut.setMonth(cut.getMonth() - Number(ui.range));
  const iso = cut.toISOString();
  const idx = tl.findIndex(r => r.at >= iso);
  return idx <= 0 ? tl : tl.slice(Math.max(0, idx - 1));
}
function renderOverview() {
  const tl = timeline();
  const pick = r => ui.home === 'with' ? r.total : r.exHome;
  const now = tl.at(-1);
  const heroN = document.getElementById('hero-number');
  const lines = document.getElementById('hero-lines');
  document.getElementById('ov-body').hidden = !now;
  document.querySelector('.hero-controls').hidden = !now;
  if (!now) {
    heroN.textContent = '';
    lines.innerHTML = db.accounts.length
      ? '<div class="empty"><h2>Almost there</h2><p class="sub">Your accounts are set up. Give them today\'s figures and press save.</p><p><button class="btn" data-go="update">Add figures</button></p></div>'
      : '<div class="empty"><h2>Nothing tracked yet</h2><p class="sub">Add the first thing you want to keep an eye on, a pension, a savings account, the home, and give it today\'s figure.</p><p><button class="btn" data-go="update" data-add="1">Add your first account</button></p></div>';
    return;
  }
  heroN.innerHTML = unitHtml(nf().format(Math.round(pick(now))));
  const prev = tl.at(-2);
  const yearAgo = (() => { const c = new Date(now.at); c.setFullYear(c.getFullYear() - 1); const iso = c.toISOString(); let r = null; for (const x of tl) if (x.at <= iso) r = x; return r; })();
  const names = persons().map(p => esc(p.label));
  const who = [names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) + ' together' : '', ui.home === 'without' ? 'not counting the home' : ''].filter(Boolean).join(', ');
  let html = `<p>${who ? who[0].toUpperCase() + who.slice(1) + ', as' : 'As'} of ${fmtDay(now.at)}.</p>`;
  if (prev) html += `<p>${delta(pick(now) - pick(prev))} since the update before, on ${fmtDay(prev.at)}.</p>`;
  if (yearAgo) html += `<p>${delta(pick(now) - pick(yearAgo))} over the last twelve months.</p>`;
  // Main chart
  const view = rangeFilter(tl);
  if (db.settings.showGrowth) {
    const g = yearlyRate(pick(view[0]), pick(now), view[0].at, now.at);
    if (g != null) html += `<p>Growing <b>${pctFmt(g)}</b> a year ${ui.range === 'all' ? 'since you started' : 'over this period'}, savings included.</p>`;
  }
  lines.innerHTML = html;
  const dates = view.map(r => r.at);
  $('view-toggle').querySelector('[data-v="person"]').hidden = solo();
  if (solo() && ui.chart === 'person') { ui.chart = 'total'; $('view-toggle').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'total')); }
  const legend = document.getElementById('legend');
  const el = document.getElementById('main-chart');
  let cfg;
  if (ui.chart === 'total') {
    const vals = view.map(pick);
    const marks = [];
    for (let i = 1; i < vals.length; i++) {
      const k = Math.floor(vals[i] / 1e6);
      if (k > Math.floor(vals[i - 1] / 1e6) && !marks.some(mk => mk.k === k)) marks.push({ i, k, label: k + ' mn' });
    }
    cfg = { dates, series: [{ key: 'nw', label: 'Net worth', color: 'var(--ink)', vals }], area: true, endDot: true, weight: 2.5, height: 360, aria: 'Net worth over time', marks, animate: !ui.animated };
    ui.animated = true;
    legend.innerHTML = '';
  } else if (ui.chart === 'type') {
    const gs = GROUPS.filter(g => ui.home === 'with' || g.key !== 'home').filter(g => view.some(r => r.groups[g.key]));
    cfg = {
      dates, stack: true, height: 380, aria: 'Net worth by type over time',
      series: gs.map(g => ({ ...g, vals: view.map(r => r.groups[g.key]) })),
      neg: { ...DEBT, vals: view.map(r => r.groups.debt) },
      total: { label: 'Net worth', vals: view.map(pick) },
    };
    legend.innerHTML = gs.map(g => `<span><i class="swatch" style="background:${g.color}"></i>${g.label}</span>`).join('') +
      `<span><i class="swatch" style="background:var(--debt)"></i>Debts</span><span><i class="swatch" style="background:var(--ink);height:2px;vertical-align:4px"></i>Net worth</span>`;
  } else if (ui.chart === 'reach') {
    const goal = db.settings.goal?.amount || null;
    cfg = { dates, series: [{ key: 'reach', label: 'Within reach', color: 'var(--series-1)', vals: view.map(r => r.reach) }], area: true, endDot: true, weight: 2.5, height: 360, goal, zeroBase: !!goal, aria: 'Within reach over time' };
    legend.innerHTML = `<span><i class="swatch" style="background:var(--series-1)"></i>Within reach: cash, savings and investments</span>` +
      (goal ? `<span><i class="swatch" style="background:none;border-top:2px dashed var(--ink-2);border-radius:0;height:0;vertical-align:3px"></i>Goal</span>` : `<button class="link" data-go="settings">Set a goal</button>`);
  } else {
    const ex = (r, k) => r.people[k] - (ui.home === 'without' ? db.accounts.filter(a => a.type === 'property' && a.owner === k).reduce((s, a) => s + (r.acc[a.id] || 0), 0) : 0);
    cfg = {
      dates, height: 360, directLabels: true, endDot: true, zeroBase: true, aria: 'Net worth by person over time',
      series: PEOPLE.map(p => ({ ...p, vals: view.map(r => ex(r, p.key)) })),
    };
    legend.innerHTML = PEOPLE.map(p => `<span><i class="swatch" style="background:${p.color}"></i>${esc(p.label)}</span>`).join('');
  }
  cfg.notes = view.map(r => db.snapshots.find(s => s.at === r.at)?.note || '');
  renderChart(el, cfg);
  renderMainTable(cfg);

  // Estimates still waiting for a real figure
  const ests = db.accounts.filter(a => !a.archivedAt && isEstimate(a.id));
  const he = document.getElementById('hero-est');
  he.hidden = !ests.length;
  if (ests.length) he.innerHTML = `${estTag} ${ests.length === 1 ? 'One figure is' : ests.length + ' figures are'} still an estimate: ${ests.map(a => esc(a.name) + (solo() ? '' : ' (' + ownerOf(a.owner) + ')')).join(', ')}. <button class="link" data-go="history">Correct in History</button>`;

  renderGoal(tl);
  renderPay(tl, pick);
  renderOwed(view);
  renderAssets();
  renderStatePension();
  renderWaterfall(document.getElementById('waterfall'), view, pick);
  renderMonthly(document.getElementById('monthly'), tl, pick);

  // Breakdown bars
  const typeRows = GROUPS.filter(g => ui.home === 'with' || g.key !== 'home').map(g => ({ label: g.label, color: g.color, v: now.groups[g.key] }))
    .concat([{ label: 'Debts', color: 'var(--debt)', v: now.groups.debt }]).filter(r => Math.round(r.v));
  bars(document.getElementById('by-type'), typeRows);
  $('who-holds').hidden = solo();
  document.querySelector('.split').classList.toggle('one', solo());
  const personRows = PEOPLE.map(p => {
    let v = now.people[p.key];
    if (ui.home === 'without') v -= db.accounts.filter(a => a.type === 'property' && a.owner === p.key).reduce((s, a) => s + (now.acc[a.id] || 0), 0);
    return { label: esc(p.label), color: p.color, v };
  });
  bars(document.getElementById('by-person'), personRows);

  renderAccounts(tl);
}
function bars(el, rows) {
  const max = Math.max(...rows.map(r => Math.abs(r.v)), 1);
  const pos = rows.filter(r => r.v > 0).reduce((s, r) => s + r.v, 0);
  el.innerHTML = rows.map(r => `
    <div class="bar-row">
      <span class="label">${r.label}</span>
      <span class="track"><span class="fill ${r.v < 0 ? 'neg' : ''}" style="width:${Math.abs(r.v) / max * 100}%;background:${r.v < 0 ? '' : r.color}"></span></span>
      <span class="val">${r.v < 0 ? '−' : ''}${compact(Math.abs(r.v))}${r.v > 0 ? `<span class="pct">${Math.round(r.v / pos * 100)}%</span>` : ''}</span>
    </div>`).join('');
}
function renderMainTable(cfg) {
  const box = document.getElementById('main-table');
  const chart = document.getElementById('main-chart');
  box.hidden = !ui.table; chart.hidden = ui.table;
  document.getElementById('table-toggle').textContent = ui.table ? 'Show as chart' : 'Show as table';
  if (!ui.table) return;
  const cols = cfg.series.concat(cfg.negs || (cfg.neg ? [cfg.neg] : [])).concat(cfg.total ? [cfg.total] : []);
  let h = '<div class="table-scroll"><table class="data"><thead><tr><th>Date</th>' + cols.map(c => `<th>${esc(c.label)}</th>`).join('') + '</tr></thead><tbody>';
  for (let i = cfg.dates.length - 1; i >= 0; i--) h += `<tr><td>${fmtDate(cfg.dates[i])}</td>` + cols.map(c => `<td>${amt(c.vals[i])}</td>`).join('') + '</tr>';
  box.innerHTML = h + '</tbody></table></div>';
}

function renderAccounts(tl) {
  const list = document.getElementById('acc-list');
  const archivedCount = db.accounts.filter(a => a.archivedAt).length;
  const sa = document.getElementById('show-archived');
  sa.hidden = !archivedCount;
  sa.textContent = ui.showArchived ? 'Hide archived' : `Show ${archivedCount} archived`;
  const accs = db.accounts.filter(a => ui.showArchived || !a.archivedAt);
  const order = Object.keys(TYPES);
  const byType = {};
  for (const a of accs) (byType[a.type] ||= []).push(a);
  let h = '';
  const now = Date.now();
  for (const t of order) {
    if (!byType[t]) continue;
    const sum = byType[t].filter(a => !a.archivedAt).reduce((s, a) => s + (tl.at(-1)?.acc[a.id] || 0), 0);
    h += `<div class="group-title"><span>${pluralType(t)}</span><span>${inTotals({ type: t }) ? amt(sum) : 'Not counted in totals'}</span></div>`;
    for (const a of byType[t]) {
      const lv = lastValue(a.id);
      const prev = lv ? lastValue(a.id, lv.i) : null;
      let valTxt = '<span class="muted">No figure yet</span>', chg = '', when = '';
      if (lv) {
        if (a.type === 'property') {
          valTxt = money(lv.v.worth - lv.v.owed, a.currency);
          if (prev) chg = delta((lv.v.worth - lv.v.owed) - (prev.v.worth - prev.v.owed), v => money(v, a.currency));
        } else {
          valTxt = money(lv.v, a.currency);
          if (prev) chg = isDebt(a.type) ? debtDelta(prev.v, lv.v, v => money(v, a.currency)) : delta(lv.v - prev.v, v => money(v, a.currency));
        }
        const days = (now - new Date(lv.at)) / 864e5;
        when = `<span class="when ${days > 90 && !a.archivedAt ? 'stale' : ''}">${a.archivedAt ? 'Archived ' + fmtDate(a.archivedAt) : (days > 90 ? 'Not updated since ' : 'Updated ') + fmtDate(lv.at)}</span>`;
      }
      const open = ui.openAcc === a.id;
      h += `<button class="acc-row ${a.archivedAt ? 'archived' : ''}" data-acc="${a.id}" aria-expanded="${open}">
        <span><span class="name">${esc(a.name)}</span><span class="prov">${esc(a.provider || '')}</span></span>
        <span class="owner">${ownerOf(a.owner)}</span>
        <span class="spark">${spark(a)}</span>
        <span class="num">${isDebt(a.type) && lv ? '−' : ''}${valTxt}${isEstimate(a.id) ? estTag : ''}</span>
        <span class="num chgcol">${chg}</span>
        ${when || '<span></span>'}
      </button>`;
      if (open) h += `<div class="acc-detail" id="acc-detail"></div>`;
    }
  }
  list.innerHTML = h;
  if (ui.openAcc) renderAccDetail(accById(ui.openAcc));
}
function spark(a) {
  const vals = [];
  db.snapshots.forEach(s => { const v = s.values[a.id]; if (v !== undefined) vals.push(a.type === 'property' ? v.worth - v.owed : v); });
  if (vals.length < 2) return '';
  const W = 96, H = 26, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [i / (vals.length - 1) * (W - 6) + 1, H - 3 - (v - lo) / span * (H - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const e = pts.at(-1);
  return `<svg width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${e[0]}" cy="${e[1]}" r="2.5" fill="var(--ink)"/></svg>`;
}

/* ---------- Growth and goal ---------- */
// Yearly rate between two figures, only when there is enough history to mean anything
function yearlyRate(from, to, fromIso, toIso) {
  const years = (new Date(toIso) - new Date(fromIso)) / (365.25 * 864e5);
  if (years < 0.25 || from <= 0 || to <= 0) return null;
  return Math.pow(to / from, 1 / years) - 1;
}
const pctFmt = g => (g >= 0 ? '' : '−') + Math.abs(g * 100).toLocaleString(loc(), { maximumFractionDigits: 1 }) + '%';

function renderGoal(tl) {
  const box = document.getElementById('goal-block');
  const goal = db.settings.goal?.amount;
  box.hidden = !goal;
  if (!goal) return;
  const now = tl.at(-1), reach = now.reach;
  const pct = Math.max(0, Math.min(1, reach / goal));
  const left = goal - reach;
  let pace = '';
  const counted = db.accounts.some(a => !a.archivedAt && REACH.includes(TYPES[a.type].group));
  if (!counted) {
    pace = 'Nothing counts towards this yet. Add your cash, savings and investments on Update and the bar will start to fill.';
  } else if (left <= 0) {
    const hit = tl.find(r => r.reach >= goal);
    pace = `Reached on ${fmtDate(hit.at)}. Time for a new one?`;
  } else {
    const c = new Date(now.at); c.setFullYear(c.getFullYear() - 1);
    let then = tl[0];
    for (const r of tl) if (r.at <= c.toISOString()) then = r;
    const months = (new Date(now.at) - new Date(then.at)) / (30.44 * 864e5);
    const perMonth = months >= 2 ? (reach - then.reach) / months : null;
    if (perMonth > 0 && left / perMonth > 50 * 12) {
      pace = `At the pace of the last ${months >= 11.5 ? 'twelve months' : Math.round(months) + ' months'}, ${delta(perMonth)} a month, this is more than fifty years away. Once your investments are in, the pace will be clearer.`;
    } else if (perMonth > 0) {
      const when = new Date(now.at); when.setMonth(when.getMonth() + Math.ceil(left / perMonth));
      pace = `At the pace of the last ${months >= 11.5 ? 'twelve months' : Math.round(months) + ' months'}, ${delta(perMonth)} a month, you would get there around <b>${when.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>.`;
    } else if (perMonth != null) {
      pace = 'Within reach has not grown over the last twelve months, so there is no pace to project yet.';
    } else {
      pace = 'A couple of months of updates and this will show when you might get there.';
    }
  }
  box.innerHTML = `
    <div class="goal-top"><h2>Goal: ${compactMoney(goal)} within reach</h2><button class="link" data-go="settings">Change</button></div>
    <div class="goal-track" role="img" aria-label="${Math.round(pct * 100)} percent of the goal"><div class="goal-fill" style="width:${pct * 100}%"></div></div>
    <div class="goal-ticks"><span>${amt(reach)} within reach, ${Math.round(pct * 100)}%</span><span>${left > 0 ? amt(left) + ' to go' : 'Goal reached'}</span></div>
    <p class="goal-lines">${pace}</p>`;
}

/* ---------- Against your pay ---------- */
function renderPay(tl, pick) {
  const p = db.settings.pay;
  const monthly = persons().reduce((s, x) => s + (p[x.key] || 0), 0);
  const box = document.getElementById('pay-block');
  box.hidden = !monthly;
  if (!monthly) return;
  const now = tl.at(-1);
  const c = new Date(now.at); c.setFullYear(c.getFullYear() - 1);
  let then = tl[0];
  for (const r of tl) if (r.at <= c.toISOString()) then = r;
  const months = (new Date(now.at) - new Date(then.at)) / (30.44 * 864e5);
  const perMonth = months >= 2 ? (pick(now) - pick(then)) / months : null;
  const est = Object.keys(p.est).filter(k => p.est[k] && p[k] && OWNERS[k]).map(k => esc(OWNERS[k]));
  const big = (n, unit) => `<div class="n">${n}<span class="unit">${unit}</span></div>`;
  document.getElementById('pay-sub').innerHTML = `${solo() ? 'Take-home pay' : 'Household take-home pay'} of ${amt(monthly)} a month${est.length ? ` (${est.join(' and ')}: estimated, <button class="link" data-go="settings">set in Settings</button>)` : ''}.`;
  const stats = [];
  if (perMonth != null) stats.push(`<div class="stat">${big(Math.round(perMonth / monthly * 100), '%')}<div class="l">Kept: net worth grew ${amt(perMonth)} a month<br>over the last ${months >= 11.5 ? 'twelve months' : Math.round(months) + ' months'}</div></div>`);
  stats.push(`<div class="stat">${big((pick(now) / (monthly * 12)).toLocaleString(loc(), { maximumFractionDigits: 1 }), 'years')}<div class="l">Net worth in years<br>of take-home pay</div></div>`);
  stats.push(`<div class="stat">${big((now.reach / monthly).toLocaleString(loc(), { maximumFractionDigits: 1 }), 'months')}<div class="l">Buffer: within reach<br>in months of pay</div></div>`);
  document.getElementById('pay-stats').innerHTML = stats.join('');
  document.getElementById('pay-note').textContent = perMonth != null
    ? 'Kept includes changes in value, like the home and the markets, so it is not quite a savings rate. It can go above 100% in a good year or below zero in a bad one.'
    : '';
}

/* ---------- Owned and owed ---------- */
function renderOwed(view) {
  const keep = a => ui.home === 'with' || a.type !== 'property';
  const owned = view.map(r => Object.entries(r.parts).reduce((s, [id, p]) => s + (keep(accById(id)) ? p.own : 0), 0));
  // One band per debt, largest first; the mortgage is the flat's "still owed"
  const debts = db.accounts.filter(a => (isDebt(a.type) || a.type === 'property') && keep(a) && inTotals(a));
  const twin = a => !solo() && debts.some(o => o !== a && o.name === a.name);   // two "Student loan"s: add whose
  const bands = debts.map(a => ({ label: a.type === 'property' ? 'Mortgage' : twin(a) ? `${a.name}, ${OWNERS[a.owner]}` : a.name, vals: view.map(r => -(r.parts[a.id]?.owe || 0)) }))
    .filter(b => b.vals.some(v => v))
    .sort((x, y) => Math.min(...x.vals) - Math.min(...y.vals));
  const owes = ['var(--series-4)', 'color-mix(in srgb, var(--series-4) 55%, var(--bg))', 'color-mix(in srgb, var(--series-4) 30%, var(--bg))'];
  bands.forEach((b, i) => b.color = owes[Math.min(i, owes.length - 1)]);
  const owedTot = view.map((_, i) => bands.reduce((s, b) => s - b.vals[i], 0));
  const net = view.map((_, i) => owned[i] - owedTot[i]);
  const n = view.length - 1;
  const ratio = i => owned[i] ? owedTot[i] / owned[i] * 100 : 0;
  const big = v => CURRENCIES[base()].after
    ? compact(v).replace(/ (mn|k)$/, `<span class="unit">$1 ${esc(symOf(base()))}</span>`)
    : `<span class="unit pre">${esc(symOf(base()))}</span>` + compact(v).replace(/ (mn|k)$/, '<span class="unit">$1</span>');
  document.getElementById('owe-stats').innerHTML = `
    <div class="stat"><div class="n">${big(owned[n])}</div><div class="l">Owned</div></div>
    <div class="stat"><div class="n">${big(owedTot[n])}</div><div class="l">Owed</div></div>
    <div class="stat"><div class="n">${unitHtml(Math.round(ratio(n)))}</div><div class="l">Owed for every ${amt(100)} owned${n ? `, ${amt(ratio(0))} on ${fmtDate(view[0].at)}` : ''}</div></div>`;
  document.getElementById('owe-legend').innerHTML =
    `<span><i class="swatch" style="background:color-mix(in srgb, var(--series-1) 45%, var(--bg))"></i>Owned</span>` +
    bands.map(b => `<span><i class="swatch" style="background:${b.color}"></i>${esc(b.label)}</span>`).join('') +
    `<span><i class="swatch" style="background:var(--ink);height:2px;vertical-align:4px"></i>Net worth</span>`;
  renderChart(document.getElementById('owe-chart'), {
    dates: view.map(r => r.at), stack: true, height: 340, aria: 'Owned and owed over time', ownedFill: true,
    series: [{ label: 'Owned', color: 'color-mix(in srgb, var(--series-1) 45%, var(--bg))', vals: owned }],
    negs: bands,
    total: { label: 'Net worth', vals: net },
  });
}

/* ---------- UK State Pension (an entitlement, not counted in net worth) ---------- */
function renderStatePension() {
  const sp = db.settings.ukState;
  const box = document.getElementById('ent-block');
  box.hidden = !sp.on;
  if (!sp.on) return;
  $('ent-sub').textContent = `An income ${solo() ? 'you' : OWNERS[spWho()]} will be paid, not money held, so it is not counted in net worth. Amounts are in today's money.`;
  const years = Math.max(0, Math.min(35, Math.round(sp.years || 0)));
  const perYear = sp.rate / 35;                                  // each qualifying year is 1/35 of the full rate
  const weekly = sp.forecast || (years >= 10 ? perYear * years : 0);
  const gbp = base() === 'GBP' ? 1 : lastFx('GBP');
  const yearly = v => `£${nf('GBP').format(Math.round(v * 52))} a year${gbp && base() !== 'GBP' ? `, about ${amt(v * 52 * gbp)}` : ''}`;
  const cells = Array.from({ length: 35 }, (_, i) => `<i class="${i < years ? 'on' : i === years ? 'next' : ''} ${i === 9 ? 'need' : ''}" title="Year ${i + 1}"></i>`).join('');
  const axis = Array.from({ length: 35 }, (_, i) => `<span>${i === 0 ? '1' : i === 9 ? '10 to qualify' : i === 34 ? '35' : ''}</span>`).join('');
  let lines = '';
  if (years < 10) {
    const left = 10 - years;
    lines += `<p>${left === 1 ? 'One more qualifying year' : left + ' more qualifying years'} and it starts to pay. At 10 years: <b>£${(perYear * 10).toFixed(2)} a week</b>, ${yearly(perYear * 10)}.</p>`;
  } else {
    lines += `<p>It pays <b>£${weekly.toFixed(2)} a week</b>, ${yearly(weekly)}${sp.forecast ? ', from your gov.uk forecast' : ''}.</p>`;
  }
  lines += `<p>Each further year adds about £${nf('GBP').format(Math.round(perYear * 52))} a year. The full amount at 35 years is £${sp.rate.toFixed(2)} a week.</p>`;
  lines += `<p>Paid from age ${sp.age}${sp.born ? `, from ${Number(sp.born) + Number(sp.age)}` : ''}.</p>`;
  document.getElementById('ent').innerHTML = `
    <div class="ent-top"><span class="n">${years} of 35 years</span><span class="muted">${years >= 10 ? 'Qualifies' : 'Not yet qualifying'}</span></div>
    <div class="years" role="img" aria-label="${years} of 35 qualifying years">${cells}</div>
    <div class="years-axis" aria-hidden="true">${axis}</div>
    <div class="ent-lines">${lines}</div>`;
}

/* ---------- Asset values ---------- */
// Things that hold value: the home, vehicles, other assets. Gain or loss on value alone.
function renderAssets() {
  const list = db.accounts.filter(a => !a.archivedAt && ['property', 'vehicle', 'other'].includes(a.type));
  const rows = list.map(a => {
    const pts = [];
    db.snapshots.forEach(s => { const v = s.values[a.id]; if (v !== undefined) pts.push({ at: s.at, v: a.type === 'property' ? v.worth : v }); });
    // Only points where the value itself changed, plus the latest, so the line shows valuations
    const keep = pts.filter((p, i) => i === 0 || i === pts.length - 1 || p.v !== pts[i - 1].v);
    return { a, pts: keep, first: pts[0], last: pts.at(-1) };
  }).filter(r => r.first);
  const box = document.getElementById('assets-block');
  box.hidden = !rows.length;
  if (!rows.length) return;
  const el = document.getElementById('assets');
  el.innerHTML = rows.map((r, i) => {
    const gain = r.last.v - r.first.v, pct = r.first.v ? gain / r.first.v : 0;
    const g = yearlyRate(r.first.v, r.last.v, r.first.at, r.last.at);
    const f = v => money(v, r.a.currency);
    const sign = gain > 0 ? '+' : gain < 0 ? '−' : '';
    return `<div class="asset">
      <div>
        <div class="a-name">${esc(r.a.name)}<span>${esc(r.a.provider || '')}</span></div>
        <div class="a-gain ${gain < 0 ? 'loss' : ''}">${gain ? unitHtml(nf(r.a.currency).format(Math.round(Math.abs(gain))), r.a.currency, sign) : 'No change'}</div>
        <div class="a-lines">
          <p>${f(r.first.v)} on ${fmtDate(r.first.at)}, now ${f(r.last.v)}.</p>
          ${gain ? `<p>${sign}${pctFmt(Math.abs(pct)).replace('−', '')} in total${g != null ? `, ${pctFmt(g)} a year` : ''}.</p>` : ''}
        </div>
      </div>
      <div class="chart" id="asset-chart-${i}"></div>
    </div>`;
  }).join('');
  rows.forEach((r, i) => {
    if (r.pts.length < 2) return;
    renderChart(document.getElementById('asset-chart-' + i), {
      dates: r.pts.map(p => p.at), height: 150, endDot: true, area: true, weight: 2, aria: r.a.name + ' value over time',
      series: [{ label: 'Value', color: r.a.type === 'property' ? 'var(--series-4)' : 'var(--series-5)', vals: r.pts.map(p => p.v) }],
    });
  });
}

/* ---------- What moved it (bridge chart) ---------- */
function renderWaterfall(el, view, pick) {
  el.innerHTML = '';
  const sub = document.getElementById('wf-sub');
  if (view.length < 2) { sub.textContent = 'Needs at least two snapshots.'; return; }
  const a = view[0], b = view.at(-1);
  const start = pick(a), end = pick(b);
  sub.innerHTML = `From ${fmtDate(a.at)} to ${fmtDate(b.at)}, ${delta(end - start)}. Each bar is how much one part added or took away.`;
  const groups = GROUPS.filter(g => ui.home === 'with' || g.key !== 'home').concat([DEBT]);
  const props = db.accounts.filter(x => x.type === 'property');
  const sumPart = (r, k) => props.reduce((s, x) => s + (r.parts[x.id]?.[k] || 0), 0);
  const steps = groups.flatMap(g => g.key !== 'home'
      ? [{ label: g.key === 'debt' ? 'Debts' : g.label, color: g.color, d: b.groups[g.key] - a.groups[g.key], key: g.key }]
      // The home moves for two reasons: its value, and paying down the mortgage
      : [{ label: 'Home value', color: g.color, d: sumPart(b, 'own') - sumPart(a, 'own'), key: 'homeval' },
         { label: 'Mortgage paid off', color: 'color-mix(in srgb, var(--series-4) 55%, var(--bg))', d: sumPart(a, 'owe') - sumPart(b, 'owe'), key: 'mortgage' }])
    .filter(st => Math.round(st.d / 100) !== 0);
  let run = start;
  const cols = [{ kind: 'end', label: fmtDate(a.at), v: start }];
  for (const st of steps) { cols.push({ kind: 'step', ...st, from: run, to: run + st.d }); run += st.d; }
  cols.push({ kind: 'end', label: 'Now', v: end });
  const levels = cols.flatMap(c => c.kind === 'end' ? [c.v] : [c.from, c.to]);
  let lo = Math.min(...levels), hi = Math.max(...levels);
  const pad = (hi - lo) * 0.18 || hi * 0.02;
  const ticks = niceTicks(lo - pad, hi + pad, 4);
  const W = Math.max(320, el.clientWidth), H = 300, m = { t: 24, r: 16, b: 40, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const y = v => m.t + ih - (v - ticks[0]) / (ticks.at(-1) - ticks[0]) * ih;
  const colW = iw / cols.length, bw = Math.min(72, colW * 0.56);
  const cx = i => m.l + colW * (i + 0.5);
  let h = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="What changed net worth, part by part"><g class="grid">`;
  for (const t of ticks) h += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(t)}" y2="${y(t)}"/>`;
  h += '</g><g class="axis">';
  for (const t of ticks) h += `<text x="${m.l - 10}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  cols.forEach((c, i) => { h += `<text x="${cx(i)}" y="${H - 14}" text-anchor="middle">${esc(c.label)}</text>`; });
  h += '</g>';
  cols.forEach((c, i) => {
    const level = c.kind === 'end' ? c.v : c.to;
    if (i < cols.length - 1) {
      h += `<line x1="${cx(i) + bw / 2}" x2="${cx(i + 1) - bw / 2}" y1="${y(level)}" y2="${y(level)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
    }
    if (c.kind === 'end') {
      h += `<line x1="${cx(i) - bw / 2}" x2="${cx(i) + bw / 2}" y1="${y(c.v)}" y2="${y(c.v)}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>`;
      h += `<text x="${cx(i)}" y="${y(c.v) - 10}" text-anchor="middle" fill="var(--ink)" font-size="13" font-weight="600">${compact(c.v)}</text>`;
    } else {
      const top = y(Math.max(c.from, c.to)), bot = y(Math.min(c.from, c.to));
      const up = c.d > 0;
      h += `<rect data-i="${i}" x="${cx(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" rx="3" fill="${c.color}"/>`;
      h += `<text x="${cx(i)}" y="${up ? top - 8 : bot + 16}" text-anchor="middle" fill="var(--ink-2)" font-size="12">${up ? '+' : '−'}${compact(Math.abs(c.d))}</text>`;
    }
  });
  el.innerHTML = h + '</svg><div class="tip"></div>';
  const tip = el.querySelector('.tip'), svg = el.querySelector('svg');
  el.querySelectorAll('rect[data-i]').forEach(r => {
    r.addEventListener('mouseenter', () => {
      const c = cols[r.dataset.i];
      const why = c.key === 'debt' ? (c.d > 0 ? 'Paid off' : 'Borrowed') : c.key === 'mortgage' ? (c.d > 0 ? 'Paid off' : 'Borrowed more') : c.key === 'homeval' ? (c.d > 0 ? 'Rose in value' : 'Fell in value') : '';
      tip.innerHTML = `<div class="when">${esc(c.label)}</div><div class="row"><span>${why || 'Change'}</span><span>${delta(c.d)}</span></div>`;
      const s = svg.getBoundingClientRect().width / W;
      tip.style.left = Math.min((cx(+r.dataset.i) + bw / 2 + 8) * s, svg.getBoundingClientRect().width - 200) + 'px';
      tip.style.top = (Number(r.getAttribute('y')) * s) + 'px';
      tip.classList.add('on');
    });
    r.addEventListener('mouseleave', () => tip.classList.remove('on'));
  });
}

/* ---------- Month by month ---------- */
function renderMonthly(el, tl, pick) {
  el.innerHTML = '';
  const sub = document.getElementById('mm-sub');
  if (tl.length < 2) { sub.textContent = 'Needs at least two months of snapshots.'; return; }
  // Net worth at the end of each calendar month, carrying the last figure forward
  const months = [];
  let d = new Date(new Date(tl[0].at).getFullYear(), new Date(tl[0].at).getMonth(), 1);
  const last = new Date(tl.at(-1).at);
  let i = 0, cur = null;
  while (d <= last) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    while (i < tl.length && new Date(tl[i].at) < next) cur = tl[i++];
    months.push({ m: new Date(d), v: cur ? pick(cur) : null });
    d = next;
  }
  let rows = months.slice(1).map((mo, k) => ({ m: mo.m, v: mo.v, d: mo.v - months[k].v }));
  if (ui.range !== 'all') { const cut = new Date(); cut.setMonth(cut.getMonth() - Number(ui.range)); rows = rows.filter(r => r.m >= new Date(cut.getFullYear(), cut.getMonth(), 1)); }
  if (!rows.length) return;
  const avg = rows.reduce((s, r) => s + r.d, 0) / rows.length;
  const ups = rows.filter(r => r.d > 0).length;
  sub.innerHTML = `On average ${delta(avg)} a month. Up in ${ups} of ${rows.length} months.`;
  const W = Math.max(320, el.clientWidth), H = 220, m = { t: 22, r: 16, b: 28, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const ticks = niceTicks(Math.min(0, ...rows.map(r => r.d)), Math.max(0, ...rows.map(r => r.d)), 4);
  const y = v => m.t + ih - (v - ticks[0]) / (ticks.at(-1) - ticks[0]) * ih;
  const cw = iw / rows.length, bw = Math.max(4, Math.min(26, cw - 4));
  const cx = k => m.l + cw * (k + 0.5);
  const maxI = rows.reduce((b, r, k) => r.d > rows[b].d ? k : b, 0);
  const minI = rows.reduce((b, r, k) => r.d < rows[b].d ? k : b, 0);
  let h = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Change in net worth each month"><g class="grid">`;
  for (const t of ticks) h += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'zero' : ''}"/>`;
  h += '</g><g class="axis">';
  for (const t of ticks) h += `<text x="${m.l - 10}" y="${y(t) + 4}" text-anchor="end">${t === 0 ? '0' : compact(t)}</text>`;
  const every = Math.max(1, Math.ceil(rows.length / Math.floor(iw / 60)));
  rows.forEach((r, k) => { if (k % every === 0) h += `<text x="${cx(k)}" y="${H - 6}" text-anchor="middle">${r.m.getMonth() === 0 ? r.m.getFullYear() : r.m.toLocaleDateString('en-GB', { month: 'short' })}</text>`; });
  h += '</g>';
  rows.forEach((r, k) => {
    const top = y(Math.max(0, r.d)), bot = y(Math.min(0, r.d));
    const ht = Math.max(1, bot - top);
    // Round only the end away from the zero line
    const x0 = cx(k) - bw / 2, rr = Math.min(4, ht / 2, bw / 2);
    const path = r.d >= 0
      ? `M${x0},${bot} V${top + rr} Q${x0},${top} ${x0 + rr},${top} H${x0 + bw - rr} Q${x0 + bw},${top} ${x0 + bw},${top + rr} V${bot} Z`
      : `M${x0},${top} V${bot - rr} Q${x0},${bot} ${x0 + rr},${bot} H${x0 + bw - rr} Q${x0 + bw},${bot} ${x0 + bw},${bot - rr} V${top} Z`;
    h += `<path d="${path}" fill="${r.d >= 0 ? 'var(--series-1)' : 'var(--fall)'}"/>`;
    if (k === maxI || k === minI) h += `<text x="${cx(k)}" y="${r.d >= 0 ? top - 7 : bot + 15}" text-anchor="middle" fill="var(--ink-2)" font-size="12">${r.d >= 0 ? '+' : '−'}${compact(Math.abs(r.d))}</text>`;
    h += `<rect data-k="${k}" x="${m.l + cw * k}" y="${m.t}" width="${cw}" height="${ih}" fill="transparent"/>`;
  });
  h += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--ink-2)" stroke-dasharray="4 4"/>`;
  el.innerHTML = h + '</svg><div class="tip"></div>';
  const tip = el.querySelector('.tip'), svg = el.querySelector('svg');
  el.querySelectorAll('rect[data-k]').forEach(rc => {
    rc.addEventListener('mouseenter', () => {
      const r = rows[rc.dataset.k];
      tip.innerHTML = `<div class="when">${r.m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div><div class="row"><span>Change</span><span>${delta(r.d)}</span></div><div class="row"><span>Net worth at month end</span><span>${amt(r.v)}</span></div>`;
      const s = svg.getBoundingClientRect().width / W;
      let left = (cx(+rc.dataset.k) + 16) * s;
      if (left + 240 > svg.getBoundingClientRect().width) left = (cx(+rc.dataset.k) - 16) * s - 240;
      tip.style.left = left + 'px'; tip.style.top = '0px';
      tip.classList.add('on');
    });
    rc.addEventListener('mouseleave', () => tip.classList.remove('on'));
  });
}

function pluralType(t) {
  return { cash: 'Cash', savings: 'Savings', investments: 'Investments', pension: 'Pensions', property: 'Property', vehicle: 'Vehicles', other: 'Other assets', loan: 'Loans', student: 'Student loans', debt: 'Other debts' }[t];
}
function renderAccDetail(a) {
  const box = document.getElementById('acc-detail');
  const pts = [];
  db.snapshots.forEach(s => { if (s.values[a.id] !== undefined) pts.push({ at: s.at, v: s.values[a.id] }); });
  const first = pts[0], last = pts.at(-1);
  let facts = '';
  if (first && last && a.type !== 'property') {
    const f = v => money(v, a.currency);
    facts = `<div class="facts"><span>First figure <b>${f(first.v)}</b> on ${fmtDate(first.at)}</span><span>Change since then ${isDebt(a.type) ? debtDelta(first.v, last.v, f) : delta(last.v - first.v, f)}</span>${(() => { if (!db.settings.showGrowth || isDebt(a.type)) return ''; const g = yearlyRate(first.v, last.v, first.at, last.at); return g == null ? '' : `<span>Growing <b>${pctFmt(g)}</b> a year</span>`; })()}<span><b>${pts.length}</b> figures recorded</span>${a.currency !== base() ? `<span>Shown in ${a.currency}, counted in ${base()} at each day's rate</span>` : ''}</div>`;
  } else if (first && last) {
    const f = v => money(v, a.currency);
    facts = `<div class="facts"><span>Worth <b>${f(last.v.worth)}</b></span><span>Owed <b>${f(last.v.owed)}</b></span><span>Equity <b>${f(last.v.worth - last.v.owed)}</b></span><span>Paid down since ${fmtDate(first.at)} <b>${f(first.v.owed - last.v.owed)}</b></span></div>`;
  }
  box.innerHTML = facts + '<div class="chart" id="acc-chart"></div><div class="actions"></div>';
  const chartEl = box.querySelector('#acc-chart');
  if (pts.length > 1) {
    const series = a.type === 'property'
      ? [{ label: 'Worth', color: 'var(--series-4)', vals: pts.map(p => p.v.worth) }, { label: 'Owed', color: 'var(--debt)', vals: pts.map(p => p.v.owed) }]
      : [{ label: a.name, color: 'var(--ink)', vals: pts.map(p => p.v) }];
    renderChart(chartEl, { dates: pts.map(p => p.at), series, height: 180, endDot: true, directLabels: a.type === 'property', zeroBase: a.type === 'property', aria: a.name + ' over time' });
    if (a.currency !== base()) chartEl.querySelectorAll('.axis text').forEach(t => { if (/\d/.test(t.textContent) && t.getAttribute('text-anchor') === 'end') t.textContent = CURRENCIES[a.currency].after ? t.textContent + ' ' + symOf(a.currency) : symOf(a.currency) + t.textContent; });
  }
  const act = box.querySelector('.actions');
  if (a.archivedAt) {
    act.innerHTML = `<button class="btn quiet small" data-unarchive="${a.id}">Bring back</button>`;
  } else {
    act.innerHTML = `<button class="btn quiet small" data-rename="${a.id}">Rename</button><button class="btn quiet small" data-archive="${a.id}">Archive, it's closed</button>`;
  }
}

/* ---------- Update ---------- */
function renderUpdate() {
  const ao = document.getElementById('asof');
  ao.max = new Date().toISOString().slice(0, 10);
  ao.value = ui.asOf || new Date().toISOString().slice(0, 10);
  renderRates();
  for (const c of foreign()) if (!ui.fetched[fxKey(c)]) fetchRate(c).then(r => { if (r && ui.view === 'update') { showRates(); refreshSavebar(); } });
  const list = document.getElementById('u-list');
  const accs = db.accounts.filter(a => !a.archivedAt);
  if (!accs.length) {
    list.innerHTML = '<div class="empty"><h2>Nothing to update yet</h2><p class="sub">Add the first thing you want to track below.</p></div>';
    return;
  }
  const byType = {};
  for (const a of accs) (byType[a.type] ||= []).push(a);
  let h = '';
  for (const t of Object.keys(TYPES)) {
    if (!byType[t]) continue;
    h += `<div class="u-group"><h3>${pluralType(t)}</h3>`;
    for (const a of byType[t]) {
      const lv = lastValue(a.id, refIndex());
      const sym = esc(symOf(a.currency));
      const ph = v => v == null ? 'No figure yet' : nf(a.currency).format(v);
      let inputs;
      if (a.type === 'property') {
        const d = draft[a.id] || {};
        inputs = `<div class="money"><span class="cap">Worth</span><input data-acc="${a.id}" data-part="worth" inputmode="decimal" placeholder="${ph(lv?.v.worth)}" value="${esc(d.worth || '')}" aria-label="${esc(a.name)} worth"><span class="cur">${sym}</span></div>
                  <div class="money"><span class="cap">Still owed</span><input data-acc="${a.id}" data-part="owed" inputmode="decimal" placeholder="${ph(lv?.v.owed)}" value="${esc(d.owed || '')}" aria-label="${esc(a.name)} still owed"><span class="cur">${sym}</span></div>`;
      } else {
        inputs = `<div class="money"><input data-acc="${a.id}" inputmode="decimal" placeholder="${ph(lv?.v)}" value="${esc(draft[a.id] || '')}" aria-label="${esc(a.name)}${isDebt(a.type) ? ' still owed' : ''}"><span class="cur">${sym}</span></div>`;
      }
      h += `<div class="u-row" data-row="${a.id}">
        <div><span class="name">${esc(a.name)}</span><span class="prov">${esc(a.provider || '')}${isDebt(a.type) ? ', amount still owed' : ''}</span></div>
        <span class="owner">${ownerOf(a.owner)}</span>
        <div class="inputs">${inputs}</div>
        <div class="chg" data-chg="${a.id}"></div>
      </div>`;
    }
    h += '</div>';
  }
  list.innerHTML = h;
  accs.forEach(a => refreshRow(a.id));
  refreshSavebar();
}
function draftValue(a) {
  const d = draft[a.id];
  if (d == null) return null;
  if (a.type === 'property') {
    const lv = lastValue(a.id, refIndex())?.v || {};
    const w = parseMoney(d.worth), o = parseMoney(d.owed);
    if (w === null && o === null) return null;
    if (Number.isNaN(w) || Number.isNaN(o)) return NaN;
    return { worth: w ?? lv.worth ?? 0, owed: o ?? lv.owed ?? 0 };
  }
  return parseMoney(d);
}
function refreshRow(id) {
  const a = accById(id);
  const row = document.querySelector(`[data-row="${id}"]`);
  if (!row) return;
  const v = draftValue(a);
  const chg = row.querySelector('.chg');
  row.querySelectorAll('.money').forEach(m => m.classList.remove('bad'));
  if (v === null) { row.classList.remove('changed'); chg.innerHTML = ''; return; }
  if (Number.isNaN(v) || (a.type === 'property' && Number.isNaN(v))) {
    row.classList.remove('changed');
    row.querySelectorAll('.money').forEach(m => { if (Number.isNaN(parseMoney(m.querySelector('input').value))) m.classList.add('bad'); });
    chg.innerHTML = '<span style="color:var(--down)">Not a number</span>';
    return;
  }
  row.classList.add('changed');
  const lv = lastValue(id, refIndex());
  const fmt = x => money(x, a.currency);
  let est = `<label class="est"><input type="checkbox" data-est="${id}" ${draftEst[id] ? 'checked' : ''}> Estimate</label>`;
  if (SPREADABLE.includes(a.type) && lv && assetVal(a, v) !== assetVal(a, lv.v)) {
    const k = plateauStart(a, refIndex());
    if (k != null && k < lv.i) est += `<br><label class="est"><input type="checkbox" data-spread="${id}" ${draftSpread[id] ? 'checked' : ''}> Spread since ${fmtDate(db.snapshots[k].at)}</label>`;
  }
  if (!lv) { chg.innerHTML = '<span class="muted">First figure</span><br>' + est; return; }
  if (a.type === 'property') chg.innerHTML = delta((v.worth - v.owed) - (lv.v.worth - lv.v.owed), fmt) + '<span class="was">equity</span>' + est;
  else chg.innerHTML = (isDebt(a.type) ? debtDelta(lv.v, v, fmt) : delta(v - lv.v, fmt)) + `<span class="was">was ${fmt(lv.v)}</span>` + est;
}
function pendingChanges() {
  const out = {};
  for (const a of db.accounts) {
    if (a.archivedAt) continue;
    const v = draftValue(a);
    if (v === null) continue;
    if (Number.isNaN(v)) return { error: a };
    out[a.id] = v;
  }
  return { values: out };
}
function refreshSavebar() {
  const bar = document.getElementById('savebar');
  const p = pendingChanges();
  const n = p.values ? Object.keys(p.values).length : 0;
  bar.classList.toggle('on', ui.view === 'update' && (n > 0 || !!p.error));
  const btn = document.getElementById('save');
  btn.disabled = !!p.error || n === 0;
  const sum = document.getElementById('save-summary');
  if (p.error) { sum.innerHTML = `Check the figure for <b>${esc(p.error.name)}</b>.`; return; }
  const noRate = foreign().find(c => !currentRate(c));
  if (noRate && n) { btn.disabled = true; sum.innerHTML = `Type the rate for <b>${noRate}</b> at the top before saving.`; return; }
  if (ui.asOf) { sum.innerHTML = `<b>${n} ${n === 1 ? 'figure' : 'figures'}</b> to save as of <b>${fmtDate(asOfIso())}</b>.`; return; }
  // Preview the new total
  const tl = timeline();
  const before = tl.at(-1)?.total || 0;
  let after = before;
  for (const id in p.values) {
    const a = accById(id), fx = currentRate(a.currency) || 0;
    if (!inTotals(a)) continue;
    const nv = p.values[id];
    const newS = a.type === 'property' ? (nv.worth - nv.owed) * fx : (isDebt(a.type) ? -nv : nv) * fx;
    const oldS = tl.at(-1)?.acc[id] ?? 0;
    after += newS - oldS;
  }
  sum.innerHTML = `<b>${n} ${n === 1 ? 'figure' : 'figures'}</b> changed. Net worth after saving: <b>${amt(after)}</b> ${delta(after - before)}`;
}
function saveSnapshot() {
  const p = pendingChanges();
  if (p.error || !Object.keys(p.values).length || foreign().some(c => !currentRate(c))) return;
  const backdated = !!ui.asOf;
  const at = asOfIso() || new Date().toISOString();
  const snap = { id: uid('s'), at, values: p.values };
  const fx = Object.fromEntries(foreign().map(c => [c, currentRate(c)]));
  if (Object.keys(fx).length) snap.fx = fx;
  const est = Object.keys(draftEst).filter(id => id in p.values);
  if (est.length) snap.est = Object.fromEntries(est.map(id => [id, true]));
  const note = document.getElementById('note').value.trim();
  if (note) snap.note = note;
  db.snapshots.push(snap);
  sortSnaps();
  for (const id of Object.keys(draftSpread)) if (id in p.values) spreadValues(accById(id), snap);
  draft = {}; draftEst = {}; draftSpread = {}; rateDraft = {}; ui.asOf = null;
  document.getElementById('note').value = '';
  persist();
  toast(backdated ? `Snapshot saved as of ${fmtDate(at)}` : `Snapshot saved, ${fmtDate(at)} at ${fmtTime(at)}`);
  go('overview');
}

/* ---------- History ---------- */
function renderHistory() {
  const tl = timeline();
  const list = document.getElementById('h-list');
  if (!db.snapshots.length) { list.innerHTML = '<div class="empty"><p class="sub">No snapshots yet. They appear here each time you save on Update.</p></div>'; return; }
  let h = '';
  for (let i = db.snapshots.length - 1; i >= 0; i--) {
    const s = db.snapshots[i];
    const names = Object.keys(s.values).map(id => accById(id)).filter(Boolean).map(a => a.name + (a.provider ? ` (${a.provider})` : ''));
    const open = ui.openSnap === s.id;
    h += `<button class="h-row" data-snap="${s.id}" aria-expanded="${open}">
      <span class="when"><b>${fmtDate(s.at)}</b><span>${fmtWeekday(s.at)}, ${fmtTime(s.at)}</span></span>
      <span class="what">${s.note ? '<b style="color:var(--ink);font-weight:500">' + esc(s.note) + '.</b> ' : ''}${names.length} updated${s.est ? `, ${Object.keys(s.est).length} estimated` : ''}: ${esc(names.join(', '))}</span>
      <span class="num">${amt(tl[i].total)}</span>
      <span class="num chgcol">${i ? delta(tl[i].total - tl[i - 1].total) : '<span class="muted">first</span>'}</span>
    </button>`;
    if (open) h += snapDetail(s, i);
  }
  list.innerHTML = h;
}
function estCell(s, id, editing) {
  return editing ? `<td><input type="checkbox" data-editest="${id}" ${s.est?.[id] ? 'checked' : ''} aria-label="Estimate" style="width:auto"></td>` : '';
}
function snapDetail(s, i) {
  const editing = ui.editSnap === s.id;
  let h = `<div class="h-detail"><table class="data"><thead><tr><th>Account</th><th>${solo() ? '' : 'Owner'}</th><th>Before</th><th>Recorded</th><th>Change</th>${editing ? '<th>Estimate</th>' : ''}</tr></thead><tbody>`;
  for (const id of Object.keys(s.values)) {
    const a = accById(id); if (!a) continue;
    const prev = lastValue(id, i);
    const v = s.values[id];
    const f = x => money(x, a.currency);
    if (a.type === 'property') {
      const rec = editing
        ? `worth <input data-edit="${id}" data-part="worth" value="${nf(a.currency).format(v.worth)}"> owed <input data-edit="${id}" data-part="owed" value="${nf(a.currency).format(v.owed)}">`
        : `${f(v.worth)} worth, ${f(v.owed)} owed`;
      h += `<tr><td>${esc(a.name)}</td><td>${ownerOf(a.owner)}</td><td>${prev ? f(prev.v.worth - prev.v.owed) + ' equity' : '<span class="muted">new</span>'}</td><td>${rec}${!editing && s.est?.[id] ? estTag : ''}</td><td>${prev ? delta((v.worth - v.owed) - (prev.v.worth - prev.v.owed), f) : ''}</td>${estCell(s, id, editing)}</tr>`;
    } else {
      const rec = editing ? `<input data-edit="${id}" value="${nf(a.currency).format(v)}">` : f(v);
      h += `<tr><td>${esc(a.name)} <span class="muted">${esc(a.provider || '')}</span></td><td>${ownerOf(a.owner)}</td><td>${prev ? f(prev.v) : '<span class="muted">new</span>'}</td><td>${rec}${!editing && s.est?.[id] ? estTag : ''}</td><td>${prev ? (isDebt(a.type) ? debtDelta(prev.v, v, f) : delta(v - prev.v, f)) : ''}</td>${estCell(s, id, editing)}</tr>`;
    }
  }
  h += '</tbody></table>';
  if (editing) h += `<label style="display:flex;gap:10px;align-items:center;margin-top:14px;font-size:var(--step--1);color:var(--ink-2)">Date <input type="date" data-editdate value="${s.at.slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}" class="note-in" style="max-width:180px"></label>`;
  if (editing) h += `<label class="f" style="display:flex;gap:10px;align-items:center;margin-top:14px;font-size:var(--step--1);color:var(--ink-2)">Note <input class="note-in" data-editnote value="${esc(s.note || '')}" placeholder="Add a note, optional"></label>`;
  else if (s.note) h += `<p style="margin:12px 0 0">${esc(s.note)}</p>`;
  const rates = Object.entries(s.fx || {});
  if (rates.length) h += `<div class="rate-note">Counted at ${rates.map(([c, r]) => `${rateLabel(c)} ${fmtRate(r)} ${esc(symOf(base()))}`).join(', ')}.</div>`;
  h += editing
    ? `<div class="actions"><button class="btn small" data-editsave="${s.id}">Save changes</button><button class="btn quiet small" data-editcancel="1">Cancel</button></div>`
    : `<div class="actions"><button class="btn quiet small" data-edit-start="${s.id}">Correct a figure</button><button class="btn danger small" data-delete="${s.id}">Delete snapshot</button></div>`;
  return h + '</div>';
}

/* ---------- Navigation and events ---------- */
function go(view, opts = {}) {
  if (view === 'household' && !db.settings.householdTab) view = 'overview';
  ui.view = view;
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.go === view ? 'page' : 'false'));
  for (const v of ['overview', 'update', 'history', 'household', 'settings']) document.getElementById('v-' + v).hidden = v !== view;
  render();
  if (opts.add) openAdd();
  window.scrollTo({ top: opts.add ? document.body.scrollHeight : 0 });
}
function render() {
  if (ui.view === 'overview') renderOverview();
  if (ui.view === 'update') renderUpdate();
  if (ui.view === 'history') renderHistory();
  if (ui.view === 'settings') renderSettings();
  if (ui.view === 'household') renderHousehold();
  refreshSavebar();
  renderLastUpdate();
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
function segment(id, key, after) {
  const el = document.getElementById(id);
  const sync = () => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ui[key]));
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ui[key] = b.dataset.v; sync(); after && after();
  });
  sync();
}
segment('home-toggle', 'home', renderOverview);
segment('view-toggle', 'chart', renderOverview);
segment('range-toggle', 'range', renderOverview);
segment('add-owner', 'addOwner');
segment('hh-owner', 'hhOwner');
// Owner buttons follow the people in Settings, and disappear when there is only one
function ownerButtons() {
  for (const [id, key] of [['add-owner', 'addOwner'], ['hh-owner', 'hhOwner']]) {
    if (!OWNERS[ui[key]]) ui[key] = PEOPLE[0].key;
    $(id).innerHTML = PEOPLE.map(p => `<button type="button" data-v="${p.key}" aria-pressed="${p.key === ui[key]}">${esc(p.label)}</button>`).join('');
    $(id).closest('.f').hidden = solo();
  }
}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go, { add: !!g.dataset.add }); return; }
  const acc = e.target.closest('.acc-row');
  if (acc) { ui.openAcc = ui.openAcc === acc.dataset.acc ? null : acc.dataset.acc; renderAccounts(timeline()); return; }
  const snap = e.target.closest('.h-row');
  if (snap) { ui.openSnap = ui.openSnap === snap.dataset.snap ? null : snap.dataset.snap; ui.editSnap = null; renderHistory(); return; }
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'table-toggle') { ui.table = !ui.table; renderOverview(); }
  if (t.id === 'show-archived') { ui.showArchived = !ui.showArchived; renderAccounts(timeline()); }
  if (t.dataset.archive) {
    const a = accById(t.dataset.archive);
    if (confirm(`Archive ${a.name}? It stops counting from now on, and its history stays.`)) { a.archivedAt = new Date().toISOString(); ui.openAcc = null; persist(); renderOverview(); toast(`${a.name} archived`); }
  }
  if (t.dataset.unarchive) { const a = accById(t.dataset.unarchive); delete a.archivedAt; persist(); renderOverview(); toast(`${a.name} is back`); }
  if (t.dataset.rename) {
    const a = accById(t.dataset.rename);
    const n = prompt('New name', a.name);
    if (n && n.trim()) { a.name = n.trim(); persist(); renderOverview(); }
  }
  if (t.dataset.editStart) { ui.editSnap = t.dataset.editStart; renderHistory(); }
  if (t.dataset.editcancel) { ui.editSnap = null; renderHistory(); }
  if (t.dataset.editsave) {
    const s = db.snapshots.find(x => x.id === t.dataset.editsave);
    let ok = true;
    document.querySelectorAll('[data-edit]').forEach(inp => {
      const v = parseMoney(inp.value);
      if (v === null || Number.isNaN(v)) { ok = false; inp.style.borderColor = 'var(--down)'; return; }
      if (inp.dataset.part) s.values[inp.dataset.edit][inp.dataset.part] = v; else s.values[inp.dataset.edit] = v;
    });
    const est = {};
    document.querySelectorAll('[data-editest]').forEach(c => { if (c.checked) est[c.dataset.editest] = true; });
    if (Object.keys(est).length) s.est = est; else delete s.est;
    const note = document.querySelector('[data-editnote]')?.value.trim();
    if (note) s.note = note; else delete s.note;
    const nd = document.querySelector('[data-editdate]')?.value;
    if (nd && nd !== s.at.slice(0, 10)) { s.at = new Date(nd + 'T' + s.at.slice(11)).toISOString(); sortSnaps(); }
    if (ok) { ui.editSnap = null; persist(); renderHistory(); toast('Changes saved'); }
  }
  if (t.dataset.delete) {
    const s = db.snapshots.find(x => x.id === t.dataset.delete);
    if (confirm(`Delete the snapshot from ${fmtDate(s.at)} at ${fmtTime(s.at)}? The figures in it are removed from the history.`)) {
      db.snapshots = db.snapshots.filter(x => x.id !== s.id); ui.openSnap = null; persist(); renderHistory(); toast('Snapshot deleted');
    }
  }
});

document.getElementById('u-list').addEventListener('input', e => {
  const inp = e.target.closest('input[data-acc]'); if (!inp) return;
  const id = inp.dataset.acc;
  if (inp.dataset.part) {
    draft[id] = { ...(draft[id] || {}), [inp.dataset.part]: inp.value };
    if (!draft[id].worth && !draft[id].owed) delete draft[id];
  } else {
    if (inp.value.trim()) draft[id] = inp.value; else delete draft[id];
  }
  refreshRow(id); refreshSavebar();
});
document.getElementById('asof').addEventListener('change', e => {
  const today = new Date().toISOString().slice(0, 10);
  ui.asOf = e.target.value && e.target.value < today ? e.target.value : null;
  renderUpdate();
});
$('rates').addEventListener('input', e => {
  const c = e.target.dataset.rate; if (!c) return;
  const v = parseRate(e.target.value);
  if (v) rateDraft[c] = v; else delete rateDraft[c];
  document.querySelector(`[data-rate-src="${c}"]`).textContent = v ? 'typed in' : '';
  refreshSavebar();
});
document.getElementById('save').addEventListener('click', saveSnapshot);
document.getElementById('discard').addEventListener('click', () => { draft = {}; draftEst = {}; draftSpread = {}; renderUpdate(); });
document.getElementById('u-list').addEventListener('change', e => {
  const sp = e.target.closest('input[data-spread]');
  if (sp) { if (sp.checked) draftSpread[sp.dataset.spread] = true; else delete draftSpread[sp.dataset.spread]; return; }
  const c = e.target.closest('input[data-est]'); if (!c) return;
  if (c.checked) draftEst[c.dataset.est] = true; else delete draftEst[c.dataset.est];
});
document.addEventListener('keydown', e => {
  if (ui.view === 'update' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveSnapshot();
});

// Add an account
const addForm = document.getElementById('add-form');
const typeSel = addForm.querySelector('select[name=type]');
typeSel.innerHTML = Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
typeSel.value = 'pension';
const curSel = addForm.querySelector('select[name=currency]');
function openAdd() {
  curSel.innerHTML = [base(), ...Object.keys(CURRENCIES).filter(c => c !== base())].map(c => `<option value="${c}">${c}</option>`).join('');
  addForm.hidden = false; document.getElementById('add-open').hidden = true; addForm.querySelector('input[name=name]').focus();
}
function closeAdd() { addForm.hidden = true; document.getElementById('add-open').hidden = false; addForm.reset(); typeSel.value = 'pension'; }
document.getElementById('add-open').addEventListener('click', openAdd);
document.getElementById('add-cancel').addEventListener('click', closeAdd);
addForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(addForm);
  const a = { id: uid('a'), name: f.get('name').trim(), provider: f.get('provider').trim(), type: f.get('type'), owner: solo() ? PEOPLE[0].key : ui.addOwner, currency: f.get('currency'), createdAt: new Date().toISOString() };
  if (!a.name) return;
  db.accounts.push(a); persist();
  closeAdd(); renderUpdate();
  const inp = document.querySelector(`input[data-acc="${a.id}"]`);
  if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
  toast(`${a.name} added. Give it a figure, then save.`);
});

/* ---------- Household: insurance and memberships ---------- */
const HH_KINDS = [
  ['home', 'Home insurance (hemförsäkring)'], ['brf', 'Bostadsrätt add-on (bostadsrättstillägg)'], ['life', 'Life insurance'],
  ['akassa', 'A-kassa'], ['union', 'Union'], ['income', 'Income insurance (inkomstförsäkring)'],
  ['accident', 'Accident and illness'], ['health', 'Health insurance'], ['will', 'Will (testamente)'],
  ['car', 'Car insurance'], ['travel', 'Travel insurance'], ['pet', 'Pet insurance'], ['other', 'Other'],
];
const hhLabel = k => (HH_KINDS.find(x => x[0] === k) || [k, k])[1];
// The usual cover: per person unless marked household. A joint policy covers both.
const HH_CHECK = [
  { k: 'home', who: 'house', why: 'Your things, liability and legal costs' },
  { k: 'brf', who: 'house', why: 'The inside of the flat, which the BRF does not cover' },
  { k: 'life', who: 'each', why: 'So the other could keep the flat. Check your employer cover (TGL) first' },
  { k: 'akassa', who: 'each', why: 'Unemployment pay up to the a-kassa ceiling' },
  { k: 'union', who: 'each', why: 'Often includes income insurance above the a-kassa ceiling', also: ['income'], optional: true },
  { k: 'accident', who: 'each', why: 'A lump sum or income if illness or an accident stops work' },
  { k: 'will', who: 'each', why: 'Essential if you are not married: a sambo does not inherit' },
];
function renderHousehold() {
  const items = db.household;
  const has = (kinds, who) => items.some(x => kinds.includes(x.kind) && (who === 'house' || x.owner === who || x.owner === 'J'));
  const cost = items.reduce((s, x) => s + (x.cost || 0), 0);
  const soon = items.filter(x => x.renews && (new Date(x.renews) - Date.now()) / 864e5 <= 30 && new Date(x.renews) >= new Date(today()));
  $('hh-stats').innerHTML = `
    <div class="stat"><div class="n">${unitHtml(nf().format(Math.round(cost)))}</div><div class="l">A month, all together</div></div>
    <div class="stat"><div class="n">${items.length}</div><div class="l">${items.length === 1 ? 'Item' : 'Items'}</div></div>
    ${soon.length ? `<div class="stat"><div class="n">${soon.length}</div><div class="l">Renewing in the next 30 days</div></div>` : ''}`;
  const ps = persons();
  let c = `<div class="check" style="--n:${ps.length}"><div class="h"></div>${ps.map(p => `<div class="h">${solo() ? '' : esc(p.label)}</div>`).join('')}`;
  for (const row of HH_CHECK) {
    const kinds = [row.k, ...(row.also || [])];
    c += `<div>${esc(hhLabel(row.k))}<span class="why">${esc(row.why)}</span></div>`;
    if (row.who === 'house') { const y = has(kinds, 'house'); c += `<div class="${y ? 'yes' : 'no'}" style="grid-column: span ${ps.length}">${y ? 'Household' : 'Not added'}</div>`; }
    else for (const p of ps) { const y = has(kinds, p.key); c += `<div class="${y ? 'yes' : 'no'}">${y ? 'Yes' : row.optional ? 'Optional' : 'Not added'}</div>`; }
  }
  $('hh-check').innerHTML = c + '</div>';
  const order = Object.fromEntries(PEOPLE.map((p, i) => [p.key, i]));
  const sorted = items.slice().sort((a, b) => order[a.owner] - order[b.owner] || HH_KINDS.findIndex(k => k[0] === a.kind) - HH_KINDS.findIndex(k => k[0] === b.kind));
  let h = '', last = null;
  for (const x of sorted) {
    if (x.owner !== last && !solo()) { h += `<div class="group-title"><span>${ownerOf(x.owner)}</span><span>${amt(items.filter(y => y.owner === x.owner).reduce((s, y) => s + (y.cost || 0), 0))} a month</span></div>`; last = x.owner; }
    const days = x.renews ? (new Date(x.renews) - Date.now()) / 864e5 : null;
    h += `<button class="hh-row" data-hh="${x.id}">
      <span><span class="k">${esc(hhLabel(x.kind))}</span><span class="p">${esc(x.provider || 'Provider not added')}</span></span>
      <span class="c">${esc(x.cover || '')}</span>
      <span class="num" style="text-align:right">${x.cost ? amt(x.cost) + ' a month' : '<span class="muted">No cost added</span>'}</span>
      <span class="r ${days != null && days <= 30 && days >= -1 ? 'soon' : ''}">${x.renews ? (days < -1 ? 'Ended ' : 'Renews ') + fmtDate(x.renews) : ''}</span>
      ${x.notes ? `<span class="note">${esc(x.notes)}</span>` : ''}
    </button>`;
  }
  $('hh-list').innerHTML = h || '<p class="sub">Nothing added yet.</p>';
}
const hhForm = $('hh-form');
hhForm.querySelector('[name=kind]').innerHTML = HH_KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
function openHh(x) {
  hhForm.reset();
  hhForm.hidden = false; $('hh-add-open').hidden = true;
  hhForm.elements.hid.value = x?.id || '';
  if (x) {
    hhForm.kind.value = x.kind; hhForm.provider.value = x.provider || ''; hhForm.cost.value = x.cost ? nf().format(x.cost) : '';
    hhForm.cover.value = x.cover || ''; hhForm.renews.value = x.renews || ''; hhForm.notes.value = x.notes || '';
  }
  ui.hhOwner = x?.owner || PEOPLE[0].key;
  $('hh-owner').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ui.hhOwner));
  $('hh-save').textContent = x ? 'Save changes' : 'Add';
  $('hh-delete').hidden = !x;
  hhForm.scrollIntoView({ block: 'center' });
  hhForm.provider.focus();
}
function closeHh() { hhForm.hidden = true; $('hh-add-open').hidden = false; }
$('hh-add-open').addEventListener('click', () => openHh(null));
$('hh-cancel').addEventListener('click', closeHh);
$('hh-list').addEventListener('click', e => { const r = e.target.closest('[data-hh]'); if (r) openHh(db.household.find(x => x.id === r.dataset.hh)); });
$('hh-delete').addEventListener('click', () => {
  const x = db.household.find(y => y.id === hhForm.elements.hid.value); if (!x) return;
  if (!confirm(`Delete ${hhLabel(x.kind)}${x.provider ? ' (' + x.provider + ')' : ''}?`)) return;
  db.household = db.household.filter(y => y !== x); persist(); closeHh(); renderHousehold(); toast('Deleted');
});
hhForm.addEventListener('submit', e => {
  e.preventDefault();
  const cost = parseMoney(hhForm.cost.value);
  if (Number.isNaN(cost)) { toast('Type the cost as a number, for example 150'); return; }
  const data = { kind: hhForm.kind.value, provider: hhForm.provider.value.trim(), owner: solo() ? PEOPLE[0].key : ui.hhOwner, cost: cost || 0,
    cover: hhForm.cover.value.trim(), renews: hhForm.renews.value || null, notes: hhForm.notes.value.trim() };
  const id = hhForm.elements.hid.value;
  if (id) Object.assign(db.household.find(x => x.id === id), data);
  else db.household.push({ id: uid('h'), ...data });
  persist(); closeHh(); renderHousehold();
  toast(id ? 'Changes saved' : 'Added');
});

/* ---------- Settings ---------- */
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applySettings() {
  const st = db.settings;
  // On maclaine.se the site's header owns the theme (its `theme` key); locally it is a setting
  if (!WEB) document.documentElement.dataset.theme = st.theme === 'auto' ? (darkMq.matches ? 'dark' : 'light') : st.theme;
  document.body.classList.toggle('private', !!st.hideFigures);
  document.querySelector('nav.tabs [data-go="household"]').hidden = !st.householdTab;
  $('unhide').hidden = !st.hideFigures;
}
darkMq.addEventListener('change', () => {
  if (WEB) { if (webTheme() === 'auto') setWebTheme('auto'); return; }
  if (db.settings.theme === 'auto') { applySettings(); render(); }
});
// The web copy follows the site: no saved `theme` follows the device, a saved one wins
function webTheme() { let t = null; try { t = localStorage.getItem('theme'); } catch {} return t === 'light' || t === 'dark' ? t : 'auto'; }
function setWebTheme(v) {
  const t = v === 'auto' ? (darkMq.matches ? 'dark' : 'light') : v;
  if (v === 'auto') { try { localStorage.removeItem('theme'); } catch {} }
  if (window.SiteChrome) window.SiteChrome.setTheme(t, v !== 'auto');
  else { document.documentElement.dataset.theme = t; if (v !== 'auto') try { localStorage.setItem('theme', t); } catch {} }
}
const themeValue = () => WEB ? webTheme() : db.settings.theme;
const syncThemeToggle = () => $('theme-toggle').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === themeValue()));
let booted = false;
document.addEventListener('themechange', () => { if (!booted) return; syncThemeToggle(); render(); });

function renderLastUpdate() {
  const el = $('last-update');
  const last = db.snapshots.at(-1);
  if (!last) { el.textContent = ''; return; }
  const days = Math.max(0, Math.floor((Date.now() - new Date(last.at)) / 864e5));
  el.textContent = days === 0 ? 'Updated today' : days === 1 ? 'Updated yesterday' : `Updated ${days} days ago`;
  el.classList.toggle('late', days >= (db.settings.reminder.days || 30));
}

async function renderSettings() {
  const st = db.settings;
  $('people-list').innerHTML = db.people.map(p => `<div class="set-row person">
      <input class="note-in" data-person="${p.key}" value="${esc(p.name)}" aria-label="Name" maxlength="30">
      ${db.people.length > 1 ? `<button class="btn quiet small" data-unperson="${p.key}">Remove</button>` : ''}
    </div>`).join('');
  $('person-add').hidden = db.people.length >= MAX_PEOPLE;
  $('set-currency').innerHTML = Object.keys(CURRENCIES).map(c => `<option value="${c}" ${c === base() ? 'selected' : ''}>${c}</option>`).join('');
  $('set-currency').disabled = db.snapshots.length > 0;
  $('currency-note').textContent = db.snapshots.length
    ? 'Totals are counted in this. It is fixed once there is a snapshot, since every saved rate is against it.'
    : 'Totals are counted in this. Accounts in other currencies are converted at the day\'s rate when you save.';
  document.querySelectorAll('.cur.base').forEach(e => e.textContent = symOf(base()));
  $('goal-amount').value = st.goal ? nf().format(st.goal.amount) : '';
  $('goal-clear').hidden = !st.goal;
  $('set-growth').checked = !!st.showGrowth;
  $('set-hide').checked = !!st.hideFigures;
  $('set-student').checked = !!st.countStudent;
  $('set-household').checked = !!st.householdTab;
  $('set-remind').checked = !!st.reminder.on;
  $('pay-inputs').innerHTML = persons().map(p => `<label>${solo() ? '' : esc(p.label)} <span class="money" style="display:inline-block;width:170px"><input data-pay="${p.key}" inputmode="decimal" aria-label="${esc(p.label)} take-home pay" value="${st.pay[p.key] ? nf().format(st.pay[p.key]) : ''}"><span class="cur">${esc(symOf(base()))}</span></span></label>`).join('');
  const pe = persons().filter(p => st.pay.est[p.key] && st.pay[p.key]).map(p => p.label);
  $('pay-est').textContent = pe.length ? `${pe.join(' and ')}: estimated from gross pay. Type the figure from the payslip.` : '';
  $('sp-on').checked = !!st.ukState.on;
  $('sp-who').innerHTML = persons().map(p => `<option value="${p.key}" ${p.key === spWho() ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  $('sp-who-f').hidden = solo();
  $('sp-years').value = st.ukState.years;
  $('sp-age').value = st.ukState.age;
  $('sp-born').value = st.ukState.born || '';
  $('sp-rate').value = st.ukState.rate.toLocaleString(loc(), { minimumFractionDigits: 2 });
  $('sp-forecast').value = st.ukState.forecast ? st.ukState.forecast.toLocaleString(loc(), { minimumFractionDigits: 2 }) : '';
  $('remind-days').value = st.reminder.days;
  syncThemeToggle();
  $('demo-open').textContent = ui.demo ? 'Leave the example' : 'Show the example';
  if (WEB) return;
  try {
    const i = await api('/api/info');
    $('data-path').textContent = i.dataFile;
    $('remind-status').textContent = st.reminder.on
      ? (i.reminderInstalled ? 'On. Checks every evening at 7pm.' : 'Switched on, but not installed. Untick and tick again.')
      : '';
    $('data-path').title = i.backups ? `${i.backups} daily backups, the latest from ${fmtDate(i.latestBackup)}` : 'No backups yet. The first is made the next time you save.';
  } catch (e) {
    $('data-path').textContent = 'Could not reach the server: ' + e.message;
  }
}
const spWho = () => OWNERS[db.settings.ukState.who] && db.settings.ukState.who !== 'J' ? db.settings.ukState.who : persons()[0].key;
function saveSettings(msg) { persist(); applySettings(); if (msg) toast(msg); }

$('goal-amount').addEventListener('change', e => {
  const v = parseMoney(e.target.value);
  if (v === null) { db.settings.goal = null; saveSettings('Goal removed'); renderSettings(); return; }
  if (Number.isNaN(v) || v <= 0) { toast('Type the goal as a number, for example 10m or 10 000 000'); return; }
  db.settings.goal = { amount: v };
  saveSettings(`Goal set: ${amt(v)} within reach`);
  renderSettings();
});
$('goal-clear').addEventListener('click', () => { db.settings.goal = null; saveSettings('Goal removed'); renderSettings(); });
$('set-growth').addEventListener('change', e => { db.settings.showGrowth = e.target.checked; saveSettings(); });
$('set-hide').addEventListener('change', e => { db.settings.hideFigures = e.target.checked; saveSettings(); });
$('set-student').addEventListener('change', e => { db.settings.countStudent = e.target.checked; saveSettings(); render(); });
$('unhide').addEventListener('click', () => { db.settings.hideFigures = false; saveSettings(); if (ui.view === 'settings') renderSettings(); });
$('theme-toggle').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (WEB) { setWebTheme(b.dataset.v); syncThemeToggle(); return; }
  db.settings.theme = b.dataset.v; saveSettings(); render();
});
$('pay-inputs').addEventListener('change', e => {
  const k = e.target.dataset.pay; if (!k) return;
  const v = parseMoney(e.target.value);
  if (Number.isNaN(v)) { toast('Type the pay as a number, for example 52 000'); renderSettings(); return; }
  db.settings.pay[k] = v || null;
  delete db.settings.pay.est[k];                         // a typed figure is the real one
  saveSettings(solo() ? 'Take-home pay saved' : `${OWNERS[k]}'s take-home pay saved`);
  renderSettings();
});
$('set-household').addEventListener('change', e => { db.settings.householdTab = e.target.checked; saveSettings(); applySettings(); });
$('sp-who').addEventListener('change', e => { db.settings.ukState.who = e.target.value; saveSettings(); });
$('set-currency').addEventListener('change', e => {
  if (db.snapshots.length) return;
  db.settings.currency = e.target.value; rateDraft = {};
  saveSettings(`Totals are now counted in ${base()}`); renderSettings();
});
// People: rename in place, add up to four, remove only someone who owns nothing
$('people-list').addEventListener('change', e => {
  const k = e.target.dataset.person; if (!k) return;
  const name = e.target.value.trim();
  if (!name) { renderSettings(); return; }
  db.people.find(p => p.key === k).name = name;
  setPeople(); ownerButtons(); saveSettings('Name saved');
});
$('people-list').addEventListener('click', e => {
  const k = e.target.dataset.unperson; if (!k) return;
  const p = db.people.find(x => x.key === k);
  const owns = db.accounts.filter(a => a.owner === k).length + db.household.filter(x => x.owner === k).length;
  if (owns) { toast(`${p.name} still owns ${owns} ${owns === 1 ? 'thing' : 'things'}. Archive or delete those first.`); return; }
  if (db.people.length === 2 && [...db.accounts, ...db.household].some(x => x.owner === 'J')) { toast('Joint accounts need two people, so one has to stay.'); return; }
  if (!confirm(`Remove ${p.name}?`)) return;
  db.people = db.people.filter(x => x !== p);
  delete db.settings.pay[k]; delete db.settings.pay.est[k];
  setPeople(); ownerButtons(); saveSettings(`${p.name} removed`); renderSettings();
});
$('person-add').addEventListener('click', () => {
  if (db.people.length >= MAX_PEOPLE) return;
  db.people.push({ key: uid('p'), name: 'Person ' + (db.people.length + 1) });
  setPeople(); ownerButtons(); saveSettings(); renderSettings();
  const inputs = document.querySelectorAll('[data-person]');
  inputs[inputs.length - 1].select();
});
$('sp-on').addEventListener('change', e => { db.settings.ukState.on = e.target.checked; saveSettings(); });
const spNum = (id, key, { min, max, optional }) => $(id).addEventListener('change', e => {
  const t = e.target.value.trim().replace(',', '.');
  if (optional && !t) { db.settings.ukState[key] = null; saveSettings(); return; }
  const v = Number(t);
  if (!Number.isFinite(v) || v < min || v > max) { toast('That does not look right, check the number'); renderSettings(); return; }
  db.settings.ukState[key] = v; saveSettings();
});
spNum('sp-years', 'years', { min: 0, max: 50 });
spNum('sp-age', 'age', { min: 60, max: 75 });
spNum('sp-born', 'born', { min: 1930, max: 2020, optional: true });
spNum('sp-rate', 'rate', { min: 50, max: 1000 });
spNum('sp-forecast', 'forecast', { min: 1, max: 1000, optional: true });
$('set-remind').addEventListener('change', async e => {
  db.settings.reminder.on = e.target.checked;
  await persist();
  try {
    await api('/api/reminder', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) });
    toast(e.target.checked ? 'Reminder switched on' : 'Reminder switched off');
  } catch (err) { toast('Could not set up the reminder: ' + err.message); }
  renderSettings();
});
$('remind-days').addEventListener('change', e => {
  const d = Math.round(Number(e.target.value));
  if (d >= 1 && d <= 365) { db.settings.reminder.days = d; saveSettings(`Reminder after ${d} days`); renderLastUpdate(); }
});
$('remind-test').addEventListener('click', async () => {
  try {
    await api('/api/reminder/test', { method: 'POST' });
    toast('Test sent. Nothing showing? Allow notifications for Script Editor in System Settings.');
  } catch (e) { toast('Test failed: ' + e.message); }
});
$('open-folder').addEventListener('click', () => api('/api/open-folder', { method: 'POST' }).catch(e => toast(e.message)));
$('move-go').addEventListener('click', async () => {
  const dir = $('move-dir').value.trim();
  if (!dir) return;
  try {
    await saving;
    await api('/api/location', { method: 'POST', body: JSON.stringify({ dir }) });
    db = normalise(await api('/api/data'));
    sortSnaps(); applySettings();
    toast('Now using ' + dir);
    $('move-dir').value = '';
    renderSettings();
  } catch (e) { toast('Could not use that folder: ' + e.message); }
});

/* ---------- Export ---------- */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);
const CSV_HEAD = ['date', 'account', 'provider', 'type', 'owner', 'currency', 'value', 'owed', 'estimate', 'note'];
const csvCell = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
$('export-json').addEventListener('click', () => download(`net-worth-${today()}.json`, JSON.stringify(db, null, 1), 'application/json'));
$('export-csv').addEventListener('click', () => {
  const rows = [CSV_HEAD];
  for (const s of db.snapshots) for (const [id, v] of Object.entries(s.values)) {
    const a = accById(id); if (!a) continue;
    const prop = a.type === 'property';
    rows.push([s.at.slice(0, 10), a.name, a.provider || '', a.type, OWNERS[a.owner] || '', a.currency, prop ? v.worth : v, prop ? v.owed : '', s.est?.[id] ? 'yes' : '', s.note || '']);
  }
  download(`net-worth-${today()}.csv`, rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
});
$('csv-template').addEventListener('click', () => {
  const ps = persons(), one = csvCell(ps[0].label), two = csvCell((ps[1] || ps[0]).label), joint = solo() ? one : 'Joint', c = base();
  download('net-worth-template.csv', [
    CSV_HEAD.join(','),
    `2025-01-31,ISK,Avanza,investments,${one},${c},250000,,,`,
    `2025-01-31,Workplace pension,,pension,${one},${c},300000,,,`,
    `2025-01-31,The flat,,property,${joint},${c},4800000,3200000,,`,
    `2025-01-31,Tjänstepension,SEB,pension,${two},${c},80000,,yes,Rough figure`,
    `2025-02-28,ISK,Avanza,investments,${one},${c},262000,,,`,
  ].join('\n'), 'text/csv');
});

/* ---------- Import ---------- */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return { rows: rows.filter(r => r.some(x => x.trim())), sep };
}
function csvNumber(t, sep) {
  t = String(t || '').trim().replace(/[\s  ’']|kr|sek|nok|dkk|eur|gbp|usd|chf|[£€$]/gi, '');
  if (!t) return null;
  if (sep === ';' || /^\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
function csvDate(t) {
  t = String(t || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const TYPE_WORDS = Object.fromEntries(Object.entries(TYPES).flatMap(([k, t]) => [[k, k], [t.label.toLowerCase(), k], [pluralType(k).toLowerCase(), k]]));
// Owners in a CSV can be written as names; blank means Joint, or the only person
const ownerWords = () => Object.fromEntries(PEOPLE.flatMap(p => [[p.label.toLowerCase(), p.key], [p.key.toLowerCase(), p.key]]));

let pendingImport = null;
$('csv-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const { rows, sep } = parseCsv(await f.text());
  const head = rows.shift()?.map(h => h.trim().toLowerCase()) || [];
  const col = name => head.indexOf(name);
  const box = $('csv-preview');
  if (col('date') < 0 || col('account') < 0 || col('value') < 0) {
    box.innerHTML = '<p style="color:var(--down)">The first row needs at least the columns date, account and value. Download the template to see the layout.</p>';
    return;
  }
  const get = (r, n) => col(n) >= 0 ? (r[col(n)] || '').trim() : '';
  const errors = [], items = [], OWNER_WORDS = ownerWords();
  rows.forEach((r, i) => {
    const line = i + 2;
    const date = csvDate(get(r, 'date'));
    const value = csvNumber(get(r, 'value'), sep);
    const owed = csvNumber(get(r, 'owed'), sep);
    const type = TYPE_WORDS[get(r, 'type').toLowerCase()] || (get(r, 'type') ? null : 'other');
    const owner = OWNER_WORDS[get(r, 'owner').toLowerCase()] || (get(r, 'owner') ? null : solo() ? PEOPLE[0].key : 'J');
    const currency = (get(r, 'currency') || base()).toUpperCase();
    if (!date) return errors.push(`Row ${line}: the date "${get(r, 'date')}" is not a date. Use 2025-01-31.`);
    if (date > today()) return errors.push(`Row ${line}: the date is in the future.`);
    // A property row may leave one of worth or owed blank: it keeps the last known figure
    const propPartial = type === 'property' && (value !== null || (owed !== null && !Number.isNaN(owed)));
    if (Number.isNaN(value) || (value === null && !propPartial)) return errors.push(`Row ${line}: the value "${get(r, 'value')}" is not a number.`);
    if (!type) return errors.push(`Row ${line}: unknown type "${get(r, 'type')}". Use one of: ${Object.keys(TYPES).join(', ')}.`);
    if (!owner) return errors.push(`Row ${line}: unknown owner "${get(r, 'owner')}". Use ${PEOPLE.map(p => p.label).join(', ').replace(/, ([^,]*)$/, ' or $1')}.`);
    if (!CURRENCIES[currency]) return errors.push(`Row ${line}: currency must be one of ${Object.keys(CURRENCIES).join(', ')}.`);
    if (!get(r, 'account')) return errors.push(`Row ${line}: the account has no name.`);
    items.push({ date, name: get(r, 'account'), provider: get(r, 'provider'), type, owner, currency, value, owed: Number.isNaN(owed) ? null : owed,
      est: /^(y|yes|ja|true|1)$/i.test(get(r, 'estimate')), note: get(r, 'note') });
  });
  const findAcc = it => db.accounts.find(a => a.name.toLowerCase() === it.name.toLowerCase() && (a.provider || '').toLowerCase() === it.provider.toLowerCase() && a.owner === it.owner);
  const fresh = new Map();
  for (const it of items) if (!findAcc(it)) fresh.set([it.name, it.provider, it.owner].join('|').toLowerCase(), it);
  const dates = [...new Set(items.map(i => i.date))].sort();
  pendingImport = { items, findAcc };
  box.innerHTML = (items.length ? `<p>Found <b>${items.length} figures</b> on <b>${dates.length} dates</b>, from ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}.` +
      (fresh.size ? ` ${fresh.size} new ${fresh.size === 1 ? 'account' : 'accounts'}: ${[...fresh.values()].map(i => `${esc(i.name)}${i.provider ? ' (' + esc(i.provider) + ')' : ''}${solo() ? '' : ', ' + esc(OWNERS[i.owner])}`).join('; ')}.` : ' All accounts already exist.') + '</p>'
    : '<p>No figures found.</p>') +
    (errors.length ? `<p style="color:var(--down)">${errors.length} ${errors.length === 1 ? 'row was' : 'rows were'} skipped:</p><ul class="sub">${errors.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}${errors.length > 8 ? `<li>and ${errors.length - 8} more</li>` : ''}</ul>` : '') +
    (items.length ? `<div class="set-row"><button class="btn small" id="csv-go">Import ${items.length} figures</button><button class="btn quiet small" id="csv-cancel">Cancel</button></div>` : '');
});
$('csv-preview').addEventListener('click', async e => {
  if (e.target.id === 'csv-cancel') { pendingImport = null; $('csv-preview').innerHTML = ''; $('csv-file').value = ''; return; }
  if (e.target.id !== 'csv-go' || !pendingImport) return;
  e.target.disabled = true; e.target.textContent = 'Importing…';
  const { items, findAcc } = pendingImport;
  const byDate = {};
  for (const it of items) (byDate[it.date] ||= []).push(it);
  for (const date of Object.keys(byDate).sort()) {
    const list = byDate[date];
    const noon = new Date(date + 'T12:00:00');
    const at = (noon > new Date() ? new Date() : noon).toISOString();   // today's rows are stamped now, never later
    let snap = db.snapshots.find(s => s.at.slice(0, 10) === at.slice(0, 10));
    if (!snap) {
      snap = { id: uid('s'), at, values: {} };
      for (const c of new Set(list.map(i => i.currency).filter(c => c !== base()))) {
        const r = await fetchRate(c, date);
        const rate = r?.rate ?? lastFx(c);
        if (rate) (snap.fx ||= {})[c] = rate;
      }
      db.snapshots.push(snap);
    }
    for (const it of list) {
      let a = findAcc(it);
      if (!a) { a = { id: uid('a'), name: it.name, provider: it.provider, type: it.type, owner: it.owner, currency: it.currency, createdAt: at }; db.accounts.push(a); }
      if (a.type === 'property') {
        sortSnaps();
        const prev = lastValue(a.id, db.snapshots.filter(s => s.at < at).length)?.v || {};
        snap.values[a.id] = { worth: it.value ?? prev.worth ?? 0, owed: it.owed ?? prev.owed ?? 0 };
      } else snap.values[a.id] = it.value;
      if (it.est) (snap.est ||= {})[a.id] = true;
      if (it.note && !snap.note) snap.note = it.note;
    }
  }
  sortSnaps();
  await persist();
  pendingImport = null; $('csv-preview').innerHTML = ''; $('csv-file').value = '';
  toast(`Imported ${items.length} figures`);
  go('overview');
});

/* ---------- Your data in the browser (web only) ---------- */
$('import-json').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  let d;
  try { d = JSON.parse(await f.text()); } catch { toast('That file is not a Net worth copy'); return; }
  if (!Array.isArray(d.accounts) || !Array.isArray(d.snapshots)) { toast('That file is not a Net worth copy'); return; }
  const when = d.snapshots.at(-1)?.at;
  if ((db.accounts.length || db.snapshots.length) && !confirm(`Replace everything in this browser with the copy${when ? ' last updated ' + fmtDate(when) : ''}? Download a copy of what is here first if you are not sure.`)) return;
  await leaveDemo(false);
  await saving;
  d.rev = db.rev;
  db = normalise(d); setPeople(); sortSnaps(); applySettings(); ownerButtons();
  await persist();
  toast('Copy opened'); go('overview');
});
$('wipe').addEventListener('click', async () => {
  if (!confirm('Delete every account, snapshot and setting in this browser? This cannot be undone, so download a copy first if you might want it.')) return;
  await saving;
  localStorage.removeItem(STORE);
  await reload();
  toast('Everything deleted'); go('overview');
});

/* ---------- Example with made-up figures ---------- */
// Two people, two and a half years of month-end snapshots. Nothing in it is saved.
function demoData() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const end = new Date(); end.setDate(0);                         // month ends up to last month, then today
  const months = 30, dates = [];
  for (let i = months; i >= 1; i--) { const d = new Date(end.getFullYear(), end.getMonth() - i + 2, 0, 12); dates.push(d.toISOString()); }
  dates.push(new Date().toISOString());                            // the latest snapshot is today
  const acc = (id, name, provider, type, owner, currency = 'SEK') => ({ id, name, provider, type, owner, currency, createdAt: dates[0] });
  const accounts = [
    acc('d1', 'Current account', 'Nordea', 'cash', 'a'),
    acc('d2', 'Buffer', 'SBAB', 'savings', 'J'),
    acc('d3', 'ISK', 'Avanza', 'investments', 'a'),
    acc('d4', 'ISK', 'Nordnet', 'investments', 's'),
    acc('d5', 'Tjänstepension', 'SEB', 'pension', 'a'),
    acc('d6', 'Tjänstepension', 'Folksam', 'pension', 's'),
    acc('d7', 'Workplace pension', 'Aviva', 'pension', 'a', 'GBP'),
    acc('d8', 'The flat', '', 'property', 'J'),
    acc('d9', 'Car', '', 'vehicle', 'J'),
    acc('d10', 'CSN', '', 'student', 's'),
  ];
  let market = 1, isk1 = 140000, isk2 = 52000, p1 = 410000, p2 = 265000, uk = 21000, buffer = 60000, csn = 186000, owed = 3150000;
  const snapshots = dates.map((at, i) => {
    market *= 1 + 0.006 + (rnd() - 0.5) * 0.06;
    isk1 += 6000; isk2 += 3500; p1 += 4200; p2 += 3100; buffer += 2500 - (i === 14 ? 45000 : 0); csn -= 1100; owed -= 4200;
    const yr = Math.floor(i / 12);
    const values = {
      d1: Math.round(18000 + rnd() * 16000), d2: buffer, d3: Math.round(isk1 * market), d4: Math.round(isk2 * market),
      d5: Math.round(p1 * market), d6: Math.round(p2 * market), d7: Math.round(uk * market + i * 160),
      d8: { worth: [4300000, 4450000, 4600000][yr], owed }, d9: [210000, 175000, 150000][yr], d10: csn,
    };
    for (const k in values) if (typeof values[k] === 'number') values[k] = Math.round(values[k] / 100) * 100;
    const s = { id: 'ds' + i, at, fx: { GBP: Math.round((13.1 + Math.sin(i / 4) * 0.5) * 100) / 100 }, values };
    if (i === 14) s.note = 'New sofa and a trip, paid from the buffer';
    if (i === 24) s.note = 'Flat valued by the bank';
    if (i === months) s.est = { d6: true };
    return s;
  });
  const soon = new Date(); soon.setDate(soon.getDate() + 20);
  return {
    version: 1, demo: true,
    people: [{ key: 'a', name: 'Alex' }, { key: 's', name: 'Sam' }],
    settings: { currency: 'SEK', goal: { amount: 1500000 }, householdTab: true, pay: { a: 36000, s: 31000, est: {} },
      ukState: { on: true, who: 'a', years: 7, age: 68, born: 1991, rate: 241.30, forecast: null } },
    accounts, snapshots,
    household: [
      { id: 'dh1', kind: 'home', provider: 'Folksam', owner: 'J', cost: 189, cover: 'Hemförsäkring with bostadsrättstillägg', renews: soon.toISOString().slice(0, 10), notes: '' },
      { id: 'dh2', kind: 'brf', provider: 'Folksam', owner: 'J', cost: 0, cover: 'Included in the home insurance', renews: null, notes: '' },
      { id: 'dh3', kind: 'akassa', provider: 'Akademikernas', owner: 'a', cost: 150, cover: '', renews: null, notes: '' },
      { id: 'dh4', kind: 'union', provider: 'Unionen', owner: 's', cost: 260, cover: 'Income insurance included', renews: null, notes: '' },
      { id: 'dh5', kind: 'life', provider: 'Länsförsäkringar', owner: 'a', cost: 110, cover: '1 mn kr', renews: null, notes: 'Papers in the blue folder' },
    ],
  };
}
async function showDemo() {
  await saving;
  ui.demo = true; draft = {}; draftEst = {}; draftSpread = {}; rateDraft = {}; ui.asOf = null; ui.animated = false;
  db = normalise(demoData()); setPeople(); sortSnaps(); applySettings(); ownerButtons();
  $('demo-bar').hidden = false;
  $('demo-own').textContent = stored() ? 'Back to your own figures' : 'Start with a blank page';
  go('overview');
}
async function leaveDemo(show = true) {
  if (!ui.demo) return;
  ui.demo = false; draft = {}; draftEst = {}; draftSpread = {}; rateDraft = {}; ui.animated = false;
  $('demo-bar').hidden = true;
  await reload();
  if (show) go('overview');
}
$('demo-open').addEventListener('click', () => ui.demo ? leaveDemo() : showDemo());
$('demo-own').addEventListener('click', () => leaveDemo());
const welcomed = 'nw1-welcomed';
$('welcome').addEventListener('close', () => localStorage.setItem(welcomed, '1'));
$('welcome-demo').addEventListener('click', () => { $('welcome').close(); showDemo(); });
$('welcome-blank').addEventListener('click', () => $('welcome').close());

/* ---------- Start ---------- */
function normalise(d) {
  const def = defaultSettings();
  const hadTab = !!d.settings && 'householdTab' in d.settings;
  d.settings = { ...def, ...(d.settings || {}) };
  d.settings.reminder = { ...def.reminder, ...(d.settings.reminder || {}) };
  d.settings.ukState = { ...def.ukState, ...(d.settings.ukState || {}) };
  d.settings.pay = { ...def.pay, ...(d.settings.pay || {}) };
  d.settings.pay.est ||= {};
  if (!CURRENCIES[d.settings.currency]) d.settings.currency = 'SEK';
  d.accounts ||= []; d.snapshots ||= []; d.household ||= [];
  // Files from before the Household tab was optional keep it if they use it
  if (!hadTab) d.settings.householdTab = d.household.length > 0;
  // Snapshots from before other currencies stored a single pound rate
  for (const s of d.snapshots) if (s.gbp != null) { s.fx ||= { GBP: s.gbp }; delete s.gbp; }
  // Every owner needs a person; a file without names gets numbered ones
  d.people ||= [];
  const owners = new Set([...d.accounts, ...d.household].map(x => x.owner).filter(k => k && k !== 'J'));
  for (const k of owners) if (!d.people.some(p => p.key === k)) d.people.push({ key: k, name: 'Person ' + (d.people.length + 1) });
  if (!d.people.length) d.people.push({ key: uid('p'), name: 'Me' });
  if (d.people.length < 2 && [...d.accounts, ...d.household].some(x => x.owner === 'J')) d.people.push({ key: uid('p'), name: 'Person 2' });
  return d;
}
async function boot() {
  try {
    db = normalise(await load());
  } catch (e) {
    document.querySelector('main').innerHTML = WEB
      ? `<div class="empty"><h2>Your figures could not be read</h2><p class="sub">${esc(e.message)}</p></div>`
      : '<div class="empty"><h2>Net worth is not running</h2><p class="sub">Open it by double clicking <b>Net Worth.command</b> in the NW1 folder. It starts the app and opens this page.</p></div>';
    document.querySelector('nav.tabs').hidden = true;
    return;
  }
  document.querySelectorAll(WEB ? '.local-only' : '.web-only').forEach(e => e.hidden = true);
  if (WEB) $('theme-auto').textContent = 'Follow the system';
  setPeople();
  sortSnaps();
  applySettings();
  booted = true;
  ownerButtons();
  const h = location.hash.slice(1);
  go(['update', 'history', 'household', 'settings'].includes(h) ? h : 'overview');
  if (WEB && !stored() && !localStorage.getItem(welcomed)) $('welcome').showModal();
}
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 120); });

boot();
