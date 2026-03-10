const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export const LIMITS = {
  FIRST_NAME: 100,
  LAST_NAME: 100,
  EMAIL: 254,
  PHONE: 20,
  ADDRESS_STREET: 200,
  ADDRESS_CITY: 100,
  ADDRESS_STATE: 50,
  ADDRESS_ZIP: 10,
  NOTES: 5000,
  SEARCH_QUERY: 200,
  CSV_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  BULK_IMPORT_MAX: 5000,
} as const;
