import fs from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

import { MAX_REQUEST_BYTES } from '../src/feedback/report'
import { FEEDBACK_ROUTE, handleFeedbackRequest, type FeedbackStore } from '../src/feedback/server'

/*
 * What the Worker does in production, done by the dev and preview servers so the panel has
 * somewhere to send while the app is run locally. Reports land in `data/feedback/` — one
 * folder for both profiles, since a report is about the app and not about either tracker —
 * and the inbox page reads them back with the token below.
 */
const DEFAULT_TOKEN = 'local'

function folderStore(root: string): FeedbackStore {
  const resolve = (key: string) => {
    const file = path.resolve(root, key)
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing key outside the folder: ${key}`)
    return file
  }
  const typeFile = (file: string) => `${file}.type`

  async function walk(dir: string): Promise<string[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const found: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) found.push(...(await walk(full)))
      else if (!entry.name.endsWith('.type')) found.push(path.relative(root, full).split(path.sep).join('/'))
    }
    return found
  }

  return {
    put: async (key, body, contentType) => {
      const file = resolve(key)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, body)
      await fs.writeFile(typeFile(file), contentType, 'utf8')
    },
    get: async (key) => {
      const file = resolve(key)
      try {
        const body = new Uint8Array(await fs.readFile(file))
        const contentType = await fs.readFile(typeFile(file), 'utf8').catch(() => 'application/octet-stream')
        return { body, contentType }
      } catch {
        return null
      }
    },
    list: async (prefix) => (await walk(root)).filter((key) => key.startsWith(prefix)),
    delete: async (key) => {
      const file = resolve(key)
      await fs.rm(file, { force: true })
      await fs.rm(typeFile(file), { force: true })
    },
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer | 'too-large'> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_REQUEST_BYTES) return 'too-large'
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function feedbackMiddleware(root: string): Connect.NextHandleFunction {
  const store = folderStore(path.join(root, 'data', 'feedback'))
  const adminToken = process.env.FEEDBACK_ADMIN_TOKEN || DEFAULT_TOKEN

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (!req.url?.includes(FEEDBACK_ROUTE)) {
      next()
      return
    }
    void (async () => {
      const method = req.method ?? 'GET'
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
      if (body === 'too-large') {
        res.statusCode = 413
        res.end('The report is too large.')
        return
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
      }
      const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      })
      const response = await handleFeedbackRequest(request, { store, adminToken })
      if (!response) {
        next()
        return
      }
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    })().catch((error: unknown) => {
      res.statusCode = 500
      res.end(error instanceof Error ? error.message : 'Feedback route failed.')
    })
  }
}

export function feedbackPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'feedback-route',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(feedbackMiddleware(root))
      server.httpServer?.once('listening', () => {
        const token = process.env.FEEDBACK_ADMIN_TOKEN ? 'FEEDBACK_ADMIN_TOKEN' : `"${DEFAULT_TOKEN}"`
        server.config.logger.info(`  Feedback inbox: ${FEEDBACK_ROUTE}/inbox (token ${token})`)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(feedbackMiddleware(root))
    },
  }
}
