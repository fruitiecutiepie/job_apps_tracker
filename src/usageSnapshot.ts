import type { StorageState } from './backend'
import { STATE_CONFIG } from './domain/states'
import type { StateId, Status, TrackerDocument } from './domain/types'
import { USAGE_FEATURES, type UsageFeature, type UsageProps } from './usageEvent'

type UsageReferrer = UsageProps<'open'>['referrer']
type UsageDuration = UsageProps<'view_time'>['duration']

/*
 * The pure half of usage reporting: what a tracker looks like, coarsely enough that the
 * answer is the same for thousands of trackers, and what a write changed. Kept apart from
 * `usage.ts`, which sends, so both can be tested without a network.
 */

const DAY_MS = 86_400_000

function applicationsBucket(count: number): UsageProps<'open'>['applications'] {
  if (count === 0) return '0'
  if (count <= 2) return '1-2'
  if (count <= 10) return '3-10'
  if (count <= 50) return '11-50'
  return '51+'
}

function ageBucket(oldest: string | null, now: Date): UsageProps<'open'>['age'] {
  if (oldest === null) return 'none'
  const days = Math.floor((now.getTime() - Date.parse(oldest)) / DAY_MS)
  if (days < 1) return '0d'
  if (days <= 7) return '1-7d'
  if (days <= 30) return '8-30d'
  if (days <= 90) return '31-90d'
  return '91d+'
}

function backlogBucket(since: string | null, now: Date): UsageProps<'open'>['backlog'] {
  if (since === null) return 'none'
  const days = (now.getTime() - Date.parse(since)) / DAY_MS
  if (days < 1) return '<1d'
  if (days <= 7) return '1-7d'
  return '8d+'
}

const STAGE_INDEX = new Map<StateId, number>(STATE_CONFIG.map((state, index) => [state.id, index]))
const position = (state: StateId) => STAGE_INDEX.get(state) ?? 0

/** Furthest by stage alone: reaching Offer and then being turned down still reached Offer. */
function reachedBucket(document: TrackerDocument): UsageProps<'open'>['reached'] {
  let furthest = -1
  for (const application of document.applications) {
    for (const entry of application.state_history) furthest = Math.max(furthest, position(entry.state))
    furthest = Math.max(furthest, position(application.state))
  }
  if (furthest >= position('accepted')) return 'accepted'
  if (furthest >= position('offer')) return 'offer'
  if (furthest >= position('recruiter_interview')) return 'interview'
  return 'none'
}

function featureInUse(document: TrackerDocument, feature: UsageFeature): boolean {
  return document.applications.some((application) => {
    switch (feature) {
      case 'notes':
        return application.stage_notes.some((note) => note.body.trim() !== '')
      case 'captures':
        return application.stage_notes.some((note) => note.heard.length > 0)
      case 'messages':
        return application.correspondence.length > 0
      case 'invites':
        return application.state_events.length > 0
      case 'ratings':
        return application.ratings.length > 0
      case 'compensation': {
        const { advertised, expected, offered } = application.compensation
        return advertised !== null || expected !== null || offered !== null
      }
      case 'posting':
        return application.posting !== null
      case 'attachments':
        return application.attachments.length > 0
      case 'done':
        return application.completed_actions.length > 0
      case 'archived':
        return application.archived_at !== null
    }
  })
}

/*
 * Hosts are matched by their registrable end, so `www.google.com.au` is a search and
 * `uk.linkedin.com` is social. Lists rather than patterns, so what counts as each is
 * readable at a glance; anything not on one is `other`.
 */
const SEARCH_HOSTS = ['google', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'kagi.com', 'baidu.com', 'yandex', 'brave.com', 'startpage.com']
const SOCIAL_HOSTS = ['linkedin.com', 'lnkd.in', 'twitter.com', 'x.com', 't.co', 'facebook.com', 'instagram.com', 'reddit.com', 'news.ycombinator.com', 'threads.net', 'bsky.app', 'mastodon.social', 'discord.com', 'slack.com', 'whatsapp.com']

