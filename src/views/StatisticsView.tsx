import { MIN_RATING_SCORE, RATING_LABELS, stateLabel, statusLabel } from "../domain";
import type { Application } from "../domain";
import type { StatsSettingId, StatsSettings } from "../statsSettings";
import { describeCompensationGap, formatCompensationBand } from "./compensation";
import { DurationDots } from "./DurationDots";
import { OutcomeBars } from "./OutcomeBars";
import type { BarSeries } from "./OutcomeBars";
import {
  finishDurations,
  replyWaits,
  sourceOutcomes,
  moveKey,
  stageMoves,
  stagePassRates,
  weeklyActivity,
} from "./outcomes";
import type { SourceOutcomeRow } from "./outcomes";
import { preferenceSummary } from "./preference";
import { QuestionCard, SettingField, SettingReset } from "./QuestionCard";
import { RatingScales } from "./RatingScales";
import { StageFlow } from "./StageFlow";
import {
  answeringAnswer,
  durationsAnswer,
  ghostingAnswer,
  liveCount,
  losingAnswer,
  momentumAnswer,
  moneyAnswer,
  movesAnswer,
  quietApplications,
  rankSources,
  ratingsAnswer,
  replyBuckets,
  sourceLabel,
  sourcesAnswer,
  weekLabel,
} from "./statsAnswers";
import { WeeklyColumns } from "./WeeklyColumns";

interface StatisticsViewProps {
  applications: Application[];
  /** Opens an application's editor, from the ghosted list. */
  onOpen: (id: string) => void;
  settings: StatsSettings;
  onSettingChange: (setting: StatsSettingId, value: number) => void;
  /** Browser-local "today". Passed by tests; the app leaves it to the clock. */
  today?: Date;
}

