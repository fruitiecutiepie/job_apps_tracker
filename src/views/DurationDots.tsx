import type { ReactNode } from "react";

import { ChartKey } from "./ChartKey";
import type { FinishDurations } from "./outcomes";

interface DurationDotsProps {
  durations: FinishDurations;
  /** The table the chart is drawn from, which is what a screen reader reads instead. */
  children: ReactNode;
}

const ROWS = [
  { id: "toOffer", label: "To an offer", tone: "strong" },
  { id: "toRejection", label: "To a rejection", tone: "rest" },
] as const;

const BINS = 30;

/**
 * One dot per finished application on a shared days axis, a row per outcome.
 *
 * Dots rather than a bar of the median, because with a few applications the spread is the
 * answer: two offers at 34 and 41 days say something a single 37 does not. Dots close
 * enough to touch are stacked rather than drawn over each other, so a count is never
 * hidden: the axis is cut into `BINS` slots and a second dot in a slot sits on the first.
 */
export function DurationDots({ durations, children }: DurationDotsProps) {
  const longest = Math.max(1, ...durations.toOffer, ...durations.toRejection);

  return (
    <div className="duration-dots">
      <div className="duration-dots__chart" aria-hidden="true">
        <ChartKey caption="One dot per application · days from the first stage" items={[]} />
        <div className="duration-dots__rows">
          {ROWS.map((row) => {
            const values = durations[row.id];
            const stacked = new Map<number, number>();
            return (
              <div className="duration-dots__row" data-durations={row.id} key={row.id}>
                <span className="duration-dots__label">{row.label}</span>
                <span className="duration-dots__plot">
                  {values.length === 0 ? <span className="duration-dots__none">None yet</span> : null}
                  {[...values].sort((left, right) => left - right).map((value, index) => {
                    const bin = Math.round((value / longest) * BINS);
                    const level = stacked.get(bin) ?? 0;
                    stacked.set(bin, level + 1);
                    return (
                      <span
                        className={`duration-dots__dot duration-dots__dot--${row.tone}`}
                        data-days={value}
                        key={index}
                        style={{
                          left: `${(value / longest) * 100}%`,
                          bottom: `calc(${level} * var(--chart-dot-step))`,
                        }}
                        title={`${value} days`}
                      />
                    );
                  })}
                </span>
              </div>
            );
          })}
          <span className="duration-dots__axis">
            <span>0</span>
            <span>{longest} days</span>
          </span>
        </div>
      </div>
      <div className="sr-only">{children}</div>
    </div>
  );
}
