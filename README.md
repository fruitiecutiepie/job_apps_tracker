# Job Applications Tracker

A polished, local-first job search organizer built with React and TypeScript. It keeps application data in a JSON file on disk and provides focused views for tracking progress, upcoming work, stale applications, and pipeline statistics—without an account, backend, or synchronization service.

On first launch, `pnpm dev` creates an empty `data/tracker.json`. Use `pnpm dev:demo` for the 19 fictional examples (exactly one in each configured state). Those demo records live under `data/demo/` so they never overwrite real applications.

## Features

- Kanban board with 11 stage columns pairing live and rejected states, drag-and-drop, the next upcoming invite and attachment filenames on cards, a state-selector fallback, and muted styling with an `Idle 30 days` label for live applications that have not changed stage in 30 days
- Stage prep notes per application, one set per pipeline stage, written in Markdown and read as a foldable outline, opened from a Kanban card or table row with the current stage first
- Captured lines per stage, recording what an interviewer tells you as you are told it, stored the moment they are entered and pinned on screen under the prep note however far it scrolls
- Optional deadline per application, recording an external closing or decision date separately from your own next action
- Preference ranking from four subjective ratings, discounted for what you have not judged yet, with the weakest dimension named so a healthy average cannot hide a dealbreaker, shown on the table row and the Kanban card, summarised across the collection on Statistics, and used to break ties within a Focus group
- Compensation as a measurement rather than a rating: what was advertised, what you expect, and what was offered, kept side by side and compared against your target
- Derived urgency ranking that explains itself, combining stage, scheduled invites, deadline, next-action date, and how long an application has sat in the same state, into one sortable column
- Sortable and filterable table with invites, deadline, urgency, preference, compensation, and attachments columns, where sorting by invite sorts by what is next
- Focus view grouping live applications by what is most pressing, with collapsible groups and a reason on every row, and a **Done** control that clears a finished task and records it as a dated completed action, kept apart from your notes
- Calendar invites imported from the `.ics` a recruiter sends, filed against a stage, with a rescheduled invite replacing the one it supersedes
- Calendar showing next-action dates and invites together, day by day
- Stale applications with 7-, 14-, and 30-day thresholds, plus a Move to Rejected shortcut to the current state's counterpart
- Current-state and ever-reached statistics derived from application history
- Global company, role, notes, stage prep note, and invite search plus state and activity filtering
- Add, edit, delete, import, and export controls, plus confirmed demo-data reset in the demo profile
- Append-only state history whenever an application actually changes state
- Responsive layouts, keyboard-accessible forms and dialogs, and keyboard shortcuts for splitting, finding, and navigating the stage notes panel

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

Select **Done** beside a next action — on a Focus row, a Kanban card, or in the table's next
action column — when you have finished it. The task moves to that application's **Completed
actions**, a dated record kept separately from Notes, and the next action clears. The deadline
is left alone, since a closing date is not something you complete, and finishing a task is not
a stage change, so no history entry is added. Applications with nothing left to do fall into
Focus's **No stage change in more than 7 days** or **Nothing dated or planned** group, which is
where you decide what is next.

Completed actions are records rather than lines appended to your notes. Notes is prose you
write and rewrite; a completed action is one line the app writes the moment you press Done.
Keeping them apart means editing your notes can never disturb the record, the date is not
something to parse back out of a sentence, and a Done pressed by mistake can be removed.

Open an application to see the whole list, newest first, above Notes. **Done** sits on the same
row as the next action and its date there, so you can finish a task while editing, and
**Remove** deletes an entry you did not mean to record. Both are drafts until you save, like everything else in that dialog. Removing an entry
does not put the task back on your plan — undoing the record is not the same as undoing the
work, and the app does not guess which you meant.

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

Notes are written in Markdown. A stage that already has notes opens as a rendered outline, ready to read; select **Edit** on it to change the text, and **Read** to go back. Empty stages open straight in the editor, which has a toolbar for bold, italic, heading, and bullet point, and **Collapse all**.

### Capture what you are told

Every stage has a **Heard** log docked beneath its prep note, holding what you were told during that stage. Type a line in the capture box and press Enter: it is stored immediately—there is no Save to remember mid-conversation, and nothing to lose by closing the panel. `Ctrl`/`Cmd+K` puts the caret in the box from anywhere in the panel, and in a split panel it lands in the pane you are reading.

The dock stays on screen however far the prep note above it scrolls, so what you have been told and the box you add to are both always in view. The log takes what it needs and then scrolls on its own, holding the newest line in sight. Lines are grouped under the day they were captured on, and each carries the time it was captured. The date is said once, at the head of the day, rather than on every line. Each line is Markdown, so `**bold**` and links work in it.

