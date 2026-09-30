import { Download, FlaskConical, FolderOpen, HardDrive, TriangleAlert, Upload } from 'lucide-react'

import type { StorageConnection, StorageState } from './backend'
import { demoSiteUrl, trackerSiteUrl } from './siteLinks'
import { formatShortDate } from './views/viewUtils'

function describe({ connection, unbackedSince }: StorageState): string {
  switch (connection.kind) {
    case 'connected':
      return `Saving to ${connection.name}`
    case 'needs-permission':
      return `Reconnect ${connection.name}`
    case 'disconnected':
      return 'Choose a folder'
    case 'unsupported':
      return unbackedSince === null ? 'Saved in this browser' : 'Export a backup'
  }
}

function explain({ connection, unbackedSince }: StorageState): string {
  const backlog = unbackedSince === null
    ? null
    : `Changes since ${formatShortDate(unbackedSince)} are only in this browser, which can clear them.`
  switch (connection.kind) {
    case 'connected':
      return `Every change is written to ${connection.name}. Click to pick a different folder.`
    case 'needs-permission':
      return [backlog, `Click to let this site write to ${connection.name} again; it catches up at once.`]
        .filter(Boolean)
        .join(' ')
    case 'disconnected':
      return [backlog, 'Pick a folder so every change is written to it as well as to this browser.']
        .filter(Boolean)
        .join(' ')
    case 'unsupported':
      return backlog === null
        ? 'This browser cannot save into a folder, so this will say when there is something to export.'
        : `${backlog} Click to export a file you can keep.`
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
 * whether what you type is reaching a file you can find again, or only this browser — and,
 * where the browser cannot write a file on its own, whether there is anything to export.
 *
 * That last case is the one a reminder exists for. A browser with no folder support
 * saves every change to its own storage and cannot do better, so the risk is not an
 * unsaved edit but an export nobody remembered to make. The pill turns into the Export
 * button the moment a change exists only here, and stays one until a file has it.
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
  const needsAttention = connection.kind !== 'connected'
  const icon = connection.kind === 'unsupported'
    ? <Download aria-hidden="true" size={16} />
    : needsAttention
      ? <TriangleAlert aria-hidden="true" size={16} />
      : <FolderOpen aria-hidden="true" size={16} />
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
  onConnect: () => void
  onImport: () => void
  onDismiss: () => void
  /** Absent on the demo site, which is already the thing the link would lead to. */
  showDemoLink: boolean
}

/**
 * The first thing a visitor sees, before there is any data to look at.
 *
 * Where the browser can write a folder, choosing one is the first step rather than one
 * option of three: it is the only arrangement in which nothing has to be remembered
 * later, and the moment before anything is typed is the only moment it costs nothing.
 * Skipping it is still allowed, but the button says what skipping means.
 *
 * Where it cannot, asking for a file up front would buy nothing — the browser could not
 * write to it afterwards — so the intro says so plainly and hands the job to the topbar,
 * which turns into Export as soon as there is something only this browser holds.
 */
export function StorageIntro({
  connection,
  onConnect,
  onImport,
  onDismiss,
  showDemoLink,
}: StorageIntroProps) {
  const canConnect = connection.kind !== 'unsupported'
  return (
    <section aria-labelledby="storage-intro-heading" className="storage-intro">
      {canConnect ? (
        <>
          <h2 id="storage-intro-heading">First, choose where this is saved</h2>
          <p>
            Pick a folder and every change is written to a tracker.json in it
            as you make it: a file on your disk you can back up, sync, or open anywhere.
            Nothing is uploaded. Already have one? Choose the folder it is in.
          </p>
        </>
      ) : (
        <>
          <h2 id="storage-intro-heading">Your applications, kept in this browser</h2>
          <p>
            Nothing is uploaded. Every change is saved in this browser as you make it, but
            this browser cannot write to a file on its own — so the top bar will say when
            you have changes to export, and Export gives you a file you can import anywhere.
            Chrome and Edge can save to a folder as you go instead.
          </p>
        </>
      )}
      <div className="storage-intro__actions">
        {canConnect ? (
          <>
            <button className="button button--primary" onClick={onConnect} type="button">
              <FolderOpen aria-hidden="true" size={16} /> Choose a folder
            </button>
            <button className="button" onClick={onImport} type="button">
              <Upload aria-hidden="true" size={16} /> Import a file
            </button>
            <button className="button button--quiet" onClick={onDismiss} type="button">
              Keep it in this browser
            </button>
          </>
        ) : (
          <>
            <button className="button button--primary" onClick={onDismiss} type="button">
              Start
            </button>
            <button className="button" onClick={onImport} type="button">
              <Upload aria-hidden="true" size={16} /> Import a file
            </button>
          </>
        )}
      </div>
      {canConnect && (
        <p className="storage-intro__note">
          Kept only in this browser, your data goes if the browser&apos;s site data is
          cleared. The top bar keeps offering a folder until one is chosen.
        </p>
      )}
      {showDemoLink && (
        <p className="storage-intro__aside">
          Not sure yet? <a href={demoSiteUrl()}>Look around the demo</a> — nineteen
          fictional applications, kept well away from this one.
        </p>
      )}
    </section>
  )
}
