import { RATING_LABELS, stateLabel } from "../domain";
import type { Application } from "../domain";
import { outcomeSummary } from "./outcomes";
import { preferenceSummary } from "./preference";

interface StatisticsViewProps {
  applications: Application[];
}

function formatMean(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** A count against the total it came out of, which is what makes it readable as a rate. */
function formatShare(count: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((count / total) * 100)}%`;
}

interface FigureProps {
  value: string;
  label: string;
  detail?: string;
}

function Figure({ value, label, detail }: FigureProps) {
  return (
    <div className="statistics__total" aria-label={`${label}: ${value}${detail ? `, ${detail}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function StatisticsView({ applications }: StatisticsViewProps) {
  /*
   * Outcomes rather than inventory. How many applications sit in each state is already on
   * the Kanban board, in a badge beside every lane, and repeating it here as a table of
   * mostly zeros said nothing the board had not. What no row and no board can show is what
   * the collection did: how often anyone replied, how long they took, how far applications
   * got before they ended, and which sources those came from.
   *
   * Derived on every render and never persisted, like the state counts before it: all of
   * it depends on browser-local "today" and on a history that changes underneath it.
   */
  const outcomes = outcomeSummary(applications);

  /*
   * Preference belongs here more than on any single row: a per-row score tells you what you
   * think of one role, while the collection tells you how you judge roles at all — whether a
   * dimension reads low because you keep rating it low, or because you have never assessed
   * it.
   */
  const preference = preferenceSummary(applications);

  if (applications.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="statistics-heading">
        <h2 id="statistics-heading">Nothing to summarise yet</h2>
        <p>Add an application, and what the search does with it appears here.</p>
      </section>
    );
  }

  return (
    <section className="statistics" aria-labelledby="statistics-heading">
      <header className="view-heading">
        <h2 className="sr-only" id="statistics-heading">Statistics</h2>
        <div className="statistics__totals">
          <Figure value={String(outcomes.total)} label="Applications" />
          <Figure
            value={String(outcomes.live)}
            label="Still live"
            detail={formatShare(outcomes.live, outcomes.total)}
          />
          <Figure
            value={String(outcomes.heardBack)}
            label="Heard back"
            detail={formatShare(outcomes.heardBack, outcomes.total)}
          />
          <Figure
            value={String(outcomes.advanced)}
            label="Got past the first stage"
            detail={formatShare(outcomes.advanced, outcomes.total)}
          />
          <Figure
            value={
              outcomes.medianDaysToFirstReply === null
                ? "—"
                : String(outcomes.medianDaysToFirstReply)
            }
            label="Median days to first reply"
            detail={outcomes.heardBack === 0 ? "Nothing to measure yet" : undefined}
          />
        </div>
      </header>

      <h3 className="statistics__section">Stages</h3>
      {outcomes.stages.length === 0 ? (
        <p className="empty-inline">No application has reached a live stage yet.</p>
      ) : (
        <div className="statistics__table table-scroll">
          <table>
            <caption className="sr-only">
              Applications that reached each live stage, that sit in it now, and that got no
              further
            </caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Reached</th>
                <th scope="col">Here now</th>
                <th scope="col">Ended here</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.stages.map((stage) => (
                <tr key={stage.state}>
                  <th scope="row">{stateLabel(stage.state)}</th>
                  <td>{stage.reached}</td>
                  <td>{stage.here}</td>
                  <td>{stage.ended}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="statistics__section">Sources</h3>
      <div className="statistics__table table-scroll">
        <table>
          <caption className="sr-only">
            Applications, replies, and progress by where the role came from
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Applications</th>
              <th scope="col">Heard back</th>
              <th scope="col">Got past the first stage</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.sources.map((source) => (
              <tr key={source.source ?? ""}>
                <th scope="row">{source.source ?? <span aria-label="Not recorded">—</span>}</th>
                <td>{source.total}</td>
                <td>
                  {source.heardBack} <small>{formatShare(source.heardBack, source.total)}</small>
                </td>
                <td>
                  {source.advanced} <small>{formatShare(source.advanced, source.total)}</small>
                </td>
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
      {preference.rated > 0 ? (
        <p className="statistics__note">
          {preference.rated} of {preference.total} rated, mean preference{" "}
          {formatMean(preference.mean)}.
        </p>
      ) : null}
    </section>
  );
}
