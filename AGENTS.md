# Contributing to the Job Applications Tracker

This file applies to the entire repository. Keep changes within the app's current scope: it is a single-user, local-first React/TypeScript application with no authentication, backend, synchronization, notifications, or collaboration layer.

## Repository map

- `src/App.tsx` coordinates shared filters, dialogs, imports, exports, persistence, and the six views.
- `src/StageNotesDialog.tsx` is the stage prep notes dialog and `src/StageNoteEditor.tsx` its Markdown editor; `src/useDialogKeyboard.ts` holds the Escape and focus-trap behavior both dialogs share.
- `src/markdown/` parses the supported Markdown subset into an AST and renders it as a foldable outline.
- `src/domain/` is the source of truth for types, state configuration, mutations, validation, storage, IDs, and demo data.
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
- Route stage note changes through `applyStageNotes`, `setStageNote`, or `updateApplicationStageNotes`. A blank body removes that stage's note, an unchanged body is a no-op that returns the same object, and a rewritten body keeps `created_at` while refreshing the note's `updated_at` and the application's `updated_at`. Stage notes never append state history.
- A next action may have no date. A date may not survive without a non-blank action.
- Application timestamps and history timestamps are timezone-qualified ISO-8601 strings.

### Persistence, import, and export

- Persist one self-describing JSON database file with shape `{ schema, applications, indexes }`. The live app uses `data/tracker.json`; the demo profile uses `data/demo/tracker.json`. The embedded `schema` object is the current JSON Schema; update it when the shape evolves instead of running migrations.
- `applications` is the source of truth. Rebuild `indexes` on every successful load or save when they are missing or stale. Do not hand-edit indexes; edit `applications` or go through mutations.
- Seed an empty live document when `data/tracker.json` is absent. Seed demo data only for `data/demo/tracker.json` when that file is absent, via `pnpm dev:demo` or `pnpm start:demo`. A valid saved document—even an empty one—must not be reseeded on reload.
- Validate and canonicalize an imported document before confirmation or replacement. A parse error, validation error, unsupported legacy `schema_version`, or cancelled confirmation must leave saved data untouched.
- Import still accepts legacy `{ schema_version: 1, applications }` exports. Canonicalize applications, attach the current schema, and rebuild indexes.
- Ignore unknown imported fields for forward compatibility. Reject duplicate IDs, invalid states, malformed timestamps, invalid URLs, and supplied history whose final state differs from the current state. Missing `state_history` is accepted for compatibility and synthesized from the current state; supplied history must be non-empty.
- Import replaces the entire collection; export writes a zip archive with `tracker.json` plus attachment files. Legacy JSON import still works without files.
- Missing `stage_notes` on import canonicalizes to `[]`. Reject blank bodies, invalid states, and duplicate states within one application.
- Application attachments store metadata on each application and file bytes under `{dataDir}/attachments/{applicationId}/{attachmentId}` (`data/attachments/` live, `data/demo/attachments/` demo). Missing `attachments` on import canonicalizes to `[]`. Add and remove attachments through mutations; cap each file at 25 MiB.
- Keep view-only values derived. Never persist Kanban columns, stale status, date groups, stage durations, statistics, or filters. Do not persist overdue/upcoming buckets, calendar day maps, or stale membership because they depend on browser-local "today".
- On first launch after upgrading from browser storage, migrate a valid legacy `localStorage` document into `data/tracker.json` once (live profile only), then stop using `localStorage`.
- A Cursor `beforeSubmitPrompt` hook backs up live and demo `tracker.json` files and their attachment directories to `data/backups/{timestamp}/` before agent prompts. Agents should edit applications through mutations and attachment APIs; do not bypass the backup hook with alternate write paths.

### Demo data

- `pnpm dev:demo` and `pnpm start:demo` first launch, plus confirmed demo reset, must produce the same 19 deterministic fictional records, exactly one ending in each configured state. Demo reset is unavailable on the live profile and must not write demo records into `data/tracker.json`.
- The examples intentionally include prior history, dated and undated actions, overdue work, notes, stage prep notes, and stale timestamps so every view has useful content.
- If states change, update the union, configuration, demo coverage, validation, and tests together. Preserve the runtime assertion that demo data covers every state exactly once.

### View behavior

- One context bar under the topbar carries the view title, the filtered count, and the global
  filters. The active view's name is the page `h1` for document structure only — the nav tab
  already shows it, so no view repeats it as a visible heading. Table, Stale, and Statistics keep
  their `h2` as `sr-only`; Calendar's heading stays visible because it names the shown month.
- Import, export, and demo reset live behind the topbar's **More actions** disclosure. It is a
  disclosure holding plain buttons, not an ARIA menu, so Tab alone reaches the items; keep Escape,
  outside-click dismissal, and focus return to the trigger. The import file input must stay mounted
  outside the panel, which unmounts when it closes.
- The Kanban card's state `<select>` reads **Move** rather than repeating the lane's state, and is
  laid over that trigger at zero opacity. It must remain a real focusable `combobox` named
  `Move {company} to state` — it is the accessible and touch fallback for drag-and-drop.
