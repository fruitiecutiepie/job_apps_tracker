/**
 * The prep notes panel's keyboard shortcuts, described once so the listener that binds
 * them, the header buttons that duplicate them, and the list that teaches them cannot
 * drift apart. A shortcut nobody can find is a shortcut nobody has.
 */

/** One binding: the key pressed with the platform modifier, and what it does. */
export interface Shortcut {
  /** The key as it reads in a label — `\`, `F`, `P`, `B`, `K`. */
  key: string
  /** What pressing it does, worded as the README's shortcut table words it. */
  description: string
}

/**
 * In the order the README's shortcut table lists them, and worded as it words them: the
 * list in the panel and the section in the README teach the same five things, so a reader
 * who has seen one recognises the other.
 */
export const PANEL_SHORTCUTS: readonly Shortcut[] = [
  { key: '\\', description: 'Open a second pane, or close back to one' },
  { key: 'F', description: 'Open the find bar' },
  { key: 'P', description: 'Open the stage picker' },
  { key: 'B', description: 'Show and hide the outline' },
  { key: 'K', description: 'Put the caret in the capture box' },
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

/**
 * How the binding reads to a person: `⌘F` on macOS, `Ctrl+F` elsewhere. The plus is
 * part of the Windows and Linux convention and absent from the Mac one, so it belongs
 * with the modifier rather than being joined on afterwards.
 */
export function shortcutLabel(key: string): string {
  const modifier = modifierLabel()
  return modifier === '⌘' ? `⌘${key}` : `${modifier}+${key}`
}

/**
 * The same binding as `aria-keyshortcuts` wants it: DOM key values, and both modifiers
 * listed because the panel answers either one on any platform.
 */
export function shortcutKeys(key: string): string {
  return `Meta+${key} Control+${key}`
}
