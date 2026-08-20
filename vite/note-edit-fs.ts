import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { isSafeAttachmentId } from '../src/domain/attachmentPaths'
import os from 'node:os'

import {
  editorUrlFor,
  looksLikeRemoteHost,
  resolveEditorTarget,
  stageNoteEditFilename,
} from '../src/domain/noteEditingPaths'
import { isStateId } from '../src/domain/states'

export function editingRootDir(dataDir: string): string {
  return path.join(dataDir, 'editing')
}

/** Resolves the scratch file for one stage, refusing anything that escapes the editing root. */
export function resolveStageNoteEditPath(
  dataDir: string,
  applicationId: string,
  state: string,
): string | null {
  if (!isSafeAttachmentId(applicationId) || !isStateId(state)) return null

  const rootDir = path.resolve(editingRootDir(dataDir))
  const filePath = path.resolve(rootDir, applicationId, stageNoteEditFilename(state))
  if (!filePath.startsWith(`${rootDir}${path.sep}`)) return null
  return filePath
}

export function removeEditingRoot(dataDir: string): void {
  const rootDir = path.resolve(editingRootDir(dataDir))
  if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
}

export interface LaunchResult {
  /** Command that was spawned, or the scheme of the URL handed to the browser. */
  editor: string
  source: 'env' | 'os' | 'url'
  /** Present when the browser should open this instead of the server spawning anything. */
  openUrl?: string
  /** Set when the server appears to be on a different machine from the browser. */
  host?: string
}

/**
 * Either spawns an editor here, or returns a URL for the browser to open so an editor on
 * the viewing machine handles it.
 *
 * A spawned child is detached with ignored stdio: the dev server owns the only TTY, so a
 * terminal editor has nowhere to draw. GUI commands work; vim does not.
 */
export function launchEditor(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): LaunchResult {
  const target = resolveEditorTarget(env, platform)

  if (target.kind === 'url') {
    const openUrl = editorUrlFor(target.template, filePath)
    return {
      editor: openUrl.split(':')[0],
      source: 'url',
      openUrl,
    }
  }

  const child = spawn(target.command, [...target.args, filePath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', () => {
    // A missing editor must not take the dev server down with it; the UI reports the path
    // it wrote so the note is still reachable by hand.
  })
  child.unref()

  return {
    editor: target.command,
    source: target.source,
    // Worth saying out loud: this opened somewhere other than where you are looking.
    host: looksLikeRemoteHost(env) ? os.hostname() : undefined,
  }
}
