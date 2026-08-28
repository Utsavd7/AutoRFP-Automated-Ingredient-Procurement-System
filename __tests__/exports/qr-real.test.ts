import jsQR from 'jsqr';
import { PNG } from 'pngjs';

import { renderSupplierLinkQr } from '@/lib/exports/qr';

test('the production QR contains exactly the canonical supplier quote URL', async () => {
  const url = `https://quoteplate.example/quote#token=${'Q'.repeat(43)}`;
  const bytes = await renderSupplierLinkQr(url);
  const png = PNG.sync.read(Buffer.from(bytes));
  const decoded = jsQR(
    new Uint8ClampedArray(png.data),
    png.width,
    png.height,
    { inversionAttempts: 'dontInvert' },
  );

  expect(Buffer.from(bytes).subarray(0, 8)).toEqual(
    Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'),
  );
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(decoded?.data).toBe(url);
}, 15_000);
