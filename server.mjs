// Net worth: a tiny local server. No dependencies, Node 18+.
// Serves the app, keeps the data file, makes daily backups, fetches the
// pound rate and installs the reminder. Listens on this Mac only.

import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NW1_PORT || 4747);
const CONFIG = path.join(ROOT, 'config.json');
const KEEP_BACKUPS = 90;
const AGENT_LABEL = 'com.nw1.reminder';
const AGENT_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', AGENT_LABEL + '.plist');

const EMPTY = () => ({
  version: 1,
  settings: { goal: null, showGrowth: false, hideFigures: false, theme: 'auto', reminder: { on: false, days: 30 } },
  people: [],
  accounts: [],
  snapshots: [],
});

/* ---------- Config and paths ---------- */
async function readConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG, 'utf8')); } catch { return {}; }
}
async function dataDir() {
  if (process.env.NW1_DATA) return process.env.NW1_DATA;   // used by tests
  const c = await readConfig();
  return c.dataDir || path.join(ROOT, 'data');
}
const dataFile = dir => path.join(dir, 'nw1.json');
const backupDir = dir => path.join(dir, 'backups');

/* ---------- Data ---------- */
async function readData() {
  const dir = await dataDir();
  try { return JSON.parse(await fs.readFile(dataFile(dir), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return EMPTY(); throw e; }
}

// Before the first write of each day, copy the current file into backups/.
async function backupOnce(dir) {
  const src = dataFile(dir);
  if (!existsSync(src)) return;
  const day = new Date().toISOString().slice(0, 10);
  const dst = path.join(backupDir(dir), `nw1-${day}.json`);
  if (existsSync(dst)) return;
  await fs.mkdir(backupDir(dir), { recursive: true });
  await fs.copyFile(src, dst);
  const all = (await fs.readdir(backupDir(dir))).filter(f => /^nw1-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await fs.unlink(path.join(backupDir(dir), f));
}

async function writeData(data) {
  if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.snapshots)) throw new Error('Not a net worth file');
  const dir = await dataDir();
  // Refuse a save made from an out of date copy, for example a second open tab
  const current = await readData();
  if ((current.rev ?? 0) !== (data.rev ?? 0)) { const e = new Error('The data changed somewhere else. Reload the page.'); e.code = 409; throw e; }
  data.rev = (current.rev ?? 0) + 1;
  await fs.mkdir(dir, { recursive: true });
  await backupOnce(dir);
  // Write to a temporary file, then rename, so a crash never leaves half a file
  const tmp = dataFile(dir) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  await fs.rename(tmp, dataFile(dir));
  return data.rev;
}

async function info() {
  const dir = await dataDir();
  let backups = [];
  try { backups = (await fs.readdir(backupDir(dir))).filter(f => f.endsWith('.json')).sort(); } catch {}
  return {
    dataFile: dataFile(dir),
    dataDir: dir,
    backups: backups.length,
    latestBackup: backups.at(-1)?.slice(4, 14) || null,
    reminderInstalled: existsSync(AGENT_PLIST),
  };
}

async function moveData(newDir) {
  if (!newDir || !path.isAbsolute(newDir)) throw new Error('Give the full path of a folder, starting with /');
  const oldDir = await dataDir();
  await fs.mkdir(newDir, { recursive: true });
  // Only copy across when the new folder has no file of its own
  if (!existsSync(dataFile(newDir)) && existsSync(dataFile(oldDir))) await fs.copyFile(dataFile(oldDir), dataFile(newDir));
  const c = await readConfig();
  c.dataDir = newDir;
  await fs.writeFile(CONFIG, JSON.stringify(c, null, 2));
  if (existsSync(AGENT_PLIST)) await installReminder();   // point the reminder at the new file
}

/* ---------- Exchange rates (ECB reference rates via Frankfurter) ---------- */
async function rate(date, from = 'GBP', to = 'SEK') {
  const dir = await dataDir();
  const cacheFile = path.join(dir, 'rates.json');
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch {}
  const today = new Date().toISOString().slice(0, 10);
  const key = date || today;
  // Older caches only held pounds to kronor, keyed by date alone
  const ck = from === 'GBP' && to === 'SEK' && cache[key] ? key : `${key}|${from}|${to}`;
  if (cache[ck] && key !== today) return cache[ck];
  const url = `https://api.frankfurter.dev/v1/${key === today ? 'latest' : key}?from=${from}&to=${to}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Rate service answered ' + r.status);
  const j = await r.json();
  const out = { rate: j.rates[to], source: j.date };
  cache[ck] = out;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache));
  return out;
}

/* ---------- Reminder (macOS LaunchAgent) ---------- */
const run = (cmd, args) => new Promise(res => execFile(cmd, args, (err, stdout, stderr) => res({ err, stdout, stderr })));
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// A stable path to node, so a Homebrew upgrade does not break the reminder
const NODE = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find(p => existsSync(p)) || process.execPath;

async function installReminder() {
  const dir = await dataDir();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(NODE)}</string>
    <string>${xml(path.join(ROOT, 'scripts', 'reminder.mjs'))}</string>
    <string>${xml(dataFile(dir))}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>19</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardErrorPath</key><string>${xml(path.join(dir, 'reminder.log'))}</string>
</dict>
</plist>
`;
  await fs.mkdir(path.dirname(AGENT_PLIST), { recursive: true });
  const uid = String(process.getuid());
  await run('launchctl', ['bootout', `gui/${uid}/${AGENT_LABEL}`]);
  await fs.writeFile(AGENT_PLIST, plist);
  const r = await run('launchctl', ['bootstrap', `gui/${uid}`, AGENT_PLIST]);
  if (r.err) throw new Error('launchctl: ' + (r.stderr || r.err.message).trim());
}
async function removeReminder() {
  await run('launchctl', ['bootout', `gui/${process.getuid()}/${AGENT_LABEL}`]);
  if (existsSync(AGENT_PLIST)) await fs.unlink(AGENT_PLIST);
}
async function testReminder() {
  const dir = await dataDir();
  const r = await run(NODE, [path.join(ROOT, 'scripts', 'reminder.mjs'), dataFile(dir), '--test']);
  if (r.err) throw new Error((r.stderr || r.err.message).trim());
}

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const APP = path.join(ROOT, 'app');
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
async function bodyJson(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 20e6) throw new Error('Too large'); }
  return JSON.parse(s || '{}');
}

