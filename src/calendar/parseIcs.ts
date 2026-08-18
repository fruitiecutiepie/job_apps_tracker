/*
 * A deliberately small iCalendar (RFC 5545) reader for the invites a job search
 * actually produces: single VEVENTs mailed by a recruiter or exported from a
 * calendar. It is a subset in the same spirit as the Markdown parser — no
 * recurrence rules, alarms, attendees, or free/busy — and it reads only what a
 * tracker entry needs. Extend it and its tests together.
 */

/** One VEVENT, reduced to the fields a tracked invite uses. Timestamps are UTC ISO-8601. */
export interface IcsEvent {
  uid: string | null
  summary: string | null
  starts_at: string | null
  ends_at: string | null
  location: string | null
  url: string | null
  sequence: number
  cancelled: boolean
}

interface IcsProperty {
  name: string
  params: Map<string, string>
  value: string
}

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/
const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/
const DURATION = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
const HTTP_URL = /https?:\/\/[^\s<>"'\]),]+/

/**
 * Undoes RFC 5545 line folding. A line beginning with a space or tab continues
 * the line before it, which is how long joining URLs arrive in real invites.
 */
function unfold(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(raw) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
      continue
    }
    lines.push(raw)
  }
  return lines.filter((line) => line.length > 0)
}

/** Index of the first character not inside a quoted parameter value. */
function unquotedIndexOf(line: string, characters: string): number {
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && characters.includes(character)) return index
  }
  return -1
}

function unescapeText(value: string): string {
  return value.replace(/\\([;,nN])/g, (_match, character: string) =>
    character === 'n' || character === 'N' ? '\n' : character,
  )
}

function parseProperty(line: string): IcsProperty | null {
  const colon = unquotedIndexOf(line, ':')
  if (colon <= 0) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const params = new Map<string, string>()

  let name = head
  const firstSemicolon = unquotedIndexOf(head, ';')
  if (firstSemicolon >= 0) {
    name = head.slice(0, firstSemicolon)
    let rest = head.slice(firstSemicolon + 1)
    while (rest.length > 0) {
      const nextSemicolon = unquotedIndexOf(rest, ';')
      const pair = nextSemicolon >= 0 ? rest.slice(0, nextSemicolon) : rest
      rest = nextSemicolon >= 0 ? rest.slice(nextSemicolon + 1) : ''
      const equals = pair.indexOf('=')
      if (equals <= 0) continue
      params.set(
        pair.slice(0, equals).trim().toUpperCase(),
        pair.slice(equals + 1).trim().replace(/^"|"$/g, ''),
      )
    }
  }

  return { name: name.trim().toUpperCase(), params, value }
}

/**
 * Offset of a named IANA zone at an instant, in milliseconds. Returns null when
 * the runtime does not know the zone, which is the signal to treat the time as
 * floating rather than to guess.
 */
function zoneOffsetMs(zone: string, at: Date): number | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at)
  } catch {
    return null
  }

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN)

  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  )
  return Number.isNaN(asUtc) ? null : asUtc - at.getTime()
}

/**
 * Resolves a wall-clock reading in a named zone to an instant. Resolving needs
 * the offset, and the offset needs the instant, so this settles the circle with
 * a second pass — which is what makes times near a daylight-saving change land
 * on the right side of it.
 */
function zonedInstant(zone: string, parts: number[]): number | null {
  const [year, month, day, hour, minute, second] = parts
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstOffset = zoneOffsetMs(zone, new Date(wallAsUtc))
  if (firstOffset === null) return null
  const secondOffset = zoneOffsetMs(zone, new Date(wallAsUtc - firstOffset))
  return wallAsUtc - (secondOffset ?? firstOffset)
}

/**
 * Reads DTSTART/DTEND in the three forms invites use: UTC (`…Z`), a named zone
 * (`TZID=`), and floating local time. A date-only value becomes local midnight,
 * following the same browser-local rule the rest of the app applies to dates.
 */
