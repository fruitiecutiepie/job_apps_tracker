import { useEffect, useState } from 'react'

import { backend } from './backend'
import type { StorageState } from './backend'

/**
 * Follows where the data is being saved, and whether any of it is only in this browser.
 * Only the static build has anything to follow: the dev server writes a fixed path, so
 * the state stays null there and every caller renders nothing.
 *
 * In its own module rather than beside the components that read it, because a file
 * exporting both a hook and a component is a file Fast Refresh has to remount whole.
 */
export function useStorageState(): StorageState | null {
  const storage = backend.storage
  const [state, setState] = useState<StorageState | null>(storage ? storage.state() : null)

  // `subscribe` reports the current state straight away, so nothing that changed between
  // this render and this effect is missed.
  useEffect(() => storage?.subscribe(setState), [storage])

  return state
}