const server = http.createServer(async (req, res) => {
  try {
    // Only answer this Mac, by name, so other websites cannot reach in
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, { error: 'Forbidden' });
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      // Changes need a custom header, which browsers never send cross-site without permission
      if (req.method !== 'GET' && req.headers['x-nw1'] !== '1') return send(res, 403, { error: 'Forbidden' });
      if (p === '/api/ping') return send(res, 200, { ok: true });
      if (p === '/api/data' && req.method === 'GET') return send(res, 200, await readData());
      if (p === '/api/data' && req.method === 'PUT') {
        try { return send(res, 200, { ok: true, rev: await writeData(await bodyJson(req)) }); }
        catch (e) { if (e.code === 409) return send(res, 409, { error: e.message }); throw e; }
      }
      if (p === '/api/info') return send(res, 200, await info());
      if (p === '/api/rate') {
        const d = url.searchParams.get('date');
        const from = url.searchParams.get('from') || 'GBP', to = url.searchParams.get('to') || 'SEK';
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return send(res, 400, { error: 'Bad date' });
        if (![from, to].every(c => /^[A-Z]{3}$/.test(c))) return send(res, 400, { error: 'Bad currency' });
        try { return send(res, 200, await rate(d, from, to)); } catch (e) { return send(res, 502, { error: e.message }); }
      }
      if (p === '/api/location' && req.method === 'POST') { await moveData((await bodyJson(req)).dir); return send(res, 200, await info()); }
      if (p === '/api/reminder' && req.method === 'POST') {
        const { on } = await bodyJson(req);
        if (on) await installReminder(); else await removeReminder();
        return send(res, 200, await info());
      }
      if (p === '/api/reminder/test' && req.method === 'POST') { await testReminder(); return send(res, 200, { ok: true }); }
      if (p === '/api/open-folder' && req.method === 'POST') { await run('open', [await dataDir()]); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'Not found' });
    }

    // Static files from app/
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const file = path.join(APP, rel);
    if (!file.startsWith(APP + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    try { return send(res, 200, await fs.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream'); }
    catch { return send(res, 404, 'Not found', 'text/plain'); }
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const i = await info();
  console.log(`Net worth is running at http://localhost:${PORT}`);
  console.log(`Data file: ${i.dataFile}`);
  console.log('Close this window to stop it.');
});
