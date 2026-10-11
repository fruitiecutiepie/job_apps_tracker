import { useEffect, useRef } from 'react'

import { isMacPlatform } from './context'
import { describeChange, describeClick, describeError, describeKey } from './steps'

/**
 * Listens to the whole document while `active`, and hands each step it can name to
 * `onStep`. Capture phase, so a control that stops its own event from bubbling — the
 * menus here stop Escape — is still heard.
 */
export function useStepRecorder(active: boolean, onStep: (text: string) => void): void {
  const handler = useRef(onStep)
  useEffect(() => {
    handler.current = onStep
  })

  useEffect(() => {
    if (!active) return
    const mac = isMacPlatform()
    const record = (text: string | null) => {
      if (text) handler.current(text)
    }
    const onClick = (event: MouseEvent) => record(describeClick(event.target))
    const onChange = (event: Event) => record(describeChange(event.target))
    const onKeyDown = (event: KeyboardEvent) => record(describeKey(event, mac))
    const onError = (event: ErrorEvent) => record(describeError(event.message))
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown
      record(describeError(reason instanceof Error ? reason.message : String(reason)))
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('change', onChange, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChange, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [active])
}
