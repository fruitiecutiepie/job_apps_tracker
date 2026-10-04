import { describe, expect, it } from 'vitest'

import { archivableApplications, createDemoDocument } from './domain'
import { archiveBulkConfirmation, archiveBulkLabel, archiveBulkNotice } from './archiveCopy'

const demo = createDemoDocument()

describe('bulk archive copy', () => {
  it('uses the End menu\'s word, and counts only when there is a count', () => {
    expect(archiveBulkLabel(8)).toBe('Archive all ended (8)')
    expect(archiveBulkLabel(0)).toBe('Archive all ended')
  })

  it('says what goes, by how each ended, and what stays', () => {
    const text = archiveBulkConfirmation(demo.applications, archivableApplications(demo))

    expect(text).toMatch(/^Archive 8 ended applications — 6 rejected, 1 withdrawn and 1 closed\?/)
    // Ten active: one at each stage, the accepted job among them — nobody ended that one.
    expect(text).toMatch(/The 10 still active stay where they are\./)
    expect(text).toMatch(/come back from the Archive filter/)
  })

  it('leaves out a kind there is none of, and handles one of one', () => {
    const withdrawn = demo.applications.filter((item) => item.outcome === 'withdrawn')
    expect(archiveBulkConfirmation(withdrawn, withdrawn)).toMatch(
      /^Archive 1 ended application — 1 withdrawn\?\n\nNothing is active, so nothing stays\./,
    )
    expect(archiveBulkNotice(1)).toBe('Archived 1 ended application.')
  })
})
