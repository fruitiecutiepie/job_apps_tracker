import { describe, expect, it } from 'vitest'

import { compensationValuesFor } from './compensation'
import { createDemoDocument } from './domain/demo'
import type { Application, TrackerDocument } from './domain/types'
import { correspondenceDrafts, correspondenceRowsFor } from './correspondence'
import { inviteDrafts, inviteRowsFor } from './invites'
import { postingDraftFrom, postingRowFor } from './posting'
import { ratingValuesFor } from './ratings'
import { applyEditorSave, type EditorForm } from './editorSave'
import { toDateTimeInput } from './dateInput'

const AT = new Date('2026-10-04T09:00:00.000Z')

/** The form as it stands the moment the editor opens, before anyone types. */
function formFor(application: Application): EditorForm {
  return {
    input: {
      company: application.company,
      role: application.role,
      url: application.url,
      source: application.source,
      next_action: application.next_action,
      next_action_at: application.next_action_at,
      deadline_at: application.deadline_at,
      notes: application.notes,
      compensation: application.compensation,
    },
    compensationValues: compensationValuesFor(application),
    ratingValues: ratingValuesFor(application),
    correspondence: correspondenceDrafts(correspondenceRowsFor(application)),
    invites: inviteDrafts(inviteRowsFor(application)),
    completedActions: application.completed_actions.map(({ id, action, at }) => ({ id, action, at })),
    posting: postingDraftFrom(postingRowFor(application)),
    stage: application.stage,
    outcome: application.outcome,
    archived: application.archived_at !== null,
    nextActionAt: toDateTimeInput(application.next_action_at),
    deadlineAt: toDateTimeInput(application.deadline_at),
    attachments: application.attachments,
    removedAttachmentIds: [],
    stagedCount: 0,
  }
}

function withCompany(document: TrackerDocument, id: string, company: string, role: string): TrackerDocument {
  return {
    ...document,
    applications: document.applications.map((item) =>
      item.id === id ? { ...item, company, role } : item,
    ),
  }
}

describe('saving the application editor', () => {
  it('keeps a field another tab changed when the form did not touch it', () => {
    const document = createDemoDocument()
    const opened = document.applications[0]
    const stored = withCompany(document, opened.id, 'Halcyon', 'Kept by the other tab')
    const form = formFor(opened)
    form.input = { ...form.input, role: 'From the form' }

    const saved = applyEditorSave(stored, opened, form, AT)
    const application = saved.applications.find((item) => item.id === opened.id)

    expect(application?.company).toBe('Halcyon')
    expect(application?.role).toBe('From the form')
  })

  it('keeps correspondence another tab logged when the form did not edit the log', () => {
    const document = createDemoDocument()
    const opened = document.applications[0]
    const extra = {
      id: '01990000-0000-7000-8000-000000000099',
      stage: opened.stage,
      direction: 'received' as const,
      channel: 'email',
      who: 'Sam',
      subject: 'Next steps',
      body: 'Logged in the other tab.',
      at: '2026-10-01T09:00:00.000Z',
      created_at: '2026-10-03T09:00:00.000Z',
      updated_at: '2026-10-03T09:00:00.000Z',
    }
    const stored: TrackerDocument = {
      ...document,
      applications: document.applications.map((item) =>
        item.id === opened.id ? { ...item, correspondence: [...item.correspondence, extra] } : item,
      ),
    }

    const saved = applyEditorSave(stored, opened, formFor(opened), AT)
    const application = saved.applications.find((item) => item.id === opened.id)

    expect(application?.correspondence.map((item) => item.body)).toContain('Logged in the other tab.')
  })
})
