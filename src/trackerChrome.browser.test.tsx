/**
 * The tracker switcher and the replace question, measured in a real browser. Both carry
 * text the reader supplies — a tracker's name, a dropped file's name, a folder's — and both
 * have to stay on screen however long that text is, at a phone's width as well as a laptop's.
 * jsdom lays nothing out, so it cannot say whether they do.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'

import { TrackerSwitcher } from './TrackerSwitcher'
import { ReplaceTrackerDialog } from './ReplaceTrackerDialog'
import type { TrackerSummary } from './backend'

const LONG = 'Senior Software Engineer applications, autumn and winter search, second attempt'

const trackers: TrackerSummary[] = [
  { id: 'here', name: LONG, applications: 12, openedAt: '2026-10-01T09:00:00.000Z', folder: 'job-search-folder-with-a-long-name' },
  { id: 'other', name: 'Spring', applications: 1, openedAt: '2026-09-01T09:00:00.000Z', sourceFile: `${LONG}.json` },
]

/** Every box inside `container` that reaches past either of its sides. */
function overflowing(container: HTMLElement): string[] {
  const outer = container.getBoundingClientRect()
  return [...container.querySelectorAll<HTMLElement>('*')]
    .filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && (box.right > outer.right + 1 || box.left < outer.left - 1)
    })
    .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
}

describe.each([[375, 700], [1280, 800]])('at %ipx wide', (width, height) => {
  it('keeps the switcher\'s panel and every row in it on screen', async () => {
    await page.viewport(width, height)
    render(
      <header className="topbar">
        <div className="topbar__identity">
          <TrackerSwitcher
            current={{ id: 'here', name: LONG, sourceFile: null }}
            currentFolder="job-search-folder-with-a-long-name"
            listTrackers={async () => trackers}
            onExport={() => {}}
            onNewFromFile={() => {}}
            onNewFromFolder={() => {}}
            onRemove={() => {}}
            onRename={async () => true}
          />
        </div>
      </header>,
    )

    await userEvent.click(document.querySelector<HTMLElement>('.tracker-switcher__trigger')!)
    await expect.poll(() => document.querySelectorAll('.tracker-switcher__list li').length).toBe(2)
    const panel = document.querySelector<HTMLElement>('.tracker-switcher__panel')!
    const box = panel.getBoundingClientRect()

    expect(Math.round(box.left)).toBeGreaterThanOrEqual(0)
    expect(Math.round(box.right)).toBeLessThanOrEqual(width)
    expect(overflowing(panel)).toEqual([])
    // Every row keeps its three actions, however long the name beside them.
    for (const row of panel.querySelectorAll<HTMLElement>('.tracker-switcher__list li')) {
      expect(row.querySelectorAll('button')).toHaveLength(3)
    }
  })

  it('keeps the replace question on screen, however long the file and tracker names', async () => {
    await page.viewport(width, height)
    render(
      <ReplaceTrackerDialog
        onChoose={() => {}}
        replacement={{
          kind: 'import',
          fileName: `${LONG}.json`,
          current: 12,
          backedUp: false,
          folder: null,
          openAsNewBeside: LONG,
        }}
      />,
    )

    const dialog = document.querySelector<HTMLElement>('.dialog')!
    const box = dialog.getBoundingClientRect()
    expect(Math.round(box.left)).toBeGreaterThanOrEqual(0)
    expect(Math.round(box.right)).toBeLessThanOrEqual(width)
    expect(overflowing(dialog)).toEqual([])
  })
})
