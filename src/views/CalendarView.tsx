import { useMemo, useState } from "react";
import type { Application } from "../domain";
import type { ApplicationsViewProps } from "./types";
import { formatLongDate, localDateKey, parseTimestamp } from "./viewUtils";

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildCalendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

export function CalendarView({ applications, onOpen }: ApplicationsViewProps) {
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const days = useMemo(() => buildCalendarDays(month), [month]);
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7)),
    [days],
  );

  const applicationsByDay = useMemo(() => {
    const grouped = new Map<string, Application[]>();
    applications.forEach((application) => {
      if (!application.next_action_at) return;
      const date = parseTimestamp(application.next_action_at);
      if (!date) return;
      const key = localDateKey(date);
      grouped.set(key, [...(grouped.get(key) ?? []), application]);
    });
    grouped.forEach((items) =>
      items.sort(
        (left, right) =>
          new Date(left.next_action_at ?? 0).getTime() -
          new Date(right.next_action_at ?? 0).getTime(),
      ),
    );
    return grouped;
  }, [applications]);

  const goToMonth = (offset: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <section className="calendar" aria-labelledby="calendar-heading">
      <div className="calendar__toolbar">
        <div className="calendar__month-nav">
          <button type="button" className="icon-button" onClick={() => goToMonth(-1)} aria-label="Previous month">
            <span aria-hidden="true">←</span>
          </button>
          <h2 id="calendar-heading" aria-live="polite">
            {monthFormatter.format(month)}
          </h2>
          <button type="button" className="icon-button" onClick={() => goToMonth(1)} aria-label="Next month">
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <button type="button" className="button button--quiet" onClick={() => setMonth(monthStart(new Date()))}>
          Today
        </button>
      </div>

      <div className="calendar__scroll">
        <div className="calendar__grid" role="grid" aria-label={monthFormatter.format(month)}>
          <div className="calendar__row" role="row">
            {Array.from({ length: 7 }, (_, day) => {
              const date = new Date(2024, 0, 7 + day);
              return (
                <div className="calendar__weekday" role="columnheader" key={day}>
                  {weekdayFormatter.format(date)}
                </div>
              );
            })}
          </div>
          {weeks.map((week) => (
            <div className="calendar__row" role="row" key={localDateKey(week[0])}>
              {week.map((day) => {
                const key = localDateKey(day);
                const items = applicationsByDay.get(key) ?? [];
                const outsideMonth = day.getMonth() !== month.getMonth();
                const isToday = key === localDateKey(new Date());
                return (
                  <div
                    className={`calendar__day${outsideMonth ? " calendar__day--muted" : ""}${isToday ? " calendar__day--today" : ""}`}
                    role="gridcell"
                    aria-label={formatLongDate(day)}
                    key={key}
                  >
                    <time dateTime={key} className="calendar__date">
                      {day.getDate()}
                    </time>
                    <div className="calendar__events">
                      {items.map((application) => (
                        <button
                          type="button"
                          className="calendar__event"
                          key={application.id}
                          onClick={() => onOpen(application.id)}
                          title={`${application.company}: ${application.next_action ?? "Scheduled action"}`}
                        >
                          <strong>{application.company}</strong>
                          <span>{application.next_action?.trim() || "Scheduled action"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
