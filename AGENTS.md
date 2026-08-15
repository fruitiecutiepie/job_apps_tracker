# Contributing to the Job Applications Tracker

This file applies to the entire repository. Keep changes within the app's current scope: it is a single-user, local-first React/TypeScript application with no authentication, backend, synchronization, notifications, or collaboration layer.

## Repository map

- `src/App.tsx` coordinates shared filters, dialogs, imports, exports, persistence, and the six views.
- `src/domain/` is the source of truth for types, state configuration, mutations, validation, storage, IDs, and demo data.
- `src/views/` contains view components and their derived-data helpers.
- `src/test/` contains app integration and smoke tests; view-focused tests live beside the views.
- `src/styles.css` contains the responsive visual system.
- `SMOKE_TEST.md` records the automated smoke coverage and optional browser-only checks.

Use pnpm for dependency and script commands. Do not introduce a second package manager or regenerate the lockfile with another tool.

## Core invariants

### States and transitions

- `StateId` is a closed union of exactly 19 states. `STATE_CONFIG` in `src/domain/states.ts` is the only source for state order and display labels.
- Preserve the configured labels exactly, including the em dashes in rejection labels.
- Any state may move directly to any other state. Do not add a transition graph or broader pipeline stages.
- A real state change updates `state` and `updated_at` and appends one timestamped `state_history` entry.
- Moving to the current state is a no-op: it must not update timestamps, replace the object, or append history.
- Editing unrelated fields updates `updated_at` but never appends state history.

### Application mutations

- Route creates, edits, moves, and deletes through the mutation functions in `src/domain/mutations.ts`; do not update application objects ad hoc in UI components.
- IDs are immutable UUIDv7-compatible values generated when records are created. Company and role are editable attributes, not identity.
- A created application receives timestamps and an initial history entry for its starting state.
- `company` is required and non-blank. Optional text fields are canonicalized to strings or `null`.
- A next action may have no date. A date may not survive without a non-blank action.
- Application timestamps and history timestamps are timezone-qualified ISO-8601 strings.

### Persistence, import, and export

- Persist one self-describing JSON database file at `data/tracker.json` with shape `{ schema, applications, indexes }`. The embedded `schema` object is the current JSON Schema; update it when the shape evolves instead of running migrations.
- `applications` is the source of truth. Rebuild `indexes` on every successful load or save when they are missing or stale. Do not hand-edit indexes; edit `applications` or go through mutations.
- Seed demo data only when `data/tracker.json` is absent. A valid saved document—even an empty one—must not be reseeded on reload.
- Validate and canonicalize an imported document before confirmation or replacement. A parse error, validation error, unsupported legacy `schema_version`, or cancelled confirmation must leave saved data untouched.
- Import still accepts legacy `{ schema_version: 1, applications }` exports. Canonicalize applications, attach the current schema, and rebuild indexes.
- Ignore unknown imported fields for forward compatibility. Reject duplicate IDs, invalid states, malformed timestamps, invalid URLs, and supplied history whose final state differs from the current state. Missing `state_history` is accepted for compatibility and synthesized from the current state; supplied history must be non-empty.
- Import replaces the entire collection; export writes a zip archive with `tracker.json` plus attachment files. Legacy JSON import still works without files.
- Application attachments store metadata on each application and file bytes under `data/attachments/{applicationId}/{attachmentId}`. Missing `attachments` on import canonicalizes to `[]`. Add and remove attachments through mutations; cap each file at 25 MiB.
- Keep view-only values derived. Never persist Kanban columns, stale status, date groups, stage durations, statistics, or filters. Do not persist overdue/upcoming buckets, calendar day maps, or stale membership because they depend on browser-local "today".
- On first launch after upgrading from browser storage, migrate a valid legacy `localStorage` document into `data/tracker.json` once, then stop using `localStorage`.
- A Cursor `beforeSubmitPrompt` hook backs up `data/tracker.json` and `data/attachments/` to `data/backups/{timestamp}/` before agent prompts. Agents should edit applications through mutations and attachment APIs; do not bypass the backup hook with alternate write paths.

### Demo data

- First launch and reset must produce the same 19 deterministic fictional records, exactly one ending in each configured state.
- The examples intentionally include prior history, dated and undated actions, overdue work, notes, and stale timestamps so every view has useful content.
- If states change, update the union, configuration, demo coverage, validation, and tests together. Preserve the runtime assertion that demo data covers every state exactly once.

### View behavior

- All six views consume the same application collection and respect app-wide search and state filters.
- Next actions include every non-blank action, grouped into overdue, upcoming, and unscheduled; dated entries sort chronologically.
- Calendar placement is based only on `next_action_at`.
- Stale means `updated_at` is at least the selected threshold in the past and sorts oldest first. The 7/14/30-day choice is display state and must not be persisted.
- Statistics use configured state order. Current counts come from `state`; ever-reached counts come from `state_history` and count each application once per reached state.
- Browser-local dates control calendar placement, overdue boundaries, and stale thresholds. Persisted timestamps remain timezone-qualified.
- Overdue grouping compares browser-local calendar days, so an action earlier today is not overdue. Stale thresholds are inclusive: an application exactly 7, 14, or 30 days old qualifies for that threshold.

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
- Invalid `data/tracker.json` files are not overwritten on startup. The app shows an error and leaves the file untouched. Invalid file imports are also non-destructive.
- The Vite dev and preview servers expose `GET`/`PUT`/`DELETE` on `/__db` to read and write `data/tracker.json`. Use `pnpm start` after `pnpm build` for a production build with the same file-backed database.
- Global filtering can intentionally hide Kanban columns and affects the collection shown by statistics. The table also has its own row filter.
- Tests that depend on dates should control the clock and account for browser timezone boundaries rather than assuming UTC display days.
- Test setup mocks `/__db` with an in-memory store and supplies a `ResizeObserver` stub. Add new browser API stubs centrally so component tests remain consistent.

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
