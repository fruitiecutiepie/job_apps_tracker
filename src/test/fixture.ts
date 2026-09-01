/**
 * What the tests are seeded with.
 *
 * The demo profile carries nineteen applications, and rendering all of them costs more
 * than most tests are asking for. What a test here spends its time on is a role query
 * walking the tree and asking jsdom for a computed style per candidate, so its cost
 * follows how much is on the page — and about thirty nodes of that is each application.
 * Nineteen of them measured 1038 nodes and roughly twice the CPU of a handful.
 *
 * So the default is the applications the tests actually name, and nothing else. Anything
 * that reads the whole set — a count, the statistics, a view whose rows are the point —
 * asks for it with `seedFullDemo()` and is the exception rather than the rule.
 *
 * The demo itself is untouched: it is what someone running the demo profile sees, and
 * shrinking it to suit the tests would be the tail wagging the dog.
 */

import { createDemoDocument } from '../domain/demo'
import { saveTrackerDocument } from '../domain/storage'
import { testTrackerStore } from './trackerStore'

/**
 * The demo companies the tests refer to by name. Every one of them is load-bearing: drop
 * one and the tests naming it have nothing to act on. Add to this only when a test needs
 * a company that is not here, and prefer reusing one that is.
 */
export const SEEDED_COMPANIES = [
  'Marble & Finch',
  'Paper Kite',
  'Echo Robotics',
  'Orbit & Oak',
  'Halcyon Maps',
  'Saffron Systems',
] as const

/** Seeds the whole demo profile, for a test that reads the set rather than a member of it. */
export function seedFullDemo(): void {
  saveTrackerDocument(createDemoDocument(), testTrackerStore)
}

/** Seeds only `SEEDED_COMPANIES`, in the order the demo lists them. */
export function seedNamedCompanies(): void {
  const demo = createDemoDocument()
  const wanted = new Set<string>(SEEDED_COMPANIES)
  saveTrackerDocument(
    {
      ...demo,
      applications: demo.applications.filter((application) => wanted.has(application.company)),
    },
    testTrackerStore,
  )
}
