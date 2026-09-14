import { useEffect, useRef, useState } from 'react'

/** What a tracker export can arrive as. Anything else is refused with a reason. */
const ACCEPTED = ['.json', '.zip']

function isTrackerFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED.some((extension) => name.endsWith(extension))
}

/*
 * Whether this drag is carrying files from outside the page.
 *
 * The app drags things around internally — Kanban cards and stage-note tabs — and those
 * must pass through untouched: no overlay, no `preventDefault`, nothing. A drag from the
 * desktop is the only one that lists `Files`, which is what separates them.
 */
function carriesFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes('Files'))
}

function trackerFileIn(list: FileList | null | undefined): File | 'wrong-type' | null {
  const files = Array.from(list ?? [])
  if (files.length === 0) return null
  return files.find(isTrackerFile) ?? 'wrong-type'
}

export interface FileImportHandlers {
  /** A tracker file arrived. */
  onFile: (file: File) => void
  /** Something arrived that could not be one. */
  onRefused: (message: string) => void
}

/**
 * Accepts a tracker export dropped anywhere on the window, or pasted.
 *
 * Returns whether a file is currently being dragged over the page, so the caller can say
 * so on screen — a drop target nobody can see is one nobody will try.
 */
export function useFileImport({ onFile, onRefused }: FileImportHandlers): boolean {
  const [dragging, setDragging] = useState(false)
  /*
   * `dragenter` and `dragleave` both fire as the pointer crosses every child element, so
   * a boolean flickers off the moment the drag moves between two nodes. Counting entries
   * against leaves is what makes "still over the window" answerable.
   */
  const depth = useRef(0)
  /*
   * The window listeners are registered once and must not be torn down and rebuilt every
   * render, so they reach the current callbacks through a ref rather than closing over
   * whichever pair existed when they were attached.
   */
  const handlers = useRef({ onFile, onRefused })
  useEffect(() => {
    handlers.current = { onFile, onRefused }
  })

  useEffect(() => {
    const refuseOrOpen = (found: File | 'wrong-type' | null) => {
      if (found === null) return
      if (found === 'wrong-type') {
        handlers.current.onRefused('That is not a tracker export. Drop a .json or .zip file.')
        return
      }
      handlers.current.onFile(found)
    }

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      depth.current += 1
      setDragging(true)
    }

    /*
     * Without `preventDefault` on dragover the browser refuses the drop and opens the file
     * in the tab instead, replacing the app. It is not decoration; the drop does not
     * happen at all without it.
     */
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }

    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      refuseOrOpen(trackerFileIn(event.dataTransfer?.files))
    }

    /*
     * Only a pasted *file* is an import. Pasted text is left alone: this listener is on
     * the window, and quietly deciding that what someone pasted into a note was really a
     * command would be the worst kind of surprise.
     */
    const onPaste = (event: ClipboardEvent) => {
      const found = trackerFileIn(event.clipboardData?.files)
      if (found === null) return
      event.preventDefault()
      refuseOrOpen(found)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  return dragging
}
