# Smoke testing

## Automated critical journey

Run:

```sh
pnpm test:smoke
```

This checks the demo-profile journey: 19 first-load examples, navigation through all four views
(Kanban, Table, Statistics, Compare), creating and searching for an application,
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

Logging hiring correspondence through the editor — keeping the time a message was sent rather than
the moment it was filed, correcting that time, removing a message, refusing one with no text or no
time, a drafted message surviving nothing when the dialog is cancelled, and finding an application
by a word only a message holds — is covered by the app integration tests. The record's own rules —
`at` supplied and correctable, send order against a timestamp written with an offset, and import
canonicalization — are covered by `src/domain/domain.test.ts`.

Reading a stage's messages in the prep notes dock — the collapsed toggle and its count, the day
heading, showing only what is filed against that stage, and the find numbering the written note,
then the messages, then the captures as one list while opening the collapsed section it steps
into — is covered by the app integration tests. Rendering the records as a note, including keeping
the paragraph breaks and quoted lines of a pasted message inside its own bullet, is covered by
`src/markdown/correspondence.test.ts` and `src/markdown/dayLog.test.ts`.

Whether any of that survives as layout — a pasted email's paragraphs separated and indented under
their own bullet, a message folding to one row that says what it holds, both dock sections
scrolling inside their caps instead of pushing the prep note off the pane, and **Read** giving the
messages the whole card rather than the 70% the strip is capped at — is covered in a real browser
by `src/correspondenceDock.browser.test.tsx`, across all three engines. jsdom cannot answer any of
it: it has no layout, and it drops a shorthand carrying a `var()`.

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
test cannot judge reliably.

Some of the panel's layout is no longer only here. `pnpm test:browser` measures, in
Chromium, Firefox and WebKit, that split panes sit side by side and stay wide enough to
read a note in, that dragging the divider resizes both and holds a pane at its minimum,
that a narrow window stacks a row, and that a long note scrolls inside its card rather
than the page. Dragging a **tab** is covered there too, by mouse and by
finger, now that it is built on pointer events rather than HTML5 drag-and-drop. Dragging a
Kanban **card** is still a manual check: that one is HTML5 drag-and-drop, which works with
neither a finger nor any browser automation.

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
   Open Table and Statistics. Confirm each view is
   readable at both wide and narrow window sizes.
   On Table, confirm it opens sorted by Urgency with the rows banded under headings, that
   each band shows a count, that every band holds at least one application so each heading
   is visible, and that each row's stated reason agrees with the band it sits under.
   Confirm the dated band reads in date order regardless of how its rows are rated:
   preference only separates rows whose date and urgency already match, so a well-rated
   application must never appear above one that is due sooner.
   Sort by Company and confirm the band headings go away, then sort by Urgency again and
   confirm they come back.
   Confirm Northstar Labs bands under **Live, nothing dated** with a reason naming the
   silence: it was edited yesterday but has not moved in weeks, and the Activity column
   reads it as Idle while its band reason names the stage change it has not had.
   Confirm a column filter narrows rows without changing Kanban, and that
   Clear column filters restores the table, including when only the Preference filter is set.
   Confirm the most pressing live applications lead, that each row
   explains itself, and that rejected, accepted, and no-openings rows show an unranked dash.
   Confirm a live row has a **Reject** button beside its state select and that
   already-rejected, accepted, and no-openings rows do not. Press it on one and confirm the
   row moves to that state's rejected counterpart and gains a history entry.
4. Confirm **Done** appears beside a next action in both places and nowhere else: on the
   Atlas Thread Kanban card — on the **Next** line itself, not down beside Move and Prep notes —
   and in its Table **Next action** cell, but on no card or row without an
   action. Select **Done** on the Saffron Systems card, an accepted application whose only
   remaining reason to appear is its task. Confirm the Next line and the Done control both go,
   that the row moves from the table's **Finished, action outstanding** band to **Finished**,
   and that the stage, the
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
   deadline saves, shows in the Table deadline column and bands the row under **Dated,
   soonest first**.
6. Use Tab, Shift+Tab, Enter, and Escape to navigate controls and the application
   dialog. Confirm focus is visible and every form field has a useful label.
7. Open **More actions**, close it with Escape, reopen it and close it by clicking
   outside; confirm focus returns to the trigger each time. Reopen it and export the
   data, confirming a timestamped zip file is downloaded. Try an invalid
   import and confirm the saved data is unchanged; try a valid zip or JSON import and
   confirm the replacement prompt appears.
