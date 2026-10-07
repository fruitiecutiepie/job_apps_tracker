import { Download, FlaskConical, FolderOpen, HardDrive, Plus, TriangleAlert, Upload } from 'lucide-react'

import type { StorageConnection, StorageState } from './backend'
import { demoSiteUrl, trackerSiteUrl } from './siteLinks'
import { formatShortDate } from './views/viewUtils'

function describe({ connection, unbackedSince, saving }: StorageState): string {
  switch (connection.kind) {
    case 'connected':
      // Present tense only while a write is in flight: a label that always said "Saving"
      // read as a save that never finished.
      return saving ? `Saving to ${connection.name}…` : `Saved to ${connection.name}`
    case 'needs-permission':
      return `Reconnect ${connection.name}`
    case 'disconnected':
      return unbackedSince === null ? 'Saved in this browser' : 'Save to a folder'
    case 'unsupported':
      return unbackedSince === null ? 'Saved in this browser' : 'Export a backup'
  }
}

function explain({ connection, unbackedSince }: StorageState): string {
  const backlog = unbackedSince === null
    ? null
    : `Changes since ${formatShortDate(unbackedSince)} are only in this browser, and clearing your browsing data would delete them.`
  switch (connection.kind) {
    case 'connected':
      return `Every change is saved to ${connection.name}. Click to pick a different folder.`
    case 'needs-permission':
      return [backlog, `Click to keep saving to ${connection.name}.`].filter(Boolean).join(' ')
    case 'disconnected':
      return [backlog, 'Click to save to a folder on your computer as well.']
        .filter(Boolean)
        .join(' ')
    case 'unsupported':
      return backlog === null
        ? 'Everything is saved in this browser.'
        : `${backlog} Click to download a copy.`
  }
}

export interface StorageStatusProps {
  state: StorageState
  onConnect: () => void
  onReconnect: () => void
  onExport: () => void
}

/**
 * The topbar control. Its job is to make the one thing that matters legible at a glance:
 * whether what you type is reaching a file you can find again, or only this browser.
 *
 * It stays quiet while nothing is at risk and asks for attention only once a change exists
 * only here — the backlog — offering whichever fix this browser has: a folder where one can
 * be written, and an export where it cannot. Asking before there is anything to lose
 * would be asking someone who came to track job applications to think about storage first.
 */
export function StorageStatus({ state, onConnect, onReconnect, onExport }: StorageStatusProps) {
  const { connection, unbackedSince } = state
  const label = describe(state)
  const title = explain(state)

  if (connection.kind === 'unsupported' && unbackedSince === null) {
    return (
      <p className="storage-status storage-status--inert" title={title}>
        <HardDrive aria-hidden="true" size={16} />
        <span>{label}</span>
      </p>
    )
  }

  const onClick = connection.kind === 'unsupported'
    ? onExport
    : connection.kind === 'needs-permission' ? onReconnect : onConnect
  const needsAttention = connection.kind === 'needs-permission' || unbackedSince !== null
  const icon = connection.kind === 'unsupported'
    ? <Download aria-hidden="true" size={16} />
    : needsAttention
      ? <TriangleAlert aria-hidden="true" size={16} />
      : connection.kind === 'connected'
        ? <FolderOpen aria-hidden="true" size={16} />
        : <HardDrive aria-hidden="true" size={16} />
  return (
    <button
      className={`storage-status${needsAttention ? ' storage-status--attention' : ''}`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/**
 * Shown for the whole session on the demo site. It stays rather than dismisses because the
 * thing it is warning about — that this data is fictional and Reset will throw away
 * anything typed into it — is as true on the fortieth screen as on the first.
 */
export function DemoBanner() {
  return (
    <aside className="demo-banner">
      <FlaskConical aria-hidden="true" size={16} />
      <p>
        <strong>This is the demo.</strong> Nineteen fictional applications, one in every
        stage, kept separately from anything real. Nothing you write here reaches your own
        tracker.
      </p>
      <a className="button button--quiet" href={trackerSiteUrl()}>
        Open my tracker
      </a>
    </aside>
  )
}

export interface StorageIntroProps {
  connection: StorageConnection
  /** Opens the add form, exactly as the topbar's Add application does. */
  onAdd: (opener: HTMLButtonElement) => void
  onConnect: () => void
  onImport: () => void
  /** Absent on the demo site, which is already the thing the link would lead to. */
  showDemoLink: boolean
}

/**
 * One action brings existing data in, per browser. Where a folder can be written, choosing
 * one both opens and saves — the folder's contents say which — so a separate Import beside
 * it would be a second way to say the same thing. Where it cannot, Import is that action.
 * An export file is still taken by drop anywhere, which the line under the buttons says.
 *
 * The empty tracker's first screen. Someone arriving here came to track job applications,
 * so that is the one thing it offers up front. A folder is an option where the browser
 * can write one, never the price of starting — but an option is only worth taking if the
 * reason for it is on screen, so the one way this data can be lost is said in a line of
 * its own before anything is asked.
 *
 * It has no dismiss: it is what an empty tracker looks like, and it goes when the first
 * application arrives.
 */
export function StorageIntro({
  connection,
  onAdd,
  onConnect,
  onImport,
  showDemoLink,
}: StorageIntroProps) {
  const canConnect = connection.kind !== 'unsupported'
  return (
    <section aria-labelledby="storage-intro-heading" className="storage-intro">
      <h2 id="storage-intro-heading">Track your job applications</h2>
      <p>
        Nothing is uploaded and there is no account: your applications are saved in this
        browser. Clearing your browsing data or closing a private window deletes them,{' '}
        {canConnect
          ? 'so keep them in a folder on your computer as well.'
          : 'so export a backup now and then — the top bar will remind you.'}
      </p>
      <div className="storage-intro__actions">
        <button
          className="button button--primary"
          onClick={(event) => onAdd(event.currentTarget)}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Add your first application
        </button>
        {canConnect ? (
          <button className="button" onClick={onConnect} type="button">
            <FolderOpen aria-hidden="true" size={16} /> Choose a folder
          </button>
        ) : (
          <button className="button" onClick={onImport} type="button">
            <Upload aria-hidden="true" size={16} /> Import a file
          </button>
        )}
      </div>
      <p className="storage-intro__hint">
        {canConnect
          ? 'A folder with your tracker in it opens it; an empty folder starts saving there. Have an exported file instead? Drop it anywhere on this page.'
          : 'Have an exported file? You can also drop it anywhere on this page.'}
      </p>
      {showDemoLink && (
        <p className="storage-intro__aside">
          Just looking? <a href={demoSiteUrl()}>Try the demo</a>.
        </p>
      )}
    </section>
  )
}
