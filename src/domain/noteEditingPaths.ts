import { isStateId } from './states'
import type { StateId } from './types'

/** Local-server route for handing a stage note to an external editor and reading it back. */
export const NOTE_EDIT_ROUTE = '/__note-edit'

export const MAX_STAGE_NOTE_BYTES = 256 * 1024

/**
 * Scratch filename for one stage of one application. Derived from the state alone so the
 * server can find the file again on a later read or delete without the client tracking it.
 */
export function stageNoteEditFilename(state: StateId): string {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  return `${state}.md`
}

export function stageNoteEditUrl(applicationId: string, state: StateId): string {
  return `${NOTE_EDIT_ROUTE}/${applicationId}/${state}`
}

export interface EditorCommand {
  command: string
  args: string[]
  /** Where the choice came from: a configured editor, or the platform's own opener. */
  source: 'env' | 'os'
}

/**
 * Where the editor should open. A spawned command always runs on the machine hosting the
 * dev server; a URL is handed to the browser instead, so an installed editor on the
 * machine viewing the page handles it. The second form is the only one that works when
 * the app is reached over a tunnel from another host.
 */
export type EditorTarget =
  | { kind: 'command'; command: string; args: string[]; source: 'env' | 'os' }
  | { kind: 'url'; template: string }

/** Environment hints that the dev server is not on the machine looking at the page. */
const REMOTE_HINTS = [
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'CODESPACES',
  'REMOTE_CONTAINERS',
  'VSCODE_IPC_HOOK_CLI',
] as const

export function looksLikeRemoteHost(env: Record<string, string | undefined>): boolean {
  return REMOTE_HINTS.some((name) => Boolean(env[name]?.trim()))
}

export function resolveEditorTarget(
  env: Record<string, string | undefined>,
  platform: string,
): EditorTarget {
  const template = env.TRACKER_EDITOR_URL?.trim()
  if (template) return { kind: 'url', template }
  return { kind: 'command', ...resolveEditorCommand(env, platform) }
}

/**
 * Fills the configured template with the file's absolute path. `encodeURI` is used rather
 * than `encodeURIComponent` so path separators survive, which schemes like
 * `vscode://vscode-remote/ssh-remote+host/abs/path` require.
 */
export function editorUrlFor(template: string, absolutePath: string): string {
  if (!template.includes('{path}')) return `${template}${encodeURI(absolutePath)}`
  return template.replaceAll('{path}', encodeURI(absolutePath))
}

/**
 * Chooses what to launch. The command never comes from a request—only from the
 * environment or the platform opener—so a stray POST cannot pick what gets executed.
 *
 * `VISUAL` wins over `EDITOR` by convention: it names the editor fit for a windowed
 * session, which is the only kind a detached process can be.
 */
export function resolveEditorCommand(
  env: Record<string, string | undefined>,
  platform: string,
): EditorCommand {
  const configured = (env.VISUAL ?? env.EDITOR ?? '').trim()
  if (configured) {
    const parts = configured.split(/\s+/)
    return { command: parts[0], args: parts.slice(1), source: 'env' }
  }
  if (platform === 'darwin') return { command: 'open', args: [], source: 'os' }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', ''], source: 'os' }
  return { command: 'xdg-open', args: [], source: 'os' }
}
