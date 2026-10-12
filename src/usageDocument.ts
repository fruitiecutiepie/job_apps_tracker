import type { Share, UsageReportSummary } from './usageReport'

/**
 * What the tracker puts on its progress page at fruitiecutiepie.com: the usage report,
 * chosen and labelled for that page, in the site's usage document format
 * (`fruitiecutiepie.usage/1`, docs/usage-api.md in the fruitiecutiepie.com repo).
 *
 * The split is the site's: this decides which numbers matter and what they are called,
 * and sends them typed — counts, shares, durations, series, breakdowns. The site decides
 * how they look, so nothing here formats a number or writes a percentage. Labels are what
 * the page prints; context labels are lower case, read as the rest of a sentence.
 */

export const USAGE_DOCUMENT_SCHEMA = 'fruitiecutiepie.usage/1'

type Scalar =
  | { kind: 'count'; value: number }
  | { kind: 'share'; count: number; of: number }
  | { kind: 'duration'; seconds: number }
type Labelled = Scalar & { label: string }
type Metric =
  | ({ id: string; label: string; description?: string; headline?: boolean; context?: Labelled[] } & Scalar)
  | {
      id: string
      label: string
      description?: string
      kind: 'series'
      interval: 'week'
      parts: string[]
      points: { start: string; values: number[] }[]
    }
  | { id: string; label: string; description?: string; kind: 'breakdown'; ordered?: boolean; items: Labelled[] }

export interface UsageDocument {
  schema: typeof USAGE_DOCUMENT_SCHEMA
  generatedAt: string
  period: { from: string; to: string }
  metrics: Metric[]
}

const count = (value: number): Scalar => ({ kind: 'count', value })
const share = ({ count: part, of }: Share): Scalar => ({ kind: 'share', count: part, of })
const pooled = (shares: Share[]): Share =>
  shares.reduce((sum, next) => ({ count: sum.count + next.count, of: sum.of + next.of }), { count: 0, of: 0 })

const FEATURES: Record<string, string> = {
  notes: 'Prep notes',
  captures: 'What they said',
  messages: 'Messages',
  invites: 'Calendar invites',
  ratings: 'Ratings',
  compensation: 'Compensation',
  posting: 'Job postings',
  attachments: 'Attachments',
  done: 'Next actions done',
  archived: 'Archive',
}
const PLACES: Record<string, string> = {
  kanban: 'Kanban',
  table: 'Table',
  statistics: 'Statistics',
  compare: 'Compare',
  prep: 'Prep',
}
const REFERRERS: Record<string, string> = {
  direct: 'Direct',
  internal: 'Within the app',
  demo: 'The demo',
  site: 'fruitiecutiepie.com',
  search: 'Search',
  social: 'Social',
  github: 'GitHub',
  other: 'Elsewhere',
}
/** In age order, which the page keeps: an age band is not a ranking. */
const AGES: [string, string][] = [
  ['0d', 'Started today'],
  ['1-7d', 'Up to a week'],
  ['8-30d', 'Up to a month'],
  ['31-90d', 'Up to three months'],
  ['91d+', 'Over three months'],
]
const FAILURES: Record<string, string> = {
  load: 'Loading',
  save: 'Saving',
  import: 'Importing',
  export: 'Exporting',
  folder: 'Folders',
  tracker: 'Renaming or removing',
  copy: 'Copying',
  reset: 'Demo reset',
}

/** Non-zero entries, labelled; a zero sent would be a zero drawn. */
function counted(values: Record<string, number>, names: Record<string, string>): Labelled[] {
  return Object.entries(values)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ label: names[key] ?? key, kind: 'count', value }))
}

