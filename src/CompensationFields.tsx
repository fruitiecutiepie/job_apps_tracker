import { COMPENSATION_CONFIG, CURRENCY_SUGGESTIONS } from './domain'
import type { CompensationStageId } from './domain'
import type { CompensationValues } from './compensation'

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
 * numeric type refuses the separator.
 */
export function CompensationFields({
  values,
  onCurrencyChange,
  onAmountChange,
}: CompensationFieldsProps) {
  return (
    <div className="field field--wide compensation-field">
      <span>Compensation</span>
      <p className="compensation-field__hint">
        Annual base pay, in whole amounts. Leave <strong>to</strong> empty for a single figure
        rather than a band. <strong>Expected</strong> is your target here: the others are
        measured against it.
      </p>

      <div className="compensation-grid">
        {/* A lone child of a two-column row takes the first column, so the currency box stays
            the width of an amount box without introducing a width of its own. */}
        <div className="compensation-row">
          <label className="field">
            <span>Currency</span>
            <input
              list="compensation-currency-suggestions"
              onChange={(event) => onCurrencyChange(event.target.value)}
              placeholder="e.g. AUD"
              value={values.currency}
            />
            <datalist id="compensation-currency-suggestions">
              {CURRENCY_SUGGESTIONS.map((currency) => (
                <option key={currency} value={currency} />
              ))}
            </datalist>
          </label>
        </div>

        {COMPENSATION_CONFIG.map(({ id, label }) => (
          <div className="compensation-row" key={id}>
            <label className="field">
              <span>{label} from</span>
              <input
                inputMode="numeric"
                onChange={(event) => onAmountChange(id, 'from', event.target.value)}
                placeholder="e.g. 130,000"
                value={values.stages[id].from}
              />
            </label>
            <label className="field">
              <span>{label} to</span>
              <input
                inputMode="numeric"
                onChange={(event) => onAmountChange(id, 'to', event.target.value)}
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
