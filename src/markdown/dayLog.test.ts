import { describe, expect, it } from 'vitest'

import { dayGroups } from './dayLog'

const day = (at: string) => at.slice(0, 10)

const entry = (at: string, body: string) => ({ at, body })

describe('dayGroups', () => {
  it('is empty for nothing', () => {
    expect(dayGroups([], day)).toEqual([])
  })

  it('puts records in order and gives each day one group', () => {
    const groups = dayGroups(
      [
        entry('2026-08-11T22:00:00.000Z', 'Third'),
        entry('2026-08-10T09:00:00.000Z', 'First'),
        entry('2026-08-10T17:00:00.000Z', 'Second'),
      ],
      day,
    )

    expect(groups.map((group) => group.label)).toEqual(['2026-08-10', '2026-08-11'])
    expect(groups[0]!.entries.map(({ body }) => body)).toEqual(['First', 'Second'])
    expect(groups[1]!.entries.map(({ body }) => body)).toEqual(['Third'])
  })

  it('groups by what the formatter says rather than by the timestamps', () => {
    // Two different instants that read as one date group together; one date that reads as two
    // does not. The formatter is what decides where a day ends.
    const everything = () => 'One day'
    const groups = dayGroups(
      [entry('2026-08-10T09:00:00.000Z', 'a'), entry('2027-01-01T09:00:00.000Z', 'b')],
      everything,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.entries).toHaveLength(2)
  })

  it('compares instants rather than strings, for a timestamp written with an offset', () => {
    // 09:00 at +10:00 is 23:00Z the day before: first in fact, and last as a string. Read in
    // UTC so both land in one group and only the order within it is at stake.
    const utcDay = (at: string) => new Date(at).toISOString().slice(0, 10)
    const groups = dayGroups(
      [
        entry('2026-08-21T09:00:00+10:00', 'Earlier'),
        entry('2026-08-20T23:30:00.000Z', 'Later'),
      ],
      utcDay,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.entries.map(({ body }) => body)).toEqual(['Earlier', 'Later'])
  })

  it('does not reorder the records it was given', () => {
    const entries = [entry('2026-08-11T09:00:00.000Z', 'b'), entry('2026-08-10T09:00:00.000Z', 'a')]
    dayGroups(entries, day)

    expect(entries.map(({ body }) => body)).toEqual(['b', 'a'])
  })
})
