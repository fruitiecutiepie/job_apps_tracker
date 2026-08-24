import { COMPENSATION_STAGE_IDS } from './compensation'
import { MAX_RATING_SCORE, MIN_RATING_SCORE, RATING_IDS } from './ratings'
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
        'deadline_at',
        'notes',
        'completed_actions',
        'stage_notes',
        'state_events',
        'attachments',
        'ratings',
        'compensation',
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
        deadline_at: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        completed_actions: {
          type: 'array',
          items: { $ref: '#/$defs/completed_action' },
        },
        stage_notes: {
          type: 'array',
          items: { $ref: '#/$defs/stage_note' },
        },
        state_events: {
          type: 'array',
          items: { $ref: '#/$defs/state_event' },
        },
        attachments: {
          type: 'array',
          items: { $ref: '#/$defs/attachment' },
        },
        ratings: {
          type: 'array',
          items: { $ref: '#/$defs/rating' },
        },
        compensation: { $ref: '#/$defs/compensation' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
      },
    },
    stage_note: {
      type: 'object',
      description:
        'Notes for one stage of an application: what was prepared, and what was captured'
        + ' during it.',
      required: ['state', 'body', 'heard', 'created_at', 'updated_at'],
      additionalProperties: false,
      properties: {
        state: { type: 'string', enum: [...STATE_IDS] },
        // Blank when the stage holds captured lines and nothing was prepared for it.
        body: { type: 'string' },
        heard: {
          type: 'array',
          items: { $ref: '#/$defs/heard_entry' },
        },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
      },
    },
    completed_action: {
      type: 'object',
      description: 'A next action that was carried out, kept apart from the free-text notes.',
      required: ['id', 'action', 'at'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        action: { type: 'string', minLength: 1 },
        at: { type: 'string' },
      },
    },
    heard_entry: {
      type: 'object',
      description: 'One line captured while a stage was being read.',
      required: ['id', 'body', 'at'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        body: { type: 'string', minLength: 1 },
        at: { type: 'string' },
      },
    },
    state_event: {
      type: 'object',
      description: 'A calendar invite filed against one state of an application.',
      required: [
        'id',
        'state',
        'summary',
        'starts_at',
        'ends_at',
        'location',
        'url',
        'ics_uid',
        'sequence',
        'cancelled',
        'created_at',
        'updated_at',
      ],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        state: { type: 'string', enum: [...STATE_IDS] },
        summary: { type: 'string', minLength: 1 },
        starts_at: { type: 'string' },
        ends_at: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] },
        url: { type: ['string', 'null'] },
        ics_uid: {
          type: ['string', 'null'],
          description: 'The iCalendar UID the invite arrived with, when it came from a file.',
        },
        sequence: { type: 'integer', minimum: 0 },
        cancelled: { type: 'boolean' },
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
    rating: {
      type: 'object',
      description:
        'One judgement of an application on one dimension. A null score means the judgement '
        + 'was attempted and could not be made; an absent record means it was never attempted.',
      required: ['dimension', 'score', 'created_at', 'updated_at'],
      additionalProperties: false,
      properties: {
        dimension: { type: 'string', enum: [...RATING_IDS] },
        score: {
          type: ['integer', 'null'],
          minimum: MIN_RATING_SCORE,
          maximum: MAX_RATING_SCORE,
        },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
      },
    },
    compensation_band: {
      type: 'object',
      description:
        'One pay figure as a band of annual gross base pay, in whole units of the '
        + "record's currency. A point value is a band whose ends match.",
      required: ['min', 'max'],
      additionalProperties: false,
      properties: {
        min: { type: 'integer', minimum: 1 },
        max: { type: 'integer', minimum: 1 },
      },
    },
    compensation: {
      type: 'object',
      description:
        'What an application pays, as a measurement rather than a judgement. The stages are '
        + 'kept side by side because compensation moves and the progression is the point; '
        + '`expected` is also the target the others are measured against. `currency` is '
        + 'non-null exactly when some stage holds a figure, and no conversion is attempted.',
      required: ['currency', ...COMPENSATION_STAGE_IDS],
      additionalProperties: false,
      properties: {
        currency: {
          type: ['string', 'null'],
          description: 'An ISO-4217-shaped three-letter code, upper case.',
          pattern: '^[A-Z]{3}$',
        },
        advertised: {
          description: 'What the posting or recruiter said.',
          oneOf: [{ $ref: '#/$defs/compensation_band' }, { type: 'null' }],
        },
        expected: {
          description: 'What you are aiming for here, and the target the others measure against.',
          oneOf: [{ $ref: '#/$defs/compensation_band' }, { type: 'null' }],
        },
        offered: {
          description: 'What arrived in writing.',
          oneOf: [{ $ref: '#/$defs/compensation_band' }, { type: 'null' }],
        },
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
        'by_deadline_at',
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
        by_deadline_at: { type: 'array', items: { type: 'string' } },
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
