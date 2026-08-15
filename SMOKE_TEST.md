# Smoke testing

## Automated critical journey

Run:

```sh
pnpm test:smoke
```

This checks first-launch demo data, navigation through all six views, creating and
searching for an application, changing its state and recording history, persistence
across an app reload, and confirmed demo-data reset.

## Manual browser-only checks

These checks cover visual and native-browser behavior that the automated component
test cannot judge reliably:

1. Run `pnpm dev` and open the address shown in the terminal. Confirm `data/tracker.json`
   is created on first launch.
2. Confirm Kanban shows 19 ordered columns with one demo application in each state.
   Narrow the window and confirm the board scrolls horizontally without clipping cards.
3. Open Table, Next actions, Calendar, Stale, and Statistics. Confirm each view is
   readable at both wide and narrow window sizes.
4. Add an application with a next action and date. Drag it to another Kanban column,
   then use its state selector to move it again. Reload the page and confirm it remains.
5. Use Tab, Shift+Tab, Enter, and Escape to navigate controls and the application
   dialog. Confirm focus is visible and every form field has a useful label.
6. Export the data and confirm a timestamped JSON file is downloaded. Try an invalid
   import and confirm the saved data is unchanged; try a valid import and confirm the
   replacement prompt appears.
7. Choose Reset demo data, cancel once, then confirm it. Confirm the same 19 examples
   are restored.

The manual steps change only this browser's local tracker data. The final reset restores
the deterministic demo data.
