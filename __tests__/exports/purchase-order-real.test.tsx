import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { build } from 'esbuild';

const purchaseOrder = {
  awardId: 'award-real-1234', requestId: 'request-real-1234', requestTitle: 'Fresh produce week 36',
  awardedAt: '2026-08-28T10:00:00.000Z',
  buyer: {
    name: 'Cedar Table Hospitality', gstin: '27ABCDE1234F1Z5', addressLine: '18 Market Road',
    city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000',
  },
  delivery: {
    requestedDeliveryDate: '2026-09-05', addressLine: 'Service gate, 18 Market Road',
    city: 'Mumbai', state: 'Maharashtra', pin: '400001', instructions: 'Deliver before 8:00 AM.',
    commercialTerms: 'Rates must include packing.',
  },
  supplier: {
    supplierId: 'supplier-real-1234', supplierName: 'GreenLeaf Fresh Foods', gstin: '27ABCDE9999F1Z1',
    contactName: 'Anita Shah', phone: '9111111111', email: 'orders@greenleaf.example',
    addressLine: '7 APMC Yard', city: 'Navi Mumbai', state: 'Maharashtra', pin: '400705',
    freightPaise: '50000', minimumOrder: 'Minimum invoice INR 2,500.',
    commercialTerms: 'Payment in 15 days.', notes: 'Use ventilated crates.',
    deliveryDate: '2026-09-06', validUntil: '2026-09-04',
  },
  lines: [{
    requestItemId: 'item-1', itemName: 'Tomato', quantity: '100', unit: 'KILOGRAM',
    requestedDescription: 'Firm red tomato', requestedBrand: 'Farm Select', suppliedBrand: 'Market Fresh',
    requestedPackSize: '5 kg crate', suppliedPackSize: '10 kg crate',
    requestedQualityGrade: 'A', suppliedQualityGrade: 'Premium', substitution: 'Roma tomato',
    unitRatePaise: '79680', gstBasisPoints: 500, subtotalPaise: '7968000',
    taxInclusive: false, gstPaise: '398400', totalPaise: '8366400',
  }],
  subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '50000', totalPaise: '8416400',
};

function decodedPdfText(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString('latin1');
  const decoded: string[] = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let stream = Buffer.from(match[1], 'latin1');
    try {
      stream = inflateSync(stream);
    } catch {
      // Metadata and other uncompressed streams are still useful below.
    }
    for (const hex of stream.toString('latin1').matchAll(/<([0-9a-f]+)>/gi)) {
      decoded.push(Buffer.from(hex[1], 'hex').toString('latin1'));
    }
  }
  return decoded.join('');
}

test('the production renderer creates an A4 purchase order with committed commercial facts', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.quoteplate-pdf-test-'));
  const entry = join(directory, 'render.ts');
  const bundle = join(directory, 'render.mjs');
  const pdf = join(directory, 'purchase-order.pdf');
  writeFileSync(entry, `
    import { writeFileSync } from 'node:fs';
    import { renderPurchaseOrderPdf } from ${JSON.stringify(resolve('src/lib/exports/purchase-order.tsx'))};
    const data = ${JSON.stringify(purchaseOrder)};
    writeFileSync(process.argv[2], await renderPurchaseOrderPdf(data));
  `);

  let bytes: Buffer;
  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: bundle,
      external: ['@react-pdf/renderer'],
      logLevel: 'silent',
    });
    execFileSync(process.execPath, [bundle, pdf]);
    bytes = readFileSync(pdf);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const raw = bytes.toString('latin1');
  const text = decodedPdfText(bytes);

  expect(Buffer.from(bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(raw).toMatch(/\/MediaBox\s*\[0 0 595(?:\.\d+)? 841(?:\.\d+)?\]/);
  expect(text).toContain('Requested delivery: 2026-09-05');
  expect(text).toContain('Supplier committed delivery: 2026-09-06');
  expect(text).toContain('Payment in 15 days.');
  expect(text).toContain('Firm red tomato');
  expect(text).toContain('Farm Select');
  expect(text).toContain('Market Fresh');
  expect(text).toContain('Roma tomato');
  expect(text).toContain('Rates must include packing.');
  expect(text).not.toContain('Award note');
  expect(text).toContain('INR 84164.00');
});
