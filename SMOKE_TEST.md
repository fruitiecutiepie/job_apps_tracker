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

Reading an application's state history back in the editor — one row per move, oldest first, and
none at all on a new application — is covered by the app integration tests, and the spans it shows
by `src/stateTimeline.test.ts`.

Recording compensation through the editor, reading a stored record back into its boxes, and
refusing an amount with no currency are covered by the app integration tests.

Importing a calendar invite through the editor, replacing a rescheduled one, and refusing an invite
with no start time are covered by the app integration tests.

Live first launch (empty `data/tracker.json`, no reset control) is covered by the
app integration tests.

Finding text in the prep notes panel — counting matches across every open note including other
applications', stepping through them into tabs that are not rendered and wrapping, opening a fold
to show a hit and closing it again
afterwards, and Escape closing the find bar before the panel — is covered by the app integration
tests, along with the tab bar, its arrow keys, the outline and its hierarchy, quick open, and
splitting into two panes.

Discovering the panel's five shortcuts without the README — the title bar controls naming the one
they share, the capture box carrying `aria-keyshortcuts` for the shortcut with no button, and the
shortcuts list opening, reading all five, and closing on Escape without taking the panel with it —
is covered by the app integration tests. Which modifier the labels read is covered by
`src/shortcuts.test.ts`; jsdom reports no platform, so the `⌘` half only appears on a real Mac and
stays manual below.

