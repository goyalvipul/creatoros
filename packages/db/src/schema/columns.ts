import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pk = () => uuid('id').primaryKey().defaultRandom();

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const deletedAt = () => ts('deleted_at');

/** Integer minor units / byte sizes that fit in a JS safe integer. */
export const int8 = (name: string) => bigint(name, { mode: 'number' });
