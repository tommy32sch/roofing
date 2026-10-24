import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const route = read('src/app/api/admin/leads/[leadId]/knock-draft/route.ts');
const server = read('src/lib/ai/knock-draft.server.ts');
const field = read('src/components/leads/KnockDraftField.tsx');
const mapPage = read('src/app/admin/(app)/map/page.tsx');
const panel = read('src/components/territories/TerritoryExecutionPanel.tsx');
const sheet = read('src/components/leads/LeadResultSheet.tsx');

function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(resolve(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('knock draft contracts', () => {
  // The rep confirms; the ordinary knock path saves. A draft route that wrote
  // would skip the offline queue, idempotency and the follow-on steps.
  it('drafts without writing anything', () => {
    for (const source of [route, server]) {
      expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    }
    expect(route).toContain("NextResponse.json({ success: true, draft: result.draft })");
  });

  it('checks access, configuration, cost and Do Not Knock before calling the model', () => {
    const order = [
      'getAuthenticatedAdmin()',
      'isKnockDraftConfigured()',
      'authorizeLeadAccess(',
      "checkConfiguredRateLimit(admin.sub, 'knock-draft'",
      'parseKnockDraftText(',
      'if (lead.do_not_knock)',
      'draftKnock(',
    ].map((needle) => {
      const at = route.indexOf(needle);
      expect(at, needle).toBeGreaterThan(-1);
      return at;
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(route).toContain('export const maxDuration = 30;');
  });

  it('uses the cheapest model with structured output and a timeout', () => {
    expect(server).toContain("KNOCK_DRAFT_MODEL = 'claude-haiku-5-5'");
    expect(server).toContain('format: zodOutputFormat(KnockDraftOutputSchema)');
    expect(server).toContain('timeout: TIMEOUT_MS');
    // A retry doubles both the time (past the client's 20s and maxDuration)
    // and the bill; the rep can tap Draft again.
    expect(server).toContain('maxRetries: 0');
    // A rep who gives up also stops the paid call.
    expect(server).toContain('}, { signal });');
    expect(route).toContain('request.signal');
    // Token counts only: the sentence can hold homeowner details.
    expect(server).not.toMatch(/console\.\w+\([^)]*input\.text/);
  });

  // The key must never reach a browser bundle.
  it('keeps the server module out of client code', () => {
    const clientFiles = [...sourceFiles('src/components'), ...sourceFiles('src/app')]
      .filter((path) => read(path).startsWith("'use client'"));
    expect(clientFiles.length).toBeGreaterThan(10);
    for (const path of clientFiles) {
      expect(read(path), path).not.toContain('knock-draft.server');
    }
  });

  // A failed save to the device must not throw away the reviewed draft.
  it('clears the review only after the knock is saved', () => {
    expect(field).toContain('if (saved) {');
    expect(mapPage).toContain('async function logDraftedKnock(lead: GeoLead, draft: ConfirmedKnockDraft): Promise<boolean>');
    expect(mapPage).toContain('if (!saved) return false;');
  });

  // A drafted date saves behind an already-open menu; the label must follow.
  it('keeps the follow-up menu in step with the stored date', () => {
    const menu = read('src/components/leads/FollowUpMenu.tsx');
    expect(menu).toContain('if (followUpDate !== syncedFrom) {');
  });

  it('shows the field only when configured and saves through logLeadResult', () => {
    expect(field).toContain('if (!features.knockDraft) return null;');
    expect(field).toContain('/knock-draft');
    expect(panel).toContain('key={currentLead.id}');
    expect(sheet).toContain('key={lead.id}');
    expect(mapPage).toContain("{ channel: 'knock', disposition: draft.disposition, notes: draft.notes }");
    expect(mapPage).toContain('notes: result.notes ?? null,');
  });
});
