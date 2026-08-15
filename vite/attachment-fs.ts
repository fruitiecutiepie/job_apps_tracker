import fs from 'node:fs'
import path from 'node:path'

import { isSafeAttachmentId } from '../src/domain/attachmentPaths'

export function attachmentsRootDir(dataDir: string): string {
  return path.join(dataDir, 'attachments')
}

export function resolveAttachmentFilePath(
  dataDir: string,
  applicationId: string,
  attachmentId: string,
): string | null {
  if (!isSafeAttachmentId(applicationId) || !isSafeAttachmentId(attachmentId)) return null

  const rootDir = path.resolve(attachmentsRootDir(dataDir))
  const filePath = path.resolve(rootDir, applicationId, attachmentId)
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) return null
  return filePath
}

export function resolveApplicationAttachmentsDir(dataDir: string, applicationId: string): string | null {
  if (!isSafeAttachmentId(applicationId)) return null

  const rootDir = path.resolve(attachmentsRootDir(dataDir))
  const dirPath = path.resolve(rootDir, applicationId)
  if (dirPath !== rootDir && !dirPath.startsWith(`${rootDir}${path.sep}`)) return null
  return dirPath
}

export function removeAttachmentsRoot(dataDir: string): void {
  const rootDir = path.resolve(attachmentsRootDir(dataDir))
  if (fs.existsSync(rootDir)) {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
}
