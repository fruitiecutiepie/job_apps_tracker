import type { ReactNode } from "react";

import { MAX_RATING_SCORE, MIN_RATING_SCORE, RATING_LABELS } from "../domain";
import { ChartKey } from "./ChartKey";
import type { PreferenceDimensionSummary } from "./preference";

const SCORES = Array.from(
  { length: MAX_RATING_SCORE - MIN_RATING_SCORE + 1 },
  (_, index) => MIN_RATING_SCORE + index,
);

/** Where a score sits across the scale: the middle of its own fifth of the width. */
function position(score: number): string {
  return `${((score - MIN_RATING_SCORE + 0.5) / SCORES.length) * 100}%`;
}

interface RatingScalesProps {
  dimensions: PreferenceDimensionSummary[];
  /** How a mean is printed, shared with the table so the two cannot round differently. */
  formatMean: (mean: number | null) => string;
  /** The table the chart is drawn from, which is what a screen reader reads instead. */
  children: ReactNode;
}

/**
 * One row per dimension on a shared 1–5 scale: a column at each score as tall as the
 * judgements that landed there, and a line where their mean falls.
 *
 * The spread is the point. A mean hides a dealbreaker — 5, 5, 5, 1 and 4, 4, 4, 4 both
 * read 4.00 — so the scores are drawn where they are and the mean is marked among them
 * rather than standing in for them. Columns rather than a dot per judgement, so a
 * dimension rated forty times is still one row high. Heights share one scale across the
 * rows, so a tall column means more judgements wherever it is.
 */
export function RatingScales({ dimensions, formatMean, children }: RatingScalesProps) {
  const tallest = Math.max(1, ...dimensions.flatMap((dimension) => dimension.scores));

  return (
    <div className="rating-scales">
      <div className="rating-scales__chart" aria-hidden="true">
        <ChartKey
          caption="Columns: how many gave each score"
          items={[
            { label: "Judgements", mark: "strong" },
            { label: "Mean", mark: "line" },
          ]}
        />
        <div className="rating-scales__rows">
          {dimensions.map((dimension) => {
            const unjudged = [
              dimension.unknown > 0 ? `${dimension.unknown} don’t know` : null,
              dimension.unassessed > 0 ? `${dimension.unassessed} not rated` : null,
            ].filter(Boolean);
            return (
              <div className="rating-scales__row" data-scale={dimension.dimension} key={dimension.dimension}>
                <span className="rating-scales__label">{RATING_LABELS[dimension.dimension]}</span>
                <span className="rating-scales__plot">
                  {SCORES.map((score) => {
                    const count = dimension.scores[score - MIN_RATING_SCORE] ?? 0;
                    if (count === 0) return null;
                    return (
                      <span
                        className="rating-scales__column"
                        data-score={score}
                        key={score}
                        style={{ left: position(score), height: `calc(${count / tallest} * var(--chart-scale))` }}
                        title={`${score}: ${count}`}
                      >
                        <span className="rating-scales__count">{count}</span>
                      </span>
                    );
                  })}
                  {dimension.mean === null ? null : (
                    <span
                      className="rating-scales__mean"
                      data-mean={dimension.mean}
                      style={{ left: position(dimension.mean) }}
                      title={`Mean ${formatMean(dimension.mean)}`}
                    />
                  )}
                </span>
                <span className="rating-scales__value">{formatMean(dimension.mean)}</span>
                <span className="rating-scales__detail">
                  {[`${dimension.judged} rated`, ...unjudged].join(" · ")}
                </span>
              </div>
            );
          })}
          <span className="rating-scales__axis">
            {SCORES.map((score) => (
              <span key={score} style={{ left: position(score) }}>
                {score}
              </span>
            ))}
          </span>
        </div>
      </div>
      <div className="sr-only">{children}</div>
    </div>
  );
}
