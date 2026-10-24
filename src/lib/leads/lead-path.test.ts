import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  leadCodeBounds,
  leadPath,
  leadSlug,
  parseLeadRef,
  slugifyLeadName,
} from './lead-path';

const ID = '3f9c2a1b-77de-4c1a-9a0b-1234567890ab';

describe('slugifyLeadName', () => {
  it('turns a name into a readable address part', () => {
    expect(slugifyLeadName('Jane', 'Smith')).toBe('jane-smith');
    expect(slugifyLeadName("Mary-Kate", "O'Brien")).toBe('mary-kate-obrien');
    expect(slugifyLeadName('José', 'Núñez')).toBe('jose-nunez');
  });

  // Address-only leads store the street as the first name.
  it('handles street names, placeholders and empty names', () => {
    expect(slugifyLeadName('1421 E Palm Ln', '(unknown)')).toBe('1421-e-palm-ln');
    expect(slugifyLeadName('', '')).toBe('lead');
    expect(slugifyLeadName(null, null)).toBe('lead');
    expect(slugifyLeadName('!!!', '???')).toBe('lead');
  });

  it('keeps the address short', () => {
    const slug = slugifyLeadName('A'.repeat(30), 'B'.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('leadPath', () => {
  it('links by name and short code', () => {
    expect(leadSlug({ id: ID, first_name: 'Jane', last_name: 'Smith' })).toBe('jane-smith-3f9c2a1b');
    expect(leadPath({ id: ID, first_name: 'Jane', last_name: 'Smith' })).toBe('/admin/leads/jane-smith-3f9c2a1b');
  });

  // The server redirects a full-UUID link to the readable one.
  it('falls back to the full id when no name is known', () => {
    expect(leadPath({ id: ID })).toBe(`/admin/leads/${ID}`);
    expect(leadPath({ id: ID, first_name: ' ', last_name: null })).toBe(`/admin/leads/${ID}`);
  });
});

describe('parseLeadRef', () => {
  it('reads old full-UUID links', () => {
    expect(parseLeadRef(ID)).toEqual({ kind: 'uuid', id: ID });
    expect(parseLeadRef(ID.toUpperCase())).toEqual({ kind: 'uuid', id: ID });
  });

  it('reads name-code links, including renamed and encoded ones', () => {
    expect(parseLeadRef('jane-smith-3f9c2a1b')).toEqual({
      kind: 'code', code: '3f9c2a1b', slug: 'jane-smith-3f9c2a1b',
    });
    expect(parseLeadRef('old-name-3F9C2A1B')?.kind).toBe('code');
    expect(parseLeadRef('3f9c2a1b')).toEqual({ kind: 'code', code: '3f9c2a1b', slug: '3f9c2a1b' });
    expect(parseLeadRef('jos%C3%A9-3f9c2a1b')?.kind).toBe('code');
  });

  it('rejects anything else', () => {
    for (const segment of ['jane-smith', 'jane-smith-3f9c2a1', 'jane-smith-3f9c2a1z', 'x3f9c2a1b', '']) {
      expect(parseLeadRef(segment), segment).toBeNull();
    }
  });
});

describe('leadCodeBounds', () => {
  // Every UUID starting with the code sorts inside the bounds.
  it('brackets exactly the UUIDs that start with the code', () => {
    const { from, to } = leadCodeBounds('3f9c2a1b');
    expect(from <= ID && ID <= to).toBe(true);
    expect('3f9c2a1a-ffff-4fff-bfff-ffffffffffff' < from).toBe(true);
    expect('3f9c2a1c-0000-4000-8000-000000000000' > to).toBe(true);
  });
});

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(resolve(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('lead address contracts', () => {
  // One helper builds every lead link, so the address format lives in one place.
  it('builds every lead page link with leadPath', () => {
    const offenders = sourceFiles('src')
      .filter((path) => !path.endsWith('lead-path.ts'))
      .filter((path) => /(?<!\/api)\/admin\/leads\/\$\{(?!lead\.slug\})/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('resolves on the server, checks access, and redirects to the canonical address', () => {
    const page = read('src/app/admin/(app)/leads/[leadId]/page.tsx');
    const edit = read('src/app/admin/(app)/leads/[leadId]/edit/page.tsx');
    const resolver = read('src/lib/leads/lead-ref.server.ts');
    for (const source of [page, edit]) {
      expect(source).not.toContain("'use client'");
      expect(source).toContain('await resolveLeadRef(segment)');
      expect(source).toContain('notFound()');
      expect(source).toContain('redirect(`/admin/leads/${lead.slug}');
    }
    expect(resolver).toContain('applyLeadAccessFilter(query');
    expect(resolver).toContain(".gte('id', from).lte('id', to)");
  });
});
