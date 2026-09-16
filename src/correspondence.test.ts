import { describe, expect, it } from 'vitest'

import { applyCorrespondence, createApplication } from './domain'
import {
  correspondenceDrafts,
  correspondenceRowsFor,
  firstCorrespondenceProblem,
  type CorrespondenceRow,
} from './correspondence'

const REFERENCE = new Date('2026-08-14T12:00:00+10:00')

function row(overrides: Partial<CorrespondenceRow> = {}): CorrespondenceRow {
  return {
    id: '018f24c0-0000-7000-8000-0000000000aa',
    state: 'recruiter_messaged',
    direction: 'received',
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
})
