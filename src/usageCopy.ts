/**
 * What the reader is told about usage counts, in one place, so the intro, the switch in
 * More actions and the list behind "What's counted" cannot describe them differently.
 *
 * Leads with what the counts are for, because a reader who knows what they get back has a
 * reason to leave them on, and one told only what is collected has a reason to turn them
 * off.
 */

import type { UsageEventName } from './usageEvent'

export const USAGE_WHY =
  'Usage counts show which parts of the app people use and where things go wrong, so fixes and new features go where they help most.'

export const USAGE_PROMISE = 'Nothing you write is ever sent, and the counts aren’t linked to you.'

/** The tooltip on the switch in More actions: the two sentences above, as one. */
export const USAGE_SUMMARY = `${USAGE_WHY} ${USAGE_PROMISE}`

/**
 * Plain words for everything `USAGE_EVENTS` can carry, each naming the events it covers:
 * a test fails if an event is in none of them, so a new event cannot be sent before the
 * reader has been told about it.
 */
export const USAGE_COUNTED: ReadonlyArray<{ text: string; events: readonly UsageEventName[] }> = [
  {
    text: 'Roughly how many applications you have, how far the furthest has got, and how long you’ve been tracking — in ranges, never exact numbers',
    events: ['open'],
  },
  { text: 'Which features you’ve used at all (notes, invites, ratings and so on) — yes or no', events: ['open'] },
  { text: 'Which views you open, and roughly how long each stays on screen', events: ['view', 'view_time'] },
  {
    text: 'That an application was added or moved, and to which stage — never which application',
    events: ['application_added', 'moved'],
  },
  {
    text: 'Whether your data is saved to a folder or only in this browser, and when you export or import',
    events: ['open', 'folder_connected', 'exported', 'imported'],
  },
  { text: 'Errors, such as a save that failed, and when an older file had to be updated', events: ['error', 'migrated'] },
  { text: 'Whether you arrived from a search, a link or directly — never the page you came from', events: ['open'] },
]

export const USAGE_NEVER = [
  'Company names, roles, notes, messages, dates, or anything else you type',
  'Your name, email or location',
  'Your IP address — the server that receives the counts keeps nothing about the request',
  'Cookies — each report carries only a random number, made in this browser, that ties one tracker’s visits together',
] as const
