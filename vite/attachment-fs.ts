import fs from 'node:fs'
import path from 'node:path'

import { isSafeAttachmentId } from '../src/domain/attachmentPaths'

export function attachmentsRootDir(root: string): string {
  return path.join(root, 'data', 'attachments')
}

export function resolveAttachmentFilePath(
  root: string,
  applicationId: string,
  attachmentId: string,
): string | null {
  if (!isSafeAttachmentId(applicationId) || !isSafeAttachmentId(attachmentId)) return null

  const rootDir = path.resolve(attachmentsRootDir(root))
  const filePath = path.resolve(rootDir, applicationId, attachmentId)
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) return null
  return filePath
}

export function resolveApplicationAttachmentsDir(root: string, applicationId: string): string | null {
  if (!isSafeAttachmentId(applicationId)) return null

  const rootDir = path.resolve(attachmentsRootDir(root))
  const dirPath = path.resolve(rootDir, applicationId)
  if (dirPath !== rootDir && !dirPath.startsWith(`${rootDir}${path.sep}`)) return null
  return dirPath
}

export function removeAttachmentsRoot(root: string): void {
  const rootDir = path.resolve(attachmentsRootDir(root))
  if (fs.existsSync(rootDir)) {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
}
