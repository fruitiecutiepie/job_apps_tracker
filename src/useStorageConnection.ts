import { useEffect, useState } from 'react'

import { backend } from './backend'
import type { StorageConnection } from './backend'

/**
 * Follows where the data is being saved. Only the static build has anything to follow:
 * the dev server writes a fixed path, so `connection` stays null there and every caller
 * renders nothing.
 *
 * In its own module rather than beside the components that read it, because a file
 * exporting both a hook and a component is a file Fast Refresh has to remount whole.
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
