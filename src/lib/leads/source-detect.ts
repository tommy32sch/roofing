import { db } from '@/lib/supabase/server';

// Map of keywords to lead_sources.name values from the database
const SOURCE_KEYWORDS: Record<string, string[]> = {
  hailtrace: ['hailtrace'],
  hail_watch: ['hailwatch', 'anythingweather', 'hail watch'],
  imgimg: ['imgimg', 'imging', 'loveland'],
  roof_hawk: ['roofhawk', 'roof hawk'],
  propstream: ['propstream'],
  batchleads: ['batchleads', 'batch leads'],
  regrid: ['regrid', 'loveland technologies'],
};

// CSV column headers that are unique to specific sources
const HEADER_FINGERPRINTS: Record<string, string[]> = {
  hailtrace: ['hail_size', 'hail size', 'hail_date', 'storm_id', 'hail size inches'],
  propstream: ['equity', 'equity %', 'loan amount', 'lender', 'pre foreclosure'],
  batchleads: ['phone 1', 'phone 2', 'phone 3', 'email 1', 'email 2', 'skip trace'],
  regrid: ['parcelnumb', 'll_gisacre', 'parval', 'owntype', 'usecode'],
};

/**
 * Auto-detect the lead source from email metadata and CSV headers.
 * Returns the source_id or null if not detected.
 */
export async function detectSource(options: {
  senderEmail?: string;
  subject?: string;
  csvHeaders?: string[];
}): Promise<number | null> {
  const { senderEmail, subject, csvHeaders } = options;

  // Build a search string from all available context
  const searchText = [
    senderEmail?.toLowerCase() || '',
    subject?.toLowerCase() || '',
  ].join(' ');

  // Check sender email and subject line against keywords
  let matchedSourceName: string | null = null;

  for (const [sourceName, keywords] of Object.entries(SOURCE_KEYWORDS)) {
    if (keywords.some(kw => searchText.includes(kw))) {
      matchedSourceName = sourceName;
      break;
    }
  }

  // If no match from email metadata, try CSV header fingerprinting
  if (!matchedSourceName && csvHeaders && csvHeaders.length > 0) {
    const lowerHeaders = csvHeaders.map(h => h.toLowerCase().trim());

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const [sourceName, fingerprints] of Object.entries(HEADER_FINGERPRINTS)) {
      const score = fingerprints.filter(fp => lowerHeaders.includes(fp)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = sourceName;
      }
    }

    if (bestScore >= 2) {
      matchedSourceName = bestMatch;
    }
  }

  if (!matchedSourceName) return null;

  // Look up the source_id from the database
  const supabase = db();
  const { data } = await supabase
    .from('lead_sources')
    .select('id')
    .eq('name', matchedSourceName)
    .single();

  return data?.id || null;
}
