import { describe, it, expect } from 'vitest';
import {
  webhookAttribution,
  emailAttribution,
  isMachineAttribution,
  attributionLabel,
  resolveUploaderFilter,
} from './attribution';

describe('webhookAttribution', () => {
  // Named after the API key because that's the thing an admin revokes when a
  // feed starts sending junk.
  it('names the API key', () => {
    expect(webhookAttribution('Zapier feed')).toBe('Webhook: Zapier feed');
  });

  it('falls back to a bare label when the key is unnamed', () => {
    expect(webhookAttribution('')).toBe('Webhook');
    expect(webhookAttribution('   ')).toBe('Webhook');
    expect(webhookAttribution(null)).toBe('Webhook');
    expect(webhookAttribution(undefined)).toBe('Webhook');
  });
});

describe('emailAttribution', () => {
  it('names the sender', () => {
    expect(emailAttribution('lists@hailtrace.com')).toBe('Email: lists@hailtrace.com');
  });

  // The email webhook substitutes the literal string 'unknown' when it can't
  // read a sender; echoing that back as a name would be worse than a bare label.
  it('does not surface the "unknown" placeholder as a sender', () => {
    expect(emailAttribution('unknown')).toBe('Email');
    expect(emailAttribution('')).toBe('Email');
    expect(emailAttribution(null)).toBe('Email');
  });
});

describe('isMachineAttribution', () => {
  // A person and a feed must be distinguishable at a glance — an admin
  // reviewing "who uploaded this" needs to know when the answer is "nobody".
  it('separates automated feeds from people', () => {
    expect(isMachineAttribution('Webhook: Zapier feed')).toBe(true);
    expect(isMachineAttribution('Email: lists@hailtrace.com')).toBe(true);
    expect(isMachineAttribution('Webhook')).toBe(true);
    expect(isMachineAttribution('Admin User')).toBe(false);
    expect(isMachineAttribution('Tommy')).toBe(false);
  });

  it('treats missing attribution as not-machine', () => {
    expect(isMachineAttribution(null)).toBe(false);
    expect(isMachineAttribution('')).toBe(false);
  });
});

describe('attributionLabel', () => {
  it('passes a real name through', () => {
    expect(attributionLabel('Admin User')).toBe('Admin User');
    expect(attributionLabel('  Setter  ')).toBe('Setter');
  });

  // Leads predating the migration have no attribution. Returning null lets the
  // caller render a dash rather than inventing a name.
  it('returns null for an unattributed lead', () => {
    expect(attributionLabel(null)).toBeNull();
    expect(attributionLabel(undefined)).toBeNull();
    expect(attributionLabel('')).toBeNull();
    expect(attributionLabel('   ')).toBeNull();
  });
});

describe('resolveUploaderFilter', () => {
  const uuid = '59ea5bcd-1ac1-4e1d-bcf1-b05cb9f4bc4d';

  it('accepts a real user id', () => {
    expect(resolveUploaderFilter(uuid)).toBe(uuid);
    expect(resolveUploaderFilter(uuid.toUpperCase())).toBe(uuid.toUpperCase());
  });

  it('ignores an absent filter', () => {
    expect(resolveUploaderFilter(null)).toBeNull();
    expect(resolveUploaderFilter(undefined)).toBeNull();
    expect(resolveUploaderFilter('')).toBeNull();
  });

  // A malformed id must not be passed to the query — same stance as the market
  // filter, where widening on junk input would show data the caller didn't ask
  // for.
  it('rejects anything that is not a uuid', () => {
    for (const junk of ['abc', '123', "' OR 1=1--", 'null', '59ea5bcd-1ac1-4e1d-bcf1']) {
      expect(resolveUploaderFilter(junk)).toBeNull();
    }
  });
});
