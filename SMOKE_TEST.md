# Smoke testing

## Automated critical journey

Run:

```sh
pnpm test:smoke
```

This checks the demo-profile journey: 19 first-load examples, navigation through all six views
(Kanban, Table, Focus, Calendar, Stale, Statistics), creating and searching for an application,
changing its state and recording history, recording stage prep notes against it, persistence
across an app reload, and confirmed demo-data reset.

Importing a calendar invite through the editor, replacing a rescheduled one, and refusing an invite
with no start time are covered by the app integration tests.

Live first launch (empty `data/tracker.json`, no reset control) is covered by the
app integration tests.

## Manual browser-only checks

These checks cover visual and native-browser behavior that the automated component
test cannot judge reliably:

1. Run `pnpm dev` and open the address shown in the terminal. Confirm `data/tracker.json`
   is created empty on first launch and that **More actions** offers Import and Export
   but not **Reset demo data**.
2. Run `pnpm dev:demo` and confirm `data/demo/tracker.json` is created. Confirm Kanban
   shows 11 stage columns with a labelled lane for each of the 19 states and one demo
   application in each state.
   Narrow the window and confirm the board scrolls horizontally without clipping cards.
   Confirm cards last updated 14 or more days ago look greyed out and show an untouched-age label.
3. Confirm the view name and the "N of M applications shown" count each appear exactly
   once, in the context bar, and that no view repeats them as a visible heading.
   Open Table, Focus, Calendar, Stale, and Statistics. Confirm each view is
   readable at both wide and narrow window sizes.
   On Focus, confirm only the leading non-empty group starts open, that group headers show
   counts even while collapsed, that expanding and collapsing works with keyboard alone, and
   that each row's stated reason agrees with the group heading it sits under.
   On Table, confirm a column filter narrows rows without changing Kanban, and that
   Clear column filters restores the table.
   Sort by Urgency and confirm the most pressing live applications lead, that each row
   explains itself, and that rejected, accepted, and no-openings rows show an unranked dash.
   On Stale, confirm a live-state row has Move to Rejected and that already-rejected,
   accepted, headhunted, and no-openings rows do not.
4. Add an application with a next action and date. Drag it to another Kanban column,
   then use its **Move** control to move it again — by mouse, and again by Tab plus the
   arrow keys — confirming the control shows a focus ring and sits on one row beside
   **Prep notes**. Reload the page and confirm it remains.
   Add a second application with only a deadline and no next action, and confirm the
   deadline saves, shows in the Table deadline column and in Focus, and does not appear on
   the Calendar.
5. Use Tab, Shift+Tab, Enter, and Escape to navigate controls and the application
   dialog. Confirm focus is visible and every form field has a useful label.
6. Open **More actions**, close it with Escape, reopen it and close it by clicking
   outside; confirm focus returns to the trigger each time. Reopen it and export the
   data, confirming a timestamped zip file is downloaded. Try an invalid
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
9. In the application editor, confirm the two invite buttons read **Import .ics file** and
   **Add invite manually**, and that the difference between them is clear before reading the hint.
   Choose **Import .ics file** and select an `.ics` file saved from a real calendar invite. Confirm
   the description, times, place, and any joining link are filled in, and that the stage defaults to
   the application's current state. Save, reopen, and confirm the invite persisted. Import the same
   file again and confirm it updates that invite rather than adding a second one. Confirm the invite
   appears on the Calendar on its local day, on the Kanban card, and in the table's Invites column,
   and that searching its description finds the application. On Table, sort by **Invites** and
   confirm rows with nothing coming sink to the bottom. Tick **Cancelled**, save, and confirm the
   calendar entry and the table cell read as cancelled and the card no longer shows it.
10. Choose **Reset demo data** from **More actions**, cancel once, then reopen the menu
    and confirm it. Confirm the same 19 examples are restored in `data/demo/`, now including
    the demo invites, and that `data/tracker.json` is unchanged.

The demo-profile steps change only `data/demo/` tracker data. The final reset restores
the deterministic demo data.
