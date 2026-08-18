import { useMemo, useState } from "react";
import type { Application, StateEvent } from "../domain";
import type { ApplicationsViewProps } from "./types";
import { formatLongDate, localDateKey, parseTimestamp } from "./viewUtils";

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * One thing shown on one day. Dated next actions and calendar invites both land
 * here, so a day cell can carry a mix of the two in time order.
 */
interface CalendarEntry {
  key: string;
  at: string;
  application: Application;
  detail: string;
  kind: "action" | "invite";
  cancelled: boolean;
}

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

function inviteEntry(application: Application, event: StateEvent, at: Date): CalendarEntry {
  const detail = [
    event.cancelled ? "Cancelled" : null,
    timeFormatter.format(at),
    event.summary,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    key: `invite:${event.id}`,
    at: event.starts_at,
    application,
    detail,
    kind: "invite",
    cancelled: event.cancelled,
  };
}

export function CalendarView({ applications, onOpen }: ApplicationsViewProps) {
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const days = useMemo(() => buildCalendarDays(month), [month]);
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7)),
    [days],
  );

  const entriesByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    const place = (entry: CalendarEntry, at: Date) => {
      const key = localDateKey(at);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    };

    applications.forEach((application) => {
      if (application.next_action_at) {
        const at = parseTimestamp(application.next_action_at);
        if (at) {
          place(
            {
              key: `action:${application.id}`,
              at: application.next_action_at,
              application,
              detail: application.next_action?.trim() || "Scheduled action",
              kind: "action",
              cancelled: false,
            },
            at,
          );
        }
      }

      application.state_events.forEach((event) => {
        const at = parseTimestamp(event.starts_at);
        if (at) place(inviteEntry(application, event, at), at);
      });
    });

    grouped.forEach((entries) =>
      entries.sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
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
                const entries = entriesByDay.get(key) ?? [];
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
                      {entries.map((entry) => (
                        <button
                          type="button"
                          className={[
                            "calendar__event",
                            `calendar__event--${entry.kind}`,
                            entry.cancelled ? "calendar__event--cancelled" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={entry.key}
                          onClick={() => onOpen(entry.application.id)}
                          title={`${entry.application.company}: ${entry.detail}`}
                        >
                          <strong>{entry.application.company}</strong>
                          <span>{entry.detail}</span>
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
