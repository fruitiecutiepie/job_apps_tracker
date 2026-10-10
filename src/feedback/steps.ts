/**
 * Turns what someone does while reproducing a problem into a line of a report:
 * `Clicked button “Add application”`, `Set “Stage” to “Interview 1”`, `Pressed ⌘P`.
 *
 * What is recorded is the **name of the control**, never what was typed into it. A text box
 * edited is `Edited “Company”` and nothing more. A name can still carry a company — the
 * Kanban card's buttons say which application they move — which is why the panel lists every
 * step before sending and lets each be removed.
 */

/** Marks the feedback panel's own controls, which are never steps of what is being reported. */
export const FEEDBACK_UI_ATTRIBUTE = 'data-feedback-ui'

const MAX_NAME = 80

const INTERACTIVE = [
  'button',
  'a[href]',
  'summary',
  'label',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="separator"]',
].join(', ')

/** Controls whose story is told by `change` rather than by the click that reached them. */
const CHANGED_NOT_CLICKED = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number',
  'date', 'datetime-local', 'month', 'week', 'time', 'checkbox', 'radio', 'file', 'range', 'color'])

function clean(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME - 1)}…` : flat
}

/** A label's own words, without the text of a control nested inside it. */
function labelText(label: Element): string {
  const copy = label.cloneNode(true) as Element
  copy.querySelectorAll('input, select, textarea, option').forEach((node) => node.remove())
  return clean(copy.textContent)
}

/**
 * Close enough to the accessible name for a report, without the full algorithm: the
 * explicit names first, then the label a form control has, then what the element says.
 */
export function controlName(element: Element): string {
  const ariaLabel = clean(element.getAttribute('aria-label'))
  if (ariaLabel) return ariaLabel

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = clean(labelledBy.split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' '))
    if (text) return text
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const label = element.labels?.[0]
    if (label) {
      const text = labelText(label)
      if (text) return text
    }
    const placeholder = clean(element.getAttribute('placeholder'))
    if (placeholder) return placeholder
  }

  const text = clean(element.textContent)
  if (text) return text
  const alt = clean(element.querySelector('img[alt]')?.getAttribute('alt'))
  if (alt) return alt
  return clean(element.getAttribute('title'))
}

function roleWord(element: Element): string {
  const role = element.getAttribute('role')
  if (role === 'separator') return 'divider'
  if (role) return role === 'menuitem' ? 'menu item' : role
  switch (element.tagName) {
    case 'A':
      return 'link'
    case 'SUMMARY':
      return 'disclosure'
    case 'SELECT':
      return 'menu'
    default:
      return 'button'
  }
}

function insideFeedback(element: Element): boolean {
  return Boolean(element.closest(`[${FEEDBACK_UI_ATTRIBUTE}]`))
}

/** The step a click is, or null when it is not one worth writing down. */
export function describeClick(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || insideFeedback(target)) return null
  const element = target.closest(INTERACTIVE)
  if (!element) return null

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return null
  if (element instanceof HTMLInputElement && CHANGED_NOT_CLICKED.has(element.type)) return null
  if (element instanceof HTMLLabelElement) {
    // A label clicked to reach its control is that control's change, already recorded.
    if (element.control) return null
    const name = labelText(element)
    return name ? `Clicked “${name}”` : null
  }

  const name = controlName(element)
  return name ? `Clicked ${roleWord(element)} “${name}”` : `Clicked an unnamed ${roleWord(element)}`
}

/** The step a changed field is: which field, and for a choice what was chosen. Never text. */
export function describeChange(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || insideFeedback(target)) return null
  if (target instanceof HTMLSelectElement) {
    const choice = clean(target.selectedOptions[0]?.textContent)
    return `Set “${controlName(target) || 'a menu'}” to “${choice}”`
  }
  if (target instanceof HTMLInputElement) {
    const name = controlName(target) || 'a field'
    if (target.type === 'checkbox') return `${target.checked ? 'Ticked' : 'Unticked'} “${name}”`
    if (target.type === 'radio') return `Chose “${name}”`
    if (target.type === 'file') return `Chose a file for “${name}”`
    return `Edited “${name}”`
  }
  if (target instanceof HTMLTextAreaElement) return `Edited “${controlName(target) || 'a text box'}”`
  return null
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock'])

/**
 * The key a chord was pressed on. `code` before `key` for letters and digits, because a
 * modifier rewrites the character — ⌥P arrives as `π` on a Mac — while the key cap stays put.
 */
function keyName(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5)
  if (event.key === ' ') return 'Space'
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

/**
 * The step a key press is. Only shortcuts and Escape: plain typing is what someone is
 * entering, which is exactly what the recorder promises not to keep.
 */
export function describeKey(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>,
  isMac: boolean,
): string | null {
  if (event.target instanceof Element && insideFeedback(event.target)) return null
  if (MODIFIER_KEYS.has(event.key)) return null
  if (event.key === 'Escape') return 'Pressed Escape'
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return null

  const parts = isMac
    ? [event.ctrlKey && '⌃', event.altKey && '⌥', event.shiftKey && '⇧', event.metaKey && '⌘']
    : [event.ctrlKey && 'Ctrl+', event.altKey && 'Alt+', event.shiftKey && 'Shift+', event.metaKey && 'Win+']
  return `Pressed ${parts.filter(Boolean).join('')}${keyName(event)}`
}

export function describeError(message: string): string {
  return `Error: ${clean(message) || 'unknown error'}`
}
