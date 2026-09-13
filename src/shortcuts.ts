/**
 * The prep notes panel's keyboard shortcuts, described once so the listener that binds
 * them, the header buttons that duplicate them, and the list that teaches them cannot
 * drift apart. A shortcut nobody can find is a shortcut nobody has.
 */

/** One binding: the key pressed with the platform modifier, and what it does. */
export interface Shortcut {
  /**
   * The key as it reads in a label — `\`, `F`, or a pair like `←/→` for a binding that
   * answers either arrow. What the reader sees, not what the DOM calls it.
   */
  key: string
  /**
   * The DOM `KeyboardEvent.key` values this binding answers, when they are not the label.
   * A pair of arrows is one row in the list and one sentence in the README, so it is one
   * shortcut here rather than two that would have to be worded twice.
   */
  domKeys?: readonly string[]
  /** Held with the platform modifier, when the binding asks for more than it. */
  shift?: boolean
  alt?: boolean
  /** What pressing it does, worded as the README's shortcut table words it. */
  description: string
}

/**
 * In the order the README's shortcut table lists them, and worded as it words them: the
 * list in the panel and the section in the README teach the same things, so a reader who
 * has seen one recognises the other.
 */
export const PANEL_SHORTCUTS: readonly Shortcut[] = [
  { key: '\\', description: 'Open a second pane, or close back to one' },
  { key: 'F', description: 'Open the find bar' },
  { key: 'P', description: 'Open the note picker' },
  { key: 'B', description: 'Show and hide the outline' },
  { key: 'K', description: 'Put the caret in the capture box' },
  {
    key: '←/→',
    domKeys: ['ArrowLeft', 'ArrowRight'],
    shift: true,
    description: 'Move the tab you are reading to the pane beside it',
  },
  {
    key: '←/→',
    domKeys: ['ArrowLeft', 'ArrowRight'],
    alt: true,
    description: 'Reorder the tab you are reading within its pane',
  },
]

/**
 * `⌘` on macOS and `Ctrl` everywhere else. Pure in its platform so it can be asserted on
 * without pretending to be another machine, the way `resolveEditorCommand` is.
 */
export function modifierLabelFor(platform: string): string {
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform) ? '⌘' : 'Ctrl'
}

/** The label for the machine this is running on. */
export function modifierLabel(): string {
  return modifierLabelFor(navigator.platform)
}

const asShortcut = (shortcut: string | Shortcut): Shortcut =>
  typeof shortcut === 'string' ? { key: shortcut, description: '' } : shortcut

/**
 * How the binding reads to a person: `⌘F` on macOS, `Ctrl+F` elsewhere. The plus is
 * part of the Windows and Linux convention and absent from the Mac one, so it belongs
 * with the modifier rather than being joined on afterwards. Mac writes its extra
 * modifiers as glyphs for the same reason.
 */
export function shortcutLabel(shortcut: string | Shortcut): string {
  const { key, shift, alt } = asShortcut(shortcut)
  const modifier = modifierLabel()
  if (modifier === '⌘') {
    return `⌘${alt ? '⌥' : ''}${shift ? '⇧' : ''}${key}`
  }
  return [modifier, alt ? 'Alt' : null, shift ? 'Shift' : null, key].filter(Boolean).join('+')
}

/**
 * The same binding as `aria-keyshortcuts` wants it: DOM key values, and both platform
 * modifiers listed because the panel answers either one on any machine. Modifiers are
 * named in the order the attribute's own grammar gives them — Alt, Control, Meta, Shift.
 */
export function shortcutKeys(shortcut: string | Shortcut): string {
  const { key, domKeys, shift, alt } = asShortcut(shortcut)
  const keys = domKeys ?? [key]
  const combos: string[] = []
  for (const platform of ['Meta', 'Control']) {
    for (const each of keys) {
      combos.push(
        [alt ? 'Alt' : null, platform, shift ? 'Shift' : null, each].filter(Boolean).join('+'),
      )
    }
  }
  return combos.join(' ')
}
