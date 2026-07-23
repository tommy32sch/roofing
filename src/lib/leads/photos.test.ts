import { describe, it, expect } from 'vitest';
import { extensionFor, photoPath, pathBelongsToLead, ALLOWED_PHOTO_TYPES } from './photos';

describe('extensionFor', () => {
  it('maps known types', () => {
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/heic')).toBe('heic');
  });
  it('defaults to jpg', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('application/octet-stream')).toBe('jpg');
  });
});

describe('photoPath', () => {
  it('groups under the lead id', () => {
    expect(photoPath('lead-1', 'abc', 'image/jpeg')).toBe('lead-1/abc.jpg');
  });
});

describe('pathBelongsToLead', () => {
  it('accepts a path under the lead', () => {
    expect(pathBelongsToLead('lead-1/abc.jpg', 'lead-1')).toBe(true);
  });
  it('rejects another lead’s path', () => {
    // Without this, a client could record someone else's photo onto its own lead
    expect(pathBelongsToLead('lead-2/abc.jpg', 'lead-1')).toBe(false);
  });
  it('rejects traversal', () => {
    expect(pathBelongsToLead('lead-1/../lead-2/abc.jpg', 'lead-1')).toBe(false);
  });
});

describe('ALLOWED_PHOTO_TYPES', () => {
  it('permits phone camera formats and excludes non-images', () => {
    expect(ALLOWED_PHOTO_TYPES.has('image/jpeg')).toBe(true);
    expect(ALLOWED_PHOTO_TYPES.has('image/heic')).toBe(true);
    expect(ALLOWED_PHOTO_TYPES.has('application/pdf')).toBe(false);
    expect(ALLOWED_PHOTO_TYPES.has('text/html')).toBe(false);
  });
});