8. Select **Prep notes** on a Kanban card, for example Halcyon Maps in the demo profile. Confirm the
   app goes to the **Prep notes** destination in the header rather than opening a dialog over the
   board, that the view strip no longer marks any view as current, that the bar above the panel offers none of the
   collection's filters, that the sidebar stacks **Outline** over **All prep notes** with
   that each half folds from its own heading and the handle
   between them sizes the two, that the title bar's icons name themselves on hover, that **Open**
   there reaches a stage with no note and **Sidebar** puts the whole column away and brings it back, that the tree groups notes by
   stage down the pipeline and lists no stage you have written nothing for — type a word you know is
   in another application's note and confirm the tree filters to it and picking it opens it, then
   drag a row onto the other pane's tabs and onto a pane edge and confirm it lands where it was
   dropped rather than in the pane you were reading, then drag a note the other pane already holds
   onto this one and confirm both panes show it, that typing into one shows in the other, and that
   closing one copy leaves the other, and that opening enough notes to overfill a tab strip scrolls
   it to the tab just opened rather than leaving it past the edge — that the
   application's current stage appears first and is badged, and that saved notes render as an outline
   rather than raw text. Open a second company's notes from the picker, split the panes, then leave
   for another view and come back — and reload the page — and confirm the same arrangement is there.
   Close every tab and confirm the view stays, showing its empty state. Fold a heading, a bullet with sub-points, a bullet with a detail paragraph,
   a quote, and a code block by clicking their text rather than their chevron, use **Collapse all**
   and **Expand all**, then reopen the view and confirm nothing about the folding was saved.
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
   On a phone or with touch emulation, confirm a short swipe along the strip scrolls it while
   a tab held for a moment is picked up and can be carried to another slot or pane edge.
   Do both again with `Ctrl`/`Cmd+Shift+←/→` and `Ctrl`/`Cmd+Alt+←/→` and confirm the keyboard
   reaches the same arrangements. Move the last tab out of a pane and confirm the pane goes and
   the split folds back.
   Drag a tab onto the left, right, top and bottom edge of a pane in turn and confirm each
   splits a new pane open on that side, with the edge marked as you hover it and the zones
   gone again once the drag ends. Confirm `Ctrl`/`Cmd+Shift+↑/↓` splits the same way when
   nothing is stacked there yet, and moves into the pane instead once one is.
   Drag the handle between two panes and confirm both resize as you go and the notes reflow;
   Tab to that handle and confirm the arrow keys move it too. Drag it as far as it will go in
   each direction and confirm neither pane collapses out of sight. Move a tab across afterwards
   and confirm the widths hold, then close the panel, reopen it, and confirm they are back to
   even — pane widths are not saved.
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
   Scroll a long note and confirm the **What they said** dock stays pinned to the bottom of its own pane
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
   panel, and that hovering **Split**, **Find**, and the sidebar toggle shows the
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
    appears on the Kanban card and in the table's Invites column,
    and that searching its description finds the application. On Table, sort by **Invites** and
    confirm rows with nothing coming sink to the bottom. Tick **Cancelled**, save, and confirm the
    table cell reads as cancelled and the card no longer shows it.
12. In the application editor, confirm each logged message reads as one folded line — when,
    who, how, and a line of what it says — and that the line tells you which message it is
    without opening it. Then choose **Add message**. Paste a real
    multi-paragraph email into **Message**, set **Date sent** to a date several days in the past, name
    who it was from, give it the email's subject, and pick a channel from the suggestions —
    confirming the box still accepts a word that is not on the list. Log a second message with
    the same subject and confirm the two read as one thread under a single heading — in the
    editor's list as well as in the prep notes log — and that a message with no subject sits on
    its own in both. Save, reopen, and confirm the date you typed came back rather
    than the moment you saved. The structure of the rendered message is covered by the browser
    suite; what is left here is judgement. Open Prep notes for that stage, expand
    **Messages**, and ask whether the hint makes the two dates distinct before you have to find
    the difference out, and whether a thread reads well open — which is how the section now
    arrives. Press **Collapse all** and ask the other half: whether a folded row, carrying the
    time, who it was from, and a line of what it says, tells you enough to decide whether to
    open it, and whether that line is cut at a useful length. Press **Edit messages** and confirm the form opens on that
    stage's rows, already unfolded, rather than at the top. Press **Read** and confirm a
    long email is comfortable to read
    down the column, that the quoted chain stays out of the way until asked for, and that
    **Prep note** brings the note back where you left it.
13. In the application editor, set all four ratings, save, reopen, and confirm they persisted.
    Set one to **Don't know** and another back to **Not rated**, save, and confirm the Table
    Preference cell distinguishes the two. Confirm the demo's Lumen Pantry row reads
    `4.00 · People 1` while a fully even row reads a plain `4.00`, so an average cannot hide a
    low judgement. Confirm the Kanban card for the same application reads the same text as the
    column. Sort Preference both ways and confirm unrated rows stay at the bottom in
    each direction.
    On Statistics, confirm the five headline figures read 19 applications with the demo's
    live count, heard-back count, got-past-the-first-stage count and median reply days, and
    that each shows its share of the total. Confirm the **Stages** table lists only stages
    something has reached, with no rejected states among them, and that Here now plus Ended
    here across the table equals 19. Confirm **Sources** lists each of the demo's sources
    with its own reply and progress counts. Confirm the **Ratings** table lists all four
    dimensions with the demo's counts — People judged twice with a mean of 2.50, and one
    **Don't know** — above a line reading 3 of 19 rated with a mean preference of 3.96.
    Filter by a company you have not rated and confirm that table is replaced by a plain
    sentence rather than a grid of zeros. Filter to nothing at all and confirm the view
    offers an empty state rather than a page of dashes.
14. In the application editor, pick a currency, set an **Advertised** band and an **Expected**
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
15. Open the demo's Saffron Systems application and confirm the **History** list reads down from
    **Applied** to **Accepted**, each move showing its date and how long that state held, with the
    last one still running. Move it to another state, save, reopen, and confirm one entry was
    appended. Reopen and change nothing but the notes, save, and confirm the list is unchanged.
    Open **Add application** and confirm no History list appears.
16. Choose **Reset demo data** from **More actions**, cancel once, then reopen the menu
    and confirm it. Confirm the same 19 examples are restored in `data/demo/`, now including
    the demo invites, and that `data/tracker.json` is unchanged.

The demo-profile steps change only `data/demo/` tracker data. The final reset restores
the deterministic demo data.
