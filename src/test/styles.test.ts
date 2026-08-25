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
