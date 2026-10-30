import { describe, expect, it } from 'vitest';
import { emailImportAppsScript } from './email-import-script';

describe('email import setup script', () => {
  it('points the Apps Script webhook at this origin', () => {
    const script = emailImportAppsScript('https://roofing-ebon.vercel.app/');
    expect(script).toContain("var WEBHOOK_URL = 'https://roofing-ebon.vercel.app/api/webhooks/email';");
    expect(script).toContain('x-api-key');
    expect(script).toContain('to-import');
  });
});
