/**
 * Address-based duplicate detection.
 *
 * A lead is identified by the PROPERTY, not the person: the same house imported
 * twice is a duplicate even when the owner name, phone numbers, or skip-trace
 * vintage differ. That matches how roofing lists actually overlap — the same
 * street gets pulled into multiple storm lists with different contact data.
 *
 * Street text varies wildly between vendors ("1039 N 35th St" / "1039 North
 * 35th Street" / "1039 n. 35th st."), so comparison happens on a canonical
 * form rather than the raw string.
 */

/** Street-type words → canonical abbreviation. */
const STREET_TYPES: Record<string, string> = {
  street: 'st', st: 'st',
  avenue: 'ave', ave: 'ave', av: 'ave',
  road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr',
  lane: 'ln', ln: 'ln',
  boulevard: 'blvd', blvd: 'blvd', blv: 'blvd',
  court: 'ct', ct: 'ct',
  circle: 'cir', cir: 'cir',
  place: 'pl', pl: 'pl',
  trail: 'trl', trl: 'trl',
  parkway: 'pkwy', pkwy: 'pkwy', pky: 'pkwy',
  highway: 'hwy', hwy: 'hwy',
  terrace: 'ter', ter: 'ter', terr: 'ter',
  square: 'sq', sq: 'sq',
  point: 'pt', pt: 'pt',
  crossing: 'xing', xing: 'xing',
  loop: 'loop',
  way: 'way',
  run: 'run',
  path: 'path',
};

/** Directionals → canonical abbreviation. */
const DIRECTIONS: Record<string, string> = {
  north: 'n', n: 'n',
  south: 's', s: 's',
  east: 'e', e: 'e',
  west: 'w', w: 'w',
  northeast: 'ne', ne: 'ne',
  northwest: 'nw', nw: 'nw',
  southeast: 'se', se: 'se',
  southwest: 'sw', sw: 'sw',
};

/** Unit designators all collapse to "#" so "Apt 4" == "Unit 4" == "#4". */
const UNIT_WORDS = new Set([
  'apt', 'apartment', 'unit', 'ste', 'suite', 'bldg', 'building',
  'lot', 'trlr', 'rm', 'room', 'fl', 'floor', 'spc', 'space',
]);

/**
 * Canonical form of a street address used as the duplicate key.
 * Returns null when there is no usable street text.
 */
export function normalizeStreet(street: string | null | undefined): string | null {
  if (!street) return null;

  const cleaned = String(street)
    .toLowerCase()
    .replace(/#/g, ' # ')          // split "#4" into "# 4"
    .replace(/[^a-z0-9# ]+/g, ' ') // drop punctuation (periods, commas, dashes)
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const tokens = cleaned.split(' ').map((t) => {
    if (UNIT_WORDS.has(t)) return '#';
    if (DIRECTIONS[t]) return DIRECTIONS[t];
    if (STREET_TYPES[t]) return STREET_TYPES[t];
    return t;
  });

  // Collapse any run of "#" produced by e.g. "apt #4"
  const out: string[] = [];
  for (const t of tokens) {
    if (t === '#' && out[out.length - 1] === '#') continue;
    out.push(t);
  }

  const key = out.join(' ').trim();
  return key || null;
}

/** The city/zip we know for a candidate address, used only to rule matches OUT. */
export interface AddressScope {
  city?: string | null;
  zip?: string | null;
}

const clean = (v: string | null | undefined) => (v ? String(v).trim().toLowerCase() : '');

/**
 * True when two same-street records are provably at different places.
 *
 * Street text alone can repeat across a metro ("123 Main St" in Phoenix and in
 * Mesa), so when BOTH records carry a city or zip and they disagree, they are not
 * duplicates. When either side is missing that detail — the common case for
 * street-only skip-trace lists — we do not block the match.
 */
export function addressConflicts(a: AddressScope, b: AddressScope): boolean {
  const [aZip, bZip] = [clean(a.zip), clean(b.zip)];
  if (aZip && bZip && aZip !== bZip) return true;

  const [aCity, bCity] = [clean(a.city), clean(b.city)];
  if (aCity && bCity && aCity !== bCity) return true;

  return false;
}

/** The fields duplicate matching looks at. */
export interface DedupeRecord {
  id: string;
  apn?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
}

/**
 * Assign duplicates across an ordered list of records — the single source of
 * truth for the matching rule, shared by CSV import and the re-check action.
 *
 * Order matters: the FIRST record at a given address/APN is the original, and
 * every later one points back to it. Pass records oldest-first (existing leads
 * by created_at, then any new rows) so imports never re-parent existing leads.
 * A record that is itself a duplicate never becomes an original, so a whole
 * cluster collapses onto one lead rather than chaining.
 *
 * Returns id → the id it duplicates, or null when it is not a duplicate.
 */
export function assignDuplicates(records: DedupeRecord[]): Map<string, string | null> {
  const addrSeen = new Map<string, { id: string; city: string | null; zip: string | null }[]>();
  const apnSeen = new Map<string, string>();
  const result = new Map<string, string | null>();

  for (const r of records) {
    const apn = r.apn?.trim() || null;
    const key = normalizeStreet(r.address_street);
    const scope = { city: r.address_city ?? null, zip: r.address_zip ?? null };

    // APN is an exact parcel id, so it outranks street text
    let dupOf: string | null = (apn && apnSeen.get(apn)) || null;
    if (!dupOf && key) {
      const hit = (addrSeen.get(key) || []).find((c) => !addressConflicts(scope, c));
      if (hit) dupOf = hit.id;
    }
    result.set(r.id, dupOf);

    if (!dupOf) {
      if (apn && !apnSeen.has(apn)) apnSeen.set(apn, r.id);
      if (key) {
        const bucket = addrSeen.get(key) || [];
        bucket.push({ id: r.id, city: scope.city, zip: scope.zip });
        addrSeen.set(key, bucket);
      }
    }
  }

  return result;
}
