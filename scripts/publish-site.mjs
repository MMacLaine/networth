// Copies the app into the maclaine.se checkout as a browser-only page at /networth/.
// The copy gets the site's look on top (web.css, the shared header and footer, tokens and fonts).
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
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const SITE = process.argv[2] || path.join(os.homedir(), 'personal website');
const OUT = path.join(SITE, 'networth');
const URL = 'https://maclaine.se/networth/';
// The share image lives in the site checkout (made by _local/redesign/og/make-og.mjs there)
const IMAGE = 'https://maclaine.se/images/og/networth.png';

const TITLE = 'Net worth · Track what you own and owe';
const DESC = 'A free net worth tracker in your browser. Note what your accounts, pensions, home and loans are worth and see the history. Your figures stay on your device.';

if (!existsSync(path.join(SITE, 'index.html'))) throw new Error(`No site checkout at ${SITE}`);
if (!existsSync(path.join(SITE, 'images', 'og', 'networth.png'))) throw new Error('The share image images/og/networth.png is missing from the site checkout');

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const js = await fs.readFile(path.join(APP, 'app.js'));
const css = await fs.readFile(path.join(APP, 'styles.css'));
const webCss = await fs.readFile(path.join(APP, 'web.css'));
let html = await fs.readFile(path.join(APP, 'index.html'), 'utf8');

// The site's shared footer and theme snippet, taken from the live homepage and
// _dev/theme-snippet.html, so the copy always matches them (and the link baker still finds
// its <!-- links:... --> blocks). The local app never gets these.
const home = await fs.readFile(path.join(SITE, 'index.html'), 'utf8');
const cut = (re, what) => { const m = home.match(re); if (!m) throw new Error(`The homepage no longer has ${what}`); return m[0]; };
// The header comes from the site's generator for this page's path, so Net Worth is marked
// as the current page under Things I build (the homepage's copy marks nothing).
const links = createRequire(import.meta.url)(path.join(SITE, 'site-links.js'));
const siteHead = (links.chromeHeader({ lang: 'en', path: '/networth/' }).match(/<header class="site-head[\s\S]*?<\/header>/) || [])[0];
if (!siteHead) throw new Error('site-links.js chromeHeader no longer returns a header');
const siteFoot = cut(/<footer class="site-foot"[\s\S]*?<\/footer>/, 'the site footer');
const skip = cut(/<a href="#main" class="skip-link">[^<]*<\/a>/, 'the skip link');
const themeSnippet = (await fs.readFile(path.join(SITE, '_dev', 'theme-snippet.html'), 'utf8')).trim();
// The tokens version the site's pages use (verify.js gate 8b), read from the homepage.
const tokensV = (home.match(/\/assets\/tokens\.css\?v=(\d+)/) || [])[1];
if (!tokensV) throw new Error('index.html no longer links /assets/tokens.css?v=N');

const head = `<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="${URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MacLaine">
<meta property="og:url" content="${URL}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="${IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${IMAGE}">
<link rel="icon" type="image/svg+xml" href="/assets/site/favicon.svg">
<link rel="apple-touch-icon" href="/assets/site/apple-touch-icon.png">
<meta name="theme-color" content="#BCC6BD" data-light="#BCC6BD" data-dark="#242A25">
${themeSnippet}
<link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/assets/tokens.css?v=${tokensV}">
<link rel="stylesheet" href="/assets/chrome.css?v=2">`;

const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains ${from}`);
  html = html.replace(from, () => to);
};
swap('<html lang="en">', '<html lang="en" data-mode="web" data-look="lav">');
swap('<title>Net worth</title>', head);
// Versioned names, so a new page never runs with a cached older script
swap('href="styles.css">', `href="styles.css?v=${hash(css)}">\n<link rel="stylesheet" href="web.css?v=${hash(webCss)}">`);
swap('<script src="app.js">', `<script src="/assets/chrome.js?v=2"></script>\n<script src="app.js?v=${hash(js)}">`);
// The site header is the page's banner, so the app's own bar becomes a plain block with the h1
swap('<header class="app-top">', '<div class="app-top">');
swap('</header>\n<div class="demo-bar"', '</div>\n<div class="demo-bar"');
swap('<div class="brand">Net worth</div>', '<h1 class="brand">Net worth</h1>');
swap('<body>\n', `<body>\n${skip}\n\n${siteHead}\n`);
swap('<main class="wrap">', '<main class="wrap" id="main">');
swap('</main>\n', `</main>\n\n${siteFoot}\n`);

// Names of the real people in the local data must never ship
const names = [];
try {
  const d = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'nw1.json'), 'utf8'));
  for (const p of d.people || []) if (p.name && p.name.length > 2) names.push(p.name);
} catch {}
// The credit line is the one place a name belongs in the app itself
const CREDIT = 'Matthew MacLaine';
for (const [file, raw] of [['index.html', html], ['app.js', js.toString()], ['styles.css', css.toString()], ['web.css', webCss.toString()]]) {
  // The site's own header and footer are copied from the homepage and checked there
  const text = [siteHead, siteFoot, CREDIT].reduce((t, part) => t.split(part).join(''), raw);
  const hit = names.find(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  if (hit) throw new Error(`${file} contains the name "${hit}" from your own data. Nothing was written.`);
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'fonts'), { recursive: true });
await fs.writeFile(path.join(OUT, 'index.html'), html);
await fs.writeFile(path.join(OUT, 'app.js'), js);
await fs.writeFile(path.join(OUT, 'styles.css'), css);
await fs.writeFile(path.join(OUT, 'web.css'), webCss);
for (const f of await fs.readdir(path.join(APP, 'fonts'))) await fs.copyFile(path.join(APP, 'fonts', f), path.join(OUT, 'fonts', f));

const files = [];
const walk = async dir => { for (const e of await fs.readdir(dir, { withFileTypes: true })) e.isDirectory() ? await walk(path.join(dir, e.name)) : files.push(path.relative(SITE, path.join(dir, e.name))); };
await walk(OUT);
console.log(`Wrote ${files.length} files to ${OUT}:`);
for (const f of files) console.log('  ' + f);
