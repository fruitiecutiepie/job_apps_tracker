import { describe, expect, it } from 'vitest'

import { parseIcsEvents } from './parseIcs'

function calendar(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n')
}

function event(...lines: string[]): string {
  return calendar('BEGIN:VEVENT', ...lines, 'END:VEVENT')
}

describe('ics events', () => {
  it('reads a UTC invite', () => {
    const [invite] = parseIcsEvents(
      event(
        'UID:abc-123@example.com',
        'SUMMARY:Interview 1 — panel',
        'DTSTART:20260820T040000Z',
        'DTEND:20260820T050000Z',
        'LOCATION:Level 4, 100 Example St',
        'SEQUENCE:2',
      ),
    )

    expect(invite).toEqual({
      uid: 'abc-123@example.com',
      summary: 'Interview 1 — panel',
      starts_at: '2026-08-20T04:00:00.000Z',
      ends_at: '2026-08-20T05:00:00.000Z',
      location: 'Level 4, 100 Example St',
      url: null,
      sequence: 2,
      cancelled: false,
    })
  })

  it('unfolds continuation lines', () => {
    const [invite] = parseIcsEvents(
      event(
        'DTSTART:20260820T040000Z',
        'SUMMARY:Recruiter interview with the ',
        ' design systems team',
      ),
    )

    expect(invite.summary).toBe('Recruiter interview with the design systems team')
  })

  it('resolves a named zone to the right instant', () => {
    const [invite] = parseIcsEvents(
      event('DTSTART;TZID=Australia/Melbourne:20260820T140000', 'SUMMARY:Winter time'),
    )

    // August is AEST (UTC+10).
    expect(invite.starts_at).toBe('2026-08-20T04:00:00.000Z')
  })

  it('resolves a named zone on the far side of a daylight-saving change', () => {
    const [invite] = parseIcsEvents(
      event('DTSTART;TZID=Australia/Melbourne:20261006T140000', 'SUMMARY:Summer time'),
    )

    // October is AEDT (UTC+11) — the second offset pass is what gets this right.
    expect(invite.starts_at).toBe('2026-10-06T03:00:00.000Z')
  })

  it('treats a floating time as browser-local', () => {
    const [invite] = parseIcsEvents(event('DTSTART:20260820T140000', 'SUMMARY:Floating'))

    expect(invite.starts_at).toBe(new Date(2026, 7, 20, 14, 0, 0).toISOString())
  })

  it('falls back to browser-local time when the zone is unknown', () => {
    const [invite] = parseIcsEvents(
      event('DTSTART;TZID=Mars/Olympus_Mons:20260820T140000', 'SUMMARY:Unknown zone'),
    )

    expect(invite.starts_at).toBe(new Date(2026, 7, 20, 14, 0, 0).toISOString())
  })

  it('reads a date-only value as local midnight', () => {
    const [invite] = parseIcsEvents(event('DTSTART;VALUE=DATE:20260820', 'SUMMARY:All day'))

    expect(invite.starts_at).toBe(new Date(2026, 7, 20).toISOString())
  })

  it('derives the end from DURATION when DTEND is absent', () => {
    const [invite] = parseIcsEvents(
      event('DTSTART:20260820T040000Z', 'DURATION:PT1H30M', 'SUMMARY:Take-home walkthrough'),
    )

    expect(invite.ends_at).toBe('2026-08-20T05:30:00.000Z')
  })

  it('leaves the end empty when neither DTEND nor DURATION is readable', () => {
    const [invite] = parseIcsEvents(event('DTSTART:20260820T040000Z', 'SUMMARY:Open ended'))

    expect(invite.ends_at).toBeNull()
  })

  it('unescapes commas, semicolons, and newlines in text', () => {
    const [invite] = parseIcsEvents(
      event(
        'DTSTART:20260820T040000Z',
        'SUMMARY:Panel\\, round 2',
        'LOCATION:Level 4\\; 100 Example St\\nMelbourne',
      ),
    )

    expect(invite.summary).toBe('Panel, round 2')
    expect(invite.location).toBe('Level 4; 100 Example St\nMelbourne')
  })

  it('prefers the URL property over a link in the description', () => {
    const [invite] = parseIcsEvents(
      event(
        'DTSTART:20260820T040000Z',
        'URL:https://example.com/room/1',
        'DESCRIPTION:Join at https://example.com/other',
      ),
    )

    expect(invite.url).toBe('https://example.com/room/1')
  })

  it('finds a joining link inside the description', () => {
    const [invite] = parseIcsEvents(
      event(
        'DTSTART:20260820T040000Z',
        'DESCRIPTION:Join the call at https://example.com/room/42 a few minutes early.',
      ),
    )

    expect(invite.url).toBe('https://example.com/room/42')
  })

  it('ignores a colon inside a quoted parameter value', () => {
    const [invite] = parseIcsEvents(
      event(
        'DTSTART:20260820T040000Z',
        'ORGANIZER;CN="Recruiting: Talent":mailto:dana@example.com',
        'SUMMARY:Quoted params',
      ),
    )

    expect(invite.summary).toBe('Quoted params')
    expect(invite.starts_at).toBe('2026-08-20T04:00:00.000Z')
  })

  it('marks a cancelled event from its status', () => {
    const [invite] = parseIcsEvents(
      event('DTSTART:20260820T040000Z', 'STATUS:CANCELLED', 'SUMMARY:Was interview 2'),
    )

    expect(invite.cancelled).toBe(true)
  })

  it('marks every event cancelled when the file carries METHOD:CANCEL', () => {
    const invites = parseIcsEvents(
      calendar(
        'METHOD:CANCEL',
        'BEGIN:VEVENT',
        'DTSTART:20260820T040000Z',
        'SUMMARY:First',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:20260821T040000Z',
        'SUMMARY:Second',
        'END:VEVENT',
      ),
    )

    expect(invites).toHaveLength(2)
    expect(invites.every((invite) => invite.cancelled)).toBe(true)
  })

  it('reads every event in a file', () => {
    const invites = parseIcsEvents(
      calendar(
        'BEGIN:VEVENT',
        'UID:one',
        'DTSTART:20260820T040000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:two',
        'DTSTART:20260821T040000Z',
        'END:VEVENT',
      ),
    )

    expect(invites.map((invite) => invite.uid)).toEqual(['one', 'two'])
  })

  it('returns an unreadable start as null rather than dropping the event', () => {
    const [invite] = parseIcsEvents(event('UID:broken', 'DTSTART:not-a-date', 'SUMMARY:Broken'))

    expect(invite.uid).toBe('broken')
    expect(invite.starts_at).toBeNull()
  })

  it('defaults a missing or malformed sequence to zero', () => {
    const [invite] = parseIcsEvents(event('DTSTART:20260820T040000Z', 'SEQUENCE:later'))

    expect(invite.sequence).toBe(0)
  })

  it('returns nothing for a file with no events', () => {
    expect(parseIcsEvents(calendar('METHOD:REQUEST'))).toEqual([])
    expect(parseIcsEvents('')).toEqual([])
  })
})
