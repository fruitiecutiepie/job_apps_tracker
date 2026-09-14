import { useEffect, useState } from 'react'
import { FlaskConical, FolderOpen, HardDrive, TriangleAlert, Upload } from 'lucide-react'

import { backend } from './backend'
import type { StorageConnection } from './backend'
import { demoSiteUrl, trackerSiteUrl } from './siteLinks'

/**
 * Follows where the data is being saved. Only the static build has anything to follow:
 * the dev server writes a fixed path, so `connection` stays null there and every caller
 * renders nothing.
 */
export function useStorageConnection(): StorageConnection | null {
  const storage = backend.storage
  const [connection, setConnection] = useState<StorageConnection | null>(
    storage ? storage.connection() : null,
  )

  // `subscribe` reports the current connection straight away, so nothing that changed
  // between this render and this effect is missed.
  useEffect(() => storage?.subscribe(setConnection), [storage])

  return connection
}

function describe(connection: StorageConnection): string {
  switch (connection.kind) {
    case 'connected':
      return `Saving to ${connection.name}`
    case 'needs-permission':
      return `Reconnect ${connection.name}`
    case 'disconnected':
      return 'Choose a folder'
    case 'unsupported':
      return 'Saved in this browser'
  }
}

export interface StorageStatusProps {
  connection: StorageConnection
  onConnect: () => void
  onReconnect: () => void
}

/**
 * The topbar control. Its job is to make the one thing that matters legible at a glance:
 * whether what you type is reaching a folder you can find again, or only this browser.
 */
export function StorageStatus({ connection, onConnect, onReconnect }: StorageStatusProps) {
  const label = describe(connection)

  if (connection.kind === 'unsupported') {
    return (
      <p
        className="storage-status storage-status--inert"
        title="This browser cannot save into a folder. Export a file to keep a copy."
      >
        <HardDrive aria-hidden="true" size={16} />
        <span>{label}</span>
      </p>
    )
  }

  const needsAttention = connection.kind !== 'connected'
  return (
    <button
      className={`storage-status${needsAttention ? ' storage-status--attention' : ''}`}
      onClick={connection.kind === 'needs-permission' ? onReconnect : onConnect}
      title={
        connection.kind === 'connected'
          ? `Every change is written to ${connection.name}. Click to pick a different folder.`
          : 'Pick a folder so every change is written to it as well as to this browser.'
      }
      type="button"
    >
      {needsAttention ? (
        <TriangleAlert aria-hidden="true" size={16} />
      ) : (
        <FolderOpen aria-hidden="true" size={16} />
      )}
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

/** The first thing a visitor sees, before there is any data to look at. */
export function StorageIntro({
  connection,
  onConnect,
  onImport,
  onDismiss,
  showDemoLink,
}: StorageIntroProps) {
  return (
    <section aria-labelledby="storage-intro-heading" className="storage-intro">
      <h2 id="storage-intro-heading">Your applications, on your machine</h2>
      <p>
        Nothing here is uploaded anywhere. Every change is saved in this browser straight
        away
        {connection.kind === 'unsupported'
          ? '. This browser cannot write to a folder, so export a file when you want a copy you can keep.'
          : ', and into a folder you choose as well, so the data stays yours when the browser forgets it.'}
      </p>
      <div className="storage-intro__actions">
        {connection.kind !== 'unsupported' && (
          <button className="button button--primary" onClick={onConnect} type="button">
            <FolderOpen aria-hidden="true" size={16} /> Choose a folder
          </button>
        )}
        <button className="button" onClick={onImport} type="button">
          <Upload aria-hidden="true" size={16} /> Import a file
        </button>
        <button className="button button--quiet" onClick={onDismiss} type="button">
          Start fresh
        </button>
      </div>
      {showDemoLink && (
        <p className="storage-intro__aside">
          Not sure yet? <a href={demoSiteUrl()}>Look around the demo</a> — nineteen
          fictional applications, kept well away from this one.
        </p>
      )}
    </section>
  )
}