- All six views consume the same application collection and respect app-wide search, state, and company filters.
- Table column filters further narrow only the table. They are display state and must not be persisted.
- Stage prep notes open in their own dialog from the Kanban card and the table row. It lists the application's current stage first, then every other stage that has notes, so the stage you are interviewing for is on screen first. Global search matches stage note text through `search_text`.
- A stage that already has notes opens as a rendered outline; an empty stage opens in the editor. Read and edit mode, and which points are folded, are display state and must not be persisted.
- `src/markdown/parseMarkdown.ts` supports headings, nested ordered and unordered lists, paragraphs with hard line breaks, block quotes, fenced code, bold, italic, inline code, escapes, and links. It is deliberately a subset, not CommonMark. Links render only for `http`, `https`, and `mailto` targets; anything else falls back to plain text. Extend the parser and its tests together.
- A list item holds `children: BlockNode[]`, so anything indented under a point—nested lists, paragraphs, quotes, code—belongs to that point. A line that merely wraps the point keeps flowing into its text; content after a blank line, or starting a block of its own, becomes a child. That distinction is what decides whether a point folds.
- Everything with hierarchy folds: a heading folds through to the next heading of equal or higher level, a list item folds when it has children, and quotes and code blocks fold behind a summary. Keep fold controls as real buttons carrying `aria-expanded`.
- `FoldRow` renders one pattern for every fold: a chevron `button` that owns the accessible name and keyboard focus, plus adjacent text that toggles on click. Do not wrap the text in the button—note text contains links, which may not nest inside a button, and a button would make the note hard to select and copy. The text handler ignores clicks that land on a link or that end a non-collapsed selection; keep both guards.
- `MarkdownNotes` builds fold keys with the `blockKey`/`itemKey` helpers, and both the renderer and the Collapse all collector walk the tree with them. Adding a foldable block means updating `collectBlockKeys` alongside the renderer, or Collapse all silently misses it. The integration test that collapses every level exists to catch exactly that drift.
- Next actions include every non-blank action, grouped into overdue, upcoming, and unscheduled; dated entries sort chronologically.
- Calendar placement is based only on `next_action_at`.
- Stale means `updated_at` is at least the selected threshold in the past and sorts oldest first. The 7/14/30-day choice is display state and must not be persisted.
- Statistics use configured state order. Current counts come from `state`; ever-reached counts come from `state_history` and count each application once per reached state.
- Browser-local dates control calendar placement, overdue boundaries, and stale thresholds. Persisted timestamps remain timezone-qualified.
- Overdue grouping compares browser-local calendar days, so an action earlier today is not overdue. Stale thresholds are inclusive: an application exactly 7, 14, or 30 days old qualifies for that threshold.
- Kanban pairs each live state with its `rejectedStateFor` counterpart in one stage column (11 columns, 19 labelled lanes). Pairing is derived view layout only; each state remains its own drop target. Global state filtering still shows one lane per selected state without forcing a pair.

### Accessibility and interaction

- Keep dialogs and controls labelled, keyboard operable, and focus-safe. Closing an editor should restore focus to its opener when possible.
- Native drag-and-drop must retain the accessible state-selector fallback; it is also important for touch devices.
- Confirm destructive collection changes such as import replacement and demo reset, as well as application deletion.
- Preserve responsive behavior, including horizontally scrollable Kanban columns and usable narrow-screen forms.

## Gotchas

- `datetime-local` inputs represent browser-local wall time. Convert them to ISO timestamps for storage and back to local values for editing; do not parse them as UTC by accident.
- The demo uses a fixed reference timestamp for deterministic content and tests. Changing it can alter stale, overdue, and calendar expectations throughout the suite.
- The editor saves ordinary field edits before applying a state move. Keep the move mutation responsible for state history so one save cannot append duplicate entries.
- Submitting the editor currently refreshes `updated_at` even when no editable value changed. An explicit same-state move is the only exact timestamp-preserving no-op. Change this only deliberately and update its tests with the behavior.
- Import validation rebuilds canonical objects, which is how unknown fields are ignored. Avoid retaining the raw imported object.
- Invalid `data/tracker.json` or `data/demo/tracker.json` files are not overwritten on startup. The app shows an error and leaves the file untouched. Invalid file imports are also non-destructive.
- The Vite dev and preview servers expose `GET`/`PUT`/`DELETE` on `/__db` to read and write the active profile's database file. `pnpm dev` and `pnpm start` use `data/tracker.json`. `pnpm dev:demo` and `pnpm start:demo` use `data/demo/tracker.json`. `DELETE` reseeds demo data only on the demo profile.
- Global filtering can intentionally hide Kanban columns and affects the collection shown by statistics.
- Tests that depend on dates should control the clock and account for browser timezone boundaries rather than assuming UTC display days.
- Test setup mocks `/__db` with an in-memory store, seeds demo data, and supplies a `ResizeObserver` stub. Add new browser API stubs centrally so component tests remain consistent.

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