function formatMean(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** A count against the total it came out of, which is what makes it readable as a rate. */
function formatShare(count: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((count / total) * 100)}%`;
}

/** A row's parts in words, leaving out the ones that hold nothing. */
function parts(entries: Array<[number, string]>): string {
  return entries
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(" · ");
}

const PASS_SERIES: BarSeries[] = [
  { id: "passed", label: "Got past it", tone: "strong" },
  { id: "lost", label: "Went no further", tone: "rest" },
];

/*
 * Nested rather than side by side: everything that got past the first stage also heard
 * back, so the middle step is the replies that went no further and the three add up to
 * the source's applications.
 */
const SOURCE_SERIES: BarSeries[] = [
  { id: "advanced", label: "Got past the first stage", tone: "strong" },
  { id: "replied", label: "Heard back, no further", tone: "mid" },
  { id: "silent", label: "No reply", tone: "rest" },
];

const WAIT_SERIES: BarSeries[] = [{ id: "count", label: "Applications", tone: "strong" }];

/**
 * Statistics as the questions a job search actually asks, each answered in a sentence
 * before anything is drawn, in the order of what needs doing: the applications that have
 * gone quiet first, because they are the only answer with something to do today, and how
 * you judge roles last, because it is for reflecting rather than steering.
 *
 * Outcomes rather than inventory, as before: how many applications sit in each state is
 * on the Kanban board already. Everything is derived on render and never persisted — it
 * depends on browser-local "today" and on a history that changes underneath it. The three
 * numbers an answer depends on are stated on the card it changes and edited there.
 */
export function StatisticsView({
  applications,
  onOpen,
  settings,
  onSettingChange,
  today = new Date(),
}: StatisticsViewProps) {
  if (applications.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="statistics-heading">
        <h2 id="statistics-heading">Nothing to summarise yet</h2>
        <p>Add an application, and what the search does with it appears here.</p>
      </section>
    );
  }

  const sources = sourceOutcomes(applications);
  const moves = stageMoves(applications);
  const preference = preferenceSummary(applications);
  const dimensionScores = (preference.dimensions[0]?.scores ?? []).map(
    (_, index) => MIN_RATING_SCORE + index,
  );

  const quiet = quietApplications(applications, settings.quietDays, today);
  const passRates = stagePassRates(applications);
  const losing = losingAnswer(passRates, settings.minStageDecided);
  const weeks = weeklyActivity(applications, today);
  const waits = replyWaits(applications);
  const buckets = replyBuckets(waits);
  const ranked = rankSources(sources, settings.minSourceApplications);
  const durations = finishDurations(applications);
  const money = moneyAnswer(applications);
  const live = liveCount(applications);

  const sourceRow = (source: SourceOutcomeRow, quietRow: boolean) => ({
    key: source.source ?? "",
    label: sourceLabel(source.source),
    values: {
      advanced: source.advanced,
      replied: source.heardBack - source.advanced,
      silent: source.total - source.heardBack,
    },
    value: String(source.total),
    detail: quietRow
      ? `${source.advanced} of ${source.total} past the first stage · too few to compare`
      : `${formatShare(source.heardBack, source.total)} heard back · ${formatShare(
          source.advanced,
          source.total,
        )} got past the first stage`,
    emphasis: !quietRow && source === ranked.comparable[0] && ranked.comparable.length > 1,
    quiet: quietRow,
  });

  return (
    <section className="statistics" aria-labelledby="statistics-heading">
      <h2 className="sr-only" id="statistics-heading">Statistics</h2>
      <div className="statistics__groups">
        <QuestionCard
          answer={ghostingAnswer(quiet, settings.quietDays)}
          method={
            <>
              Quiet means no stage change for{" "}
              <SettingField
                label="Days without a stage change before an application counts as quiet"
                onChange={onSettingChange}
                setting="quietDays"
                value={settings.quietDays}
              />{" "}
              days or more. It's also what Idle means on the board and in the table. Logging a
              message doesn't reset it.
              <SettingReset
                label="Days without a stage change before an application counts as quiet"
                onChange={onSettingChange}
                setting="quietDays"
                value={settings.quietDays}
              />
            </>
          }
          question="Am I being ghosted?"
          step={quiet.length > 0 ? "Follow up, or move them on." : undefined}
        >
          {quiet.length > 0 ? (
            <ul className="quiet-list">
              {quiet.map(({ application, days }) => (
                <li key={application.id}>
                  <button
                    className="quiet-list__item"
                    onClick={() => onOpen(application.id)}
                    type="button"
                  >
                    <span className="quiet-list__name">
                      {application.company} · {stateLabel(application.state)}
                    </span>
                    <span className="quiet-list__days">{days} days</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </QuestionCard>

        <QuestionCard
          answer={losing.answer}
          method={
            <>
              Of the applications that reached a stage and have since been decided, the share
              that reached a later one. Ones still in a stage are left out. A stage needs{" "}
              <SettingField
                label="Decided applications a stage needs before it is compared"
                onChange={onSettingChange}
                setting="minStageDecided"
                value={settings.minStageDecided}
              />{" "}
              decided to be compared.
              <SettingReset
                label="Decided applications a stage needs before it is compared"
                onChange={onSettingChange}
                setting="minStageDecided"
                value={settings.minStageDecided}
              />
            </>
          }
          question="Where am I losing?"
          step={losing.worst ? "That's the stage to prepare for." : undefined}
        >
          {passRates.length > 0 ? (
            <OutcomeBars
              caption="Each bar: a stage's decided applications · figure: how many got past it"
              max="row"
              rows={passRates.map((row) => {
                const tooFew = row.decided < settings.minStageDecided;
                return {
                  key: row.state,
                  label: stateLabel(row.state),
                  values: { passed: row.passed, lost: row.decided - row.passed },
                  value: `${row.passed} of ${row.decided}`,
                  detail: [
                    parts([
                      [row.decided - row.passed, "went no further"],
                      [row.pending, "still in it"],
                    ]),
                    tooFew ? "too few to compare" : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  emphasis: row.state === losing.worst,
                  quiet: tooFew,
                };
              })}
              series={PASS_SERIES}
            >
              <table>
                <caption>How many applications got past each live stage</caption>
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Decided</th>
                    <th scope="col">Got past it</th>
                    <th scope="col">Still in it</th>
                  </tr>
                </thead>
                <tbody>
                  {passRates.map((row) => (
                    <tr key={row.state}>
                      <th scope="row">{stateLabel(row.state)}</th>
                      <td>{row.decided}</td>
                      <td>{row.passed}</td>
                      <td>{row.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </OutcomeBars>
          ) : null}
        </QuestionCard>

        {/*
         * Its own card rather than the bottom half of the losing one: it is the tallest chart
         * on the page, and flowing columns cannot be shorter than their tallest card, so
         * inside another card it set the height of the whole view and left a wide screen's
         * other columns half empty.
         */}
        <QuestionCard
          answer={movesAnswer(moves)}
          method="Every recorded stage change, from the state it left to the state it reached. Going back counts as anywhere else."
          question="Where do applications go?"
        >
          {moves.length > 0 ? (
            <StageFlow moves={moves}>
              <table>
                <caption>Every recorded move, from the state it left to the state it reached</caption>
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Moves</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((move) => (
                    <tr key={moveKey(move)}>
                      <th scope="row">{statusLabel(move.from)}</th>
                      <td>{statusLabel(move.to)}</td>
                      <td>{move.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StageFlow>
          ) : null}
        </QuestionCard>

        <QuestionCard
          answer={momentumAnswer(weeks)}
          method="Each application counts in the week of its first stage, and its reply in the week it came."
          question="Am I keeping momentum?"
          step={`${live} ${live === 1 ? "application is" : "applications are"} still live.`}
        >
          <WeeklyColumns weeks={weeks}>
            <table>
              <caption>Applications started and replies received per week</caption>
              <thead>
                <tr>
                  <th scope="col">Week</th>
                  <th scope="col">Applications</th>
                  <th scope="col">Replies</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.start.toISOString()}>
                    <th scope="row">{weekLabel(week)}</th>
                    <td>{week.started}</td>
                    <td>{week.replies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </WeeklyColumns>
        </QuestionCard>

        <QuestionCard
          answer={answeringAnswer(applications.length, waits)}
          method="A reply is any stage change after the first, a rejection included."
          question="Is anyone answering?"
          step={
            waits.waiting > 0
              ? `${waits.waiting} live ${waits.waiting === 1 ? "application is" : "applications are"} still waiting for a first reply.`
              : undefined
          }
        >
          {waits.replied.length > 0 ? (
            <OutcomeBars
              caption="How long the first reply took"
              max={Math.max(...buckets.map((bucket) => bucket.count))}
              rows={buckets.map((bucket) => ({
                key: bucket.id,
                label: bucket.label,
                values: { count: bucket.count },
                value: String(bucket.count),
                detail: "",
              }))}
              series={WAIT_SERIES}
            >
              <table>
                <caption>Applications by how long their first reply took</caption>
                <thead>
                  <tr>
                    <th scope="col">Wait</th>
                    <th scope="col">Applications</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr key={bucket.id}>
                      <th scope="row">{bucket.label}</th>
                      <td>{bucket.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </OutcomeBars>
          ) : null}
        </QuestionCard>

        <QuestionCard
          answer={sourcesAnswer(ranked, settings.minSourceApplications)}
          method={
            <>
              Ranked by the share that got past the first stage. A source needs{" "}
              <SettingField
                label="Applications a source needs before it is compared"
                onChange={onSettingChange}
                setting="minSourceApplications"
                value={settings.minSourceApplications}
              />{" "}
              applications to be compared.
              <SettingReset
                label="Applications a source needs before it is compared"
                onChange={onSettingChange}
                setting="minSourceApplications"
                value={settings.minSourceApplications}
              />
            </>
          }
          question="Which channels are worth my time?"
        >
          <OutcomeBars
            caption="Each bar: one source’s applications as shares · figure: how many"
            max="row"
            rows={[
              ...ranked.comparable.map((source) => sourceRow(source, false)),
              ...ranked.tooFew.map((source) => sourceRow(source, true)),
            ]}
            series={SOURCE_SERIES}
          >
            <table>
              <caption>
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
                {sources.map((source) => (
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
          </OutcomeBars>
        </QuestionCard>

        <QuestionCard
          answer={durationsAnswer(durations)}
          method="Counted from the first recorded stage: to the rejection, or to first reaching Offer."
          question="How long does it take?"
        >
          {durations.toOffer.length + durations.toRejection.length > 0 ? (
            <DurationDots durations={durations}>
              <table>
                <caption>Days from the first stage to an offer or a rejection</caption>
                <thead>
                  <tr>
                    <th scope="col">Outcome</th>
                    <th scope="col">Days, per application</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">To an offer</th>
                    <td>{[...durations.toOffer].sort((a, b) => a - b).join(", ") || "None"}</td>
                  </tr>
                  <tr>
                    <th scope="row">To a rejection</th>
                    <td>{[...durations.toRejection].sort((a, b) => a - b).join(", ") || "None"}</td>
                  </tr>
                </tbody>
              </table>
            </DurationDots>
          ) : null}
        </QuestionCard>

        <QuestionCard
          answer={money.answer}
          method={
            money.kind === "postings"
              ? "Advertised pay against the target you set on each application. A posting isn't an offer."
              : "Offered pay against the target you set on each application. Currencies are never converted."
          }
          question="Is the money there?"
        >
          {money.rows.length > 0 ? (
            <ul className="pay-list">
              {money.rows.map(({ application, gap }) => {
                const { currency, offered, advertised } = application.compensation;
                const band = money.kind === "offers" ? offered : advertised;
                return (
                  <li key={application.id}>
                    <span className="pay-list__name">{application.company}</span>
                    <span className="pay-list__figure">
                      {currency} {band ? formatCompensationBand(band) : ""}
                    </span>
                    <span className="pay-list__verdict">
                      {gap ? describeCompensationGap(gap) : "no target set"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </QuestionCard>

        <QuestionCard
          answer={ratingsAnswer(preference, formatMean)}
          question="How do I judge roles?"
        >
          {preference.rated > 0 ? (
            <RatingScales dimensions={preference.dimensions} formatMean={formatMean}>
              <table>
                <caption>
                  Judgement counts and mean judged score by rating dimension
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    <th scope="col">Rated</th>
                    <th scope="col">Don&rsquo;t know</th>
                    <th scope="col">Not rated</th>
                    {dimensionScores.map((score) => (
                      <th key={score} scope="col">
                        Scored {score}
                      </th>
                    ))}
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
                      {dimension.scores.map((count, index) => (
                        <td key={index}>{count}</td>
                      ))}
                      <td>{formatMean(dimension.mean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </RatingScales>
          ) : null}
        </QuestionCard>
      </div>
    </section>
  );
}
