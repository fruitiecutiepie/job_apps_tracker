import { rebuildIndexes, indexesAreStale } from './indexes'
import { TRACKER_JSON_SCHEMA } from './jsonSchema'
import { DATA_VERSION } from './migrate'
import { DEFAULT_STAGE_CONFIG, stageConfigFrom, storedStages, type StageConfig } from './states'
import type { Application, JsonSchemaObject, TrackerDatabase } from './types'

function cloneSchema(): JsonSchemaObject {
  return JSON.parse(JSON.stringify(TRACKER_JSON_SCHEMA)) as JsonSchemaObject
}

export function prepareTrackerDatabase(
  applications: Application[],
  name?: string,
  stages: StageConfig = DEFAULT_STAGE_CONFIG,
): TrackerDatabase {
  const named = name?.trim()
  const stored = storedStages(stages)
  return {
    schema_version: DATA_VERSION,
    schema: cloneSchema(),
    // Omitted rather than null when blank, so an unnamed tracker's file is the same shape
    // it always was.
    ...(named ? { name: named } : {}),
    // Omitted while they are the defaults, for the same reason.
    ...(stored ? { stages: stored } : {}),
    applications,
    indexes: rebuildIndexes(applications, stages),
  }
}

/** The stages a tracker document reads in. */
export function documentStages(database: Pick<TrackerDatabase, 'stages'>): StageConfig {
  return database.stages ? stageConfigFrom(database.stages) : DEFAULT_STAGE_CONFIG
}

export function createEmptyDocument(): TrackerDatabase {
  return prepareTrackerDatabase([])
}

export function refreshTrackerDatabase(database: TrackerDatabase): TrackerDatabase {
  return prepareTrackerDatabase(database.applications, database.name, documentStages(database))
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
