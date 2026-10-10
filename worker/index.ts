import { handleFeedbackRequest, type FeedbackStore } from '../src/feedback/server'

/*
 * The slices of the Workers runtime this file touches, declared here rather than pulled in
 * from `@cloudflare/workers-types`: three methods on a bucket and one on the assets binding
 * do not justify a dependency whose globals would fight the DOM types the app builds with.
 */
interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

interface R2Bucket {
  put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>
    truncated: boolean
    cursor?: string
  }>
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  FEEDBACK: R2Bucket
  /** Set from Bitwarden by `scripts/push-worker-secrets`. Unset, the inbox stays shut. */
  FEEDBACK_ADMIN_TOKEN?: string
}

function bucketStore(bucket: R2Bucket): FeedbackStore {
  return {
    put: async (key, body, contentType) => {
      await bucket.put(key, body, { httpMetadata: { contentType } })
    },
    get: async (key) => {
      const object = await bucket.get(key)
      if (!object) return null
      return {
        body: new Uint8Array(await object.arrayBuffer()),
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      }
    },
    list: async (prefix) => {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix, cursor })
        keys.push(...page.objects.map((object) => object.key))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      return keys
    },
    delete: (key) => bucket.delete(key),
  }
}

/*
 * Only `…/api/*` reaches this script — `run_worker_first` in wrangler.jsonc says so — and
 * everything else is served straight from the built assets. Anything under that prefix
 * that is not a feedback route is handed back to the assets, which answer 404.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await handleFeedbackRequest(request, {
      store: bucketStore(env.FEEDBACK),
      adminToken: env.FEEDBACK_ADMIN_TOKEN || null,
    })
    return response ?? env.ASSETS.fetch(request)
  },
}
