/**
 * Which tracker a tab holds, read from and written to its URL.
 *
 * The URL rather than `sessionStorage` because it is what a person can see, copy, and
 * open again: a reload comes back to the same tracker, a link opened in a new tab opens
 * the one it names, and two tabs holding two trackers is simply two URLs. A tab whose URL
 * names none opens the most recently used tracker, which is what a bookmark of the bare
 * site should do.
 */
export const TRACKER_PARAM = 'tracker'

/** Asks for a fresh, empty tracker rather than an existing one. */
export const NEW_TRACKER = 'new'

export interface TrackerAddress {
  /** The tracker the tab asked for, `NEW_TRACKER`, or null when it named none. */
  requested(): string | null
  /** Records which tracker this tab holds, so a reload comes back to it. */
  show(id: string): void
}

export function locationAddress(): TrackerAddress {
  return {
    requested() {
      if (typeof window === 'undefined') return null
      return new URLSearchParams(window.location.search).get(TRACKER_PARAM)
    },
    show(id) {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      if (url.searchParams.get(TRACKER_PARAM) === id) return
      url.searchParams.set(TRACKER_PARAM, id)
      // Replaced, not pushed: resolving which tracker this is is not a navigation.
      window.history.replaceState(window.history.state, '', url)
    },
  }
}

/**
 * Opening another tracker in this tab is a navigation: the backend is chosen once per
 * page, for the tracker the URL names. An object rather than a bare call so a test can
 * watch it, jsdom having no navigation to perform.
 */
export const navigation = {
  open(href: string): void {
    window.location.assign(href)
  },
}

/**
 * A link to one tracker, relative to the page it is on. Relative so it keeps the site's
 * base path, which differs between the tracker, the demo and any fork.
 */
export function trackerHref(id: string): string {
  return `?${new URLSearchParams({ [TRACKER_PARAM]: id })}`
}
