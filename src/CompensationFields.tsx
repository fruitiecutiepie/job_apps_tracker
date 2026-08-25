import type { KeyboardEvent } from 'react'
import { COMPENSATION_CONFIG } from './domain'
import type { CompensationStageId } from './domain'
import { currencyOptions, steppedAmount, type CompensationValues } from './compensation'

interface CompensationFieldsProps {
  values: CompensationValues
  onCurrencyChange: (value: string) => void
  onAmountChange: (stage: CompensationStageId, bound: 'from' | 'to', value: string) => void
}

/**
 * Compensation is a measurement, so these are number boxes rather than a 1-5 scale: given a
 * figure everyone agrees more is better, and scoring it would throw the figure away.
 *
 * Every box carries its full stage name as its own visible label, for the same reason the
 * rating selects do: a `label` names only its first labelable descendant, so "From" repeated
 * three times under a group heading would leave a screen reader unable to say which stage it
 * is in. `inputMode` rather than `type="number"` because people type `130,000`, and the
 * numeric type refuses the separator — the arrow keys are wired up by hand instead, so the
 * box still behaves like a number control without giving that up.
 */
export function CompensationFields({
  values,
  onCurrencyChange,
  onAmountChange,
}: CompensationFieldsProps) {
  const stepAmount = (
    event: KeyboardEvent<HTMLInputElement>,
    stage: CompensationStageId,
    bound: 'from' | 'to',
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const stepped = steppedAmount(
      values.stages[stage][bound],
      event.key === 'ArrowUp' ? 1 : -1,
      event.shiftKey,
    )
    // Only swallow the key when it did something, so an unusable box still behaves like a
    // text box rather than silently eating a keystroke.
    if (stepped === null) return
    event.preventDefault()
    onAmountChange(stage, bound, stepped)
  }

  return (
    <div className="field field--wide compensation-field">
      <div className="compensation-field__head">
        <span>Compensation</span>
        <label className="field compensation-currency">
          <span>Currency</span>
          <select onChange={(event) => onCurrencyChange(event.target.value)} value={values.currency}>
            <option value="">Not set</option>
            {currencyOptions(values).map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="compensation-field__hint">
        Annual base pay, in whole amounts. Leave <strong>to</strong> empty for a single figure
        rather than a band. <strong>Expected</strong> is your target here: the others are
        measured against it.
      </p>

      <div className="compensation-grid">
        {COMPENSATION_CONFIG.map(({ id, label }) => (
          <div className="compensation-row" key={id}>
            <label className="field">
              <span>{label} from</span>
              <input
                inputMode="numeric"
                onChange={(event) => onAmountChange(id, 'from', event.target.value)}
                onKeyDown={(event) => stepAmount(event, id, 'from')}
                placeholder="e.g. 130,000"
                value={values.stages[id].from}
              />
            </label>
            <label className="field">
              <span>{label} to</span>
              <input
                inputMode="numeric"
                onChange={(event) => onAmountChange(id, 'to', event.target.value)}
                onKeyDown={(event) => stepAmount(event, id, 'to')}
                placeholder="Optional"
                value={values.stages[id].to}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}
