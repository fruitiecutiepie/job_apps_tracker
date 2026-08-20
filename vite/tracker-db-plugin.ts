import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'

import { MAX_ATTACHMENT_BYTES } from '../src/domain/attachmentPaths'
import { createEmptyDocument, refreshTrackerDatabase } from '../src/domain/database'
import { createDemoDocument } from '../src/domain/demo'
import type { TrackerDatabase } from '../src/domain/types'
import { assertTrackerDocument, parseTrackerDocument } from '../src/domain/validation'
import {
  removeAttachmentsRoot,
  resolveApplicationAttachmentsDir,
  resolveAttachmentFilePath,
} from './attachment-fs'
import { resolveTrackerProfile, trackerFilePaths, type TrackerProfile } from './tracker-paths'

const DB_ROUTE = '/__db'
const ATTACHMENTS_ROUTE = '/__attachments'

function writeDatabaseAtomic(dbPath: string, tmpPath: string, database: TrackerDatabase): void {
  const payload = `${JSON.stringify(database, null, 2)}\n`
  fs.writeFileSync(tmpPath, payload, 'utf8')
  fs.renameSync(tmpPath, dbPath)
}

function readDatabaseFile(dbPath: string): TrackerDatabase {
  const text = fs.readFileSync(dbPath, 'utf8')
  return assertTrackerDocument(parseTrackerDocument(text))
}

function seedDatabase(
  dbPath: string,
  tmpPath: string,
  dataDir: string,
  profile: TrackerProfile,
): TrackerDatabase {
  fs.mkdirSync(dataDir, { recursive: true })
  const document = profile === 'demo' ? createDemoDocument() : createEmptyDocument()
  writeDatabaseAtomic(dbPath, tmpPath, document)
  return document
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

function parseAttachmentRoute(req: IncomingMessage): {
  applicationId?: string
  attachmentId?: string
  filename?: string
} {
  const url = parseUrl(req)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 1 || segments[0] !== '__attachments') return {}

  const filename = url.searchParams.get('filename') ?? undefined
  if (segments.length === 1) return { filename }
  if (segments.length === 2) return { applicationId: segments[1], filename }
  return {
    applicationId: segments[1],
    attachmentId: segments[2],
    filename,
  }
}

function handleTrackerDb(root: string, profile: TrackerProfile, req: IncomingMessage, res: ServerResponse): void {
  const { dataDir, dbPath, tmpPath } = trackerFilePaths(root, profile)

  if (req.method === 'GET') {
    if (!fs.existsSync(dbPath)) {
      const seeded = seedDatabase(dbPath, tmpPath, dataDir, profile)
      sendJson(res, 200, seeded)
      return
    }

    try {
      const database = readDatabaseFile(dbPath)
      const refreshed = refreshTrackerDatabase(database)
      const existing = fs.readFileSync(dbPath, 'utf8')
      const serialized = `${JSON.stringify(refreshed, null, 2)}\n`
      if (serialized !== existing) {
        writeDatabaseAtomic(dbPath, tmpPath, refreshed)
      }
      sendJson(res, 200, refreshed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendText(res, 500, `Saved tracker data is invalid: ${message}`)
    }
    return
  }

  if (req.method === 'PUT') {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8')
        const parsed = assertTrackerDocument(JSON.parse(body) as unknown)
        const refreshed = refreshTrackerDatabase(parsed)
        fs.mkdirSync(dataDir, { recursive: true })
        writeDatabaseAtomic(dbPath, tmpPath, refreshed)
        sendJson(res, 200, refreshed)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendText(res, 400, message)
      }
    })
    return
  }

  if (req.method === 'DELETE') {
    if (profile !== 'demo') {
      sendText(res, 405, 'Demo reset is only available when running the demo profile')
      return
    }

    try {
      removeAttachmentsRoot(dataDir)
      const demo = seedDatabase(dbPath, tmpPath, dataDir, profile)
      sendJson(res, 200, demo)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendText(res, 500, message)
    }
    return
  }

  sendText(res, 405, 'Method not allowed')
}

function handleAttachments(root: string, profile: TrackerProfile, req: IncomingMessage, res: ServerResponse): void {
  const { dataDir } = trackerFilePaths(root, profile)
  const route = parseAttachmentRoute(req)
  const { applicationId, attachmentId, filename } = route

  if (req.method === 'GET' && applicationId && attachmentId) {
    const filePath = resolveAttachmentFilePath(dataDir, applicationId, attachmentId)
    if (!filePath || !fs.existsSync(filePath)) {
      sendText(res, 404, 'Attachment not found')
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    if (filename) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
    }
    fs.createReadStream(filePath).pipe(res)
    return
  }

  if (req.method === 'PUT' && applicationId && attachmentId) {
    const filePath = resolveAttachmentFilePath(dataDir, applicationId, attachmentId)
    if (!filePath) {
      sendText(res, 400, 'Attachment path is invalid')
      return
    }

    let chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_ATTACHMENT_BYTES) {
        if (!tooLarge) {
          tooLarge = true
          chunks = []
          sendText(res, 413, `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit`)
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return
      if (total === 0) {
        sendText(res, 400, 'Attachment file must not be empty')
        return
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, Buffer.concat(chunks))
      sendText(res, 200, 'OK')
    })
    return
  }

  if (req.method === 'DELETE') {
    if (!applicationId) {
      removeAttachmentsRoot(dataDir)
      sendText(res, 200, 'OK')
      return
    }

    if (!attachmentId) {
      const dirPath = resolveApplicationAttachmentsDir(dataDir, applicationId)
      if (!dirPath) {
        sendText(res, 400, 'Application id is invalid')
        return
      }
      if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true })
      sendText(res, 200, 'OK')
      return
    }

    const filePath = resolveAttachmentFilePath(dataDir, applicationId, attachmentId)
    if (!filePath) {
      sendText(res, 400, 'Attachment path is invalid')
      return
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    sendText(res, 200, 'OK')
    return
  }

  sendText(res, 405, 'Method not allowed')
}

function registerTrackerMiddleware(server: ViteDevServer | PreviewServer): void {
  const root = server.config.root
  const profile = resolveTrackerProfile()

  server.middlewares.use((req, res, next) => {
    const pathname = parseUrl(req).pathname
    if (pathname === DB_ROUTE) {
      handleTrackerDb(root, profile, req, res)
      return
    }
    if (pathname === ATTACHMENTS_ROUTE || pathname.startsWith(`${ATTACHMENTS_ROUTE}/`)) {
      handleAttachments(root, profile, req, res)
      return
    }
    next()
  })
}

export function trackerDbPlugin(): Plugin {
  return {
    name: 'tracker-db',
    configureServer(server) {
      registerTrackerMiddleware(server)
    },
    configurePreviewServer(server) {
      registerTrackerMiddleware(server)
    },
  }
}
