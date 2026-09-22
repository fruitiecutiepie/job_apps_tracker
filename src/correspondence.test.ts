import { describe, expect, it } from 'vitest'

import { applyCorrespondence, createApplication } from './domain'
import { preview } from './markdown'
import {
  correspondenceDrafts,
  opensThread,
  correspondenceRowSummary,
  correspondenceRowsFor,
  firstCorrespondenceProblem,
  newCorrespondenceRow,
  type CorrespondenceRow,
} from './correspondence'

const REFERENCE = new Date('2026-08-14T12:00:00+10:00')

function row(overrides: Partial<CorrespondenceRow> = {}): CorrespondenceRow {
  return {
    id: '018f24c0-0000-7000-8000-0000000000aa',
    state: 'recruiter_messaged',
    direction: 'received',
    subject: '',
    channel: '',
    who: '',
    body: 'Could you send me some windows?',
    at: '2026-08-10T09:30',
    ...overrides,
  }
}

describe('correspondence rows', () => {
  it('reads a stored log back newest first', () => {
    const application = applyCorrespondence(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [
        { state: 'applied', direction: 'received', body: 'First', at: '2026-08-09T23:30:00.000Z' },
        { state: 'applied', direction: 'sent', body: 'Second', at: '2026-08-10T23:30:00.000Z' },
      ],
      REFERENCE,
    )

    // Stored oldest first, read newest first: what arrived last is what you are checking.
    expect(application.correspondence.map((entry) => entry.body)).toEqual(['First', 'Second'])
    expect(correspondenceRowsFor(application).map((current) => current.body)).toEqual([
      'Second',
      'First',
    ])
  })

  it('has no rows for an application that is not there yet', () => {
    expect(correspondenceRowsFor(null)).toEqual([])
  })

  it('turns a blank channel and correspondent into nothing rather than an empty string', () => {
    const [draft] = correspondenceDrafts([row({ channel: '', who: '' })])

    expect(draft).toMatchObject({ channel: null, who: null })
  })

  it('drops a row that was added and then left alone', () => {
    expect(correspondenceDrafts([row({ body: '', at: '' }), row()])).toHaveLength(1)
  })

  it('names the row a problem is in', () => {
    expect(firstCorrespondenceProblem([row(), row({ body: '  ' })])).toBe('Message 2 needs its text.')
    expect(firstCorrespondenceProblem([row({ at: '' })])).toBe(
      'Message 1 needs the date and time it was sent.',
    )
  })

  it('says nothing about a blank row, which is dropped rather than refused', () => {
    expect(firstCorrespondenceProblem([row({ body: '', at: '' })])).toBeNull()
    expect(firstCorrespondenceProblem([row()])).toBeNull()
  })

  it('starts the next message from who the last one was with, and how', () => {
    const next = newCorrespondenceRow(
      [row({ who: 'Dana Okafor', channel: 'Email' })],
      'interview_1',
      'new-id',
    )

    // A hiring conversation is one recruiter on one channel far more often than not.
    expect(next).toMatchObject({ who: 'Dana Okafor', channel: 'Email', state: 'interview_1' })
    // Not the text, the time, or the direction: a reply follows a message, not another reply.
    expect(next).toMatchObject({ body: '', at: '', direction: 'received', id: 'new-id' })
  })

  it('takes them from the newest row that has any, skipping a blank one', () => {
    const blank = row({ id: 'blank', who: '', channel: '', body: '', at: '' })
    const earlier = row({ id: 'earlier', who: 'Priya Raman', channel: 'LinkedIn' })

    expect(newCorrespondenceRow([blank, earlier], 'applied', 'new-id')).toMatchObject({
      who: 'Priya Raman',
      channel: 'LinkedIn',
    })
  })

  it('starts empty when there is nothing to carry forward', () => {
    expect(newCorrespondenceRow([], 'applied', 'new-id')).toMatchObject({ who: '', channel: '' })
  })

  it('sums a row up as when, who, how, and a line of what it says', () => {
    const summary = correspondenceRowSummary(
      row({ who: 'Dana Okafor', channel: 'Email', at: '2026-08-10T09:30' }),
    )

    expect(summary).toContain('Dana Okafor')
    expect(summary).toContain('Email')
    expect(summary).toContain('Could you send me some windows?')
  })

  it('names you as the sender of what you sent, the way the log does', () => {
    expect(correspondenceRowSummary(row({ direction: 'sent', who: 'Dana Okafor' })))
      .toContain('You')
    expect(correspondenceRowSummary(row({ who: '' }))).toContain('Them')
  })

  it('cuts the line at the same length the log cuts it', () => {
    const long = 'x'.repeat(200)

    // One rule, so a row does not summarise a message one way here and another way there.
    expect(correspondenceRowSummary(row({ body: long }))).toContain(preview(long))
    expect(correspondenceRowSummary(row({ body: long }))).toContain('…')
  })

  it('says a row is new rather than rendering as a stack of separators', () => {
    expect(correspondenceRowSummary(row({ who: '', channel: '', body: '', at: '' })))
      .toBe('New message')
  })

  it('says so when a message has text but no date yet', () => {
    expect(correspondenceRowSummary(row({ at: '' }))).toContain('No date')
  })

  it('summarises a row by its body, leaving the subject to the heading over the thread', () => {
    const greeting = 'Hi Audrey,\n\nThanks for making the time on Thursday.'
    const summary = correspondenceRowSummary(row({ subject: 'Next steps', body: greeting }))

    // The same split the log makes. Three rows each reading "Next steps" under a heading
    // reading "Next steps" would say nothing about which is which.
    expect(summary).toContain('Hi Audrey')
    expect(summary).not.toContain('Next steps')
  })

  it('carries the thread forward into the next message, not just the correspondent', () => {
    const next = newCorrespondenceRow(
      [row({ subject: 'Next steps', who: 'Dana Okafor' })],
      'interview_1',
      'new-id',
    )

    // The next message in a thread is a reply to it, and a shared subject is what a thread is.
    expect(next.subject).toBe('Next steps')
  })

  it('opens a thread at the first row of a run and not at the ones following it', () => {
    const rows = [
      row({ id: 'a', subject: 'Next steps' }),
      row({ id: 'b', subject: 'Next steps' }),
      row({ id: 'c', subject: 'Scheduling' }),
    ]

    expect([0, 1, 2].map((index) => opensThread(rows, index))).toEqual([true, false, true])
  })

  it('breaks a run when the stage changes, even on the same subject', () => {
    const rows = [
      row({ id: 'a', subject: 'Next steps', state: 'recruiter_messaged' }),
      row({ id: 'b', subject: 'Next steps', state: 'interview_1' }),
    ]

    // Two conversations that happen to share a subject in different stages are not one
    // conversation, which is the same rule the log groups on.
    expect(opensThread(rows, 1)).toBe(true)
  })

  it('opens no thread for a message that arrived without a subject', () => {
    expect(opensThread([row({ subject: '' })], 0)).toBe(false)
    expect(opensThread([row({ subject: '   ' })], 0)).toBe(false)
  })
})
