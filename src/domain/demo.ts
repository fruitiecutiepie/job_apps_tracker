import { prepareTrackerDatabase } from './database'
import { STATE_IDS } from './states'
import type { Application, StateHistoryEntry, StateId, TrackerDocument } from './types'

interface DemoSeed {
  company: string
  role: string | null
  state: StateId
  createdDaysAgo: number
  updatedDaysAgo: number
  priorStates?: StateId[]
  nextAction?: string
  nextActionDaysFromNow?: number
  notes?: string
}

const DEMO_SEEDS: readonly DemoSeed[] = [
  { company: 'Northstar Labs', role: 'Staff Product Designer', state: 'headhunted', createdDaysAgo: 4, updatedDaysAgo: 1, nextAction: 'Reply to the talent partner', nextActionDaysFromNow: 2, notes: 'Introduced through a former teammate.' },
  { company: 'Juniper Works', role: 'Frontend Engineer', state: 'no_openings', createdDaysAgo: 47, updatedDaysAgo: 31, priorStates: ['headhunted'], nextAction: 'Check the careers page next quarter', notes: 'Hiring is paused, but the team asked to stay in touch.' },
  { company: 'Marble & Finch', role: 'Product Manager', state: 'applied', createdDaysAgo: 9, updatedDaysAgo: 9, nextAction: 'Follow up on the application', nextActionDaysFromNow: -2, notes: 'Applied with a tailored portfolio.' },
  { company: 'Copperline Health', role: 'Data Analyst', state: 'auto_rejected', createdDaysAgo: 39, updatedDaysAgo: 38, priorStates: ['applied'], notes: 'Automated rejection arrived the following morning.' },
  { company: 'Paper Kite', role: 'Senior UX Researcher', state: 'recruiter_messaged', createdDaysAgo: 7, updatedDaysAgo: 3, priorStates: ['applied'], nextAction: 'Send availability to the recruiter', nextActionDaysFromNow: -1, notes: 'Recruiter asked for three interview windows.' },
  { company: 'Tidal Grove', role: 'Platform Engineer', state: 'recruiter_messaged_rejected', createdDaysAgo: 26, updatedDaysAgo: 17, priorStates: ['applied', 'recruiter_messaged'], notes: 'Role requires a different on-call timezone.' },
  { company: 'Orbit & Oak', role: 'Operations Lead', state: 'online_assessment', createdDaysAgo: 12, updatedDaysAgo: 2, priorStates: ['applied', 'recruiter_messaged'], nextAction: 'Complete the scenario assessment', nextActionDaysFromNow: 3, notes: 'Assessment should take about 75 minutes.' },
  { company: 'Bright Harbor', role: 'Software Engineer', state: 'online_assessment_rejected', createdDaysAgo: 44, updatedDaysAgo: 29, priorStates: ['applied', 'online_assessment'], notes: 'Passed most cases; concurrency section was incomplete.' },
  { company: 'Atlas Thread', role: 'Design Systems Lead', state: 'recruiter_interview', createdDaysAgo: 18, updatedDaysAgo: 2, priorStates: ['applied', 'recruiter_messaged'], nextAction: 'Prepare examples of system governance', nextActionDaysFromNow: 1, notes: 'Thirty-minute video call with the internal recruiter.' },
  { company: 'Cinder Studio', role: 'Product Designer', state: 'recruiter_interview_rejected', createdDaysAgo: 35, updatedDaysAgo: 20, priorStates: ['applied', 'recruiter_messaged', 'recruiter_interview'], notes: 'Team selected someone with deeper enterprise experience.' },
  { company: 'Kindred Cloud', role: 'Developer Advocate', state: 'take_home_assessment', createdDaysAgo: 16, updatedDaysAgo: 1, priorStates: ['applied', 'recruiter_interview'], nextAction: 'Submit the API tutorial', nextActionDaysFromNow: 5, notes: 'Keep the written exercise under 1,500 words.' },
  { company: 'Willow Finance', role: 'Risk Product Manager', state: 'take_home_assessment_rejected', createdDaysAgo: 51, updatedDaysAgo: 24, priorStates: ['applied', 'recruiter_interview', 'take_home_assessment'], notes: 'Good feedback on structure; domain depth was the deciding factor.' },
  { company: 'Echo Robotics', role: 'Human Factors Researcher', state: 'interview_1', createdDaysAgo: 21, updatedDaysAgo: 4, priorStates: ['applied', 'recruiter_interview'], nextAction: 'Review the research case study', nextActionDaysFromNow: 2, notes: 'Panel includes design, engineering, and research.' },
  { company: 'Mosslight Energy', role: 'Senior Data Scientist', state: 'interview_1_rejected', createdDaysAgo: 62, updatedDaysAgo: 34, priorStates: ['applied', 'online_assessment', 'recruiter_interview', 'interview_1'], notes: 'Technical discussion went well; another candidate had energy-market experience.' },
  { company: 'Halcyon Maps', role: 'Engineering Manager', state: 'interview_2', createdDaysAgo: 25, updatedDaysAgo: 1, priorStates: ['applied', 'recruiter_interview', 'interview_1'], nextAction: 'Join the leadership interview', nextActionDaysFromNow: 0, notes: 'Final conversation with the VP of Engineering.' },
  { company: 'Fern & Field', role: 'Brand Director', state: 'interview_2_rejected', createdDaysAgo: 73, updatedDaysAgo: 41, priorStates: ['headhunted', 'recruiter_interview', 'interview_1', 'interview_2'], nextAction: 'Thank the hiring manager and stay connected', notes: 'A thoughtful process and useful portfolio feedback.' },
  { company: 'Lumen Pantry', role: 'Head of Growth', state: 'offer', createdDaysAgo: 33, updatedDaysAgo: 1, priorStates: ['applied', 'recruiter_interview', 'interview_1', 'interview_2'], nextAction: 'Review compensation and equity terms', nextActionDaysFromNow: 1, notes: 'Written offer received; response requested this week.' },
  { company: 'Redwood Relay', role: 'Principal Engineer', state: 'offer_rejected', createdDaysAgo: 88, updatedDaysAgo: 46, priorStates: ['headhunted', 'recruiter_interview', 'interview_1', 'interview_2', 'offer'], notes: 'Declined after the location policy changed.' },
  { company: 'Saffron Systems', role: 'Product Operations Manager', state: 'accepted', createdDaysAgo: 58, updatedDaysAgo: 6, priorStates: ['applied', 'recruiter_messaged', 'recruiter_interview', 'interview_1', 'interview_2', 'offer'], nextAction: 'Prepare questions for onboarding', notes: 'Start date confirmed. Background check complete.' },
]

