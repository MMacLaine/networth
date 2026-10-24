// Copies the app into the maclaine.se checkout as a browser-only page at /networth/.
// The copy keeps its data in localStorage; nothing under data/ is ever read into it,
// and the build stops if any name from the local data file turns up in the output.
//
//   node scripts/publish-site.mjs ["/path/to/personal website"]

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const SITE = process.argv[2] || path.join(os.homedir(), 'personal website');
const OUT = path.join(SITE, 'networth');
const URL = 'https://maclaine.se/networth/';

const TITLE = 'Net worth · Track what you own and owe';
const DESC = 'A free net worth tracker in your browser. Note what your accounts, pensions, home and loans are worth and see the history. Your figures stay on your device.';

if (!existsSync(path.join(SITE, 'index.html'))) throw new Error(`No site checkout at ${SITE}`);

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const js = await fs.readFile(path.join(APP, 'app.js'));
const css = await fs.readFile(path.join(APP, 'styles.css'));
let html = await fs.readFile(path.join(APP, 'index.html'), 'utf8');

const head = `<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="${URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MacLaine">
<meta property="og:url" content="${URL}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">`;

const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains ${from}`);
  html = html.replace(from, to);
};
swap('<html lang="en">', '<html lang="en" data-mode="web">');
swap('<title>Net worth</title>', head);
// Versioned names, so a new page never runs with a cached older script
swap('href="styles.css"', `href="styles.css?v=${hash(css)}"`);
swap('src="app.js"', `src="app.js?v=${hash(js)}"`);

// Names of the real people in the local data must never ship
const names = [];
try {
  const d = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'nw1.json'), 'utf8'));
  for (const p of d.people || []) if (p.name && p.name.length > 2) names.push(p.name);
} catch {}
// The credit line is the one place a name belongs
const CREDIT = 'Matthew MacLaine';
for (const [file, raw] of [['index.html', html], ['app.js', js.toString()], ['styles.css', css.toString()]]) {
  const text = raw.split(CREDIT).join('');
  const hit = names.find(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  if (hit) throw new Error(`${file} contains the name "${hit}" from your own data. Nothing was written.`);
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'fonts'), { recursive: true });
await fs.writeFile(path.join(OUT, 'index.html'), html);
await fs.writeFile(path.join(OUT, 'app.js'), js);
await fs.writeFile(path.join(OUT, 'styles.css'), css);
for (const f of await fs.readdir(path.join(APP, 'fonts'))) await fs.copyFile(path.join(APP, 'fonts', f), path.join(OUT, 'fonts', f));

const files = [];
const walk = async dir => { for (const e of await fs.readdir(dir, { withFileTypes: true })) e.isDirectory() ? await walk(path.join(dir, e.name)) : files.push(path.relative(SITE, path.join(dir, e.name))); };
await walk(OUT);
console.log(`Wrote ${files.length} files to ${OUT}:`);
for (const f of files) console.log('  ' + f);
