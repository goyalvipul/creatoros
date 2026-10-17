import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, sql, type DbHandle } from '@creatoros/db';

let h: DbHandle;
beforeAll(() => {
  h = createDb(process.env.TEST_DATABASE_URL!, { max: 2 });
});
afterAll(async () => {
  await h.close();
});

async function rows<T = any>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await h.db.execute(q);
  return (r as unknown as { rows: T[] }).rows;
}

describe('schema & migrations', () => {
  it('creates all domain tables', async () => {
    const t = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema='public'`,
    );
    const names = new Set(t.map((r) => r.table_name));
    for (const required of [
      'users',
      'organizations',
      'brands',
      'channels',
      'social_accounts',
      'provider_connections',
      'devices',
      'device_credentials',
      'storage_roots',
      'scan_runs',
      'scan_observations',
      'file_instances',
      'media_objects',
      'logical_assets',
      'asset_versions',
      'asset_file_links',
      'derived_previews',
      'duplicate_candidates',
      'media_tags',
      'asset_tag_links',
      'asset_match_suggestions',
      'ideas',
      'creative_projects',
      'project_memberships',
      'project_checklist_templates',
      'project_checklist_items',
      'songs',
      'production_scenes',
      'generation_jobs',
      'generation_outputs',
      'project_attachments',
      'project_status_events',
      'distribution_variants',
      'publication_targets',
      'publication_records',
      'publication_status_events',
      'publication_metrics_snapshots',
      'publishing_schedules',
      'external_organizations',
      'contacts',
      'conversation_threads',
      'messages',
      'opportunities',
      'deals',
      'deal_deliverables',
      'deal_contracts',
      'invoices',
      'payments',
      'expenses',
      'follow_up_rules',
      'inbound_classifications',
      'internal_actions',
      'task_integrations',
      'task_links',
      'notifications',
      'notification_preferences',
      'goals',
      'goal_observations',
      'analytics_snapshots',
      'background_jobs',
      'sync_cursors',
      'oauth_states',
      'audit_events',
      'api_idempotency_keys',
      'settings_and_feature_flags',
      'backup_runs',
      'automation_rules',
      'organization_memberships',
    ]) {
      expect(names.has(required), `missing table ${required}`).toBe(true);
    }
  });

  it('has pg_trgm and partial unique indexes', async () => {
    const ext = await rows(sql`select extname from pg_extension where extname='pg_trgm'`);
    expect(ext.length).toBe(1);
    const idx = await rows<{ indexname: string }>(
      sql`select indexname from pg_indexes where indexname in ('file_instances_root_path_uq','media_objects_hash_uq','publication_records_external_uq')`,
    );
    expect(idx.length).toBe(3);
  });
});