function parseIcsDate(property: IcsProperty): string | null {
  const value = property.value.trim()
  const zone = property.params.get('TZID')

  const dateTime = DATE_TIME.exec(value)
  if (dateTime) {
    const parts = dateTime.slice(1, 7).map(Number)
    const [year, month, day, hour, minute, second] = parts
    if (dateTime[7] === 'Z') {
      return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
    }
    if (zone) {
      const instant = zonedInstant(zone, parts)
      if (instant !== null) return new Date(instant).toISOString()
    }
    return new Date(year, month - 1, day, hour, minute, second).toISOString()
  }

  const dateOnly = DATE_ONLY.exec(value)
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1, 4).map(Number)
    return new Date(year, month - 1, day).toISOString()
  }

  return null
}

/** Reads the DURATION subset emitters pair with DTSTART when they omit DTEND. */
function parseIcsDuration(value: string): number | null {
  const match = DURATION.exec(value.trim())
  if (!match) return null
  const [sign, weeks, days, hours, minutes, seconds] = match.slice(1)
  const total =
    (Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 86_400_000
    + Number(hours ?? 0) * 3_600_000
    + Number(minutes ?? 0) * 60_000
    + Number(seconds ?? 0) * 1000
  if (total === 0) return null
  return sign === '-' ? -total : total
}

function firstHttpUrl(value: string): string | null {
  return HTTP_URL.exec(value)?.[0] ?? null
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Reads every VEVENT in an iCalendar file. Events are returned as parsed, so a
 * caller can report an invite it cannot use rather than have it vanish: an
 * event without `starts_at` carried no readable start time.
 */
export function parseIcsEvents(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let calendarCancelled = false
  let current: IcsProperty[] | null = null

  for (const line of unfold(text)) {
    const property = parseProperty(line)
    if (!property) continue

    if (property.name === 'BEGIN' && property.value.trim().toUpperCase() === 'VEVENT') {
      current = []
      continue
    }
    if (property.name === 'END' && property.value.trim().toUpperCase() === 'VEVENT') {
      if (current) events.push(buildEvent(current))
      current = null
      continue
    }
    if (current) {
      current.push(property)
      continue
    }
    // A cancellation is announced once for the whole file, outside the event.
    if (property.name === 'METHOD' && property.value.trim().toUpperCase() === 'CANCEL') {
      calendarCancelled = true
    }
  }

  return calendarCancelled ? events.map((event) => ({ ...event, cancelled: true })) : events
}

function buildEvent(properties: IcsProperty[]): IcsEvent {
  const find = (name: string): IcsProperty | undefined =>
    properties.find((property) => property.name === name)

  const start = find('DTSTART')
  const end = find('DTEND')
  const duration = find('DURATION')
  const description = find('DESCRIPTION')
  const location = find('LOCATION')

  const startsAt = start ? parseIcsDate(start) : null
  let endsAt = end ? parseIcsDate(end) : null
  if (!endsAt && startsAt && duration) {
    const span = parseIcsDuration(duration.value)
    if (span !== null && span > 0) endsAt = new Date(Date.parse(startsAt) + span).toISOString()
  }

  const sequence = Number(find('SEQUENCE')?.value.trim())
  const status = find('STATUS')?.value.trim().toUpperCase()

  return {
    uid: optionalText(find('UID')?.value),
    summary: optionalText(unescapeText(find('SUMMARY')?.value ?? '')),
    starts_at: startsAt,
    ends_at: endsAt,
    location: optionalText(unescapeText(location?.value ?? '')),
    url:
      firstHttpUrl(find('URL')?.value ?? '')
      ?? firstHttpUrl(find('X-GOOGLE-CONFERENCE')?.value ?? '')
      ?? firstHttpUrl(unescapeText(description?.value ?? '')),
    sequence: Number.isInteger(sequence) && sequence >= 0 ? sequence : 0,
    cancelled: status === 'CANCELLED',
  }
}
