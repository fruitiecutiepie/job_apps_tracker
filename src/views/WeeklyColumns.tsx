import type { ReactNode } from "react";

import { ChartKey } from "./ChartKey";
import type { WeekActivity } from "./outcomes";
import { WEEK_FORMAT, weekLabel } from "./statsAnswers";

interface WeeklyColumnsProps {
  weeks: WeekActivity[];
  /** The table the chart is drawn from, which is what a screen reader reads instead. */
  children: ReactNode;
}

/**
 * Applications started and replies received, a pair of columns per week on one axis.
 *
 * One axis is honest here because both are counts of the same kind of thing — events in a
 * week. The current week is the last pair and is what the answer above reads out, so it
 * is marked; the rest are there to read it against. The tallest count is printed once
 * rather than on every column: twenty-four numbers would be a table drawn badly.
 */
export function WeeklyColumns({ weeks, children }: WeeklyColumnsProps) {
  const tallest = Math.max(1, ...weeks.flatMap((week) => [week.started, week.replies]));

  return (
    <div className="weekly-columns">
      <div className="weekly-columns__chart" aria-hidden="true">
        <ChartKey
          caption={`Per week · tallest: ${tallest}`}
          items={[
            { label: "Applications", mark: "strong" },
            { label: "Replies", mark: "mid" },
          ]}
        />
        <div className="weekly-columns__plot">
          {weeks.map((week, index) => (
            <span
              className={`weekly-columns__week${index === weeks.length - 1 ? " weekly-columns__week--current" : ""}`}
              data-week={index}
              key={week.start.toISOString()}
              title={`${weekLabel(week)}: ${week.started} applications, ${week.replies} replies`}
            >
              <span
                className="weekly-columns__column weekly-columns__column--strong"
                style={{ height: `calc(${week.started / tallest} * var(--chart-scale-tall))` }}
              />
              <span
                className="weekly-columns__column weekly-columns__column--mid"
                style={{ height: `calc(${week.replies / tallest} * var(--chart-scale-tall))` }}
              />
            </span>
          ))}
        </div>
        <div className="weekly-columns__axis">
          <span>{weeks[0] ? WEEK_FORMAT.format(weeks[0].start) : ""}</span>
          <span>This week</span>
        </div>
      </div>
      <div className="sr-only">{children}</div>
    </div>
  );
}
