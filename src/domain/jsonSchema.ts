import { STATE_IDS } from './states'

export const TRACKER_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'job-applications-tracker/database',
  title: 'Job Applications Tracker Database',
  type: 'object',
  required: ['schema', 'applications', 'indexes'],
  additionalProperties: false,
  properties: {
    schema: {
      type: 'object',
      description: 'Embedded JSON Schema describing the canonical database shape.',
    },
    applications: {
      type: 'array',
      items: { $ref: '#/$defs/application' },
    },
    indexes: { $ref: '#/$defs/indexes' },
  },
  $defs: {
    application: {
      type: 'object',
      required: [
        'id',
        'company',
        'role',
        'url',
        'source',
        'state',
        'state_history',
        'next_action',
        'next_action_at',
        'notes',
        'stage_notes',
        'attachments',
        'created_at',
        'updated_at',
      ],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        company: { type: 'string', minLength: 1 },
        role: { type: ['string', 'null'] },
        url: { type: ['string', 'null'] },
        source: { type: ['string', 'null'] },
        state: { type: 'string', enum: [...STATE_IDS] },
        state_history: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['state', 'at'],
            additionalProperties: false,
            properties: {
              state: { type: 'string', enum: [...STATE_IDS] },
              at: { type: 'string' },
            },
          },
        },
        next_action: { type: ['string', 'null'] },
        next_action_at: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        stage_notes: {
          type: 'array',
          items: { $ref: '#/$defs/stage_note' },
        },
        attachments: {
          type: 'array',
          items: { $ref: '#/$defs/attachment' },
        },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
      },
    },
    stage_note: {
      type: 'object',
      description: 'Preparation notes recorded for one stage of an application.',
      required: ['state', 'body', 'created_at', 'updated_at'],
      additionalProperties: false,
      properties: {
        state: { type: 'string', enum: [...STATE_IDS] },
        body: { type: 'string', minLength: 1 },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
      },
    },
    attachment: {
      type: 'object',
      required: ['id', 'filename', 'mime', 'size', 'created_at'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        filename: { type: 'string', minLength: 1 },
        mime: { type: ['string', 'null'] },
        size: { type: 'integer', minimum: 1 },
        created_at: { type: 'string' },
      },
    },
    indexes: {
      type: 'object',
      required: [
        'by_id',
        'by_state',
        'by_company',
        'by_created_at',
        'by_updated_at',
        'by_next_action_at',
        'with_next_action',
        'unscheduled_next_actions',
        'ever_reached',
        'search_text',
        'stats_current',
        'stats_ever_reached',
      ],
      additionalProperties: false,
      properties: {
        by_id: {
          type: 'object',
          additionalProperties: { type: 'integer', minimum: 0 },
        },
        by_state: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        by_company: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        by_created_at: { type: 'array', items: { type: 'string' } },
        by_updated_at: { type: 'array', items: { type: 'string' } },
        by_next_action_at: { type: 'array', items: { type: 'string' } },
        with_next_action: { type: 'array', items: { type: 'string' } },
        unscheduled_next_actions: { type: 'array', items: { type: 'string' } },
        ever_reached: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        search_text: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        stats_current: {
          type: 'object',
          additionalProperties: { type: 'integer', minimum: 0 },
        },
        stats_ever_reached: {
          type: 'object',
          additionalProperties: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const
