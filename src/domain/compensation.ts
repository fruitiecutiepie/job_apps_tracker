import type { Compensation, CompensationBand, CompensationStageId } from './types'

/**
 * The stages a pay figure passes through, in the order they arrive. This is deliberately not
 * a rating scale: each entry is the number itself. Compensation fails the admission test in
 * `RATING_CONFIG` — given a number everyone agrees more is better — so scoring it 1-5 would
 * throw away the one thing you already know, and it is stored as a measurement instead.
 *
 * All three are kept because compensation moves: a posting says one thing, you want another,
 * and the offer arrives somewhere else again. Overwriting a single value would erase that
 * progression, which is the part worth reading.
 */
export const COMPENSATION_CONFIG = [
  { id: 'advertised', label: 'Advertised' },
  { id: 'expected', label: 'Expected' },
  { id: 'offered', label: 'Offered' },
] as const satisfies readonly { id: CompensationStageId; label: string }[]

export const COMPENSATION_STAGE_IDS = Object.freeze(
  COMPENSATION_CONFIG.map(({ id }) => id),
) as readonly CompensationStageId[]

export const COMPENSATION_STAGE_LABELS = Object.fromEntries(
  COMPENSATION_CONFIG.map(({ id, label }) => [id, label]),
) as Record<CompensationStageId, string>

/**
 * Codes offered as suggestions in the editor. Any three-letter code is accepted: this is a
 * single-user tracker, and refusing a currency because it is not on a curated list would be
 * worse than storing one the app cannot convert. Conversion is not attempted anywhere.
 */
export const CURRENCY_SUGGESTIONS = [
  'AUD',
  'USD',
  'EUR',
  'GBP',
  'NZD',
  'SGD',
  'CAD',
  'JPY',
] as const

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/

/** An ISO-4217-shaped code: exactly three letters. Stored upper case. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value.trim())
}

/** The stored form of a currency, or `null` for a blank one. Throws on a malformed code. */
export function currencyCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!isCurrencyCode(trimmed)) throw new TypeError('Currency must be a three-letter code')
  return trimmed.toUpperCase()
}

/**
 * One end of a band: annual gross base pay in whole currency units. Whole units because
 * cents never decide a job, and a positive integer because a salary of zero is not a figure
 * you were quoted — it is a field you have not filled in, which `null` already says.
 */
export function isCompensationAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/**
 * One amount as a reader sees it. This lives beside `isCompensationAmount` rather than in a
 * view, because the "whole units, no cents" rule is the same rule in both directions: the
 * editor and the table must never disagree about how a stored amount looks.
 */
export function formatCompensationAmount(amount: number): string {
  return amountFormatter.format(amount)
}

/** A record with nothing filled in. A fresh object each call, so no two records alias one. */
export function emptyCompensation(): Compensation {
  return { currency: null, advertised: null, expected: null, offered: null }
}

/** Whether any stage holds a figure. This is what decides whether a currency may survive. */
export function hasCompensationAmount(compensation: Compensation): boolean {
  return COMPENSATION_STAGE_IDS.some((stage) => compensation[stage] !== null)
}

/** A single number for a band, used only by view-layer comparisons. */
export function bandMidpoint(band: CompensationBand): number {
  return (band.min + band.max) / 2
}

/** True when a band is a point value, so a reader can show one number instead of two. */
export function isPointValue(band: CompensationBand): boolean {
  return band.min === band.max
}
