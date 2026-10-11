import { useSyncExternalStore } from 'react'

import { trackerProfile } from './domain/trackerProfile'
import { parseUsageReport, USAGE_VERSION, type UsageEventName, type UsageProps } from './usageEvent'

/**
 * Usage counts from the hosted build: which features get used and how far searches get,
 * so it is clear what is worth improving. Never what anyone wrote — `usageEvent.ts` holds
 * the only values a report can carry, and both ends check against it.
 *
 * Only a build given `VITE_USAGE_URL` reports anything, which is the Cloudflare build alone.
 * The dev server, GitHub Pages, and every test send nothing, and render none of the
 * controls, there being nothing to turn off.
 *
 * On by default, off with one press, and off from the start in a browser that sends
 * Global Privacy Control or Do Not Track — a person who set that has already answered.
 * The choice is per-machine interface state like the theme, in `localStorage`, never in
 * the document.
 */

export const USAGE_STORAGE_KEY = 'usage-counts'

function endpoint(): string | null {
  return import.meta.env.VITE_USAGE_URL || null
}

/** Whether this build reports usage at all. */
export function usageAvailable(): boolean {
  return endpoint() !== null
}

function browserAsksNotTo(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1'
}

export function readUsagePreference(): boolean {
  try {
    const stored = localStorage.getItem(USAGE_STORAGE_KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    // Unreadable storage falls through to the browser's own signal.
  }
  return !browserAsksNotTo()
}

const listeners = new Set<() => void>()

export function writeUsagePreference(on: boolean): void {
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, on ? 'on' : 'off')
    sessionChoice = null
  } catch {
    // A private window may refuse the write; the choice then lasts for this visit only.
    sessionChoice = on
  }
  if (!on) queue.length = 0
  for (const listener of listeners) listener()
}

let sessionChoice: boolean | null = null

function usageOn(): boolean {
  return sessionChoice ?? readUsagePreference()
}

/** The preference and its setter, kept in step across every component reading it. */
export function useUsagePreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    usageOn,
  )
  return [on, writeUsagePreference]
}

/**
 * A hash of the tracker id, so the stored tag cannot be matched against the id in a
 * page's URL. Salted with a fixed string only to keep it from equalling a hash of the bare
 * id anything else might compute.
 */
export async function usageTag(trackerId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`job-apps-tracker usage:${trackerId}`),
  )
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let tag: Promise<string> | null = null
/** Reports made before the tracker was known, sent once it is. Bounded: a page that never
    learns its tracker should not grow this forever. */
const queue: Array<{ event: UsageEventName; props: Record<string, string> }> = []
const QUEUE_LIMIT = 20

/** Names the tracker this page holds; reports are tagged with it from here on. */
export function setUsageTracker(trackerId: string): void {
  tag = usageTag(trackerId)
  for (const pending of queue.splice(0)) void send(pending.event, pending.props)
}

export function recordUsage<E extends UsageEventName>(event: E, props: UsageProps<E>): void {
  if (!usageAvailable() || !usageOn()) return
  if (tag === null) {
    if (queue.length < QUEUE_LIMIT) queue.push({ event, props: props as Record<string, string> })
    return
  }
  void send(event, props as Record<string, string>)
}

async function send(event: UsageEventName, props: Record<string, string>): Promise<void> {
  const url = endpoint()
  if (!url || !tag) return
  try {
    const report = { v: USAGE_VERSION, tracker: await tag, profile: trackerProfile(), event, props }
    // Checked here as well as by the Worker, so a report it would refuse is never sent.
    if (!parseUsageReport(report) || !usageOn()) return
    const body = JSON.stringify(report)
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body)) return
    await fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit' })
  } catch {
    // Counting is never worth an error a person sees.
  }
}

/** Forgets the tracker and anything queued, between tests. */
export function resetUsageForTests(): void {
  tag = null
  queue.length = 0
  sessionChoice = null
}
