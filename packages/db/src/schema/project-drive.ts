import { pgTable, text, uuid, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgRef, pk, createdAt, updatedAt } from './columns';
import { creativeProjects } from './production';

/** Persistent upload run. The worker owns execution; the browser only polls progress. */
export const projectDriveSyncs = pgTable(
  'project_drive_syncs',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').notNull().references(() => creativeProjects.id, { onDelete: 'cascade' }),
    folderId: text('folder_id'),
    folderName: text('folder_name').notNull(),
    status: text('status').notNull().default('QUEUED'),
    selectedItemIds: jsonb('selected_item_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    total: integer('total').notNull().default(0),
    completed: integer('completed').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('project_drive_syncs_project_idx').on(t.orgId, t.projectId, t.createdAt)],
);
