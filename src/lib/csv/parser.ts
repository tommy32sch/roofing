import Papa from 'papaparse';
import { FIELD_MAP, normalizeLeadData, type NormalizedLead } from '@/lib/leads/normalize';

export type ParsedLead = NormalizedLead;

export interface CSVParseResult {
  leads: NormalizedLead[];
  errors: string[];
  skipped: number;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

export function parseLeadCSV(csvText: string): CSVParseResult {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => {
      const normalized = normalizeHeader(h);
      return FIELD_MAP[normalized] || FIELD_MAP[h.toLowerCase().trim()] || h.toLowerCase().trim().replace(/\s+/g, '_');
    },
  });

  const leads: NormalizedLead[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i] as Record<string, string>;
    const rowNum = i + 2;

    const lead = normalizeLeadData(row);
    if (lead) {
      leads.push(lead);
    } else {
      errors.push(`Row ${rowNum}: Missing first or last name`);
      skipped++;
    }
  }

  return { leads, errors, skipped };
}
