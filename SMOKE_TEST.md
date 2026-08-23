# Smoke testing

## Automated critical journey

Run:

```sh
pnpm test:smoke
```

This checks the demo-profile journey: 19 first-load examples, navigation through all six views
(Kanban, Table, Focus, Calendar, Stale, Statistics), creating and searching for an application,
changing its state and recording history, marking a next action done and logging it in the
notes, recording stage prep notes against it, persistence across an app reload, and confirmed
demo-data reset.

Recording compensation through the editor, reading a stored record back into its boxes, and
refusing an amount with no currency are covered by the app integration tests.

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
   Confirm the Lumen Pantry card shows `Preference 4.00 · People 1`, that Halcyon Maps shows a
   plain score, and that an unrated card shows no preference line at all.
3. Confirm the view name and the "N of M applications shown" count each appear exactly
   once, in the context bar, and that no view repeats them as a visible heading.
   Open Table, Focus, Calendar, Stale, and Statistics. Confirm each view is
   readable at both wide and narrow window sizes.
   On Focus, confirm only the leading non-empty group starts open, that group headers show
   counts even while collapsed, that expanding and collapsing works with keyboard alone, and
   that each row's stated reason agrees with the group heading it sits under.
   Confirm the dated groups still read in date order regardless of how their rows are rated:
   preference only separates rows whose date and urgency already match, so a well-rated
   application must never appear above one that is due sooner.
   Confirm Northstar Labs appears under **No stage change in more than 7 days** and does not
   appear on Stale at any threshold: it was edited yesterday but has not moved in weeks.
   Confirm every group has at least one application, so each heading and row format is visible.
   On Table, confirm a column filter narrows rows without changing Kanban, and that
   Clear column filters restores the table, including when only the Preference filter is set.
   Sort by Urgency and confirm the most pressing live applications lead, that each row
   explains itself, and that rejected, accepted, and no-openings rows show an unranked dash.
   On Stale, confirm a live-state row has Move to Rejected and that already-rejected,
   accepted, headhunted, and no-openings rows do not.
4. Confirm **Done** appears beside a next action in all three places and nowhere else: on the
   Atlas Thread Kanban card, on its Focus row, and in its Table **Next action** cell, but on no
   card or row without an action. Select **Done** on the Saffron Systems card — an accepted
   application whose only remaining reason to appear is its task. Confirm the card's Next line
   and the Done control both go, and that the notes now end with a line naming the task, dated
   the way dates read everywhere else in the app under your locale. Confirm the stage, the state
   history, and the deadline are unchanged, and that the row leaves Focus's **Finished, action
   outstanding** group, since there is nothing left to do on it. Reload and confirm it stuck.
5. Add an application with a next action and date. Drag it to another Kanban column,
   then use its **Move** control to move it again — by mouse, and again by Tab plus the
   arrow keys — confirming the control shows a focus ring and sits on one row beside
   **Prep notes**. Reload the page and confirm it remains.
   Add a second application with only a deadline and no next action, and confirm the
   deadline saves, shows in the Table deadline column and in Focus, and does not appear on
   the Calendar.
6. Use Tab, Shift+Tab, Enter, and Escape to navigate controls and the application
   dialog. Confirm focus is visible and every form field has a useful label.
7. Open **More actions**, close it with Escape, reopen it and close it by clicking
   outside; confirm focus returns to the trigger each time. Reopen it and export the
   data, confirming a timestamped zip file is downloaded. Try an invalid
   import and confirm the saved data is unchanged; try a valid zip or JSON import and
   confirm the replacement prompt appears.
8. Select **Prep notes** on a Kanban card, for example Halcyon Maps in the demo profile. Confirm the
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
9. With `VISUAL` or `EDITOR` set to a GUI editor, select **Editor** on a stage note. Confirm the file
   opens, that `data/editing/` holds it, and that the banner names the editor and path. Save a change
   in the editor and confirm it appears in the app within a second or two and is stored without
   pressing Save. Select **Stop**, then reopen and close the dialog, and confirm `data/editing/` is
   empty again. Repeat with both variables unset to check the platform opener path.
   If you reach the app over a tunnel, set `TRACKER_EDITOR_URL` to your editor's scheme and confirm
   the banner offers it as a link, that your local editor opens the remote file, and that saves there
   still come back into the app.
10. Add an attachment in the application editor, save, reopen the application, and open
    the file. Remove an attachment and confirm it disappears after save.
11. In the application editor, confirm the two invite buttons read **Import .ics file** and
    **Add invite manually**, and that the difference between them is clear before reading the hint.
    Choose **Import .ics file** and select an `.ics` file saved from a real calendar invite. Confirm
    the description, times, place, and any joining link are filled in, and that the stage defaults to
    the application's current state. Save, reopen, and confirm the invite persisted. Import the same
    file again and confirm it updates that invite rather than adding a second one. Confirm the invite
    appears on the Calendar on its local day, on the Kanban card, and in the table's Invites column,
    and that searching its description finds the application. On Table, sort by **Invites** and
    confirm rows with nothing coming sink to the bottom. Tick **Cancelled**, save, and confirm the
    calendar entry and the table cell read as cancelled and the card no longer shows it.
12. In the application editor, set all four ratings, save, reopen, and confirm they persisted.
    Set one to **Don't know** and another back to **Not rated**, save, and confirm the Table
    Preference cell distinguishes the two. Confirm the demo's Lumen Pantry row reads
    `4.00 · People 1` while a fully even row reads a plain `4.00`, so an average cannot hide a
    low judgement. Confirm the Kanban card for the same application reads the same text as the
    column. Sort Preference both ways and confirm unrated rows stay at the bottom in
    each direction.
    On Statistics, confirm the header reads 19 total, 3 rated, and a mean preference of 3.96,
    and that the **Ratings** table lists all four dimensions with the demo's counts — People
    judged twice with a mean of 2.50, and one **Don't know**. Filter by a company you have not
    rated and confirm the table is replaced by a plain sentence rather than a grid of zeros.
13. In the application editor, set a currency, an **Advertised** band, and an **Expected**
    single figure, save, reopen, and confirm the band reads back in both boxes while the
    single figure leaves its **to** box empty. Type an amount with no currency and confirm
    the save is refused with a readable message, then clear every amount and confirm the
    currency is dropped rather than kept alone. Confirm the demo's Halcyon Maps row reads
    `AUD · Advertised 180,000–210,000 · Expected 200,000 · Offered 215,000 · 8% above target`,
    that Orbit & Oak reads `within target` because its band reaches the target, and that
    Marble & Finch claims no gap because it has no target. Sort Compensation both ways and
    confirm Northstar Labs — which has only an expectation — stays at the bottom in each
    direction along with the rows that have nothing at all.
14. Choose **Reset demo data** from **More actions**, cancel once, then reopen the menu
    and confirm it. Confirm the same 19 examples are restored in `data/demo/`, now including
    the demo invites, and that `data/tracker.json` is unchanged.

The demo-profile steps change only `data/demo/` tracker data. The final reset restores
the deterministic demo data.
