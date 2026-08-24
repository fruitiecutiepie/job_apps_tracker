import { STATE_CONFIG, STATE_LABELS } from './states'
import type { Application, StateId, TrackerIndexes } from './types'

function emptyStateArrays(): Record<StateId, string[]> {
  const record = {} as Record<StateId, string[]>
  for (const { id } of STATE_CONFIG) {
    record[id] = []
  }
  return record
}

function emptyStateCounts(): Record<StateId, number> {
  const record = {} as Record<StateId, number>
  for (const { id } of STATE_CONFIG) {
    record[id] = 0
  }
  return record
}

export function rebuildIndexes(applications: Application[]): TrackerIndexes {
  const by_id: Record<string, number> = {}
  const by_state = emptyStateArrays()
  const by_company: Record<string, string[]> = {}
  const by_created_at: string[] = []
  const by_updated_at: string[] = []
  const by_next_action_at: string[] = []
  const by_deadline_at: string[] = []
  const with_next_action: string[] = []
  const unscheduled: Application[] = []
  const ever_reached = emptyStateArrays()
  const search_text: Record<string, string> = {}
  const stats_current = emptyStateCounts()
  const stats_ever_reached = emptyStateCounts()

  applications.forEach((application, index) => {
    by_id[application.id] = index
    by_state[application.state].push(application.id)
    const companyIds = by_company[application.company] ?? (by_company[application.company] = [])
    companyIds.push(application.id)
    by_created_at.push(application.id)
    by_updated_at.push(application.id)
    stats_current[application.state]++

    const reachedStates = new Set<StateId>()
    for (const entry of application.state_history) {
      reachedStates.add(entry.state)
    }
    for (const state of reachedStates) {
      ever_reached[state].push(application.id)
      stats_ever_reached[state]++
    }

    if (application.deadline_at) {
      by_deadline_at.push(application.id)
    }

    if (application.next_action?.trim()) {
      with_next_action.push(application.id)
      if (application.next_action_at) {
        by_next_action_at.push(application.id)
      } else {
        unscheduled.push(application)
      }
    }

    search_text[application.id] = [
      application.company,
      application.role,
      application.source,
      application.notes,
      application.next_action,
      // What you did is as findable as what you plan to do; before Done had a field of its
      // own these lines lived in `notes` and were already matched here.
      ...application.completed_actions.map((entry) => entry.action),
      STATE_LABELS[application.state],
      ...application.stage_notes.map((note) =>
        [STATE_LABELS[note.state], note.body, ...note.heard.map((entry) => entry.body)]
          .filter(Boolean)
          .join(' '),
      ),
      ...application.state_events.map((event) =>
        [STATE_LABELS[event.state], event.summary, event.location].filter(Boolean).join(' '),
      ),
      ...application.attachments.map((attachment) => attachment.filename),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
  })

  by_created_at.sort(
    (leftId, rightId) =>
      Date.parse(applications[by_id[leftId]].created_at) -
      Date.parse(applications[by_id[rightId]].created_at),
  )

  by_updated_at.sort(
    (leftId, rightId) =>
      Date.parse(applications[by_id[leftId]].updated_at) -
      Date.parse(applications[by_id[rightId]].updated_at),
  )

  by_next_action_at.sort(
    (leftId, rightId) =>
      Date.parse(applications[by_id[leftId]].next_action_at!) -
      Date.parse(applications[by_id[rightId]].next_action_at!),
  )

  by_deadline_at.sort(
    (leftId, rightId) =>
      Date.parse(applications[by_id[leftId]].deadline_at!) -
      Date.parse(applications[by_id[rightId]].deadline_at!),
  )

  const unscheduled_next_actions = unscheduled
    .sort((left, right) => left.company.localeCompare(right.company))
    .map((application) => application.id)

  return {
    by_id,
    by_state,
    by_company,
    by_created_at,
    by_updated_at,
    by_next_action_at,
    by_deadline_at,
    with_next_action,
    unscheduled_next_actions,
    ever_reached,
    search_text,
    stats_current,
    stats_ever_reached,
  }
}

export function indexesAreStale(applications: Application[], indexes: TrackerIndexes): boolean {
  if (Object.keys(indexes.by_id).length !== applications.length) return true
  if (!Array.isArray(indexes.by_created_at) || indexes.by_created_at.length !== applications.length) {
    return true
  }
  if (!indexes.by_company || typeof indexes.by_company !== 'object') return true

  for (let index = 0; index < applications.length; index++) {
    const application = applications[index]!
    if (indexes.by_id[application.id] !== index) return true
    if (!indexes.by_company[application.company]?.includes(application.id)) return true
  }

  return false
}
