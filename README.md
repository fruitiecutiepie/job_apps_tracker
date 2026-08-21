# Job Applications Tracker

A polished, local-first job search organizer built with React and TypeScript. It keeps application data in a JSON file on disk and provides focused views for tracking progress, upcoming work, stale applications, and pipeline statistics—without an account, backend, or synchronization service.

On first launch, `pnpm dev` creates an empty `data/tracker.json`. Use `pnpm dev:demo` for the 19 fictional examples (exactly one in each configured state). Those demo records live under `data/demo/` so they never overwrite real applications.

## Features

- Kanban board with 11 stage columns pairing live and rejected states, drag-and-drop, the next upcoming invite and attachment filenames on cards, a state-selector fallback, and muted styling for applications untouched for 14 days
- Stage prep notes per application, one set per pipeline stage, written in Markdown and read as a foldable outline, opened from a Kanban card or table row with the current stage first
- Optional deadline per application, recording an external closing or decision date separately from your own next action
- Preference ranking from four subjective ratings, discounted for what you have not judged yet, with the weakest dimension named so a healthy average cannot hide a dealbreaker
- Compensation as a measurement rather than a rating: what was advertised, what you expect, and what was offered, kept side by side and compared against your target
- Derived urgency ranking that explains itself, combining stage, scheduled invites, deadline, next-action date, and how long an application has sat in the same state, into one sortable column
- Sortable and filterable table with invites, deadline, urgency, preference, compensation, and attachments columns, where sorting by invite sorts by what is next
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

### Write notes in your own editor

Select **Editor** on a stage note to open it in a real editor. The current draft is written to `data/editing/{applicationId}/{state}.md`, that file is handed to your editor, and anything you save there is pulled back and stored automatically—an editor has no Save button to press, so the app does it for you. The stage's in-app textarea steps aside while the session is live; **Stop** ends it, and closing the dialog ends every session and deletes the scratch files.

Which editor opens is taken from `VISUAL`, then `EDITOR`, then your platform's default handler for `.md`:

```sh
VISUAL="code --wait" pnpm dev
```

Terminal editors such as vim will not work here. The editor is launched detached from the dev server, which owns the only terminal, so a program that needs a TTY has nowhere to draw. Use a GUI command (`code`, `zed`, `subl`) or leave both variables unset and let the platform opener pick.

#### When the app runs on another machine

A spawned editor always opens on the machine running the dev server. If you reach the app over an SSH tunnel or port forward, that is not the machine you are looking at, and the app cannot detect this reliably—a web page has no way to launch anything locally except through a URL scheme an installed app has registered.

Set `TRACKER_EDITOR_URL` and the app hands the browser a URL instead of spawning anything, so your local editor opens it. `{path}` is replaced with the file's absolute path on the server:

```sh
TRACKER_EDITOR_URL='cursor://vscode-remote/ssh-remote+myhost{path}' pnpm dev
```

Use `vscode://vscode-remote/ssh-remote+myhost{path}` for VS Code, where `myhost` is the SSH host alias your editor already uses. Because the URL points at the remote file, your editor opens it over its own remote connection and the app keeps reading changes back—the round-trip still works. For a local checkout, `vscode://file{path}` or `zed://file{path}` is enough.

When nothing is configured and the server looks like it is on a remote host, the banner names the hostname it opened on rather than leaving you wondering why no window appeared. It also shows the absolute path, so you can always open the file yourself.

`tracker.json` remains the source of truth; the files under `data/editing/` are disposable scratch copies and are gitignored. The route is only served by `pnpm dev` and `pnpm start`, and it refuses cross-origin requests since it both writes a file and starts a process.

### Rate what you think of a role

The editor carries four ratings: **Work** (the day-to-day itself), **Growth** (where it
leads), **People** (team and manager), and **Company & product**. Each takes 1–5, or
**Don't know** when you have asked and genuinely cannot tell, and starts at **Not rated**.

