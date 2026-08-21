/*
 * The compensation fields behind the editor: how a stored record becomes text inputs and how
 * text inputs become a record the domain will take. Two things have to survive the round
 * trip — a band and a point value — so the "to" box carries the whole difference between
 * them: filled it is a band, blank it is the single number you were quoted.
 */
import {
  COMPENSATION_STAGE_IDS,
  COMPENSATION_STAGE_LABELS,
  emptyCompensation,
  isCurrencyCode,
} from './domain'
import type { Application, Compensation, CompensationStageId } from './domain'

export interface CompensationStageValues {
  from: string
  to: string
}

export interface CompensationValues {
  currency: string
  stages: Record<CompensationStageId, CompensationStageValues>
}

export function compensationValuesFor(application: Application | null): CompensationValues {
  const compensation = application?.compensation ?? emptyCompensation()
  const stages = {} as Record<CompensationStageId, CompensationStageValues>

  for (const stage of COMPENSATION_STAGE_IDS) {
    const band = compensation[stage]
    stages[stage] = band
      ? // A point value leaves "to" empty, which is how it was typed and how it reads back.
        { from: String(band.min), to: band.min === band.max ? '' : String(band.max) }
      : { from: '', to: '' }
  }

  return { currency: compensation.currency ?? '', stages }
}

/**
 * Thousands separators and spaces are stripped, because a salary is something people type as
 * `130,000`. Returns `null` for a blank box and `NaN` for text that is not a number at all,
 * so a caller can tell "not filled in" from "filled in wrongly".
 */
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (!cleaned) return null
  return Number(cleaned)
}

/**
 * The first thing wrong with the compensation fields, phrased for the editor's error line, or
 * null when they are usable. This mirrors `firstInviteProblem`: the domain would throw on the
 * same input, but a message naming the box beats a message naming the field.
 */
export function firstCompensationProblem(values: CompensationValues): string | null {
  let anyAmount = false

  for (const stage of COMPENSATION_STAGE_IDS) {
    const label = COMPENSATION_STAGE_LABELS[stage]
    const { from, to } = values.stages[stage]
    const min = parseAmount(from)
    const max = parseAmount(to)

    if (min === null && max === null) continue
    if (min === null) return `${label} pay needs a starting amount.`
    if (!Number.isInteger(min) || min <= 0) {
      return `${label} pay must be a whole amount above zero.`
    }
    if (max !== null) {
      if (!Number.isInteger(max) || max <= 0) {
        return `${label} pay must be a whole amount above zero.`
      }
      if (max < min) return `${label} pay ends below where it starts.`
    }
    anyAmount = true
  }

  if (anyAmount && !values.currency.trim()) {
    return 'Compensation needs a currency, so the amounts can be read.'
  }
  if (anyAmount && !isCurrencyCode(values.currency)) {
    return 'Currency must be a three-letter code such as AUD.'
  }
  return null
}

/**
 * The record to save. Assumes `firstCompensationProblem` already passed; anything it missed
 * is caught again by `canonicalCompensation`, which is the real gate.
 */
export function compensationFromValues(values: CompensationValues): Compensation {
  const record = emptyCompensation()

  for (const stage of COMPENSATION_STAGE_IDS) {
    const { from, to } = values.stages[stage]
    const min = parseAmount(from)
    if (min === null) continue
    const max = parseAmount(to)
    record[stage] = { min, max: max ?? min }
  }

  const currency = values.currency.trim()
  record.currency = currency ? currency.toUpperCase() : null
  return record
}
