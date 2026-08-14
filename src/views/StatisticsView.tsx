import { STATE_CONFIG } from "../domain";
import type { Application } from "../domain";

interface StatisticsViewProps {
  applications: Application[];
}

export function StatisticsView({ applications }: StatisticsViewProps) {
  const statistics = STATE_CONFIG.map((state) => ({
    ...state,
    current: applications.filter((application) => application.state === state.id).length,
    everReached: applications.filter((application) =>
      application.state_history.some((entry) => entry.state === state.id),
    ).length,
  }));

  return (
    <section className="statistics" aria-labelledby="statistics-heading">
      <header className="view-heading">
        <div>
          <h2 id="statistics-heading">Statistics</h2>
          <p>Current positions and states reached over application history.</p>
        </div>
        <div className="statistics__total" aria-label={`${applications.length} total applications`}>
          <strong>{applications.length}</strong>
          <span>Total applications</span>
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
      {applications.length === 0 ? <p className="empty-state">Add an application to see statistics.</p> : null}
    </section>
  );
}
