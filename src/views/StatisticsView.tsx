import { RATING_LABELS, STATE_CONFIG } from "../domain";
import type { Application } from "../domain";
import { preferenceSummary } from "./preference";

interface StatisticsViewProps {
  applications: Application[];
}

function formatMean(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

export function StatisticsView({ applications }: StatisticsViewProps) {
  const statistics = STATE_CONFIG.map((state) => ({
    ...state,
    current: applications.filter((application) => application.state === state.id).length,
    everReached: applications.filter((application) =>
      application.state_history.some((entry) => entry.state === state.id),
    ).length,
  }));

  /*
   * Preference belongs here more than on any single row: a per-row score tells you what you
   * think of one role, while the collection tells you how you judge roles at all — whether a
   * dimension reads low because you keep rating it low, or because you have never assessed
   * it. Derived on every render like the state counts, and never persisted.
   */
  const preference = preferenceSummary(applications);

  return (
    <section className="statistics" aria-labelledby="statistics-heading">
      <header className="view-heading">
        <h2 className="sr-only" id="statistics-heading">Statistics</h2>
        <div className="statistics__totals">
          <div className="statistics__total" aria-label={`${applications.length} total applications`}>
            <strong>{applications.length}</strong>
            <span>Total applications</span>
          </div>
          <div
            className="statistics__total"
            aria-label={`${preference.rated} of ${preference.total} applications rated`}
          >
            <strong>{preference.rated}</strong>
            <span>Rated of {preference.total}</span>
          </div>
          {preference.mean === null ? null : (
            <div
              className="statistics__total"
              aria-label={`Mean preference ${formatMean(preference.mean)}`}
            >
              <strong>{formatMean(preference.mean)}</strong>
              <span>Mean preference</span>
            </div>
          )}
        </div>
      </header>

      <div className="statistics__table table-scroll">
        <table>
          <caption className="sr-only">Current and ever-reached application counts by state</caption>
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Current</th>
              <th scope="col">Ever reached</th>
            </tr>
          </thead>
          <tbody>
            {statistics.map((state) => (
              <tr key={state.id}>
                <th scope="row">{state.label}</th>
                <td>{state.current}</td>
                <td>{state.everReached}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="statistics__section">Ratings</h3>
      {preference.rated === 0 ? (
        <p className="empty-inline">No application has been rated yet.</p>
      ) : (
        <div className="statistics__table table-scroll">
          <table>
            <caption className="sr-only">
              Judgement counts and mean judged score by rating dimension
            </caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Rated</th>
                <th scope="col">Don&rsquo;t know</th>
                <th scope="col">Not rated</th>
                <th scope="col">Mean</th>
              </tr>
            </thead>
            <tbody>
              {preference.dimensions.map((dimension) => (
                <tr key={dimension.dimension}>
                  <th scope="row">{RATING_LABELS[dimension.dimension]}</th>
                  <td>{dimension.judged}</td>
                  <td>{dimension.unknown}</td>
                  <td>{dimension.unassessed}</td>
                  <td>{formatMean(dimension.mean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {applications.length === 0 ? <p className="empty-state">Add an application to see statistics.</p> : null}
    </section>
  );
}
