# TimeBox 2 — Stage 1

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
