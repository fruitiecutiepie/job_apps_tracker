/**
 * What lets two tabs holding one tracker stay one tracker: a lock so their writes take
 * turns, and a channel so each hears when the other has written.
 *
 * Both are behind interfaces of their own because the browser's versions — the Web Locks
 * API and `BroadcastChannel` — span tabs, which a test cannot open. A test hands two
 * backends one in-memory pair instead and they behave as two tabs would.
 */
export interface TabLock {
  /** Runs `task` while no other tab holds `name`. */
  run<T>(name: string, task: () => Promise<T>): Promise<T>
}

export type TabMessage =
  /** A newer document is stored; read it. */
  | { type: 'document' }
  /** The folder, the backlog or the name changed; re-read them. */
  | { type: 'storage' }
  /** The tracker was removed; `next` is the one the removing tab opened. */
  | { type: 'removed'; next: string | null }

export interface TabChannel {
  post(message: TabMessage): void
  listen(listener: (message: TabMessage) => void): () => void
  /** Lets go of a channel opened only to say one thing. */
  close?(): void
}

/*
 * Without the Web Locks API — older browsers, jsdom — a tab can only take turns with
 * itself, which its own write queue already does. Writes from two such tabs can still
 * cross; the document's revision is what lets the slower one notice and rebase.
 */
export function webLocks(): TabLock {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return { run: (_name, task) => task() }
  return { run: (name, task) => locks.request(name, task) as Promise<Awaited<ReturnType<typeof task>>> }
}

export function broadcastChannel(name: string): TabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(name)
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
    listen(listener) {
      const onMessage = (event: MessageEvent) => listener(event.data as TabMessage)
      channel.addEventListener('message', onMessage)
      return () => channel.removeEventListener('message', onMessage)
    },
  }
}