Captures are stored separately from what you prepared, which has three consequences worth knowing:

- Clearing a stage's prep notes does not unsay what you were told in it. The note stays, with a blank body and its captures intact.
- **Correct** opens the lines for editing, one box each, with the time each was captured beside it. Enter or leaving a box stores it, Escape puts the line back, and the bin removes it. A line's time does not move when you correct it: an edit fixes what was written down, it does not claim the line was said later.
- Captures stay on screen and writable while you are editing the prep note, or while that note is open in an external editor. There is no shared text for the two to race over.
- Saving the panel never rewrites a capture, and Cancel never rolls one back. Corrections are stored as they are made, the same way captures are, so there is nothing here for a Save to be waiting on.

Supported syntax is a practical subset: `#` through `######` headings, `-` or `1.` lists that nest when you indent them, `**bold**`, `_italic_`, `` `code` ``, `>` block quotes, fenced code blocks, and `[links](https://example.com)`. A URL or email address pasted in bare links itself, as does one written inside `<…>`; trailing sentence punctuation stays out of the link. A `[link](#heading)` to one of the note's own headings jumps to it, opening whatever fold it sits inside, so a note that arrives with its own contents list works as written. Links out open only for `http`, `https`, and `mailto` targets.

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

Notes fold while you are **writing** them as well as while you are reading them, along the same
headings, points, quotes, and code blocks. The chevrons stand inside the box, down its left edge
against the lines they fold—a textarea has no room in its text for anything that is not text, so
they are drawn over the padding the text is already held off by—and **Collapse all** sits in the
formatting toolbar. What is folded is taken out of the box, not out of the note: it is still
stored, still saved, still searched, and still counted by the word count.

Two things follow from a folded note being smaller than the note itself:

- An edit that would reach through a fold—backspacing the line break at the end of a folded
  heading, say—opens that fold instead of making the edit. Quietly swallowing lines you cannot see
  is worse than a keystroke that has to be pressed twice.
- The find opens any fold holding a match while it is running, and picking a heading from the
  outline opens whatever it is written inside, the same as in the reading view. Both close back up
  afterwards, so the note keeps the shape you left it in.

Folds follow the lines they belong to as you type: writing a new section above a folded one leaves
it folded, and deleting a heading takes its fold with it.

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

### Keyboard shortcuts

The stage notes panel binds five shortcuts while it is open. They are bound to the document rather than to a particular field, so they work wherever the caret is in the panel. You do not have to come back here for them: the keyboard button in the panel's title bar lists all five, and the **Split**, **Go to stage**, **Find**, and outline controls each name the shortcut they share, in a tooltip and to a screen reader. The panel answers `Ctrl` and `Cmd` alike whatever you are on; the labels show the one your own platform writes.