function localDay(reference: Date, daysFromReference: number, hour = 10): Date {
  const date = new Date(reference)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() + daysFromReference)
  return date
}

function historyFor(seed: DemoSeed, reference: Date): StateHistoryEntry[] {
  const states = [...(seed.priorStates ?? []), seed.state]
  const created = localDay(reference, -seed.createdDaysAgo, 9).getTime()
  const updated = localDay(reference, -seed.updatedDaysAgo, 16).getTime()
  return states.map((state, index) => {
    const fraction = states.length === 1 ? 0 : index / (states.length - 1)
    const at = new Date(created + (updated - created) * fraction).toISOString()
    return { state, at }
  })
}

function demoId(index: number): string {
  return `018f0000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
}

const DEFAULT_DEMO_REFERENCE = '2026-08-14T02:00:00.000Z'

export function createDemoDocument(
  reference: Date = new Date(DEFAULT_DEMO_REFERENCE),
): TrackerDocument {
  const applications: Application[] = DEMO_SEEDS.map((seed, index) => {
    const history = historyFor(seed, reference)
    const createdAt = history[0].at
    const updatedAt = history[history.length - 1].at
    return {
      id: demoId(index),
      company: seed.company,
      role: seed.role,
      url: `https://example.com/jobs/${index + 1}`,
      state: seed.state,
      state_history: history,
      next_action: seed.nextAction ?? null,
      next_action_at:
        seed.nextAction !== undefined && seed.nextActionDaysFromNow !== undefined
          ? localDay(reference, seed.nextActionDaysFromNow, 9).toISOString()
          : null,
      notes: seed.notes ?? null,
      attachments: [],
      created_at: createdAt,
      updated_at: updatedAt,
    }
  })

  const coveredStates = new Set(applications.map((application) => application.state))
  if (
    applications.length !== STATE_IDS.length
    || coveredStates.size !== STATE_IDS.length
    || STATE_IDS.some((state) => !coveredStates.has(state))
  ) {
    throw new Error('Demo data must contain exactly one application per state')
  }
  return prepareTrackerDatabase(applications)
}
