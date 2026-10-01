import type { Application } from './domain'

/**
 * The words around the bulk archive. "Ended" is the app's own word for it: the End menu
 * records rejected, withdrawn and closed, and this archives exactly those — so an accepted
 * job, which nobody ended, is not among them. The confirmation counts what goes by kind
 * and says what stays.
 */

export const ARCHIVE_BULK_LABEL = 'Archive all ended'

/** The menu item, with the count when there is anything to count. */
export function archiveBulkLabel(count: number): string {
  return count === 0 ? ARCHIVE_BULK_LABEL : `${ARCHIVE_BULK_LABEL} (${count})`
}

export const ARCHIVE_BULK_NOTHING = 'Nothing outside the archive has ended'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** What it would take, by the way each one ended, in the End menu's order. */
function breakdown(archivable: readonly Application[]): string[] {
  const count = (outcome: Application['outcome']) =>
    archivable.filter((item) => item.outcome === outcome).length
  return (['rejected', 'withdrawn', 'closed'] as const)
    .map((outcome) => [count(outcome), outcome] as const)
    .filter(([n]) => n > 0)
    .map(([n, outcome]) => `${n} ${outcome}`)
}

/** What it leaves: everything active and not already archived, accepted jobs included. */
function staying(applications: readonly Application[]): number {
  return applications.filter((item) => item.archived_at === null && item.outcome === 'active').length
}

export function archiveBulkConfirmation(
  applications: readonly Application[],
  archivable: readonly Application[],
): string {
  const kept = staying(applications)
  return [
    `Archive ${plural(archivable.length, 'ended application')} — ${list(breakdown(archivable))}?`,
    kept > 0 ? `The ${kept} still active stay where they are.` : 'Nothing is active, so nothing stays.',
    'Archived applications keep their history and outcome, and come back from the Archive filter.',
  ].join('\n\n')
}

export function archiveBulkNotice(archivable: number): string {
  return `Archived ${plural(archivable, 'ended application')}.`
}
