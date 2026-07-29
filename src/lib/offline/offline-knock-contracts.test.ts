import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/022_offline_knocks.sql');
const schema = read('supabase/schema.sql');
const route = read('src/app/api/admin/leads/[leadId]/knocks/route.ts');
const hook = read('src/lib/offline/useLeadResultOutbox.ts');
const mapPage = read('src/app/admin/map/page.tsx');
const store = read('src/lib/offline/store.ts');

describe('offline lead-result persistence contracts', () => {
  it('records the event and every derived write in one locked database transaction', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION record_lead_knock');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('knock_count = COALESCE(knock_count, 0) + 1');
    expect(migration).toContain("activity_type,\n    content");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION record_lead_knock');
    expect(migration).toContain('TO service_role');
  });

  it('keeps the generated schema snapshot current', () => {
    expect(schema).toContain('-- 022_offline_knocks.sql');
    expect(schema).toContain('CREATE OR REPLACE FUNCTION record_lead_knock');
  });

  it('makes the route a validating wrapper around the atomic RPC', () => {
    expect(route).toContain(".rpc('record_lead_knock'");
    expect(route).toContain('body.owner_id !== admin.sub');
    expect(route).toContain("result?.error === 'client_id_conflict'");
    expect(route).not.toContain(".from('lead_knocks')\n      .insert");
    expect(route).not.toContain(".from('leads').update");
  });

  it('waits for IndexedDB transaction completion before confirming durability', () => {
    expect(store).toContain('transaction.oncomplete = () => finish(true)');
    expect(store).toContain('transaction.onabort = () => finish(false)');
    expect(store).toContain('export async function put(entry: OutboxEntry): Promise<boolean>');
  });

  it('uses one owner-scoped drainer for knocks and cold calls', () => {
    expect(hook).toContain('ownerId: string | null');
    expect(hook).toContain('entry.ownerId === options.ownerId');
    expect(hook).toContain('owner_id: entry.ownerId');
    expect(hook).toContain("entry.kind === 'knock'");
    expect(hook).toContain("entry.kind === 'cold_call'");
    expect(hook).toContain("'knocks' : 'calls'");
    expect(hook.match(/drainEntries</g)).toHaveLength(1);
    expect(hook).toContain('retryFailed');
    expect(hook).toContain('void flush(true)');
    expect(hook).not.toContain('markSending');
  });

  it('overlays both queued result types and surfaces failed work generically', () => {
    expect(mapPage).toContain('applyQueuedCalls(applyQueuedKnocks(leads, queuedKnocks), queuedCalls)');
    expect(mapPage).toContain('leads={effectiveLeads}');
    expect(mapPage).toContain('resultOutbox.failed > 0');
    expect(mapPage).toContain('resultOutbox.retryFailed()');
    expect(mapPage).toContain('resultOutbox.flush(true)');
    expect(mapPage).toContain('result${resultOutbox.pending === 1');
  });
});
