import {
  GET as requestExport,
  maxDuration as requestExportMaxDuration,
} from '@/app/api/requests/[id]/export/route';
import {
  maxDuration as requestQrMaxDuration,
  POST as requestQr,
} from '@/app/api/requests/[id]/qr/route';
import {
  GET as purchaseOrder,
  maxDuration as purchaseOrderMaxDuration,
} from '@/app/api/awards/[id]/purchase-orders/[supplierId]/route';
import {
  ExportConflictError,
  ExportNotFoundError,
  ExportTimeoutError,
  ExportTooLargeError,
  exportOperations,
  parseSupplierShareUrl,
} from '@/lib/exports/export-service';
import {
  EXPORT_TIMEOUT_MS,
  runExportWithTimeout,
} from '@/lib/exports/export-http';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/exports/export-service', () => ({
  ...jest.requireActual('@/lib/exports/export-service'),
  exportOperations: {
    requestCsv: jest.fn(),
    qr: jest.fn(),
    purchaseOrder: jest.fn(),
  },
}));

const account = {
  tenant: { id: 'tenant-a' },
  user: { id: 'member-a', tenantId: 'tenant-a', role: 'MEMBER', isActive: true },
};
const requestContext = { params: Promise.resolve({ id: 'request-a' }) };
const poContext = {
  params: Promise.resolve({ id: 'award-a', supplierId: 'supplier-a' }),
};
const token = 'Q'.repeat(43);
const previousNextAuthUrl = process.env.NEXTAUTH_URL;

function png(bytes = 100) {
  return {
    bytes: new Uint8Array(bytes),
    filename: 'fresh-produce-quote-link-greenleaf.png',
    mediaType: 'image/png' as const,
  };
}

function qrRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://quoteplate.example/api/requests/request-a/qr', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://quoteplate.example',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('request exports API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXTAUTH_URL = 'https://quoteplate.example';
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  });

  afterAll(() => {
    if (previousNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousNextAuthUrl;
  });

  it('keeps every export inside the free-host function budget', () => {
    expect(requestExportMaxDuration).toBe(10);
    expect(requestQrMaxDuration).toBe(10);
    expect(purchaseOrderMaxDuration).toBe(10);
    expect(EXPORT_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it('fails a stalled export with a typed timeout and private 503 response', async () => {
    jest.useFakeTimers();
    try {
      const stalled = new Promise<never>(() => undefined);
      const typedTimeout = runExportWithTimeout(stalled, 25);
      await jest.advanceTimersByTimeAsync(25);
      await expect(typedTimeout).rejects.toBeInstanceOf(ExportTimeoutError);

      jest.mocked(exportOperations.requestCsv).mockReturnValue(
        new Promise(() => undefined),
      );
      const responsePromise = requestExport(
        new Request('https://quoteplate.example/api/requests/request-a/export?kind=request'),
        requestContext as never,
      );
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(EXPORT_TIMEOUT_MS);
      const response = await responsePromise;
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      await expect(response.json()).resolves.toMatchObject({
        title: 'Export timed out',
        status: 503,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['request', 'quotes', 'award', 'accounting'] as const)(
    'returns a private on-demand %s CSV for the session tenant',
    async (kind) => {
      jest.mocked(exportOperations.requestCsv).mockResolvedValue({
        bytes: new TextEncoder().encode('\uFEFF"Request ID"\r\n"request-a"\r\n'),
        filename: `fresh-produce-${kind}.csv`,
        mediaType: 'text/csv; charset=utf-8',
      });

      const response = await requestExport(
        new Request(`https://quoteplate.example/api/requests/request-a/export?kind=${kind}`),
        requestContext as never,
      );

      expect(exportOperations.requestCsv).toHaveBeenCalledWith({
        actor: { tenantId: 'tenant-a', userId: 'member-a' }, requestId: 'request-a', kind,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="fresh-produce-${kind}.csv"`,
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    },
  );

  it('authenticates before export and maps missing/uncommitted records safely', async () => {
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const unauthorized = await requestExport(
      new Request('https://quoteplate.example/api/requests/request-a/export?kind=request'),
      requestContext as never,
    );
    expect(unauthorized.status).toBe(401);
    expect(exportOperations.requestCsv).not.toHaveBeenCalled();

    jest.mocked(exportOperations.requestCsv)
      .mockRejectedValueOnce(new ExportNotFoundError())
      .mockRejectedValueOnce(new ExportConflictError('Record an award first.'));
    const missing = await requestExport(
      new Request('https://quoteplate.example/api/requests/request-a/export?kind=request'),
      requestContext as never,
    );
    const conflict = await requestExport(
      new Request('https://quoteplate.example/api/requests/request-a/export?kind=award'),
      requestContext as never,
    );
    expect(missing.status).toBe(404);
    expect(conflict.status).toBe(409);
    await expect(missing.json()).resolves.not.toHaveProperty('tenantId');
  });

  it('enforces the 8 MiB response cap even if an export dependency misbehaves', async () => {
    jest.mocked(exportOperations.requestCsv).mockResolvedValue({
      bytes: new Uint8Array(8 * 1_024 * 1_024 + 1),
      filename: 'fresh-produce-request.csv',
      mediaType: 'text/csv; charset=utf-8',
    });
    const response = await requestExport(
      new Request('https://quoteplate.example/api/requests/request-a/export?kind=request'),
      requestContext as never,
    );
    expect(response.status).toBe(413);
  });

  it('creates a QR from bounded same-origin JSON without putting the token in route metadata', async () => {
    jest.mocked(exportOperations.qr).mockResolvedValue(png());
    const url = `https://quoteplate.example/quote#token=${token}`;
    const response = await requestQr(qrRequest({ url }), requestContext as never);

    expect(exportOperations.qr).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, requestId: 'request-a',
      expectedOrigin: 'https://quoteplate.example', url,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...response.headers.entries()].join('\n')).not.toContain(token);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('separates preview CSRF origin from canonical supplier-link origin', async () => {
    process.env.NEXTAUTH_URL = 'https://app.quoteplate.in';
    jest.mocked(exportOperations.qr).mockImplementation(async (input) => {
      parseSupplierShareUrl(input.url, input.expectedOrigin);
      return png();
    });
    const qrThroughPreview = (url: string) => requestQr(
        new Request('http://internal-next:3000/api/requests/request-a/qr', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            host: 'preview.quoteplate.vercel.app',
            origin: 'https://preview.quoteplate.vercel.app',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-proto': 'https',
          },
          body: JSON.stringify({ url }),
        }),
        requestContext as never,
      );
    const canonicalUrl = `https://app.quoteplate.in/quote#token=${token}`;
    const aliasUrl = `https://preview.quoteplate.vercel.app/quote#token=${token}`;

    const canonical = await qrThroughPreview(canonicalUrl);
    const alias = await qrThroughPreview(aliasUrl);

    expect(canonical.status).toBe(200);
    expect(exportOperations.qr).toHaveBeenNthCalledWith(1, expect.objectContaining({
        expectedOrigin: 'https://app.quoteplate.in',
        url: canonicalUrl,
      }));
    expect(alias.status).toBe(404);
    await expect(alias.json()).resolves.toMatchObject({
      title: 'Export unavailable',
      detail: 'The requested record is unavailable.',
    });
  });

  it('rejects cross-origin, non-JSON, malformed, unknown-field, and oversized QR requests before export', async () => {
    const crossOrigin = await requestQr(
      qrRequest({ url: 'x' }, { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }),
      requestContext as never,
    );
    const form = await requestQr(
      new Request('https://quoteplate.example/api/requests/request-a/qr', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://quoteplate.example' },
        body: 'url=x',
      }),
      requestContext as never,
    );
    const malformed = await requestQr(qrRequest('{'), requestContext as never);
    const unknown = await requestQr(qrRequest({ url: 'x', token: 'secret' }), requestContext as never);
    const oversized = await requestQr(
      new Request('https://quoteplate.example/api/requests/request-a/qr', {
        method: 'POST',
        headers: {
          'content-type': 'application/json', origin: 'https://quoteplate.example',
          'content-length': String(8 * 1_024 + 1),
        },
        body: '{}',
      }),
      requestContext as never,
    );

    expect(crossOrigin.status).toBe(403);
    expect(form.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(unknown.status).toBe(422);
    expect(oversized.status).toBe(413);
    expect(exportOperations.qr).not.toHaveBeenCalled();
  });

  it('returns one private supplier purchase order from a committed award', async () => {
    jest.mocked(exportOperations.purchaseOrder).mockResolvedValue({
      bytes: new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2_000)])),
      filename: 'fresh-produce-po-greenleaf.pdf',
      mediaType: 'application/pdf',
    });

    const response = await purchaseOrder(
      new Request('https://quoteplate.example/api/awards/award-a/purchase-orders/supplier-a'),
      poContext as never,
    );

    expect(exportOperations.purchaseOrder).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      awardId: 'award-a', supplierId: 'supplier-a',
    });
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('fresh-produce-po-greenleaf.pdf');
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('returns 413 when the production PDF renderer reaches the export limit', async () => {
    jest.mocked(exportOperations.purchaseOrder).mockRejectedValue(
      new ExportTooLargeError(),
    );

    const response = await purchaseOrder(
      new Request('https://quoteplate.example/api/awards/award-a/purchase-orders/supplier-a'),
      poContext as never,
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      title: 'Export too large',
      status: 413,
    });
  });
});
