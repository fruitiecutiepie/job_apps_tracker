import { useMemo, useState } from "react";
import { rejectedStateFor, stateLabel } from "../domain";
import type { MovableApplicationsViewProps } from "./types";
import { applicationAgeInDays, DEFAULT_STALE_THRESHOLD_DAYS, formatShortDate } from "./viewUtils";

const THRESHOLDS = [7, 14, 30] as const;
type Threshold = (typeof THRESHOLDS)[number];

export function StaleView({ applications, onOpen, onMove }: MovableApplicationsViewProps) {
  const [threshold, setThreshold] = useState<Threshold>(DEFAULT_STALE_THRESHOLD_DAYS);

  const staleApplications = useMemo(
    () =>
      applications
        .map((application) => ({
          application,
          ageInDays: applicationAgeInDays(application.updated_at),
        }))
        .filter(({ ageInDays }) => ageInDays >= threshold)
        .sort(
          (left, right) =>
            new Date(left.application.updated_at).getTime() -
            new Date(right.application.updated_at).getTime(),
        ),
    [applications, threshold],
  );

  return (
    <section aria-labelledby="stale-heading">
      <div className="view-toolbar">
        <h2 className="sr-only" id="stale-heading">Needs attention</h2>
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
          {staleApplications.map(({ application, ageInDays }) => {
            const rejectedState = rejectedStateFor(application.state);
            return (
              <li className="stale-row" key={application.id}>
                <button
                  className="stale-row__open"
                  type="button"
                  onClick={() => onOpen(application.id)}
                  aria-label={`Open ${application.company}${application.role ? `, ${application.role}` : ""}`}
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
                {rejectedState ? (
                  <button
                    className="stale-row__reject"
                    type="button"
                    onClick={() => onMove(application.id, rejectedState)}
                    aria-label={`Move ${application.company} to ${stateLabel(rejectedState)}`}
                  >
                    Move to Rejected
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