Those three states are deliberately different. *Not rated* means you have not looked;
*Don't know* means you looked and the answer is not available, which is information in its
own right. Both cost the same in the score, because either way the decision carries a blind
spot, but the Preference column tells you which it is so you know whether to go ask or just
think for a moment.

The score is the average of what you have judged, discounted for what you have not, so a
fully judged 4.00 outranks a 4.00 with a gap in it. It also names the weakest dimension:
`4.00 · People 1` and a plain `4.00` are the same average, and only one of them has a 1 in
it. An application you have not rated at all is not ranked last — it shows a dash and stays
put whichever way you sort.

Compensation is deliberately **not** a rating. Given a number everyone agrees more is
better, so scoring it 1–5 would throw the number away; it belongs in a field of its own.

### Record what a role pays

The editor carries three compensation figures per application — **Advertised** (what the
posting or recruiter said), **Expected** (what you are aiming for here), and **Offered**
(what arrived in writing) — plus one currency for all three. All three are kept rather than
one current number, because compensation moves and the progression is the point: an offer
that came in under the advertised band is worth seeing.

Every figure is a band, because that is what a posting gives you (`130–150k`). Leave the
**to** box empty for a single number and it reads back the way you typed it. Amounts are
annual base pay in whole units; thousands separators are accepted. An amount needs a
currency to be read in, so saving one without a currency is refused — but a currency with
no amount behind it is simply dropped, the way a next-action date is dropped when the action
goes away.

**Expected** doubles as the target. There is no global salary target because there is
nowhere honest to keep one: the saved document has a closed shape and discards any extra
top-level key, and a single number could not be compared against a per-application currency
anyway. What you would accept genuinely differs by role, level, and country, so it lives on
the application.

The Compensation column states the currency once, then the progression, then how far off
target it lands: `AUD · Advertised 180,000–210,000 · Expected 200,000 · Offered 215,000 ·
8% above target`. The gap is measured between the nearest ends of the two bands, so it only
ever claims what the bands guarantee — `120,000–140,000` against a `135,000` target reads
`within target` rather than being called short from a midpoint nobody quoted. Sorting the
column sorts by the offered figure, or the advertised one when there is no offer; an
application holding only your own expectation has no quoted figure and stays at the bottom
in either direction. That sort compares raw numbers and ignores currency, since there are no
exchange rates to keep, which is why every cell names its currency first.

### Find the right view

- **Kanban** shows 11 stage columns with a labelled lane for each visible state. Live stages pair with their rejected counterpart in the same column. Attachment filenames and a prep notes button appear on cards, and you can move applications by drag-and-drop or the state selector. Cards last updated 14 or more days ago are greyed out and labelled as untouched; they stay on the board with their history.
- **Table** sorts and column-filters by company, role, source, state, next action, deadline, urgency, preference, compensation, attachments, created date, or last update, and gives each row a prep notes button. Columns whose value can be missing—deadline, invites, preference, compensation—keep the rows without one last in either sort direction. The urgency column shows why an application ranks where it does—`Deadline in 3 days`, `Action overdue 2 days`, `No change for 21 days`—and filtering it matches that text. Rejected, accepted, and no-openings applications are not ranked and show `—`. Column filters only affect the table and are not saved. Global search, state, and company filters still apply across views.
- **Focus** answers "what should I do next". Each group heading states its own membership rule, so nothing is hidden behind a mood word: **Overdue or due today**, **Due in 1 to 7 days**, **Due in more than 7 days**, **Action with no date**, **No stage change in more than 7 days**, **Nothing dated or planned**, and a trailing **Finished, action outstanding** for tasks left on rejected, accepted, or no-openings applications. Placement uses the nearest of the soonest upcoming invite, the deadline, and the next-action date, so a date always decides the group; the urgency score only orders rows within it. An application with just an invite, or just a deadline, and no action of its own appears here too. Silence is measured from the last actual state change, not from the last edit, so fixing a typo does not make an application look like it moved. Groups collapse and expand—only the leading non-empty group starts open, and that choice is never saved.
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
