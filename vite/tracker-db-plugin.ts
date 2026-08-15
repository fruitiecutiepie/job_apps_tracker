import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'

import { createDemoDocument } from '../src/domain/demo'
import { refreshTrackerDatabase } from '../src/domain/database'
import type { TrackerDatabase } from '../src/domain/types'
import { assertTrackerDocument, parseTrackerDocument } from '../src/domain/validation'

const DB_ROUTE = '/__db'

function trackerPaths(root: string) {
  const dataDir = path.join(root, 'data')
  return {
    dataDir,
    dbPath: path.join(dataDir, 'tracker.json'),
    tmpPath: path.join(dataDir, 'tracker.json.tmp'),
  }
}

function writeDatabaseAtomic(dbPath: string, tmpPath: string, database: TrackerDatabase): void {
  const payload = `${JSON.stringify(database, null, 2)}\n`
  fs.writeFileSync(tmpPath, payload, 'utf8')
  fs.renameSync(tmpPath, dbPath)
}

function readDatabaseFile(dbPath: string): TrackerDatabase {
  const text = fs.readFileSync(dbPath, 'utf8')
  return assertTrackerDocument(parseTrackerDocument(text))
}

function seedDatabase(dbPath: string, tmpPath: string, dataDir: string): TrackerDatabase {
  fs.mkdirSync(dataDir, { recursive: true })
  const demo = createDemoDocument()
  writeDatabaseAtomic(dbPath, tmpPath, demo)
  return demo
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

function handleTrackerDb(root: string, req: IncomingMessage, res: ServerResponse): void {
  const { dataDir, dbPath, tmpPath } = trackerPaths(root)

  if (req.method === 'GET') {
    if (!fs.existsSync(dbPath)) {
      const seeded = seedDatabase(dbPath, tmpPath, dataDir)
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
    try {
      const demo = seedDatabase(dbPath, tmpPath, dataDir)
      sendJson(res, 200, demo)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendText(res, 500, message)
    }
    return
  }

  sendText(res, 405, 'Method not allowed')
}

function registerTrackerDbMiddleware(server: ViteDevServer | PreviewServer): void {
  const root = server.config.root

  server.middlewares.use((req, res, next) => {
    const url = req.url?.split('?')[0]
    if (url !== DB_ROUTE) {
      next()
      return
    }
    handleTrackerDb(root, req, res)
  })
}

export function trackerDbPlugin(): Plugin {
  return {
    name: 'tracker-db',
    configureServer(server) {
      registerTrackerDbMiddleware(server)
    },
    configurePreviewServer(server) {
      registerTrackerDbMiddleware(server)
    },
  }
}
