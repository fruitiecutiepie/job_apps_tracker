import { rebuildIndexes, indexesAreStale } from './indexes'
import { TRACKER_JSON_SCHEMA } from './jsonSchema'
import type { Application, JsonSchemaObject, TrackerDatabase } from './types'

function cloneSchema(): JsonSchemaObject {
  return JSON.parse(JSON.stringify(TRACKER_JSON_SCHEMA)) as JsonSchemaObject
}

export function prepareTrackerDatabase(applications: Application[]): TrackerDatabase {
  return {
    schema: cloneSchema(),
    applications,
    indexes: rebuildIndexes(applications),
  }
}

export function createEmptyDocument(): TrackerDatabase {
  return prepareTrackerDatabase([])
}

export function refreshTrackerDatabase(database: TrackerDatabase): TrackerDatabase {
  return prepareTrackerDatabase(database.applications)
}

export function ensureFreshIndexes(database: TrackerDatabase): TrackerDatabase {
  if (!database.indexes || indexesAreStale(database.applications, database.indexes)) {
    return refreshTrackerDatabase(database)
  }

  return {
    ...database,
    schema: cloneSchema(),
  }
}
