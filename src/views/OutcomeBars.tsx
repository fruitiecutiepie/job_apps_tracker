import type { ReactNode } from "react";

import { ChartKey } from "./ChartKey";
import type { ChartTone } from "./ChartKey";

export interface BarSeries {
  id: string;
  label: string;
  tone: ChartTone;
}

export interface BarRow {
  key: string;
  label: ReactNode;
  /** One count per series id; the bar is their sum. */
  values: Record<string, number>;
  /** What the bar's end says: the row's total, or its headline reading. */
  value: string;
  /** The row's parts in words, under the bar. */
  detail: string;
  /** The row the card's answer names, set in bold so the claim can be found in the chart. */
  emphasis?: boolean;
  /** Too few to compare: drawn in grey, so it reads as present but not counted. */
  quiet?: boolean;
}

interface OutcomeBarsProps {
  caption: string;
  series: BarSeries[];
  rows: BarRow[];
  /**
   * What a full-width bar stands for. A number is a count shared by every row, so lengths
   * compare down the chart; `"row"` makes every bar its own row's total, so what compares
   * is the shares inside it — the reading a rate wants, since a longer bar for a source
   * that merely sent more applications says nothing about how it worked out.
   */
  max: number | "row";
  /** The table the chart is drawn from, which is what a screen reader reads instead. */
  children: ReactNode;
}

/*
 * The figure sits at the bar's end, so a full bar is the track less the room kept for it.
 * Every bar is measured against that same span, which is what keeps lengths comparable.
 */
const BAR_SPAN = "(100% - var(--chart-value))";

/**
 * A stacked bar per row, labelled in words beside and beneath it.
 *
 * The chart is hidden from assistive technology and the table it is drawn from is hidden
 * from sight, so each reader gets one of the two rather than both. The chart states every
 * number the table does: nothing is reachable only through the one a reader cannot see.
 */
export function OutcomeBars({ caption, series, rows, max, children }: OutcomeBarsProps) {
  return (
    <div className="outcome-bars">
      <div className="outcome-bars__chart" aria-hidden="true">
        <ChartKey
          caption={caption}
          // One series needs no legend: the caption already says what the bars are.
          items={series.length > 1 ? series.map((item) => ({ label: item.label, mark: item.tone })) : []}
        />
        <div className="outcome-bars__rows">
          {rows.map((row) => {
            const total = series.reduce((sum, item) => sum + (row.values[item.id] ?? 0), 0);
            const share = max === "row" ? 1 : max > 0 ? total / max : 0;
            return (
              <div
                className={[
                  "outcome-bars__row",
                  row.emphasis ? "outcome-bars__row--emphasis" : "",
                  row.quiet ? "outcome-bars__row--quiet" : "",
                ].filter(Boolean).join(" ")}
                data-bar={row.key}
                key={row.key}
              >
                <span className="outcome-bars__label">{row.label}</span>
                <span className="outcome-bars__track">
                  <span className="outcome-bars__bar" style={{ width: `calc(${share} * ${BAR_SPAN})` }}>
                    {series.map((item) => {
                      const count = row.values[item.id] ?? 0;
                      if (count === 0) return null;
                      return (
                        <span
                          className={`outcome-bars__segment outcome-bars__segment--${item.tone}`}
                          data-segment={item.id}
                          key={item.id}
                          style={{ flexGrow: count }}
                          title={`${item.label}: ${count}`}
                        />
                      );
                    })}
                  </span>
                  <span className="outcome-bars__value">{row.value}</span>
                </span>
                {row.detail ? <span className="outcome-bars__detail">{row.detail}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sr-only">{children}</div>
    </div>
  );
}
