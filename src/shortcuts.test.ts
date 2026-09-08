import { describe, expect, it } from 'vitest'

import { modifierLabelFor, PANEL_SHORTCUTS, shortcutKeys, shortcutLabel } from './shortcuts'

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

  it('names the extra modifiers a binding asks for, in the order the attribute wants', () => {
    expect(shortcutKeys({ key: '←/→', domKeys: ['ArrowLeft', 'ArrowRight'], shift: true, description: '' }))
      .toBe('Meta+Shift+ArrowLeft Meta+Shift+ArrowRight Control+Shift+ArrowLeft Control+Shift+ArrowRight')
    expect(shortcutKeys({ key: '←', domKeys: ['ArrowLeft'], alt: true, description: '' }))
      .toBe('Alt+Meta+ArrowLeft Alt+Control+ArrowLeft')
  })

  it('writes the extra modifiers the way each platform writes them', () => {
    // Read through the real `navigator.platform`, so this asserts the shape rather than
    // the machine: whichever branch runs, the modifier and the key are both in the label.
    const moveTab = PANEL_SHORTCUTS.find((shortcut) => shortcut.shift)!
    const label = shortcutLabel(moveTab)
    expect(label).toContain('←/→')
    expect(label === `⌘⇧←/→` || label === 'Ctrl+Shift+←/→').toBe(true)
  })

  it('describes every binding the panel listens for', () => {
    expect(PANEL_SHORTCUTS.map((shortcut) => shortcut.key)).toEqual([
      '\\',
      'F',
      'P',
      'B',
      'K',
      '←/→',
      '←/→',
    ])
    for (const shortcut of PANEL_SHORTCUTS) expect(shortcut.description).not.toBe('')
  })
})
