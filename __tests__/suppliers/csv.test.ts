import {
  parseSupplierCsv,
  readBoundedSupplierCsv,
  serializeSuppliersCsv,
  SUPPLIER_CSV_HEADERS,
  SUPPLIER_CSV_LIMITS,
  SupplierCsvError,
} from '@/lib/suppliers/csv';

const header = SUPPLIER_CSV_HEADERS.join(',');

describe('supplier CSV exchange', () => {
  it('parses and normalizes a representative Indian supplier row', () => {
    const result = parseSupplierCsv(
      [
        header,
        [
          'Shree Balaji Fresh Produce',
          'Mehul Shah',
          '98765 43210',
          '+91 99887 76655',
          'SALES@BALAJIFRESH.IN',
          '41 APMC Market, Vashi',
          'Navi Mumbai',
          'Maharashtra',
          '400705',
          '27AAPFU0939F1ZV',
          'Delivery before 7 am',
          'true',
          'SELECTED_NEW',
          'VEGETABLES|DAIRY',
          'FRUITS',
          'SPICES_SEASONINGS',
          'tomato::Tomato|potato::Potato',
          'paneer::Paneer',
        ]
          .map((value) => `"${value}"`)
          .join(','),
      ].join('\r\n'),
    );

    expect(result).toEqual([
      {
        row: 2,
        supplier: {
          businessName: 'Shree Balaji Fresh Produce',
          contactName: 'Mehul Shah',
          phone: '+919876543210',
          whatsappNumber: '+919988776655',
          email: 'sales@balajifresh.in',
          addressLine: '41 APMC Market, Vashi',
          city: 'Navi Mumbai',
          state: 'Maharashtra',
          pin: '400705',
          gstin: '27AAPFU0939F1ZV',
          notes: 'Delivery before 7 am',
          isActive: true,
          relationshipType: 'SELECTED_NEW',
          capabilities: {
            v: 1,
            categories: [
              { category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 },
              { category: 'DAIRY', tier: 'CAPABLE', rank: 2 },
              { category: 'FRUITS', tier: 'PREFERRED', rank: 1 },
              { category: 'SPICES_SEASONINGS', tier: 'BACKUP', rank: 1 },
            ],
            items: [
              { itemKey: 'tomato', itemName: 'Tomato', tier: 'PREFERRED', rank: 1 },
              { itemKey: 'potato', itemName: 'Potato', tier: 'PREFERRED', rank: 2 },
              { itemKey: 'paneer', itemName: 'Paneer', tier: 'BACKUP', rank: 1 },
            ],
          },
        },
      },
    ]);
  });

  it('accepts a UTF-8 BOM and quoted commas through csv-parse', () => {
    expect(
      parseSupplierCsv(
        `\uFEFF${header}\r\n"Coastal Foods","Anita, Sales",,,,,Mumbai,Maharashtra,400001,,,,,,,,,`,
      )[0],
    ).toEqual(
      expect.objectContaining({
        row: 2,
        supplier: expect.objectContaining({
          businessName: 'Coastal Foods',
          contactName: 'Anita, Sales',
        }),
      }),
    );
  });

  it('rejects malformed, unknown, duplicate, or missing required headers', () => {
    for (const csv of [
      'business_name,unknown\nVendor,value',
      'business_name,business_name\nVendor,Other',
      'email,phone\nsales@vendor.in,9876543210',
      'business_name,email\n"Vendor,sales@vendor.in',
    ]) {
      expect(() => parseSupplierCsv(csv)).toThrow(SupplierCsvError);
    }
  });

  it.each([
    ['applicant relationship', 'APPLICANT', '', '', '', '', ''],
    ['unknown category', 'CURRENT', 'NOT_A_CATEGORY', '', '', '', ''],
    ['category repeated across tiers', 'CURRENT', 'FRUITS', 'FRUITS', '', '', ''],
    ['malformed item preference', 'CURRENT', '', '', '', 'Tomato', ''],
  ])('rejects %s', (_label, relationship, categories, preferred, backup, items, backupItems) => {
    const csv = [
      'business_name,relationship_type,categories,preferred_categories,backup_categories,preferred_items,backup_items',
      ['Vendor', relationship, categories, preferred, backup, items, backupItems]
        .map((value) => `"${value}"`).join(','),
    ].join('\n');
    expect(() => parseSupplierCsv(csv)).toThrow(SupplierCsvError);
  });

  it('reports row validation and within-file duplicate contacts without returning rows', () => {
    const csv = [
      header,
      'Vendor One,,9876543210,,SALES@VENDOR.IN,,,,,,,true,,,,,,',
      'Vendor Two,,+91 98765 43210,,sales@vendor.in,,,,,,,true,,,,,,',
      'Vendor Three,,bad,,not-an-email,,,Maharashtra,012345,INVALID,,true,,,,,,',
    ].join('\n');

    let caught: unknown;
    try {
      parseSupplierCsv(csv);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SupplierCsvError);
    expect(caught).toMatchObject({
      status: 422,
      errorCount: 6,
      errors: expect.arrayContaining([
        expect.objectContaining({ row: 3, field: 'email', code: 'duplicate' }),
        expect.objectContaining({ row: 3, field: 'phone', code: 'duplicate' }),
        expect.objectContaining({ row: 4, field: 'gstin', code: 'invalid' }),
      ]),
    });
  });

  it('caps import at 500 rows and error output at 50 compact entries', () => {
    const maximumRows = [
      'business_name',
      ...Array.from(
        { length: SUPPLIER_CSV_LIMITS.rows },
        (_, index) => `Vendor ${index + 1}`,
      ),
    ].join('\n');
    expect(parseSupplierCsv(maximumRows)).toHaveLength(
      SUPPLIER_CSV_LIMITS.rows,
    );

    const tooManyRows = [
      header,
      ...Array.from(
        { length: SUPPLIER_CSV_LIMITS.rows + 1 },
        (_, index) => `Vendor ${index + 1}${','.repeat(SUPPLIER_CSV_HEADERS.length - 1)}`,
      ),
    ].join('\n');
    expect(() => parseSupplierCsv(tooManyRows)).toThrow(
      expect.objectContaining({ code: 'CSV_ROW_LIMIT', status: 422 }),
    );

    const invalidRows = [
      header,
      ...Array.from(
        { length: 75 },
        (_, index) => `,Contact ${index + 1}${','.repeat(SUPPLIER_CSV_HEADERS.length - 2)}`,
      ),
    ].join('\n');
    try {
      parseSupplierCsv(invalidRows);
      throw new Error('Expected invalid CSV');
    } catch (error) {
      expect(error).toMatchObject({
        errorCount: 75,
        errors: expect.any(Array),
      });
      expect((error as SupplierCsvError).errors).toHaveLength(
        SUPPLIER_CSV_LIMITS.errorReport,
      );
      expect(JSON.stringify((error as SupplierCsvError).errors).length).toBeLessThan(
        8_000,
      );
    }
  });

  it('stops csv-parse after the first over-limit row in a many-short-row file', () => {
    const amplified = [
      'business_name',
      ...Array.from({ length: 100_000 }, () => 'V'),
    ].join('\n');
    expect(new TextEncoder().encode(amplified).byteLength).toBeLessThan(
      SUPPLIER_CSV_LIMITS.bodyBytes,
    );
    expect(
      (SUPPLIER_CSV_LIMITS as Record<string, number>).parserRecords,
    ).toBe(SUPPLIER_CSV_LIMITS.rows + 2);

    expect(() => parseSupplierCsv(amplified)).toThrow(
      expect.objectContaining({ code: 'CSV_ROW_LIMIT', status: 422 }),
    );
  });

  it('reports physical spreadsheet rows for malformed records after blank rows', () => {
    const csv = [
      'business_name,email,phone',
      '',
      'Valid,sales@valid.in,9876543210',
      '',
      'Short,sales@short.in',
      '',
      '',
      'Long,sales@long.in,9876543211,unexpected',
    ].join('\n');

    try {
      parseSupplierCsv(csv);
      throw new Error('Expected row-length validation errors.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CSV_INVALID_ROWS',
        status: 422,
        errorCount: 2,
        errors: [
          expect.objectContaining({
            row: 5,
            field: 'csv',
            message: 'Expected 3 columns but received 2.',
          }),
          expect.objectContaining({
            row: 8,
            field: 'csv',
            message: 'Expected 3 columns but received 4.',
          }),
        ],
      });
    }
  });

  it('enforces the one-megabyte request cap from content length and streamed bytes', async () => {
    const declared = new Request('http://localhost/api/suppliers/import', {
      method: 'POST',
      headers: {
        'content-length': String(SUPPLIER_CSV_LIMITS.bodyBytes + 1),
        'content-type': 'text/csv',
      },
      body: 'small',
    });
    await expect(readBoundedSupplierCsv(declared)).rejects.toMatchObject({
      code: 'CSV_BODY_LIMIT',
      status: 413,
    });

    const streamed = new Request('http://localhost/api/suppliers/import', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: 'x'.repeat(SUPPLIER_CSV_LIMITS.bodyBytes + 1),
    });
    await expect(readBoundedSupplierCsv(streamed)).rejects.toMatchObject({
      code: 'CSV_BODY_LIMIT',
      status: 413,
    });
  });

  it('exports deterministic CSV and neutralizes spreadsheet formulas', () => {
    const csv = serializeSuppliersCsv([
      {
        businessName: '=HYPERLINK("https://bad.example")',
        contactName: '+SUM(1,1)',
        phone: '+919876543210',
        whatsappNumber: null,
        email: 'sales@example.in',
        addressLine: '-2 Market Road',
        city: '@Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        gstin: '27AAPFU0939F1ZV',
        notes: '  =cmd',
        isActive: false,
        relationshipType: 'CURRENT' as const,
        capabilities: { v: 1 as const, categories: [], items: [] },
      },
    ]);

    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')[0]).toBe(
      SUPPLIER_CSV_HEADERS.map((value) => `"${value}"`).join(','),
    );
    expect(csv).toContain(`"'=HYPERLINK(""https://bad.example"")"`);
    expect(csv).toContain(`"'+SUM(1,1)"`);
    expect(csv).toContain(`"'-2 Market Road"`);
    expect(csv).toContain(`"'@Mumbai"`);
    expect(csv).toContain(`"'  =cmd"`);
    expect(csv).toContain('"false"');
  });

  it('round-trips spreadsheet-neutralized supplier fields through export and import', () => {
    const supplier = {
      businessName: '=Formula Produce',
      contactName: '+Sales Desk',
      phone: '+919876543210',
      whatsappNumber: '+919988776655',
      email: 'sales@example.in',
      addressLine: '-2 Market Road',
      city: '@Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      gstin: '27AAPFU0939F1ZV',
      notes: "'=keep this literal apostrophe",
      isActive: true,
      relationshipType: 'SELECTED_NEW' as const,
      capabilities: {
        v: 1 as const,
        categories: [{ category: 'FRUITS' as const, tier: 'PREFERRED' as const, rank: 1 }],
        items: [{
          itemKey: 'mango', itemName: '=Mango', tier: 'PREFERRED' as const, rank: 1,
        }],
      },
    };

    const exported = serializeSuppliersCsv([supplier]);

    expect(exported).toContain(`"'+919876543210"`);
    expect(exported).toContain(`"''=keep this literal apostrophe"`);
    expect(parseSupplierCsv(exported)).toEqual([{ row: 2, supplier }]);
  });
});
