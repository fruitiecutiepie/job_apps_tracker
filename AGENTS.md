# Contributing to the Job Applications Tracker

This file applies to the entire repository. Keep changes within the app's current scope: it is a single-user, local-first React/TypeScript application with no authentication, backend, synchronization, notifications, or collaboration layer.

## Repository map

- `src/App.tsx` coordinates shared filters, dialogs, imports, exports, persistence, and the six views.
- `src/StageNotesDialog.tsx` is the stage prep notes panel and `src/StageNotePane.tsx` one stage's note inside it, with the ids tying a pane to its tab in `src/stageNoteIds.ts`. `src/StageNoteEditor.tsx` is the Markdown editor, `src/FindWidget.tsx` the find bar, and `src/QuickOpen.tsx` the stage picker with its matching in `src/quickOpenMatch.ts`; `src/useDialogKeyboard.ts` holds the Escape and focus-trap behavior the panel shares with the application dialog.
- `src/markdown/` parses the supported Markdown subset into an AST and renders it as a foldable outline. `sections.ts` holds the section tree, the fold-key scheme, and the heading walks the outline and breadcrumbs read; `searchNote.ts` finds text in it.
- `src/calendar/` reads the iCalendar subset that recruiter invites arrive in; `src/invites.ts` turns those
  events into editor rows and mutation drafts, and `src/InviteFields.tsx` is the editor's invite section.
- `src/StateHistory.tsx` renders the editor's read-only state history, with the spans it shows derived in `src/stateTimeline.ts`.
- `src/dateInput.ts` is the only place `datetime-local` wall time is converted to and from stored timestamps.
- `src/domain/noteEditing.ts` and `noteEditingPaths.ts` hold the client and pure halves of external note editing; `vite/note-edit-fs.ts` holds the filesystem and process side.
- `src/domain/` is the source of truth for types, state, rating and compensation configuration, mutations, validation, storage, IDs, and demo data.
- `src/views/` contains view components and their derived-data helpers.
- `src/test/` contains app integration and smoke tests; view-focused tests live beside the views.
- `src/styles.css` contains the responsive visual system. Spacing, radius, type size, colour,
  control height, shadow, and focus all come from the token scale in its `:root` block; reuse a
  token instead of adding a one-off value, and keep the media queries at the end of the file so a
  later base rule cannot outrank them.
- `SMOKE_TEST.md` records the automated smoke coverage and optional browser-only checks.

Use pnpm for dependency and script commands. Do not introduce a second package manager or regenerate the lockfile with another tool.

## Core invariants

### States and transitions

- `StateId` is a closed union of exactly 19 states. `STATE_CONFIG` in `src/domain/states.ts` is the only source for state order and display labels.
- Preserve the configured labels exactly, including the em dashes in rejection labels.
- Name things `state` in code and stored data — `StateId`, `state`, `state_history`, `state_events`. Use
  "stage" only in copy a reader sees, where it reads more naturally ("prep notes for this stage", the Kanban
  stage columns). `stage_notes` predates this rule and stays as it is: it is a persisted field, and renaming
  it would silently canonicalize every existing note away on load. Note that `stagedFiles` in the attachment
  flow uses "stage" in its git sense, which is a third meaning — another reason not to reach for the word.
- Any state may move directly to any other state. Do not add a transition graph or broader pipeline stages.
- `rejectedStateFor` is a UI convenience that maps a live state to its rejected counterpart (`applied` → `auto_rejected`, otherwise `{state}_rejected` when that id exists). It must not restrict moves.
- A real state change updates `state` and `updated_at` and appends one timestamped `state_history` entry.
- Moving to the current state is a no-op: it must not update timestamps, replace the object, or append history.
- Editing unrelated fields updates `updated_at` but never appends state history.

### Application mutations

- Route creates, edits, moves, and deletes through the mutation functions in `src/domain/mutations.ts`; do not update application objects ad hoc in UI components.
- IDs are immutable UUIDv7-compatible values generated when records are created. Company and role are editable attributes, not identity.
- A created application receives timestamps and an initial history entry for its starting state.
- `company` is required and non-blank. Optional text fields (`role`, `source`, `notes`, and similar) are canonicalized to strings or `null`; missing `source` on import canonicalizes to `null`.
- Stage prep notes hang off an application as `stage_notes`, at most one per `StateId`, stored in configured state order. A note may target any state, including one the application has not reached, because notes are written before a stage happens.
- A stage note `body` is raw Markdown text. Store exactly what was typed: no HTML is stored, generated, or injected, and the renderer maps the parsed AST to elements rather than using `dangerouslySetInnerHTML`.
- What you were told during a stage is `heard` on its stage note: `HeardEntry` records of `{ id, body, at }`, oldest first. It is a field rather than text inside `body` because the two are written at different moments by different hands, and because the day a line belongs to is then a reading of `at` rather than something parsed back out of a heading. `capturedMarkdown` in `src/markdown/capture.ts` renders the records as one note — a `###` heading per day, and a bullet per line stamped with the time it was captured — derived on render and never stored, so the reading view, the outline, and the find work on captures exactly as they do on a written note. It takes a day formatter and a time formatter rather than formatting either itself: how a date reads belongs to the view, and the day formatter doubles as what decides where one day ends. The stamp is a code span, so it reads as a record rather than as something that was said, and it carries no date — the heading above it already says which day this was.
- A capture is append-only and stored the moment it is entered, through `captureStageNote` or `updateApplicationStageCapture`. It is typed mid-conversation, where Escape and a closed tab are likelier than a deliberate Save; a record of what was said at a moment has no draft to roll back and no edit. Ids and `at` are minted in the mutation rather than supplied.
- `StageNoteDraft` carries no captures, so Save cannot write one twice or put one back. `applyStageNotes` preserves the `heard` of every stage it rewrites, and drops a note on a blank body only when that note holds no captures either: clearing what you wrote for a stage does not unsay what you were told in it. `heard` is absent-is-empty in validation, so documents written before captures existed load as valid documents with none.
- Route stage note changes through `applyStageNotes`, `setStageNote`, or `updateApplicationStageNotes`. A blank body removes that stage's note, an unchanged body is a no-op that returns the same object, and a rewritten body keeps `created_at` while refreshing the note's `updated_at` and the application's `updated_at`. Stage notes never append state history.
- Calendar invites hang off an application as `state_events`, each filed against one `StateId`, stored in
  configured state order and then start time. A state may hold several invites, and an invite may target a
  state the application has not reached. An invite may target any state; nothing about the invite decides
  which stage it belongs to.
