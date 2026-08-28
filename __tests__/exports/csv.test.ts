import {
  safeCsvFilename,
  safeExportFilename,
  serializeCsv,
} from '@/lib/exports/csv';

describe('safe CSV exports', () => {
  it('uses deterministic CRLF CSV with a UTF-8 BOM', () => {
    expect(serializeCsv([
      ['Item', 'Amount'],
      ['Tomato', '83664.00'],
    ])).toBe('\uFEFF"Item","Amount"\r\n"Tomato","83664.00"\r\n');
  });

  it.each(['=2+3', '+SUM(A1:A2)', '-1+2', '@IMPORTXML(1)', "'=2+3", '  =2+3'])(
    'neutralizes spreadsheet formulas in %s',
    (attack) => {
      const csv = serializeCsv([['Value'], [attack]]);
      expect(csv).not.toContain(`\r\n"${attack.replaceAll('"', '""')}"`);
      expect(csv).toContain("'" + attack);
    },
  );

  it('quotes commas, quotes, newlines and null values', () => {
    expect(serializeCsv([['a,b', 'say "yes"', 'one\ntwo', null]])).toContain(
      '"a,b","say ""yes""","one\ntwo",""',
    );
  });

  it('creates bounded ascii filenames', () => {
    expect(safeCsvFilename('Fresh produce · Week 36', 'quotes')).toBe(
      'fresh-produce-week-36-quotes.csv',
    );
    expect(safeCsvFilename('../../', 'award')).toBe('quoteplate-award.csv');
    expect(safeExportFilename('Fresh produce · Week 36', 'po GreenLeaf', 'pdf')).toBe(
      'fresh-produce-week-36-po-greenleaf.pdf',
    );
    expect(safeExportFilename('../..', '', 'png')).toBe('quoteplate-export.png');
  });
});
