import { describe, expect, it } from 'vitest'

import { modifierLabelFor, PANEL_SHORTCUTS, shortcutKeys } from './shortcuts'

describe('shortcut labels', () => {
  it('reads the modifier the way the platform writes it', () => {
    expect(modifierLabelFor('MacIntel')).toBe('⌘')
    expect(modifierLabelFor('iPhone')).toBe('⌘')
    expect(modifierLabelFor('Win32')).toBe('Ctrl')
    expect(modifierLabelFor('Linux x86_64')).toBe('Ctrl')
    // Nothing to go on is the same answer as not a Mac, never an empty modifier.
    expect(modifierLabelFor('')).toBe('Ctrl')
  })

  it('offers both modifiers to assistive technology, since the panel answers either', () => {
    expect(shortcutKeys('F')).toBe('Meta+F Control+F')
  })

  it('describes every binding the panel listens for', () => {
    expect(PANEL_SHORTCUTS.map((shortcut) => shortcut.key)).toEqual(['\\', 'F', 'P', 'B', 'K'])
    for (const shortcut of PANEL_SHORTCUTS) expect(shortcut.description).not.toBe('')
  })
})
