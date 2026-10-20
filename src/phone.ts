/**
 * Whether the window is phone-sized: the stylesheet's `max-width: 520px`, asked from script
 * for the few starting states that depend on it. Read when it is needed rather than
 * followed, because each one is a default the reader goes on to change.
 */
export const PHONE_QUERY = '(max-width: 520px)'

export function isPhone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}
