import { useMemo, useState } from "react";
import type { ApplicationsViewProps } from "./types";
import { formatShortDate, localDayNumber, parseTimestamp } from "./viewUtils";

const THRESHOLDS = [7, 14, 30] as const;
type Threshold = (typeof THRESHOLDS)[number];

export function StaleView({ applications, onOpen }: ApplicationsViewProps) {
  const [threshold, setThreshold] = useState<Threshold>(14);
  const today = localDayNumber(new Date());

  const staleApplications = useMemo(
    () =>
      applications
        .map((application) => {
          const updatedAt = parseTimestamp(application.updated_at);
        const ageInDays = updatedAt ? Math.max(0, today - localDayNumber(updatedAt)) : 0;
          return { application, ageInDays };
        })
        .filter(({ ageInDays }) => ageInDays >= threshold)
        .sort(
          (left, right) =>
            new Date(left.application.updated_at).getTime() -
            new Date(right.application.updated_at).getTime(),
        ),
    [applications, threshold, today],
  );

  return (
    <section aria-labelledby="stale-heading">
      <div className="view-toolbar">
        <div>
          <h2 id="stale-heading">Needs attention</h2>
          <p>Applications that have not changed recently, oldest first.</p>
        </div>
        <fieldset className="segmented-control">
          <legend className="sr-only">Stale after</legend>
          {THRESHOLDS.map((days) => (
            <label key={days}>
              <input
                className="sr-only"
                type="radio"
                name="stale-threshold"
                value={days}
                checked={threshold === days}
                onChange={() => setThreshold(days)}
              />
              {days} days
            </label>
          ))}
        </fieldset>
      </div>

      {staleApplications.length === 0 ? (
        <div className="empty-state">
          <h3>Everything is fresh</h3>
          <p>No applications have been untouched for {threshold} days.</p>
        </div>
      ) : (
        <ul className="stale-list">
          {staleApplications.map(({ application, ageInDays }) => (
            <li key={application.id}>
              <button
                className="stale-row"
                type="button"
                onClick={() => onOpen(application.id)}
              >
                <span>
                  <strong>{application.company}</strong>
                  <small>{application.role ?? "Role not specified"}</small>
                </span>
                <span>
                  <strong>{ageInDays} days</strong>
                  <small>Last updated {formatShortDate(application.updated_at)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
