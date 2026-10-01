import { useId, useState } from "react";
import type { ReactNode } from "react";

import { DEFAULT_STATS_SETTINGS, STATS_SETTING_LIMITS } from "../statsSettings";
import type { StatsSettingId } from "../statsSettings";

interface QuestionCardProps {
  /** What the reader is asking, as they would ask it. A heading, but set small. */
  question: string;
  /** The answer, worked out: the largest text on the card. */
  answer: string;
  /** What to do about it, where the data supports saying so — and only then. */
  step?: string;
  /** How the answer was counted, written on the card rather than tucked into a tooltip. */
  method?: ReactNode;
  /** The evidence: the chart or list the answer was read from. */
  children?: ReactNode;
}

/**
 * One question the reader brings to Statistics, answered before anything is drawn.
 *
 * The answer is a sentence because a bare figure leaves the reader to work out what it
 * means, and the chart under it is evidence for the sentence rather than the place the
 * reader has to find it. The question is the heading, so the page reads as a list of
 * questions to stop at — and the card is a region named by it.
 */
export function QuestionCard({ question, answer, step, method, children }: QuestionCardProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="question-card">
      <h3 className="question-card__question" id={id}>
        {question}
      </h3>
      <p className="question-card__answer">{answer}</p>
      {children ? <div className="question-card__evidence">{children}</div> : null}
      {step ? <p className="question-card__step">{step}</p> : null}
      {method ? <p className="question-card__method">{method}</p> : null}
    </section>
  );
}

interface SettingFieldProps {
  setting: StatsSettingId;
  value: number;
  /** Says what the number is, since the sentence around it is not its label. */
  label: string;
  onChange: (setting: StatsSettingId, value: number) => void;
}

/**
 * A number the answer depends on, edited where the answer states it.
 *
 * The draft is the box's own until it holds a whole number in range, so a half-typed
 * value never reaches the answers; leaving the box with anything else puts the stored
 * value back.
 */
export function SettingField({ setting, value, label, onChange }: SettingFieldProps) {
  const { min, max } = STATS_SETTING_LIMITS[setting];
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max) {
      onChange(setting, parsed);
    }
  };

  return (
    <input
      aria-label={label}
      className="setting-field"
      inputMode="numeric"
      max={max}
      min={min}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        commit(event.target.value);
      }}
      type="number"
      value={draft ?? String(value)}
    />
  );
}

/**
 * The way back to a setting's default, offered only once it has been changed — which is
 * also how a reader learns there is one. It goes at the end of the sentence holding the
 * setting rather than beside the box, where it split the sentence in two.
 */
export function SettingReset({ setting, value, label, onChange }: SettingFieldProps) {
  const fallback = DEFAULT_STATS_SETTINGS[setting];
  if (value === fallback) return null;
  return (
    <>
      {" "}
      <button
        // Three of these can be on screen at once, so the name says which number it resets.
        aria-label={`Reset ${label.charAt(0).toLowerCase()}${label.slice(1)} to ${fallback}`}
        className="setting-reset"
        onClick={() => onChange(setting, fallback)}
        type="button"
      >
        Reset to {fallback}
      </button>
    </>
  );
}