- Route invite changes through `applyStateEvents`, `addStateEvent`, `removeStateEvent`,
  `updateApplicationStateEvents`, or `addApplicationStateEvent`. A blank summary drops that invite the way a
  blank body drops a prep note, an unchanged draft is a no-op that returns the same object, and a rescheduled
  invite keeps its `created_at` while refreshing its `updated_at` and the application's. Invites never append
  state history.
- `ics_uid` is the identity that makes re-importing safe: `addStateEvent` replaces the invite already holding
  that UID instead of appending beside it, keeps the `state` that invite was filed under, and ignores an
  invite whose `sequence` is behind the stored one. Two invites on one application may not share a UID.
- An invite must have a summary and a start; `ends_at` may be absent but may not precede `starts_at`.
- A next action may have no date. A date may not survive without a non-blank action.
- A next action is resolved through `completeNextAction`, not by hand-clearing the field: it nulls `next_action` and `next_action_at` and appends one dated line to `notes`, so finishing a task leaves a trail instead of deleting the only record that it was ever planned. Lines stack newest last with a single newline, because `notes` is plain text. A blank action returns the same object, `deadline_at` is untouched because it is an external fact rather than the task, and completing an action never appends state history.
- The completion date is display text passed in by the caller. The domain has no locale, and `formatShortDate` is the one place this app turns a date into something to read, so a logged line is dated the way every other date on screen is. Do not add a second date formatter to `src/domain/`.
- `ratings` holds at most one judgement per dimension, in `RATING_CONFIG` order. Three states are distinct and all meaningful: no record means never assessed, `score: null` means asked and genuinely cannot tell, and an integer 1-5 is a judgement. New applications start with no records.
- Route rating changes through `applyRatings`, `clearRating`, `updateApplicationRatings` and `clearApplicationRating`; `ratings` is deliberately absent from `ApplicationEdits`, like `stage_notes` and `state_events`, because a second write path would destroy per-record `created_at`. An unchanged draft returns the same object, a rewritten score keeps `created_at` and refreshes both `updated_at`s, and ratings never append state history.
- Unlike a stage prep note, a rating has no blank form that could mean "remove this" — `score: null` is a real judgement. So a draft absent from the array leaves its dimension untouched and removal is an explicit `clearRating`.
- `RATING_CONFIG` in `src/domain/ratings.ts` is the only source of dimension ids, labels and order. A dimension belongs there only if two reasonable people could rate the same fact differently, which is why compensation is not one: given a number, more is always better, so it is a measurement and belongs in its own field.
- `compensation` is that field. It holds one currency plus three nullable bands — `advertised`, `expected`, `offered` — in `COMPENSATION_CONFIG` order. All three are stored rather than one current value because compensation moves and the progression is the point; overwriting would erase it. New applications start with an empty record, never a missing one.
- Every figure is a band. A point value is a band whose ends match, which keeps one representation instead of two and spares every reader a `max === null` branch. Both ends are annual gross base pay as whole positive integers: cents never decide a job, and zero is not a figure you were quoted — `null` already says that.
- One currency covers the whole record, not each band: one application is one employer discussing one salary, and letting the stages disagree would make the progression meaningless. It is a three-letter code stored upper case. Any three-letter code is accepted; no conversion is attempted anywhere in the app.
- A currency may not survive without an amount — the same rule as a next-action date and a blank action, and canonicalized the same silent way. The reverse is an error, not a drop: a number whose unit is unknown cannot be read at all.
- `expected` is both what you are aiming for and the target the other two are measured against. There is deliberately no global target: the document shape is closed and discards any extra top-level key, so there is nowhere honest to persist one, and one number could not be compared against a per-application currency anyway. What you would accept genuinely differs by role, level, and country, so it belongs on the application.
- `compensation` is in `ApplicationEdits`, unlike `ratings`, `stage_notes`, and `state_events`. It carries no per-record timestamps, so there is nothing a second write path could destroy: the whole record is replaced at once, exactly the way `deadline_at` is. Do not add per-stage timestamps — `state_history` already records when `offer` was reached, and the stage names carry the rest of the story.
- `deadline_at` is an external fact (a posting closing, an offer decision date), not a planning date. It is independent of `next_action`: it may be set with no next action, and clearing the next action must not clear it.
- Application timestamps and history timestamps are timezone-qualified ISO-8601 strings.

