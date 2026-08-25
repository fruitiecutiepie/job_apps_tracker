/*
 * The compensation fields behind the editor: how a stored record becomes text inputs and how
 * text inputs become a record the domain will take. Two things have to survive the round
 * trip — a band and a point value — so the "to" box carries the whole difference between
 * them: filled it is a band, blank it is the single number you were quoted.
 */
import {
  COMPENSATION_STAGE_IDS,
  COMPENSATION_STAGE_LABELS,
  CURRENCY_SUGGESTIONS,
  emptyCompensation,
  formatCompensationAmount,
  isCurrencyCode,
  parseTypedAmount,
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
 * The first thing wrong with the compensation fields, phrased for the editor's error line, or
 * null when they are usable. This mirrors `firstInviteProblem`: the domain would throw on the
 * same input, but a message naming the box beats a message naming the field.
 */
export function firstCompensationProblem(values: CompensationValues): string | null {
  let anyAmount = false

  for (const stage of COMPENSATION_STAGE_IDS) {
    const label = COMPENSATION_STAGE_LABELS[stage]
    const { from, to } = values.stages[stage]
    const min = parseTypedAmount(from)
    const max = parseTypedAmount(to)

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
 * How far one arrow-key press moves an amount. Salaries are negotiated in round steps, so
 * a bare text box that only accepts typing makes the commonest edit — nudging a figure —
 * more work than it should be. Shift is the coarse step, matching the convention native
 * number inputs already set.
 */
export const AMOUNT_STEP = 5_000
export const AMOUNT_STEP_LARGE = 10_000

/**
 * The box's next value after an arrow key, or null when there is nothing sensible to do:
 * text that is not a number, or a step that would take the amount to zero or below, which
 * `null` already means and a figure may not be. An empty box steps up from nothing to one
 * step, so the key still starts a value rather than doing nothing at all.
 *
 * Returns formatted text, so a stepped amount reads as money and reinforces the unit.
 */
export function steppedAmount(
  text: string,
  direction: 1 | -1,
  large = false,
): string | null {
  const step = large ? AMOUNT_STEP_LARGE : AMOUNT_STEP
  const current = parseTypedAmount(text)
  if (current === null) return direction === 1 ? formatCompensationAmount(step) : null
  if (!Number.isInteger(current) || current <= 0) return null

  const next = current + direction * step
  return next <= 0 ? null : formatCompensationAmount(next)
}

/**
 * The codes the editor offers, with any code already stored kept on the list. That second
 * part is not a nicety: a picker that silently drops a currency it does not recognise would
 * rewrite the amounts' unit on the next save. Anything a document holds stays selectable.
 */
export function currencyOptions(values: CompensationValues): readonly string[] {
  const stored = values.currency.trim().toUpperCase()
  const suggestions = CURRENCY_SUGGESTIONS as readonly string[]
  return stored && !suggestions.includes(stored) ? [...suggestions, stored] : suggestions
}

/**
 * The record to save. Assumes `firstCompensationProblem` already passed; anything it missed
 * is caught again by `canonicalCompensation`, which is the real gate.
 */
export function compensationFromValues(values: CompensationValues): Compensation {
  const record = emptyCompensation()

  for (const stage of COMPENSATION_STAGE_IDS) {
    const { from, to } = values.stages[stage]
    const min = parseTypedAmount(from)
    if (min === null) continue
    const max = parseTypedAmount(to)
    record[stage] = { min, max: max ?? min }
  }

  const currency = values.currency.trim()
  record.currency = currency ? currency.toUpperCase() : null
  return record
}
