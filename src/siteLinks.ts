/**
 * The two hosted builds link to each other, and neither may hard-code the other's path:
 * a fork lives under a different repository name, and the demo is one level deeper than
 * the tracker. `BASE_URL` is what Vite bakes in at build time, so both are derived from it.
 */
const DEMO_SEGMENT = 'demo/'

function baseUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** Where the demo lives, seen from the real tracker. */
export function demoSiteUrl(): string {
  return `${baseUrl()}${DEMO_SEGMENT}`
}

/** Where the real tracker lives, seen from the demo. */
export function trackerSiteUrl(): string {
  const base = baseUrl()
  return base.endsWith(`/${DEMO_SEGMENT}`) ? base.slice(0, -DEMO_SEGMENT.length) : base
}
