# Job Applications Tracker

A polished, local-first job search organizer built with React and TypeScript. It keeps application data in a JSON file on disk and provides focused views for tracking progress, upcoming work, stale applications, and pipeline statistics—without an account, backend, or synchronization service.

On first launch, `pnpm dev` creates an empty `data/tracker.json`. Use `pnpm dev:demo` for the 19 fictional examples (exactly one in each configured state). Those demo records live under `data/demo/` so they never overwrite real applications.

## Features

- Kanban board with 19 ordered columns, drag-and-drop, attachment filenames on cards, a state-selector fallback, and muted styling for applications untouched for 14 days
- Sortable and filterable table with an attachments column
- Next actions grouped as overdue, upcoming, or unscheduled
- Calendar driven by next-action dates
- Stale applications with 7-, 14-, and 30-day thresholds, plus a Move to Rejected shortcut to the current state's counterpart
- Current-state and ever-reached statistics derived from application history
- Global company, role, and notes search plus state filtering
- Add, edit, delete, import, and export controls, plus confirmed demo-data reset in the demo profile
- Append-only state history whenever an application actually changes state
- Responsive layouts and keyboard-accessible forms and dialogs

## Quick start

You need Node.js and pnpm. The repository pins pnpm 10.30.3 through Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed by Vite. The tracker reads and writes `data/tracker.json` in the project directory through the dev server.

To work with the 19 example applications instead:

```sh
pnpm dev:demo
```

That command uses `data/demo/tracker.json` and `data/demo/attachments/`, separate from live data.

For a production build with the same file-backed database:

```sh
pnpm build
pnpm start
```

Use `pnpm start:demo` after a build to preview against the demo database.

## Using the app

### Track an application

Select **Add application** and enter a company, optional role and URL, its current state, notes, and an optional next action. A next action can be saved without a date; its date is cleared automatically if the action text is removed. URLs must begin with `http://` or `https://`.

Open an existing application from any view to edit or delete it. Moving to another state adds a timestamped history entry. You can move a Kanban card by dragging it or by using its state selector, which also works for keyboard and touch interaction.

### Find the right view

- **Kanban** shows one ordered column per visible state, attachment filenames on cards, and lets you move applications. Cards last updated 14 or more days ago are greyed out and labelled as untouched; they stay on the board with their history.
- **Table** supports row filtering and sorting by company, role, state, next action, or last update, plus an attachments column.
- **Next actions** separates overdue, upcoming, and undated work.
- **Calendar** places applications only by their next-action date; select an item to edit it.
- **Stale** shows applications that have not changed recently, oldest first. Its 7-, 14-, and 30-day threshold is temporary and is not saved. When the current state has a rejected counterpart, **Move to Rejected** records that outcome and keeps the history.
- **Statistics** compares current state counts with counts for every state applications have previously reached.

The global search and state filters apply across views. Dates, calendar days, overdue status, and stale thresholds use your browser's timezone.

### Back up or replace data

- **Export** downloads a zip archive with `tracker.json` and any attachment files.
- **Import** accepts zip archives or legacy JSON. Zip import validates the document before asking to replace all current applications and attachments.
- **Reset demo data** appears only when running `pnpm dev:demo` or `pnpm start:demo`. It asks for confirmation and restores the original 19 examples in `data/demo/`.

Export a backup before importing or resetting if you may need the current data again.

## Data and privacy

All live data stays in `data/tracker.json` inside the project directory (gitignored), with attachment files in `data/attachments/` (also gitignored). Demo data uses `data/demo/tracker.json` and `data/demo/attachments/`. The dev server and preview commands read and write the active profile's paths through `/__db` and `/__attachments`. There is no remote server copy. Export a backup before importing or resetting if you may need the current data again.

On first launch after this upgrade, a valid legacy `localStorage` document from the same browser origin is copied into `data/tracker.json` once, then browser storage is cleared.

## Development checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:smoke
pnpm build
```

Use `pnpm test:watch` while developing. The automated smoke test and optional browser checklist are documented in [SMOKE_TEST.md](./SMOKE_TEST.md).

Contributor architecture, invariants, and common traps are documented in [AGENTS.md](./AGENTS.md).