### Persistence, import, and export

- Missing `ratings` canonicalizes to `[]` on import. Reject an unknown dimension, two ratings for one dimension, and any score that is not `null` or an integer from 1 to 5.
- Missing `compensation` canonicalizes to an empty record on import. Reject a currency that is not three letters, an amount that is not a whole positive integer, a band whose `max` is below its `min`, and an amount with no currency. A currency with no amount behind it is dropped rather than rejected.
- Persist one self-describing JSON database file with shape `{ schema, applications, indexes }`. The live app uses `data/tracker.json`; the demo profile uses `data/demo/tracker.json`. The embedded `schema` object is the current JSON Schema; update it when the shape evolves instead of running migrations.
- `applications` is the source of truth. Rebuild `indexes` on every successful load or save when they are missing or stale. Do not hand-edit indexes; edit `applications` or go through mutations.
- Seed an empty live document when `data/tracker.json` is absent. Seed demo data only for `data/demo/tracker.json` when that file is absent, via `pnpm dev:demo` or `pnpm start:demo`. A valid saved document—even an empty one—must not be reseeded on reload.
- Validate and canonicalize an imported document before confirmation or replacement. A parse error, validation error, unsupported legacy `schema_version`, or cancelled confirmation must leave saved data untouched.
- Import still accepts legacy `{ schema_version: 1, applications }` exports. Canonicalize applications, attach the current schema, and rebuild indexes.
- Ignore unknown imported fields for forward compatibility. Reject duplicate IDs, invalid states, malformed timestamps, invalid URLs, and supplied history whose final state differs from the current state. Missing `state_history` is accepted for compatibility and synthesized from the current state; supplied history must be non-empty.
- Import replaces the entire collection; export writes a zip archive with `tracker.json` plus attachment files. Legacy JSON import still works without files.
- Missing `stage_notes` on import canonicalizes to `[]`. Reject blank bodies, invalid states, and duplicate states within one application.
- Missing `state_events` on import canonicalizes to `[]`. Reject blank summaries, invalid states, malformed
  timestamps, an end before the start, a non-http(s) link, a negative sequence, duplicate ids, and duplicate
  calendar UIDs within one application.
- Application attachments store metadata on each application and file bytes under `{dataDir}/attachments/{applicationId}/{attachmentId}` (`data/attachments/` live, `data/demo/attachments/` demo). Missing `attachments` on import canonicalizes to `[]`. Add and remove attachments through mutations; cap each file at 25 MiB.
- Keep view-only values derived. Never persist Kanban columns, stale status, date groups, stage durations, statistics, or filters. Do not persist overdue/upcoming buckets, calendar day maps, or stale membership because they depend on browser-local "today".
- On first launch after upgrading from browser storage, migrate a valid legacy `localStorage` document into `data/tracker.json` once (live profile only), then stop using `localStorage`.
- A Cursor `beforeSubmitPrompt` hook backs up live and demo `tracker.json` files and their attachment directories to `data/backups/{timestamp}/` before agent prompts. Agents should edit applications through mutations and attachment APIs; do not bypass the backup hook with alternate write paths.

### Demo data

- `pnpm dev:demo` and `pnpm start:demo` first launch, plus confirmed demo reset, must produce the same 19 deterministic fictional records, exactly one ending in each configured state. Demo reset is unavailable on the live profile and must not write demo records into `data/tracker.json`.
- The examples intentionally include prior history, dated and undated actions, overdue work, past and future deadlines, notes, stage prep notes, calendar invites (including one cancelled), ratings in all three states (including one whose 4.00 mean hides a 1), compensation in every comparison shape, and stale timestamps so every view has useful content.
- The demo populates every Focus group, so no heading or empty message goes unexercised. A test in `src/views/focusGroups.test.ts` asserts it; if you retune a seed's dates, check that no group empties out.
- The compensation seeds cover every gap verdict (above, within, below, none), a target with nothing quoted against it, a quote with no target, bands and point values, and more than one currency. A test in `src/views/compensation.test.ts` asserts it; if you retune a seed's amounts, check that no cell shape stops appearing.
- One example (`Northstar Labs`) sets `editedDaysAgo`, so its `updated_at` is newer than its last `state_history` entry. That is the only seed where silence and last-touched disagree: Focus files it under no stage change while the Stale view hides it. Keep a seed with that shape, or the difference between the two measures goes untested in the demo.
- If states change, update the union, configuration, demo coverage, validation, and tests together. Preserve the runtime assertion that demo data covers every state exactly once.

### View behavior

- One context bar under the topbar carries the view title, the filtered count, and the global
  filters. The active view's name is the page `h1` for document structure only — the nav tab
  already shows it, so no view repeats it as a visible heading. Table, Stale, and Statistics keep
  their `h2` as `sr-only`; Calendar's heading stays visible because it names the shown month.
  Statistics' visible **Ratings** `h3` is a section heading inside the view, not the view's name,
  so it does not break that rule.
- Import, export, and demo reset live behind the topbar's **More actions** disclosure. It is a
  disclosure holding plain buttons, not an ARIA menu, so Tab alone reaches the items; keep Escape,
  outside-click dismissal, and focus return to the trigger. The import file input must stay mounted
  outside the panel, which unmounts when it closes.
- The Kanban card's state `<select>` reads **Move** rather than repeating the lane's state, and is
  laid over that trigger at zero opacity. It must remain a real focusable `combobox` named
  `Move {company} to state` — it is the accessible and touch fallback for drag-and-drop.