export function usageDocument(report: UsageReportSummary): UsageDocument {
  const weeks = report.weekly
  const current = weeks[weeks.length - 1]
  // A week holds a handful of new trackers: too few to read alone, so the period pools them.
  const firstDay = pooled(weeks.map((week) => week.activation.addedFirstDay))
  const week1 = pooled(weeks.map((week) => week.retention.week1))
  const week4 = pooled(weeks.map((week) => week.retention.week4))
  const { acquisition, dataSafety, adoption, outcomes, reliability } = report
  const errors = Object.values(reliability.errors).reduce((sum, value) => sum + value, 0)
  const failures = counted(reliability.errors, FAILURES)

  const metrics: Metric[] = [
    {
      id: 'trackers',
      label: 'Trackers this week',
      ...count(current.active),
      headline: true,
      context: [
        { label: 'recorded something', ...count(current.writing) },
        { label: 'new', ...count(current.newTrackers) },
      ],
    },
    {
      id: 'started',
      label: 'Started on day one',
      ...share(firstDay),
      headline: true,
      description: 'New trackers that added an application within a day of starting',
    },
    {
      id: 'came-back',
      label: 'Came back',
      ...share(week1),
      headline: true,
      description: 'New trackers seen again in their second week, leaving out any that had already taken a job',
      // The fifth week is left out until some tracker is old enough to have reached it.
      ...(week4.of > 0 ? { context: [{ label: 'in their fifth week', ...share(week4) }] } : {}),
    },
    {
      id: 'folder',
      label: 'Saving to a folder',
      ...share(dataSafety.folder),
      headline: true,
      context: [
        { label: 'exports', ...count(dataSafety.exports) },
        { label: 'folders waiting for permission', ...share(dataSafety.folderLapsed) },
      ],
      description: 'Trackers saving to a folder, as of their latest visit',
    },
    {
      id: 'offer',
      label: 'Got an offer',
      ...share(outcomes.offer),
      headline: true,
      context: [{ label: 'took a job', ...share(outcomes.accepted) }],
    },
    {
      id: 'trackers-per-week',
      label: 'Trackers per week',
      kind: 'series',
      interval: 'week',
      parts: ['Recorded something', 'Only opened'],
      points: weeks.map((week) => ({ start: week.week, values: [week.writing, Math.max(0, week.active - week.writing)] })),
    },
    {
      id: 'features',
      label: 'Features in use',
      kind: 'breakdown',
      description: 'Share of trackers using each, as of their latest visit',
      items: Object.entries(adoption.features).map(([key, value]) => ({ label: FEATURES[key] ?? key, ...share(value) })),
    },
    {
      id: 'recorded-per-week',
      label: 'Recorded per week',
      kind: 'series',
      interval: 'week',
      parts: ['Applications added', 'Stage moves'],
      points: weeks.map((week) => ({
        start: week.week,
        values: [week.engagement.applicationsAdded, week.engagement.moves],
      })),
    },
    {
      id: 'referrers',
      label: 'Where visits come from',
      kind: 'breakdown',
      items: counted(acquisition.referrers, REFERRERS),
    },
    {
      id: 'time',
      label: 'Time on each view',
      kind: 'breakdown',
      description: 'Estimated from time ranges, not timed exactly',
      items: Object.entries(adoption.minutes)
        .filter(([, minutes]) => minutes > 0)
        .map(([key, minutes]) => ({ label: PLACES[key] ?? key, kind: 'duration', seconds: Math.round(minutes * 60) })),
    },
    {
      id: 'ages',
      label: 'How long trackers have been in use',
      kind: 'breakdown',
      ordered: true,
      items: AGES.map(([key, label]) => ({ label, ...count(report.ages[key as keyof typeof report.ages] ?? 0) })),
    },
    ...(failures.length > 0
      ? [{ id: 'failures', label: 'What failed', kind: 'breakdown' as const, items: failures }]
      : []),
    { id: 'loads', label: 'Page loads', ...count(acquisition.loads.live) },
    { id: 'visitors', label: 'Trackers seen', ...count(acquisition.visitors.live) },
    { id: 'demo-loads', label: 'Demo page loads', ...count(acquisition.loads.demo) },
    { id: 'errors', label: 'Errors', ...count(errors) },
    { id: 'failed-loads', label: 'Loads that failed', ...share(reliability.failedLoads) },
    { id: 'unreadable-imports', label: 'Imports that could not be read', ...share(reliability.unreadableImports) },
    {
      id: 'migrations',
      label: 'Trackers that opened an older file',
      ...count(reliability.migrations['1'] + reliability.migrations['2']),
    },
  ]

  return {
    schema: USAGE_DOCUMENT_SCHEMA,
    generatedAt: report.generatedAt,
    period: report.period,
    metrics,
  }
}