- `Ctrl`/`Cmd+\` opens a second pane beside the one you are reading, on the first other stage the application has, and closes back to one pane when pressed again. An application with only one stage has nothing to split to, so nothing happens.
- `Ctrl`/`Cmd+F` opens the find bar. It deliberately takes over the browser's own find, which cannot see text inside a folded note. `Enter` steps to the next match and `Shift+Enter` to the previous; `Escape` closes the bar rather than the panel.
- `Ctrl`/`Cmd+P` opens the stage picker. Type to narrow it, `ArrowUp` and `ArrowDown` move through the results, `Enter` opens the highlighted stage—reopening one you had closed, or adding one you have not reached—and `Escape` dismisses it.
- `Ctrl`/`Cmd+B` shows and hides the outline sidebar.
- `Ctrl`/`Cmd+K` puts the caret in the capture box, and in a split panel it lands in the pane you are reading.

Elsewhere, `Escape` closes any dialog, `Tab` cycles within it rather than escaping to the page behind, and the compensation amount fields take arrow keys to nudge a figure by 5,000—10,000 with `Shift`.

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

The same text appears on the Kanban card, so the board tells you what you think of a role
while you are moving it along. Statistics turns the whole collection into a picture of how
you judge roles at all, which no single row can: how many you have rated, the mean across
them, and per dimension how many are judged, how many you could not tell, how many you have
never looked at, and the mean of the judgements you did make. That last table is where you
find out whether **People** reads low because you keep rating it low or because you have
never assessed it.

Preference deliberately does **not** feed the urgency score or decide which Focus group an
application lands in. A rating is what you want; a deadline is when it is due, and letting
one bend the other would sink a deadline due today under a nicer role due next week. Inside
a Focus group it is the last thing consulted: where the date and the score have already
tied, the role you think more of goes first, and rows you have not rated stay put.

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
annual base pay in whole units; thousands separators are accepted, and the arrow keys nudge
a figure by 5,000 — 10,000 with Shift — so adjusting an offer does not mean retyping it. An
amount needs a currency to be read in, so saving one without a currency is refused — but a
currency with no amount behind it is simply dropped, the way a next-action date is dropped
when the action goes away.

The currency is a picker rather than a text box, since it is the field easiest to get wrong
and there are only so many answers. It always includes whatever the application already
holds, so a code imported from elsewhere is never quietly replaced; imports still accept any
three-letter code.

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

The column's filter is a range rather than a text box: pick **Any stage**, **Advertised**,
**Expected**, or **Offered**, then a minimum, a maximum, or both. A bound checks overlap
against the relevant band, so a `120,000–150,000` query catches a `100,000–130,000` posting;
leaving one bound blank reads as "at least" or "at most" rather than as zero. **Any stage**
checks all three, so an application with only an offer can still turn up without picking
Offered by name.

### Find the right view

- **Kanban** shows 11 stage columns with a labelled lane for each visible state. Live stages pair with their rejected counterpart in the same column. Attachment filenames, a preference score for rated applications, and a prep notes button appear on cards, and you can move applications by drag-and-drop or the state selector. A live application that has not changed stage for 30 days or more is greyed out and labelled `Idle 30 days`; it stays in its own lane with its history, and still moves wherever any other application can. Silence is measured from the last stage change rather than the last edit, so annotating a card or importing an invite does not reset it. Rejected, accepted, and no-openings applications are finished rather than idle and are never labelled.
- **Table** sorts and column-filters by company, role, source, state, activity, next action, deadline, urgency, preference, compensation, attachments, created date, or last update, and gives each row a prep notes button. Columns whose value can be missing—activity, deadline, invites, preference, compensation—keep the rows without one last in either sort direction. The Activity column carries the same `Idle N days` text the board shows and filters on it, and reads `—` for an application that is not idle. The urgency column shows why an application ranks where it does—`Deadline in 3 days`, `Action overdue 2 days`, `No change for 21 days`—and filtering it matches that text. Rejected, accepted, and no-openings applications are not ranked and show `—`. Column filters only affect the table and are not saved. Global search, state, activity, company, and source filters still apply across views.
- **Focus** answers "what should I do next". Each group heading states its own membership rule, so nothing is hidden behind a mood word: **Overdue or due today**, **Due in 1 to 7 days**, **Due in more than 7 days**, **Action with no date**, **No stage change in more than 7 days**, **Nothing dated or planned**, and a trailing **Finished, action outstanding** for tasks left on rejected, accepted, or no-openings applications. Placement uses the nearest of the soonest upcoming invite, the deadline, and the next-action date, so a date always decides the group; the urgency score only orders rows within it, and preference breaks ties the date and the score have both left level. An application with just an invite, or just a deadline, and no action of its own appears here too. Silence is measured from the last actual state change, not from the last edit, so fixing a typo does not make an application look like it moved. Groups collapse and expand—only the leading non-empty group starts open, and that choice is never saved.
- **Calendar** places applications only by their next-action date; select an item to edit it. There is no Done control here — the Calendar is a picture of when things fall, not a task list.
- **Stale** shows applications that have not changed recently, oldest first. Its 7-, 14-, and 30-day threshold is temporary and is not saved. This is a view you tune, unlike the Idle label on the board and in the table, which is fixed at 30 days—here you choose the window you want to look through. When the current state has a rejected counterpart, **Move to Rejected** records that outcome and keeps the history.
- **Statistics** compares current state counts with counts for every state applications have previously reached, then summarises your ratings: how many applications you have rated, the mean preference across them, and one row per dimension showing what you judged, what you could not tell, what you never assessed, and the mean of the judgements.

The global search, state, activity, company, and source filters apply across views. Activity takes **Idle** or **Active**, which are complements rather than a pair of thresholds—a finished application counts as Active because it is not idle. It is a separate control from the state filter because idleness qualifies a stage without changing it, so "Interview 1 and idle" is a question worth asking. The state filter also takes an outcome—**Rejected** or **Not rejected**—which stands for every rejection at once, or everything that is not one. Neither `Accepted` nor `No openings` counts as a rejection: they are outcomes of their own rather than somebody turning the application down. **Copy roles** puts the roles of whatever is showing on the clipboard, one per line and without repeats—so filtering to Applied at one company from LinkedIn and pressing it copies exactly those roles. Dates, calendar days, overdue status, and stale thresholds use your browser's timezone.

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

## License

MIT. See [LICENSE](./LICENSE).