- All six views consume the same application collection and respect app-wide search, state, and company filters.
- `onCompleteAction` is required on `ApplicationsViewProps` rather than optional, so a new task-bearing view cannot silently forget to wire it. Views with no task row simply ignore it.
- Table column filters further narrow only the table. They are display state and must not be persisted.
- The table's Invites column lists every invite on an application, soonest first, with a cancelled one marked
  in words as well as struck through. Its filter matches summary, location, date, and the word "cancelled" —
  so it reaches past invites the column shows but the Kanban card does not. Sorting the column sorts by the
  next invite still ahead, which sinks rows with nothing coming to the bottom ascending.
- **Done** resolves a next action from the Focus row, the Kanban card, and the table's next action cell, through the one `CompleteActionButton`. It renders nothing when there is no action — a disabled control on every untasked row is noise — and its accessible name states the task, so a screen reader hears which one is closing rather than a column of identical buttons. Focus and the board both carry it because Focus is where tasks are worked through and Kanban is the default view; the Calendar and Stale views deliberately do not, since neither is organised around the task.
- The application editor shows `state_history` as a read-only **History** list, oldest first, so the order tells the story and the current state sits beside the State select that changes it. It renders only when editing: a new application has no history, and a state picked but not yet saved is deliberately absent because the list is the saved record.
- Each entry shows how long that state held — the gap to the next move, or to now for the last one. Spans are derived on render in `stateTimeline`, never persisted, and counted in browser-local days like staleness, so two moves on one day read as `Same day` rather than a rounded fraction.
- Stage prep notes open in a full-viewport panel from the Kanban card and the table row. Stages are chosen from a tab bar that lists the application's current stage first and then every other stage with notes, so the stage you are interviewing for is the one you land on. Global search matches stage note text through `search_text`.
- The notes area is one or two panes. Splitting reads two stages against each other; each pane scrolls on its own so a long note does not drag the note beside it along. A stage may be in at most one pane: `showStage` moves focus to a pane that already holds it rather than opening it twice, which also keeps every rendered `data-match-id` unique — two copies of a note would give one match two ids and the find would step onto whichever the DOM happened to return first.
- The focused pane is the one the outline, breadcrumbs, status bar, and find act on, and it is the only one whose editor may take the caret. Clicking or focusing anywhere in a pane focuses it.
- A split tablist is `aria-multiselectable`, because two tabpanels really are on show. Each pane is labelled by its own heading rather than by its tab: a tab also carries the current-stage badge and the match count, and a name that changes as you type into the find bar is not a name.
- The captured lines and the box that adds to them are docked together at the bottom of a pane, pinned while the note above them scrolls: what you were told is the part of a stage still being added to, so it does not scroll away. The log is capped at `--capture-log` and scrolls itself, held at the newest line, so a long conversation cannot push the note above it off screen. Ctrl+K reaches the focused pane's box. Enter must `preventDefault`: the panel is one form around every stage, so it would otherwise save the lot and close mid-conversation. The focused pane is found through a `data-capture-focus` attribute rather than a pane index, so the document-level shortcut is not rebound every time focus moves between panes.
- The dock shows in every mode, including while the note is in the Markdown editor or out with an external session. Captures are their own field, so there is no shared text for a second caret to race — this is the point of the split, and reverting it would put the choice back.
- A pane renders two notes, so the find numbers them the way the eye runs down them: the written note first, then the captures, with `written` in `findMatches` recording where the second starts. A stage in the Markdown editor sits its written note out of the find, because a textarea has no highlights to step onto, but its captures are on screen the whole time and stay in the list. The log passes `foldAll={false}`: a permanent fold-all control costs a row that a pinned strip wants for the note itself, and every day in it still folds on its own.
- The outline collapses with Ctrl+B when the notes want the full width. That is the reader asking for it — do not collapse it, or any other content, on the app's own initiative.
- `openPanes` filters the panes down to stages the tab bar still lists, because an external editor can empty a note and drop its stage while the panel is up. It is derived, not corrected in an effect, so no render shows a pane for a stage that is already gone.
- The panel pins its title bar, tab bar, breadcrumbs, outline sidebar, and status bar, and scrolls only the notes column, so a note of any length leaves the stage list and the write state reachable. A note is what the panel is for: give the notes column the width and leave the chrome dense.
- A stage being written fills its pane's height, so the editor offers the room the reader gets rather than a box the size of a short note. The stretch is scoped with `:has()` to the card holding an editor: a short note being read still sizes to itself instead of stretching its card down an empty pane.
- Only the active tab's note is mounted, but every stage's draft stays in `drafts`. Nothing about the panel's own state—which tab is showing, what is folded, what has been found—may reach a saved note.
- The panel has no Save. Drafts write themselves `AUTOSAVE_MS` after the typing stops, and again as the panel unmounts so the last keystrokes are not lost — prep notes are typed mid-interview, where a closed tab is likelier than a deliberate Save. Only the stages that changed are sent, measured against `stored` rather than against the saved note, because `applyStageNotes` trims a body and a draft ending in a space would otherwise be re-sent forever.
- Writes run one at a time behind `savingRef`: each one PUTs the whole document, so an overlapping write would be built on a document the first has already replaced. Typing during a write stays pending and is picked up by the loop before it lets go. A failed write leaves its drafts pending and says so in the status bar; the panel never claims to have stored what it has not.
- The debounce hangs off `drafts` and nothing else. Its identity changes only when a draft is edited, and every write re-renders the parent — anything else in the dependencies restarts the wait on the panel's own writes and it never fires.
- A file coming back from an external editor is marked stored as it commits, so the poll's own write does not come back round as an autosave of itself.
- A stage typed into joins `addedStages`, so emptying a note removes it from the document without the pane disappearing from under the caret that cleared it. An external editor emptying a note still drops its stage, which is why the two draft paths are separate.
- A tab's close control means off screen, not deleted: the note stays, and the stage is listed again next time. The application's own stage has none, so there is always somewhere to land.
- Focus follows a tab selected with the arrow keys. Leave it behind and the next arrow key is read by the tab that no longer matters, stepping from the wrong place.
- The sidebar outlines the active note's headings, and the breadcrumbs name the last heading scrolled past. Both are derived from the section tree, but which heading is current reads layout rather than the tree, because a folded heading is not on screen to be inside. `NOTE_HEADER_PX` in the panel has to track `--note-header` in the stylesheet.
- The outline is a nested list, one per level, so the hierarchy is in the markup rather than only in the indentation. `outlineTree` nests by section structure, not by comparing heading levels, so a note that opens at `###` and later uses `##` still outlines the way it reads.
- Three things carry the hierarchy, and all three are needed: an indent guide per level, a type ramp that quietens deeper rows, and the path down to the current section marked the whole way. The row modifiers carry `[data-depth]` so they outrank that ramp at any depth — drop it and the mark disappears exactly where the outline is deepest.
- The outline stays a tree at every width. The narrow breakpoint caps the sidebar's height and lets it scroll; flattening it into a strip of chips would trade the hierarchy for the space it saves.
- The outline repeats heading text, so two buttons in the panel can hold the same words. Outline entries carry a `Go to …` label to keep them apart, and a test looking for note content scopes itself to the `tabpanel`.
- Quick open (Ctrl+P) reaches all 19 stages, not only the ones on screen, and is the only way to start notes for a stage the application has not reached. It takes over the browser's print shortcut while the panel is open, as Ctrl+F takes over its find. Ctrl+\ splits and Ctrl+B collapses the outline.
- Finding text inside notes is the panel's own, not the browser's: a folded row is unmounted, so `Ctrl`/`Cmd+F` is taken over and answered from the AST. `searchNote` returns the match count, the fold keys a match sits behind, and each text container's first ordinal in one pass; the renderer numbers its highlights from those ordinals rather than from render order, so a re-render cannot renumber the matches under the find bar.
- A fold opened to show a match closes again when the find closes. Revealing is derived state layered over the reader's own folding, never a write to it.
- Escape closes the find bar before it closes the panel. `FindWidget` stops the key from reaching the document listener in `useDialogKeyboard`; if another overlay is added inside the panel, it owes Escape the same treatment.
- A stage open in the Markdown editor takes no part in the find: a textarea holds source, which has no highlights to step onto.
- The find searches every stage, including tabs that are not rendered, and stepping onto a match in another stage switches to it. That switch happens in the step handler, from the cursor's new position, not in an effect watching it.
- A stage that already has notes opens as a rendered outline; an empty stage opens in the editor. Read and edit mode, and which points are folded, are display state and must not be persisted.
- `src/markdown/parseMarkdown.ts` supports headings, nested ordered and unordered lists, paragraphs with hard line breaks, block quotes, fenced code, bold, italic, inline code, escapes, and links. It is deliberately a subset, not CommonMark. Links render only for `http`, `https`, and `mailto` targets; anything else falls back to plain text. Extend the parser and its tests together.
- The editor's hint is the only place a writer learns what that subset is, so it lists everything the parser takes. Quotes and fenced code were supported and foldable for a long time while the hint named neither, which is the same as not supporting them. Extend the hint with the parser.
- A quote takes the line straight after it, so `> Question` followed by an unmarked `Answer` reads as one quoted paragraph. That lazy continuation is deliberate — it is what makes a quote survive a wrapped line — but it means a blank line is the only way to end one, and the hint says so.
- A list item holds `children: BlockNode[]`, so anything indented under a point—nested lists, paragraphs, quotes, code—belongs to that point. A line that merely wraps the point keeps flowing into its text; content after a blank line, or starting a block of its own, becomes a child. That distinction is what decides whether a point folds.
- Everything with hierarchy folds: a heading folds through to the next heading of equal or higher level, a list item folds when it has children, and quotes and code blocks fold behind a summary. Keep fold controls as real buttons carrying `aria-expanded`.
- `FoldRow` renders one pattern for every fold: a chevron `button` that owns the accessible name and keyboard focus, plus adjacent text that toggles on click. Do not wrap the text in the button—note text contains links, which may not nest inside a button, and a button would make the note hard to select and copy. The text handler ignores clicks that land on a link or that end a non-collapsed selection; keep both guards.
- Fold keys come from the `blockKey`/`itemKey` helpers in `src/markdown/sections.ts`, and the renderer, the Collapse all collector, and the note search all walk the tree with them. A key that means one thing to one of them and something else to another folds or reveals the wrong rows. Adding a foldable block means updating `collectBlockKeys` and `searchNote` alongside the renderer, or Collapse all silently misses it and a match behind the new fold never opens. The integration test that collapses every level exists to catch exactly that drift.
- `searchNote` walks containers in the order the renderer visits them—a section's heading, then its blocks, then its subsections; a list item's own line, then its children. Reordering one without the other misnumbers every highlight after the change.
- The calendar places dated next actions and calendar invites, each on its browser-local day and in time
  order within it. An invite reads as its time and summary, a cancelled one says so and is struck through,
  and both kinds open their application.
