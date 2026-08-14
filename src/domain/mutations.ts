import { createUuidV7 } from './id'
import { isStateId } from './states'
import type { Application, ApplicationEdits, ApplicationInput, StateId, TrackerDocument } from './types'

function timestamp(at: Date | string): string {
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required')
  return date.toISOString()
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function companyName(value: string): string {
  const company = value.trim()
  if (!company) throw new TypeError('Company is required')
  return company
}

function checkedUrl(value: string | null | undefined): string | null {
  const url = optionalText(value)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
  } catch {
    throw new TypeError('URL must be a valid http or https URL')
  }
  return url
}

function optionalTimestamp(value: string | null | undefined): string | null {
  const candidate = optionalText(value)
  if (!candidate) return null
  return timestamp(candidate)
}

export function createApplication(
  input: ApplicationInput,
  at: Date | string = new Date(),
  id: string = createUuidV7(at instanceof Date ? at : new Date(at)),
): Application {
  const createdAt = timestamp(at)
  const state = input.state ?? 'applied'
  if (!isStateId(state)) throw new TypeError('State is invalid')
  const nextAction = optionalText(input.next_action)

  return {
    id,
    company: companyName(input.company),
    role: optionalText(input.role),
    url: checkedUrl(input.url),
    state,
    state_history: [{ state, at: createdAt }],
    next_action: nextAction,
    next_action_at: nextAction ? optionalTimestamp(input.next_action_at) : null,
    notes: optionalText(input.notes),
    created_at: createdAt,
    updated_at: createdAt,
  }
}

export function editApplication(
  application: Application,
  edits: ApplicationEdits,
  at: Date | string = new Date(),
): Application {
  const nextAction =
    'next_action' in edits ? optionalText(edits.next_action) : application.next_action
  const nextActionAt = nextAction
    ? 'next_action_at' in edits
      ? optionalTimestamp(edits.next_action_at)
      : application.next_action_at
    : null

  return {
    ...application,
    company: 'company' in edits ? companyName(edits.company ?? '') : application.company,
    role: 'role' in edits ? optionalText(edits.role) : application.role,
    url: 'url' in edits ? checkedUrl(edits.url) : application.url,
    next_action: nextAction,
    next_action_at: nextActionAt,
    notes: 'notes' in edits ? optionalText(edits.notes) : application.notes,
    updated_at: timestamp(at),
  }
}

export function moveApplicationState(
  application: Application,
  state: StateId,
  at: Date | string = new Date(),
): Application {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  if (application.state === state) return application
  const updatedAt = timestamp(at)
  return {
    ...application,
    state,
    state_history: [...application.state_history, { state, at: updatedAt }],
    updated_at: updatedAt,
  }
}

export function addApplication(
  document: TrackerDocument,
  input: ApplicationInput,
  at: Date | string = new Date(),
): TrackerDocument {
  return { ...document, applications: [...document.applications, createApplication(input, at)] }
}

export function updateApplication(
  document: TrackerDocument,
  id: string,
  edits: ApplicationEdits,
  at: Date | string = new Date(),
): TrackerDocument {
  return {
    ...document,
    applications: document.applications.map((application) =>
      application.id === id ? editApplication(application, edits, at) : application,
    ),
  }
}

export function moveApplication(
  document: TrackerDocument,
  id: string,
  state: StateId,
  at: Date | string = new Date(),
): TrackerDocument {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  const application = document.applications.find((item) => item.id === id)
  if (!application || application.state === state) return document

  return {
    ...document,
    applications: document.applications.map((application) =>
      application.id === id ? moveApplicationState(application, state, at) : application,
    ),
  }
}

export function deleteApplication(document: TrackerDocument, id: string): TrackerDocument {
  return {
    ...document,
    applications: document.applications.filter((application) => application.id !== id),
  }
}
