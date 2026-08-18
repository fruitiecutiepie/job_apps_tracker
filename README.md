# Job Applications Tracker

A polished, local-first job search organizer built with React and TypeScript. It keeps application data in a JSON file on disk and provides focused views for tracking progress, upcoming work, stale applications, and pipeline statistics—without an account, backend, or synchronization service.

On first launch, `pnpm dev` creates an empty `data/tracker.json`. Use `pnpm dev:demo` for the 19 fictional examples (exactly one in each configured state). Those demo records live under `data/demo/` so they never overwrite real applications.

## Features

- Kanban board with 11 stage columns pairing live and rejected states, drag-and-drop, the next upcoming invite and attachment filenames on cards, a state-selector fallback, and muted styling for applications untouched for 14 days
- Stage prep notes per application, one set per pipeline stage, written in Markdown and read as a foldable outline, opened from a Kanban card or table row with the current stage first
- Optional deadline per application, recording an external closing or decision date separately from your own next action
- Derived urgency ranking that explains itself, combining stage, scheduled invites, deadline, next-action date, and silence into one sortable column
- Sortable and filterable table with invites, deadline, urgency, and attachments columns, where sorting by invite sorts by what is next
- Focus view grouping live applications by what is most pressing, with collapsible groups and a reason on every row
- Calendar invites imported from the `.ics` a recruiter sends, filed against a stage, with a rescheduled invite replacing the one it supersedes
- Calendar showing next-action dates and invites together, day by day
- Stale applications with 7-, 14-, and 30-day thresholds, plus a Move to Rejected shortcut to the current state's counterpart
- Current-state and ever-reached statistics derived from application history
- Global company, role, notes, stage prep note, and invite search plus state filtering
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

Select **Add application** and enter a company, optional role and URL, its current state, notes, and an optional next action. A next action can be saved without a date; its date is cleared automatically if the action text is removed. A deadline is separate: it records an external closing or decision date and can be set with no next action at all. URLs must begin with `http://` or `https://`.

Open an existing application from any view to edit or delete it. Moving to another state adds a timestamped history entry. You can move a Kanban card by dragging it or by using its state selector, which also works for keyboard and touch interaction.

### Link a calendar invite to a stage

Open an application and use **Import .ics file** under Interview invites to read the calendar attachment a
recruiter emailed you. The time, place, and joining link come from the file; the stage it is filed under
defaults to the application's current state, and you can change it to any other. **Add invite manually**
records one by hand instead, for an interview arranged over the phone.

Re-importing a rescheduled invite updates the one it replaces rather than adding a second, because invites are
matched on the calendar UID inside the file. The stage you filed it under survives the update, and an invite
older than the one you already have is ignored. Cancelled invites stay on the record, marked as cancelled, so
you can see what was called off.

Invites appear on the Calendar beside dated next actions, and a Kanban card shows the next one still ahead.
The table's Invites column lists them all, filters on their text, and sorts by whichever is next. Their text
is searchable from the global search box.

The tracker reads invites; it does not talk to your calendar. Nothing is sent anywhere, and nothing changes in
Google Calendar or Outlook when you edit an invite here.

### Prepare for a stage

Select **Prep notes** on a Kanban card or table row to record what you need for a stage: questions to ask, stories to tell, names to remember. Each stage of the pipeline holds its own notes, and the dialog opens with the application's current stage first so it is the first thing on screen during the interview.

Add notes for a stage you have not reached yet with **Add notes for another stage**—useful for drafting offer questions while you are still interviewing. Clearing a stage's notes removes them when you save. Prep notes are searchable from the global search box.

Notes are written in Markdown. A stage that already has notes opens as a rendered outline, ready to read; select **Edit** on it to change the text, and **Read** to go back. Empty stages open straight in the editor, which has a toolbar for bold, italic, heading, and bullet point.

Supported syntax is a practical subset: `#` through `######` headings, `-` or `1.` lists that nest when you indent them, `**bold**`, `_italic_`, `` `code` ``, `>` block quotes, fenced code blocks, and `[links](https://example.com)`. Links open only for `http`, `https`, and `mailto` targets.

In the reading view **everything with hierarchy folds**, so you can collapse a long note to its shape and open only the part you need mid-interview:

- **Headings** fold everything beneath them, through to the next heading of the same or higher level.
- **Bullets** fold whatever sits under them—sub-bullets, a detail paragraph, a quote, a code block.
- **Quotes** and **code blocks** fold behind a one-line summary.
- **Collapse all** folds a whole note at once, and turns into **Expand all**.

Click anywhere on a heading, point, quote summary, or code summary to fold it—not just the chevron. Clicking a link inside a point follows the link, and selecting text to copy it does not fold anything.

A line that simply wraps a bullet stays part of that bullet. To give a point foldable detail, leave a blank line and indent the detail under it:

```markdown
- Timeline

  They want an answer by Friday.
```

What you have folded is never saved—it resets each time you open the dialog.

### Find the right view

- **Kanban** shows 11 stage columns with a labelled lane for each visible state. Live stages pair with their rejected counterpart in the same column. Attachment filenames and a prep notes button appear on cards, and you can move applications by drag-and-drop or the state selector. Cards last updated 14 or more days ago are greyed out and labelled as untouched; they stay on the board with their history.
- **Table** sorts and column-filters by company, role, source, state, next action, deadline, urgency, attachments, created date, or last update, and gives each row a prep notes button. Sorting by deadline puts applications without one last. The urgency column shows why an application ranks where it does—`Deadline in 3 days`, `Action overdue 2 days`, `No change for 21 days`—and filtering it matches that text. Rejected, accepted, and no-openings applications are not ranked and show `—`. Column filters only affect the table and are not saved. Global search, state, and company filters still apply across views.
- **Focus** answers "what should I do next". Each group heading states its own membership rule, so nothing is hidden behind a mood word: **Overdue or due today**, **Due in 1 to 7 days**, **Due in more than 7 days**, **Action with no date**, **No change in more than 7 days**, **Nothing dated or planned**, and a trailing **Finished, action outstanding** for tasks left on rejected, accepted, or no-openings applications. Placement uses the nearest of the soonest upcoming invite, the deadline, and the next-action date, so a date always decides the group; the urgency score only orders rows within it. An application with just an invite, or just a deadline, and no action of its own appears here too. Groups collapse and expand—only the leading non-empty group starts open, and that choice is never saved.
- **Calendar** places applications only by their next-action date; select an item to edit it.
- **Stale** shows applications that have not changed recently, oldest first. Its 7-, 14-, and 30-day threshold is temporary and is not saved. When the current state has a rejected counterpart, **Move to Rejected** records that outcome and keeps the history.
- **Statistics** compares current state counts with counts for every state applications have previously reached.

The global search, state, and company filters apply across views. Dates, calendar days, overdue status, and stale thresholds use your browser's timezone.

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
