// Run once a day by the macOS LaunchAgent that Settings installs.
// Reads the data file and shows a Mac notification when the last
// update is older than the reminder interval. Nothing leaves the Mac.
//
//   node reminder.mjs <path to nw1.json> [--test]

import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';

const [file, flag] = process.argv.slice(2);
const test = flag === '--test';

const notify = (title, text) => new Promise(res => {
  const q = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  execFile('osascript', ['-e', `display notification ${q(text)} with title ${q(title)}`], () => res());
});

let data;
try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
catch (e) { console.error(new Date().toISOString(), 'Could not read', file, e.message); process.exit(test ? 1 : 0); }

const r = data.settings?.reminder || {};
const last = data.snapshots?.map(s => s.at).sort().at(-1);
const days = last ? Math.floor((Date.now() - new Date(last)) / 864e5) : null;

if (test) {
  await notify('Net worth', days === null ? 'Reminders work. Add your first figures when you are ready.' : `Reminders work. Your last update was ${days} ${days === 1 ? 'day' : 'days'} ago.`);
} else if (r.on && (days === null || days >= (r.days || 30))) {
  await notify('Net worth', days === null ? 'Nothing recorded yet. Open Net worth to add your first figures.' : `Your last update was ${days} days ago. Open Net worth to add today's figures.`);
}