Capturing what you were told — Enter storing a line without Save and without submitting the panel,
the line reading in the docked log and not in the prep note above it, the log and its capture box
staying writable while the prep note is being edited, captures surviving the prep note being
cleared, and Ctrl+K reaching the focused pane's box — is covered by the app integration tests.
Correcting a captured line in place — rewriting one and keeping its id and the moment it was
captured, removing one with the bin, and dropping a note whose last line goes when nothing was
written for it — is covered by the app integration tests and by `src/domain/domain.test.ts`.
Reading captured records back as a note, a heading per day, and the order they were said in are
covered by `src/markdown/capture.test.ts`. The sticky headers,
the breadcrumb trail, and the scroll to each hit need real layout, so they stay manual below.

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
   Atlas Thread Kanban card — on the **Next** line itself, not down beside Move and Prep notes —
   on its Focus row, and in its Table **Next action** cell, but on no card or row without an
   action. Select **Done** on the Saffron Systems card, an accepted application whose only
   remaining reason to appear is its task. Confirm the Next line and the Done control both go,
   that the row leaves Focus's **Finished, action outstanding** group, and that the stage, the
   state history, the deadline, and the Notes text are all unchanged.
   Open Saffron Systems and confirm **Completed actions** lists the task you just closed above
   the Notes box, newest first, with today's date and nothing written into Notes itself. Open
   Atlas Thread and confirm the Next action, its date, and **Done** sit on one row in that
   order, all lined up on the inputs. Select Done, and confirm the action and date fields clear,
   the control greys out with nothing left to resolve, and a row appears below — then close
   without saving and confirm nothing was recorded. Narrow the window and confirm the three
   stack rather than squeezing. Repeat and save,
   then reopen and confirm it persisted. **Remove** an entry, save, and confirm it is gone and
   that the next action was not restored. Search for the text of a completed action and confirm
   it finds the application.
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
   confirm the formatting rendered. Confirm the editor fills the pane's height between its toolbar
   and its hint, on an empty stage as well as a full one, and that a short note being read still
   sizes to itself. Type past the bottom of the box and confirm it holds its height and scrolls the
   text inside itself rather than growing, with no resize handle to drag, and that the toolbar, the
   hint, and the dock below all stay where they are. Write every kind of block the hint names — a
   quote, a nested quote, and a fenced block — and confirm each renders, folds, and is indented
   under whatever it hangs from. Stop typing and confirm the status bar goes from
   **Waiting to save** to **Saved** with a time, that no toast appears for it, and that reopening
   the panel shows the notes. Type a last few words and close the panel immediately, then reopen it
   and confirm those words are there too. Add notes for a stage
   further down the pipeline and confirm searching for that text finds the application.
   Clear a stage's notes and confirm they go on their own, while the stage keeps its tab and pane
   until the panel is closed. Close another stage's tab with its **X** and confirm the tab goes but
   the note is back the next time the panel opens. Confirm every tab closes, the badged current
   stage included, and that closing the last one closes the panel.
   Open a second application's notes with `Ctrl`/`Cmd+P` — pick a company other than the one the
   panel was opened from — and confirm it arrives as a tab in the pane you were in, named
   `{Company} · {Stage}` like the rest. Split, and confirm one company's note can be read beside
   another's. Confirm each pane carries its own strip of tabs, that **Unsplit** gathers every tab
   into one pane rather than closing any, and that a note already open is brought into view rather
   than opened a second time.
   Confirm the notes fill the screen: the title bar, tab bar, breadcrumbs, outline, and status row
   stay put while only the notes column scrolls, and a stage's header sticks to the top of that
   column as its note runs past, with the headings inside it sticking below the header.
   Move between stages with the tabs and with the arrow keys, confirming focus follows the tab.
   Drag a tab within its strip and confirm it reorders, with the slot it would land in marked
   as you go; drag one onto the other pane's strip in a split and confirm it moves across.
   Do both again with `Ctrl`/`Cmd+Shift+←/→` and `Ctrl`/`Cmd+Alt+←/→` and confirm the keyboard
   reaches the same arrangements. Move the last tab out of a pane and confirm the pane goes and
   the split folds back.
   Scroll a long note and confirm the breadcrumbs name the heading you are inside, that the
   matching outline row is marked, that the rows above it on the trail are marked more quietly
   with their indent guide picked out, and that selecting an outline row scrolls to that heading.
   In a note with headings three levels deep, confirm the outline indents each level with its own
   guide, that deeper rows read more quietly than the top level, and that a third-level row is
   still clearly marked when it is the one you are inside.
   Press `Ctrl`/`Cmd+P`, type part of a stage name, and confirm the picker filters loosely, marks
   the stages already open, opens the one you pick as a tab ready to type into, and that the
   browser's print dialog never appears.
   Select **Split** (or `Ctrl`/`Cmd+\`) and confirm a second pane opens on another stage, that
   each pane scrolls and sticks its own header independently, that the focused pane is marked and
   follows a click into either one, and that the outline and breadcrumbs describe the focused pane.
   Select a tab whose stage is already in the other pane and confirm focus moves there rather than
   the note opening twice. Close one pane, then **Unsplit**, and confirm the other note is untouched.
   Press `Ctrl`/`Cmd+B` and confirm the outline collapses away, the notes take the width, and it
   comes back. On a narrow window, confirm a split panel stacks its panes instead of squeezing them.
   Scroll a long note and confirm the **Heard** dock stays pinned to the bottom of its own pane
   with the note scrolling under it, opaque against both a plain stage and the tinted current one.
   Type a line, press Enter, and confirm it appears at the end of the log under today's date and
   stamped with the time it was captured, that the notice reports it, and that closing the panel with Escape and reopening it shows the line
   still there. Capture a second line and confirm it joins the same day under its own
   time stamp, rather than repeating the date. Capture enough lines to fill the log and confirm it scrolls within its own cap, holding
   the newest line in view, with the day heading sticking to the top of it and the prep note above
   still readable. Select **Edit** on that stage and confirm the log and its box stay put and
   still work while the prep note is in the editor.
   Select **Correct** and confirm each captured line opens in its own box with the time it was
   captured beside it, that Enter and clicking away both store a change, that Escape puts a line
   back as it was, and that the bin removes one. Confirm a corrected line keeps its place and its
   time when you select **Done** and read the log back.
8. In the prep notes panel, press `Ctrl`/`Cmd+F` and confirm the browser's own find does not open.
   Search for text that appears in more than one stage, and confirm the count reads `1 of N`, every
   hit is highlighted, the current one stands out, and each tab shows a count of the matches in
   that stage's note. Step with the up and down buttons and with Enter and Shift+Enter, confirming the
   panel scrolls to each hit, that stepping across a stage boundary switches tab, and that
   stepping past either end wraps.
   Search for text that only appears in a stage you are not looking at, and confirm the panel
   switches to that tab and scrolls to the hit. With the panel split, confirm the match lands in
   the focused pane and leaves the other one alone.
   Fold a heading, then search for text inside it: the fold must open to show the hit, and close
   again when the find closes. Search for something absent and confirm it reads No results.
   Press `Ctrl`/`Cmd+F` again while the bar is open and confirm the existing query is selected.
   Press Escape once to close the find and again to close the panel.
   Reopen the panel and select the keyboard button in the title bar. Confirm the list names all
   five shortcuts, that on macOS they read `⌘F` and elsewhere `Ctrl+F`, that Tab reaches the button
   and Enter opens it, that Escape closes the list and returns focus to it without closing the
   panel, and that hovering **Split**, **Go to stage**, **Find**, and the outline toggle shows the
   same shortcut each one answers.
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
13. In the application editor, pick a currency, set an **Advertised** band and an **Expected**
    single figure, save, reopen, and confirm the band reads back in both boxes while the
    single figure leaves its **to** box empty. With the cursor in an amount box, press the up
    and down arrows and confirm the figure moves by 5,000, by 10,000 with Shift, and gains
    its thousands separators. Type an amount with no currency and confirm
    the save is refused with a readable message, then clear every amount and confirm the
    currency is dropped rather than kept alone. Confirm the demo's Halcyon Maps row reads
    `AUD · Advertised 180,000–210,000 · Expected 200,000 · Offered 215,000 · 8% above target`,
    that Orbit & Oak reads `within target` because its band reaches the target, and that
    Marble & Finch claims no gap because it has no target. Sort Compensation both ways and
    confirm Northstar Labs — which has only an expectation — stays at the bottom in each
    direction along with the rows that have nothing at all.
    On the Compensation column filter, pick **Advertised** and a range that overlaps Orbit &
    Oak's posting, and confirm only rows advertised in that stage and range show, not rows
    whose offer happens to fall in it. Switch back to **Any stage**, leave **Max** blank, and
    confirm a **Min** alone reads as at least that figure rather than requiring an upper end.
    Clear column filters and confirm the picker returns to **Any stage** with both boxes
    empty.
14. Open the demo's Saffron Systems application and confirm the **History** list reads down from
    **Applied** to **Accepted**, each move showing its date and how long that state held, with the
    last one still running. Move it to another state, save, reopen, and confirm one entry was
    appended. Reopen and change nothing but the notes, save, and confirm the list is unchanged.
    Open **Add application** and confirm no History list appears.
15. Choose **Reset demo data** from **More actions**, cancel once, then reopen the menu
    and confirm it. Confirm the same 19 examples are restored in `data/demo/`, now including
    the demo invites, and that `data/tracker.json` is unchanged.

The demo-profile steps change only `data/demo/` tracker data. The final reset restores
the deterministic demo data.