function hostMatches(host: string, names: readonly string[]): boolean {
  return names.some((name) =>
    name.includes('.')
      ? host === name || host.endsWith(`.${name}`)
      // A bare name like `google` stands for every country domain it has.
      : host.split('.').includes(name),
  )
}

/**
 * Where a visit came from, as one of a few kinds: the demo and the tracker share an origin,
 * so a visit from the demo is told from a reload by its path. The referrer itself never leaves the page:
 * a URL can carry anything, a search query included.
 */
export function referrerKind(
  referrer: string,
  ownOrigin: string,
  /** The demo's path, given only on the real tracker: arriving from it is the demo working. */
  demoPath: string | null = null,
  /**
   * The tracker's own path, the demo's included. The same origin outside it is the rest of
   * the site — the project page that links here — which is a way in, not a reload.
   */
  appPath: string | null = null,
): UsageReferrer {
  if (referrer === '') return 'direct'
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return 'other'
  }
  if (url.origin === ownOrigin) {
    if (demoPath !== null && url.pathname.startsWith(demoPath)) return 'demo'
    if (appPath !== null && !url.pathname.startsWith(appPath)) return 'site'
    return 'internal'
  }
  const host = url.hostname.toLowerCase()
  if (host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.github.io')) return 'github'
  if (hostMatches(host, SEARCH_HOSTS)) return 'search'
  if (hostMatches(host, SOCIAL_HOSTS)) return 'social'
  return 'other'
}

/** A stretch of time on screen, coarsely: whether a place is glanced at or worked in. */
export function durationBucket(ms: number): UsageDuration {
  const seconds = ms / 1000
  if (seconds < 10) return '<10s'
  if (seconds < 60) return '10s-1m'
  if (seconds < 300) return '1-5m'
  if (seconds < 1800) return '5-30m'
  return '30m+'
}

/**
 * The `open` report: how big, how old, how far, how safe, which features are in use, and
 * what kind of site the visit came from.
 */
export function usageSnapshot(
  document: TrackerDocument,
  storage: StorageState | null,
  now: Date,
  referrer: UsageReferrer = 'direct',
): UsageProps<'open'> {
  const oldest = document.applications.reduce<string | null>(
    (min, application) => (min === null || application.created_at < min ? application.created_at : min),
    null,
  )
  const connection = storage?.connection.kind
  const features = Object.fromEntries(
    USAGE_FEATURES.map((feature) => [feature, featureInUse(document, feature) ? 'y' : 'n']),
  ) as Record<UsageFeature, 'y' | 'n'>
  return {
    applications: applicationsBucket(document.applications.length),
    age: ageBucket(oldest, now),
    reached: reachedBucket(document),
    storage: connection === 'connected' ? 'folder' : connection === 'unsupported' ? 'unsupported' : 'browser',
    backlog: backlogBucket(storage?.unbackedSince ?? null, now),
    ...features,
    referrer,
  }
}

/**
 * What one write did that is worth counting: applications added, and applications whose
 * stage or outcome changed. Read off the two documents rather than reported by each
 * caller, so a new way of adding or moving one is counted without anyone remembering to.
 * Imports and resets do not come through here — they replace the document rather than
 * change it — so a restored backup is not a hundred applications added.
 */
export function usageChanges(before: TrackerDocument, after: TrackerDocument): {
  added: number
  moved: Status[]
} {
  if (before === after) return { added: 0, moved: [] }
  const previous = new Map(before.applications.map((application) => [application.id, application]))
  let added = 0
  const moved: Status[] = []
  for (const application of after.applications) {
    const was = previous.get(application.id)
    if (!was) added += 1
    else if (was.state !== application.state || was.outcome !== application.outcome) {
      moved.push({ state: application.state, outcome: application.outcome })
    }
  }
  return { added, moved }
}
