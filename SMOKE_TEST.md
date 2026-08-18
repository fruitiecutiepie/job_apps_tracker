# Smoke testing

## Automated critical journey

Run:

```sh
pnpm test:smoke
```

This checks the demo-profile journey: 19 first-load examples, navigation through all six views, creating and
searching for an application, changing its state and recording history, recording stage prep
notes against it, persistence across an app reload, and confirmed demo-data reset.

Live first launch (empty `data/tracker.json`, no reset control) is covered by the
app integration tests.

## Manual browser-only checks

These checks cover visual and native-browser behavior that the automated component
test cannot judge reliably:

1. Run `pnpm dev` and open the address shown in the terminal. Confirm `data/tracker.json`
   is created empty on first launch and that **Reset demo data** is not shown.
2. Run `pnpm dev:demo` and confirm `data/demo/tracker.json` is created. Confirm Kanban
   shows 11 stage columns with a labelled lane for each of the 19 states and one demo
   application in each state.
   Narrow the window and confirm the board scrolls horizontally without clipping cards.
   Confirm cards last updated 14 or more days ago look greyed out and show an untouched-age label.
3. Open Table, Next actions, Calendar, Stale, and Statistics. Confirm each view is
   readable at both wide and narrow window sizes.
   On Table, confirm a column filter narrows rows without changing Kanban, and that
   Clear column filters restores the table.
   On Stale, confirm a live-state row has Move to Rejected and that already-rejected,
   accepted, headhunted, and no-openings rows do not.
4. Add an application with a next action and date. Drag it to another Kanban column,
   then use its state selector to move it again. Reload the page and confirm it remains.
5. Use Tab, Shift+Tab, Enter, and Escape to navigate controls and the application
   dialog. Confirm focus is visible and every form field has a useful label.
6. Export the data and confirm a timestamped zip file is downloaded. Try an invalid
   import and confirm the saved data is unchanged; try a valid zip or JSON import and
   confirm the replacement prompt appears.
7. Select **Prep notes** on a Kanban card, for example Halcyon Maps in the demo profile. Confirm the
   application's current stage appears first and is badged, and that saved notes render as an outline
   rather than raw text. Fold a heading, a bullet with sub-points, a bullet with a detail paragraph,
   a quote, and a code block by clicking their text rather than their chevron, use **Collapse all**
   and **Expand all**, then reopen the dialog and confirm nothing about the folding was saved.
   Select a sentence inside a foldable point with the mouse and confirm it does not fold, and that
   the text can be copied.
   Select **Edit** on a stage, use the bold and bullet toolbar buttons, switch back with **Read**, and
   confirm the formatting rendered. Save, reopen, and confirm the notes persist. Add notes for a stage
   further down the pipeline and confirm searching for that text finds the application.
   Clear a stage's notes, save, and confirm they are gone.
8. Add an attachment in the application editor, save, reopen the application, and open
   the file. Remove an attachment and confirm it disappears after save.
9. Choose Reset demo data, cancel once, then confirm it. Confirm the same 19 examples
   are restored in `data/demo/` and that `data/tracker.json` is unchanged.

The demo-profile steps change only `data/demo/` tracker data. The final reset restores
the deterministic demo data.
