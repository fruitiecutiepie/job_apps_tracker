import { describe, expect, it } from 'vitest'

import { compensationValuesFor } from './compensation'
import { createDemoDocument } from './domain/demo'
import type { Application, TrackerDocument } from './domain/types'
import { correspondenceDrafts, correspondenceRowsFor } from './correspondence'
import { inviteDrafts, inviteRowsFor } from './invites'
import { nextActionDrafts, nextActionRowsFor } from './nextActionRows'
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
    nextActions: nextActionDrafts(nextActionRowsFor(application)),
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

  describe('next actions', () => {
    /** Atlas Thread, which the demo gives two tasks: one dated, one not. */
    function twoTasks() {
      const document = createDemoDocument()
      const opened = document.applications.find((item) => item.company === 'Atlas Thread')!
      expect(opened.next_actions).toHaveLength(2)
      return { document, opened, dated: opened.next_actions[0]!, undated: opened.next_actions[1]! }
    }

    function withTasks(document: TrackerDocument, id: string, tasks: Application['next_actions']): TrackerDocument {
      return {
        ...document,
        applications: document.applications.map((item) => (item.id === id ? { ...item, next_actions: tasks } : item)),
      }
    }

    function tasksAfter(document: TrackerDocument, id: string) {
      return document.applications.find((item) => item.id === id)!.next_actions.map(({ action }) => action)
    }

    it('keeps a task another tab added when the form did not touch the tasks', () => {
      const { document, opened } = twoTasks()
      const added = { id: '01990000-0000-7000-8000-0000000000aa', action: 'Added in the other tab', at: null }
      const stored = withTasks(document, opened.id, [...opened.next_actions, added])
      const form = formFor(opened)
      form.input = { ...form.input, role: 'From the form' }

      expect(tasksAfter(applyEditorSave(stored, opened, form, AT), opened.id)).toContain('Added in the other tab')
    })

    it('keeps a task done in another tab done while the form edits a different one', () => {
      const { document, opened, dated, undated } = twoTasks()
      const stored = withTasks(document, opened.id, [undated])
      const form = formFor(opened)
      form.nextActions = form.nextActions.map((draft) =>
        draft.id === undated.id ? { ...draft, action: 'Send the case study deck and the brief' } : draft,
      )

      const after = tasksAfter(applyEditorSave(stored, opened, form, AT), opened.id)
      expect(after).toEqual(['Send the case study deck and the brief'])
      expect(after).not.toContain(dated.action)
    })

    it('removes what the form removed and adds what it added, beside another tab\'s new task', () => {
      const { document, opened, dated } = twoTasks()
      const added = { id: '01990000-0000-7000-8000-0000000000aa', action: 'Added in the other tab', at: null }
      const stored = withTasks(document, opened.id, [...opened.next_actions, added])
      const form = formFor(opened)
      form.nextActions = [
        ...form.nextActions.filter((draft) => draft.id === dated.id),
        { action: 'Typed in the form', at: null },
      ]

      expect(tasksAfter(applyEditorSave(stored, opened, form, AT), opened.id)).toEqual([
        dated.action,
        'Added in the other tab',
        'Typed in the form',
      ])
    })

    it('brings back a task edited here that another tab removed', () => {
      const { document, opened, dated, undated } = twoTasks()
      const stored = withTasks(document, opened.id, [dated])
      const form = formFor(opened)
      form.nextActions = form.nextActions.map((draft) =>
        draft.id === undated.id ? { ...draft, action: 'Rewritten here' } : draft,
      )

      expect(tasksAfter(applyEditorSave(stored, opened, form, AT), opened.id)).toEqual([dated.action, 'Rewritten here'])
    })
  })
})
