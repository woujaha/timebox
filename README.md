# TimeBox 2 — Stage 2

Mobile-ready rebuild of TimeBox. Works on laptop and iPhone, installs as a home-screen app (Stage 2), and is prepared for Google Calendar + Drive sync (Stage 3).

## Files

| File | What it is |
|---|---|
| `index.html` | The app's page |
| `styles.css` | Layout for laptop and phone |
| `app.js` | All app logic, including the TimeBox 1 importer |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable on iPhone and work offline |

Keep all files together in one folder. Don't rename them.

## Your data

- TimeBox 2 stores data under its own key (`tb2_state`). It never touches or deletes your TimeBox 1 data.
- Import accepts the backup file from TimeBox 1's **Export** button, and TimeBox 2 backups.
- Before any import you see a summary; afterwards **Settings → Undo last import** restores the previous state.
- Until Drive sync arrives (Stage 3), data lives on each device separately. Use **Export** for backups.

## What changed from TimeBox 1

- Phone layout: bottom tab bar, block editor as a slide-up sheet, 16px inputs (no iOS zoom), safe-area aware.
- Touch: tap a block to edit · hold ~⅓ s then drag to move · drag the bottom bar to resize · tap an empty slot to add · **+** button.
- Overlapping blocks sit side by side instead of on top of each other.
- Priorities are per day. "Bring N unfinished from …" and the Review carry-forward actually move items now (TimeBox 1's carry-forward silently did nothing).
- Week view: Monday start, blocks line up with the hour grid (they were misaligned before), the correct blocks show when you've navigated to another day, job deadlines/follow-ups/interviews appear.
- Timer always follows *today's* schedule, even when you're looking at another day.
- Job Search: real date fields for deadline, interview (date + time + duration) and follow-up; list sorted by what's coming up. Old free-text deadlines are converted; unreadable ones are kept as a note and flagged.
- Each block has a **Google Calendar** setting (Auto / Main / TimeBox / Don't sync). Auto = Meetings → main calendar, everything else → TimeBox calendar. Nothing syncs yet — that's Stage 3.
- Autosave on every change (no Save/Restore buttons), undo for every delete (⌘Z or the toast's Undo), review text saved as you type.

## Stage 2 additions

- **Cleaner phone lists:** priorities, tasks, braindump and checklist use the same compact text as the Review; tools sit behind **⋯**. Long items wrap instead of being cut off.
- **Planned vs done:** mark blocks ✓ done · ½ partly · ✕ skipped (block editor or Review → "How did the blocks go?"). Time Allocation shows done against planned per category; Review shows hours done and skipped.
- **Sprints are logged:** a finished (or stopped, 5+ min) 25-min sprint becomes a done block on your schedule.
- **Dark mode:** Settings → Appearance (Auto / Light / Dark), per device.
- **Weekly Checklist** (Planning): the 12-item Weekly Action Checklist from the Career Suite's Job Search Plan. Resets every Monday, keeps 8 weeks of history, + Schedule on each item, editable.
- **Job Search Plan project:** the one-off setup steps, added once as tasks.
- **Reading List:** the Case Studies tab is renamed so it isn't confused with the Career Suite's own case studies. Same data.
- **Materials links:** on blocks, jobs and projects, plus a pinned **Library** card in Planning. One link per line, optionally `Label | link`.
- **Jobs:** posting link and source fields; marking a role Applied sets a follow-up 10 days out if none is set.
- **Housekeeping:** search engines told not to index the page; placeholders made generic; updates load reliably.