- A Kanban card shows the soonest invite that is still ahead, skipping cancelled ones and using the same
  browser-local day boundary as overdue grouping, so an invite earlier today still counts.
- A Kanban card also carries its preference, which is the one thing on the board that cannot be derived
  from anything else the card shows. It renders the full `describePreference` text, not a bare number: a
  score alone would read as more certain than it is, and the weakest judgement is the point of showing it
  at all. An unrated card shows no preference line rather than a dash, because the board is scanned rather
  than read in columns.
- Focus groups live applications into `due_now`, `due_week`, `due_later`, `no_date`, `nudge`, `quiet`, plus a trailing `wrapping_up`. Grouping lives in `src/views/focusGroups.ts`.
- Every Focus heading must state its own membership rule in plain terms ("Due in 1 to 7 days", not "Coming up"). If a rule changes, the heading changes with it.
- Placement is decided by the nearest of the soonest upcoming invite, `deadline_at`, and `next_action_at`, not by which pressure wins the score. Urgency pressure decays to zero past its horizon, so grouping by the winning term would file an action dated ten days out as unplanned. Undated placement then falls through: a non-blank action goes to `no_date`, otherwise silence past `STALE_GRACE_DAYS` goes to `nudge`, otherwise `quiet`. The `nudge` test uses `daysSinceLastMove`, the same measure the staleness pressure uses, so placement and score cannot disagree.
- A row describes its own date via `describeDue` when it has one, so a heading and a row can never disagree about the same date. `describeDue` in `src/views/urgency.ts` is the only place date phrasing is built.
- Focus is not an actions-only view: an application with a deadline and no next action still appears. Conversely a task left on a rejected, accepted, or no-openings application must stay visible under `wrapping_up` rather than vanishing because the ranking omits finished applications.
- Date-driven Focus groups sort chronologically by the driving date, because a dated group is read as a schedule. `nudge` keeps ranked order; `no_date`, `quiet`, and `wrapping_up` sort by company.
- The within-group chain is the group's own rule, then the urgency score, then preference descending with unrated last. Preference sits at the end deliberately: it can only reorder rows the ranking would otherwise have settled by a deadline timestamp, an action date, an age or an id, so it never overturns a date or a score. Its effect is invisible until enough applications are rated to tie, which is why `preference.test.ts` builds a deliberate tie rather than trusting real data to produce one. `focusGroups` compares scores with the ranking's own `SCORE_EPSILON` so the two cannot disagree about what "tied" means.
- A Focus group whose row position carries meaning (a schedule, or oldest first) renders as `<ol>`; alphabetical groups render as `<ul>`. The `ordered` flag on each group drives this, so the markup states whether order is information.
- Focus group disclosure is display state and must not be persisted. Only the leading non-empty group starts open, derived on each render rather than remembered.
- Deadlines are deliberately not placed on the calendar, which carries dated next actions and invites only. A deadline surfaces in the table and in Focus.
- A table column whose value can be absent returns `null` from `comparableValue`, and the comparator settles presence before it applies the sort direction. A sentinel number cannot do this: whichever end you pick it sorts to the wrong one as soon as the direction flips, which is exactly how the deadline and invite columns used to put undated rows first when sorted descending. Deadline, invites, preference, and compensation all rely on this, and each has a both-directions test.
- Urgency is derived in `src/views/urgency.ts` and must never be persisted: it depends on browser-local "today", and a score without the weights that produced it is meaningless. Keep the weights in that module, not in the tracker document or `indexes`.
- Preference is derived in `src/views/preference.ts` and never persisted, for the same reason as urgency: a score without the weights that produced it is meaningless. `DEFAULT_RATING_WEIGHTS` lives in that module, and there is nowhere to persist a different policy — the document shape is closed and discards any extra top-level key.
- The compensation comparison is derived in `src/views/compensation.ts` and never persisted, for the same reason: which figure counts as *the* figure, and whether a band straddling the target is short or merely undecided, are policy. Only the figures themselves are stored. Unlike preference it is not a score and carries no weights — the numbers are already comparable, so nothing there invents a scale.
- The compared figure is `offered ?? advertised`. `expected` is excluded because a target is not a number anyone quoted you, so an application holding only an expectation has no figure at all and sorts last despite showing one.
- The gap is measured between the nearest ends of the two bands, so it reports only what the bands guarantee: `below` means the figure cannot reach the target, `above` means it clears all of it, and overlapping bands are `within target` with a gap of exactly zero. A midpoint difference would state a policy as a fact.
- The Compensation column sorts by the midpoint of the compared figure and ignores currency, because there is nowhere to persist conversion rates and inventing them would be worse. A tracker mixing currencies must read the column rather than trust its order, which is why every cell states its currency first.
- Compensation is never folded into urgency or preference and never affects Focus placement, for the same reason ratings are not: urgency already carries a stage factor, so a second factor compounds until a deadline today loses to one next week that happens to pay better. A regression test in `src/views/compensation.test.ts` asserts `urgencyFor`, `rankByUrgency`, and `focusGroups` are unchanged by it.
- Compensation is deliberately absent from `search_text`, the same as ratings and for the same reason: these are numbers, not prose. Indexing them would make a search for `offered` match every application that has one and `150` match any application holding 150 in a band. The Compensation column filters its own rendered text instead.
- The preference score is `mean(rated) - MAX_UNKNOWN_DISCOUNT * (missingWeight / totalWeight)`, so the bound is `mean - MAX_UNKNOWN_DISCOUNT < score <= mean`. That bound is independent of how many dimensions exist. It does **not** mean a rating difference always wins: a mean gap smaller than the discount can be overturned, and `5,-,-,-` losing to `5,5,4,4` is intended and asserted. Only a gap of the full discount is guaranteed safe.
- The discount uses weight share, not count share, so a dimension weighted zero costs nothing whether it is judged or not, and it is excluded from `lowest` too. Weights are clamped to zero at the low end; a negative weight would push the discount past its bound.
- Nothing judged returns `null`, which sorts last in either direction rather than as the worst score. Unrated is not bad, and a fresh tracker must not read as a wall of rejects.
- `lowest` exists because a mean hides dealbreakers: `5,5,5,1` and `4,4,4,4` both score 4.00. `preferenceFor` reports it without a threshold; `describePreference` holds `DEALBREAKER_SCORE` and decides when to name it.
- `describePreference` is the only place preference phrasing is built, the way `describeDue` is the only place date phrasing is built. The table column and the Kanban card both read it, so two views cannot describe the same ratings differently, and the table's column filter still matches its own rendered text.
- Preference is never multiplied or added into the urgency score and never affects Focus placement. Urgency already carries a stage factor, so a second factor compounds and a deadline today on a poorly rated application loses to one ten days out that happens to be rated well. Regression tests assert `urgencyFor`, `rankByUrgency` and `focusGroups` are unchanged by ratings, and `focusGroups.test.ts` passes untouched as the empirical proof that placement is date-driven only. Order within a group and display are the only things preference is allowed to touch.
- Ratings are deliberately absent from `search_text`. They are numbers, not prose: indexing them would make a search for `work` match every rated application and `4` match anything holding a 4. `indexesAreStale` cannot detect `search_text` content drift either, so existing documents would under-match forever. The Preference column filters its own rendered text instead.
- Only live applications are ranked. `classifyLifecycle` treats every `rejectedStateFor` counterpart as rejected and `accepted`/`no_openings` as closed; both are omitted from the ranking rather than scored low. This is view grouping only and must not restrict moves.
- Stage weight comes from position among the live states, not the raw `STATE_CONFIG` index, because the configured order interleaves live and rejected states.
- The highest single pressure sets both the score and the displayed reason; the others stack only into the headroom above it.
- Horizons encode confidence, not importance. Every dated term peaks at 1 on its own day, and a firmer commitment decays more slowly: an invite over `INVITE_HORIZON_DAYS`, a deadline over `DEADLINE_HORIZON_DAYS`, a next action over `ACTION_HORIZON_DAYS`. So at equal distance an invite outranks a deadline and a deadline outranks a date you set yourself, while an overdue action still outranks an invite that is days away. Staleness is capped below all of them because it is inferred rather than recorded. Ties resolve in the same order: invite, deadline, action, staleness.
- Staleness measures days since the last `state_history` entry, via `daysSinceLastMove` — never `updated_at`. Any edit refreshes `updated_at`, so reading it would let saving an invite or fixing a typo reset the silence the term exists to detect. Note this deliberately differs from the Stale view, which still means "untouched" and keeps using `updated_at`.
- Only invites still ahead carry pressure, cancelled ones never do, and `upcomingStateEvent` enforces both. A meeting that already happened is history, which is the one place invites and deadlines differ: a passed deadline stays urgent precisely because it slipped.
- Rank comparisons treat scores within `SCORE_EPSILON` as tied so the documented tiebreak (deadline, then action date, then age, then id) decides the order instead of floating-point noise.
- Stale means `updated_at` is at least the selected threshold in the past and sorts oldest first. The 7/14/30-day choice is display state and must not be persisted.
- Statistics use configured state order. Current counts come from `state`; ever-reached counts come from `state_history` and count each application once per reached state.
- Statistics also summarise ratings through `preferenceSummary`, in `RATING_CONFIG` order: how many applications carry a judgement, the mean preference across them, and per dimension how many are judged, unknown, and never assessed with the mean of the judged scores. This is the one place preference says something a per-row number cannot — whether a dimension reads low because you keep rating it low or because you have never looked. The per-dimension rows count what was recorded, so a dimension weighted zero still reports its judgements; only the count of rated applications and the mean follow the weights. With nothing rated the table is replaced by a plain sentence rather than a grid of zeros.
- Browser-local dates control calendar placement, overdue boundaries, and stale thresholds. Persisted timestamps remain timezone-qualified.
- Overdue grouping compares browser-local calendar days, so an action earlier today is not overdue. Stale thresholds are inclusive: an application exactly 7, 14, or 30 days old qualifies for that threshold.
- Kanban pairs each live state with its `rejectedStateFor` counterpart in one stage column (11 columns, 19 labelled lanes). Pairing is derived view layout only; each state remains its own drop target. Global state filtering still shows one lane per selected state without forcing a pair.

