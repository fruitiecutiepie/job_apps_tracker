# Job Applications Tracker

A polished, local-first job search organizer built with React and TypeScript. It keeps application data in your browser and provides focused views for tracking progress, upcoming work, stale applications, and pipeline statistics—without an account, backend, or synchronization service.

On first launch, the tracker creates 19 editable fictional applications, exactly one in each configured state. They are ordinary records: you can edit, move, or delete them, and reset the app later to restore the original examples.

## Features

- Kanban board with 19 ordered columns, drag-and-drop, and a state-selector fallback
- Sortable and filterable table
- Next actions grouped as overdue, upcoming, or unscheduled
- Calendar driven by next-action dates
- Stale applications with 7-, 14-, and 30-day thresholds
- Current-state and ever-reached statistics derived from application history
- Global company, role, and notes search plus state filtering
- Add, edit, delete, import, export, and confirmed demo-data reset controls
- Append-only state history whenever an application actually changes state
- Responsive layouts and keyboard-accessible forms and dialogs

## Quick start

You need Node.js and pnpm. The repository pins pnpm 10.30.3 through Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed by Vite.

## Using the app

### Track an application

Select **Add application** and enter a company, optional role and URL, its current state, notes, and an optional next action. A next action can be saved without a date; its date is cleared automatically if the action text is removed. URLs must begin with `http://` or `https://`.

Open an existing application from any view to edit or delete it. Moving to another state adds a timestamped history entry. You can move a Kanban card by dragging it or by using its state selector, which also works for keyboard and touch interaction.

### Find the right view

- **Kanban** shows one ordered column per visible state and lets you move applications.
- **Table** supports row filtering and sorting by company, role, state, next action, or last update.
- **Next actions** separates overdue, upcoming, and undated work.
- **Calendar** places applications only by their next-action date; select an item to edit it.
- **Stale** shows applications that have not changed recently, oldest first. Its 7-, 14-, and 30-day threshold is temporary and is not saved.
- **Statistics** compares current state counts with counts for every state applications have previously reached.

The global search and state filters apply across views. Dates, calendar days, overdue status, and stale thresholds use your browser's timezone.

### Back up or replace data

- **Export JSON** downloads the complete canonical tracker document with a timestamped filename.
- **Import JSON** validates a document before asking to replace all current applications. Invalid files and cancelled confirmations do not change saved data.
- **Reset demo data** asks for confirmation and restores the original 19 examples.

Export a backup before importing or resetting if you may need the current data again.

## Data and privacy

All data stays in `localStorage` under `job-applications-tracker:v1`. It is specific to the current browser profile and site origin; there is no server copy. Clearing site data, switching browser profiles, or using a different development origin can make unexported applications unavailable.

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
