import { rebuildIndexes, indexesAreStale } from './indexes'
import { TRACKER_JSON_SCHEMA } from './jsonSchema'
import { DATA_VERSION } from './migrate'
import type { Application, JsonSchemaObject, TrackerDatabase } from './types'

function cloneSchema(): JsonSchemaObject {
  return JSON.parse(JSON.stringify(TRACKER_JSON_SCHEMA)) as JsonSchemaObject
}

export function prepareTrackerDatabase(applications: Application[], name?: string): TrackerDatabase {
  const named = name?.trim()
  return {
    schema_version: DATA_VERSION,
    schema: cloneSchema(),
    // Omitted rather than null when blank, so an unnamed tracker's file is the same shape
    // it always was.
    ...(named ? { name: named } : {}),
    applications,
    indexes: rebuildIndexes(applications),
  }
}

export function createEmptyDocument(): TrackerDatabase {
  return prepareTrackerDatabase([])
}

export function refreshTrackerDatabase(database: TrackerDatabase): TrackerDatabase {
  return prepareTrackerDatabase(database.applications, database.name)
}

export function ensureFreshIndexes(database: TrackerDatabase): TrackerDatabase {
  if (!database.indexes || indexesAreStale(database.applications, database.indexes)) {
    return refreshTrackerDatabase(database)
  }

  return {
    ...database,
    schema_version: DATA_VERSION,
    schema: cloneSchema(),
  }
}