### Accessibility and interaction

- Keep dialogs and controls labelled, keyboard operable, and focus-safe. Closing an editor should restore focus to its opener when possible.
- Native drag-and-drop must retain the accessible state-selector fallback; it is also important for touch devices.
- Confirm destructive collection changes such as import replacement and demo reset, as well as application deletion.
- Preserve responsive behavior, including horizontally scrollable Kanban columns and usable narrow-screen forms.

## Gotchas

- `src/calendar/parseIcs.ts` is a deliberate subset of RFC 5545, not an iCalendar implementation: no
  recurrence, alarms, or attendees. It reads UTC (`…Z`), named-zone (`TZID=`), floating, and date-only
  starts. A named zone is resolved through `Intl` in two passes, because the offset depends on the instant
  the offset is needed to find — that second pass is what places a time near a daylight-saving change on the
  right side of it. An unknown zone falls back to browser-local rather than guessing, and an event whose
  start cannot be read is returned with a null `starts_at` so a caller can report it instead of dropping it.
- `datetime-local` inputs represent browser-local wall time. Convert them to ISO timestamps for storage and back to local values for editing; do not parse them as UTC by accident.
- The demo uses a fixed reference timestamp for deterministic content and tests, exported as `DEFAULT_DEMO_REFERENCE`. Changing it can alter stale, overdue, and calendar expectations throughout the suite, including in the integration tests that pin the wall clock to it.
- The editor saves ordinary field edits before applying a state move. Keep the move mutation responsible for state history so one save cannot append duplicate entries.
- Submitting the editor currently refreshes `updated_at` even when no editable value changed. An explicit same-state move is the only exact timestamp-preserving no-op. Change this only deliberately and update its tests with the behavior.
- Import validation rebuilds canonical objects, which is how unknown fields are ignored. Avoid retaining the raw imported object.
- Invalid `data/tracker.json` or `data/demo/tracker.json` files are not overwritten on startup. The app shows an error and leaves the file untouched. Invalid file imports are also non-destructive.
- The Vite dev and preview servers also expose `/__note-edit/{applicationId}/{state}`: `POST` writes the note to `{dataDir}/editing/{applicationId}/{state}.md` and launches an editor, `GET` reads that file back, and `DELETE` removes it. Scratch files are disposable; `tracker.json` stays the source of truth and `data/editing/` is gitignored.
- `TRACKER_EDITOR_URL` takes precedence over any command: the response carries `open_url` and nothing is spawned, so the browser opens it and an editor on the machine viewing the page handles the file. This is the only arrangement that works when the app is reached over a tunnel, because a spawned process always lands on the server's host. Fill the template with `{path}`, and keep using `encodeURI` so path separators survive schemes like `vscode://vscode-remote/ssh-remote+host/abs/path`.
- Otherwise the launched command comes only from `VISUAL`, then `EDITOR`, then the platform opener. Never take a command, arguments, or path from the request. The route also refuses requests whose `Sec-Fetch-Site` is cross-origin, because it both writes a file and starts a process.
- When a command is spawned and the environment looks remote (`SSH_CONNECTION`, `CODESPACES`, and similar), the response reports the server's hostname so the UI can say where the file actually opened rather than appearing to do nothing.
- The editor is spawned detached with ignored stdio, so terminal editors cannot work: the dev server owns the only TTY. Document GUI commands such as `code`, `zed`, or the platform default.
- While a stage is open externally the external file owns it: the in-app editor for that stage is withdrawn, the client polls the scratch file, and changes commit on their own because an editor has no Save button to press. Ending the session or closing the dialog deletes the scratch file.
- The Vite dev and preview servers expose `GET`/`PUT`/`DELETE` on `/__db` to read and write the active profile's database file. `pnpm dev` and `pnpm start` use `data/tracker.json`. `pnpm dev:demo` and `pnpm start:demo` use `data/demo/tracker.json`. `DELETE` reseeds demo data only on the demo profile.
- Global filtering can intentionally hide Kanban columns and affects the collection shown by statistics.
- Tests that depend on dates should control the clock and account for browser timezone boundaries rather than assuming UTC display days.
- `src/test/app.integration.test.tsx` pins the wall clock to `DEFAULT_DEMO_REFERENCE`, the instant the demo seeds are measured from. The seeds are deterministic but a view's "today" is not, so without this the two drift apart until a seed crosses a stale, overdue or calendar boundary and assertions start failing on a date rather than on a change. A guard test asserts the pinning, so removing it fails with the reason. Keep any new date-dependent assertion in that file relative to the reference rather than to the real clock.
- Only `Date` is faked there, via `vi.useFakeTimers({ toFake: ['Date'] })`. Do not widen it to the timers: Testing Library's fake-timer support is gated on a global `jest` that vitest does not define, so its `waitFor` would poll a `setInterval` nothing advances and every test in the file would hang. Nothing in `src/` measures elapsed time from `Date.now()`, and `createUuidV7` takes its uniqueness from random bytes, so a frozen `Date` is safe.
- Test setup mocks `/__db`, `/__attachments`, and `/__note-edit` with in-memory stores, seeds demo data, and supplies a `ResizeObserver` stub. `src/test/noteEditStore.ts` lets a test stand in for the external editor by writing the scratch file directly. Add new browser API stubs centrally so component tests remain consistent.

## Working on a change

1. Read the relevant domain function and its tests before changing a view that depends on it.
2. Add or update focused tests for domain behavior, derived view behavior, and user-visible integration flows as appropriate.
3. For a meaningful UI flow change, update the smoke test or `SMOKE_TEST.md` checklist.
4. Before handing off, run:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run `pnpm test:smoke` explicitly when changing first launch, navigation, application editing, state movement, persistence, or reset behavior.
