import { describe, expect, it } from 'vitest'

import css from '../styles.css?raw'

/** The declarations of one rule, by selector, so a block can be asserted on as a whole. */
function ruleBody(selector: string): string {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))
  if (!match) throw new Error(`no rule for ${selector}`)
  return match[1]
}

describe('dialog actions', () => {
  it('pins delete, cancel and save to the bottom of the scrolling dialog', () => {
    const body = ruleBody('.dialog__actions')

    expect(body).toMatch(/position:\s*sticky/)
    expect(body).toMatch(/bottom:\s*calc\(var\(--s5\) \* -1\)/)
    // Opaque, or the fields scrolling underneath would show through the row.
    expect(body).toMatch(/background:\s*var\(--surface\)/)
    // The dialog is the scroll container, so nothing between may clip the row.
    expect(ruleBody('.dialog')).toMatch(/overflow-y:\s*auto/)
  })
})

describe('idle pill', () => {
  it('reads as a chip on the recessed card, in tokens only', () => {
    const body = ruleBody('.application-card__idle')

    expect(body).toMatch(/border-radius:\s*var\(--pill\)/)
    // The card behind it is --surface-3 when idle, so a --surface-3 chip would vanish.
    expect(body).toMatch(/background:\s*var\(--surface\)/)
    expect(ruleBody('.application-card--idle')).toMatch(/background:\s*var\(--surface-3\)/)
    // Silence is a nudge, not an alarm: no accent, no danger, and no raw values.
    expect(body).not.toMatch(/--accent|--danger/)
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(body).toMatch(/padding:\s*0 var\(--s2\)/)
    expect(body).toMatch(/font-size:\s*var\(--t1\)/)
    // The 1px hairline is the card's own border convention; every colour is a token.
    expect(body).toMatch(/border:\s*1px solid var\(--line\)/)
  })
})

describe('shortcut keys', () => {
  it('draws the key chip from the token scale, like every other chip', () => {
    const body = ruleBody('.panel__shortcut-key')

    expect(body).toMatch(/border:\s*1px solid var\(--line-strong\)/)
    expect(body).toMatch(/border-radius:\s*var\(--r1\)/)
    expect(body).toMatch(/background:\s*var\(--surface-2\)/)
    expect(body).toMatch(/font-size:\s*var\(--t1\)/)
    // A key is a label, not a state: no accent, no danger, and no raw values.
    expect(body).not.toMatch(/--accent|--danger/)
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    // The 1px hairline is the interface's own border convention; nothing else is raw.
    expect(body.replace(/1px solid/g, '')).not.toMatch(/\d+px/)
    // The popover hangs off the trigger, so the trigger has to be the containing block.
    expect(ruleBody('.panel__shortcuts')).toMatch(/position:\s*relative/)
    expect(ruleBody('.panel__shortcuts-panel')).toMatch(/position:\s*absolute/)
  })
})

describe('collapsed outline', () => {
  it('keeps a rail where the sidebar was, rather than closing the column away', () => {
    // A control inside the thing it hides has nowhere to be once it is hidden, so the
    // collapsed state is a narrower first column, never a missing one.
    expect(ruleBody('.panel__body--rail')).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/)

    const rail = ruleBody('.panel__rail')
    // It reads as the sidebar it stands in for: same face, same edge.
    expect(rail).toMatch(/background:\s*var\(--surface-2\)/)
    expect(rail).toMatch(/border-right:\s*1px solid var\(--line\)/)
    expect(ruleBody('.panel__sidebar')).toMatch(/background:\s*var\(--surface-2\)/)
    expect(rail.replace(/1px solid/g, '')).not.toMatch(/\d+px/)
  })
})

describe('pane handles and drop zones', () => {
  it('sizes the handle from a token and gives it a cursor for the axis it moves on', () => {
    const handle = ruleBody('.panel__resize')

    expect(handle).toMatch(/flex:\s*0 0 var\(--pane-handle\)/)
    expect(handle).toMatch(/background:\s*var\(--line\)/)
    // The pointer owns the handle for the length of a drag, or a touch drag scrolls the
    // panel out from under it instead of moving the divider.
    expect(handle).toMatch(/touch-action:\s*none/)
    expect(handle.replace(/1px solid/g, '')).not.toMatch(/\d+px/)
    expect(handle).not.toMatch(/#[0-9a-fA-F]{3,8}/)

    expect(ruleBody('.panel__resize--vertical')).toMatch(/cursor:\s*col-resize/)
    expect(ruleBody('.panel__resize--horizontal')).toMatch(/cursor:\s*row-resize/)
  })

  it('lays the drop zones over the pane without covering its middle', () => {
    expect(ruleBody('.panel__dropzones')).toMatch(/position:\s*absolute/)
    // Over the note, and over the sticky header and dock the pane pins at z-index 2.
    expect(ruleBody('.panel__dropzones')).toMatch(/z-index:\s*3/)
    /*
     * The note half of the pane is the containing block, not the whole pane. Measured from
     * the pane the zones covered its tab strip too, and since they sit on top of
     * everything, a drop aimed at a tab found an edge zone instead of the tab's own slot.
     */
    expect(ruleBody('.panel__group-body')).toMatch(/position:\s*relative/)
    expect(ruleBody('.panel__group')).not.toMatch(/position:\s*relative/)

    const zone = ruleBody('.panel__dropzone')
    // A third a side leaves the middle clear, so a drag can still be abandoned over the
    // note rather than every pointer-up somewhere in the pane splitting a pane open.
    expect(zone).toMatch(/width:\s*33%/)
    expect(zone).toMatch(/height:\s*100%/)

    // The edge being aimed at reads in the accent, like every other drop target here.
    expect(ruleBody('.panel__dropzone--over')).toMatch(/background:\s*var\(--accent-weak\)/)
    expect(ruleBody('.panel__dropzone--over')).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})

describe('context bar buttons', () => {
  it('keeps every filter-row button label on one line', () => {
    // A flex item shrinks below its content by default, and a button narrower than its
    // own two words is what a wrapped label looks like. Scoped to the row rather than to
    // one button's wrapper, so a button added here cannot quietly get the old behaviour.
    const body = ruleBody('.context-bar__filters .button')

    expect(body).toMatch(/white-space:\s*nowrap/)
    // Nothing to shrink means the selects give the width up instead, down to the floors
    // they set for themselves.
    expect(body).toMatch(/flex:\s*none/)
  })
})
