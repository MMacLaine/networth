# Net worth

A net worth tracker you fill in by hand. Write down what your accounts, pensions, home and loans are worth whenever you like, and see the history as charts. There is no bank syncing and no account to sign up for.

You can use it in the browser at [maclaine.se/networth](https://maclaine.se/networth/), where your figures stay in that browser. This repo is the same app, and it can also run on your own Mac with the data in a file you control.

## What it does

- **Update**: every account with its last figure shown faded. Type what changed, leave the rest blank and press Save snapshot. "Figures as of" lets you add an earlier date, and Estimate marks a placeholder.
- **Overview**: net worth over time, by type, by person and within reach, plus owned and owed, what moved it, month by month and asset values.
- **History**: every save. Open one to correct its figures, date, estimates or note, or delete it.
- **Household** (optional): insurance, memberships and where the papers are, with a checklist of the usual cover in Sweden.
- **Settings**: people (one to four, plus Joint), main currency, a goal, take-home pay, an optional UK State Pension, export, CSV import and an example with made-up figures.

Accounts can be in a different currency from the main one. The day's rate comes from the European Central Bank's reference rates through [Frankfurter](https://frankfurter.dev) and is stored with each snapshot, so old totals never shift.

## Running it on your Mac

Needs Node 18 or later. No dependencies.

```
node server.mjs
```

Then open http://localhost:4747. `Net Worth.command` does the same with a double click, and `scripts/background.sh install` keeps it running in the background from login (`remove` switches that off).

The data is one file, `data/nw1.json`, with a dated copy in `data/backups/` before the first change of each day (the last 90 are kept). Settings can move it to another folder, for example Google Drive. `data/` is in `.gitignore` and never meant to be committed.

Settings, Reminder installs a macOS LaunchAgent that runs `scripts/reminder.mjs` at 7pm and shows a notification when you have not updated for a while.

## Importing history

Settings, Add history from a spreadsheet takes a CSV with the columns `date, account, provider, type, owner, currency, value, owed, estimate, note`. Download the template there to see the layout. Semicolon separated files and decimal commas work too.

## Files

| | |
|---|---|
| `app/` | The page: `index.html`, `styles.css`, `app.js` and the font. `web.css` is the maclaine.se look, loaded by the web copy only |
| `server.mjs` | The local server: app, data file, backups, exchange rates, reminder. Listens on this Mac only |
| `Net Worth.command` | Double click to open it |
| `scripts/background.sh` | Switch background running on or off |
| `scripts/reminder.mjs` | The daily reminder check |
| `scripts/publish-site.mjs` | Builds the browser-only copy for maclaine.se, with the site's header, footer, fonts and theme |

## Licence

MIT, see [LICENSE](LICENSE).
