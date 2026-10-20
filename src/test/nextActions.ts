import type { NextAction } from '../domain'

/**
 * One next action as a fixture override, spread into an application: `...task('Follow up')`.
 * The id is derived from the text so a test can name the task it means without minting one.
 */
export function task(action: string, at: string | null = null): { next_actions: NextAction[] } {
  return { next_actions: [{ id: `task-${action}`, action, at }] }
}
