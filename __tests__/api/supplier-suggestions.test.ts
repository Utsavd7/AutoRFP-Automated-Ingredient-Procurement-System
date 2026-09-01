import { GET } from '@/app/api/requests/[id]/suggestions/route';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  getSupplierSuggestions,
  SupplierSuggestionsCapacityError,
  SupplierSuggestionsNotFoundError,
} from '@/lib/suggestions/supplier-suggestions';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/suggestions/supplier-suggestions', () => ({
  getSupplierSuggestions: jest.fn(),
  SupplierSuggestionsCapacityError: jest.requireActual('@/lib/suggestions/supplier-suggestions').SupplierSuggestionsCapacityError,
  SupplierSuggestionsNotFoundError: jest.requireActual('@/lib/suggestions/supplier-suggestions').SupplierSuggestionsNotFoundError,
}));

const context = { params: Promise.resolve({ id: 'request-a' }) };

describe('supplier suggestions API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue({
      tenant: { id: 'tenant-a' }, user: { id: 'member-a' },
    } as never);
  });

  it('uses authenticated tenancy and returns private deterministic suggestions', async () => {
    const suggestions = {
      requestId: 'request-a', requestVersion: 2,
      suggestionsByItemId: { item: [{ supplierId: 'supplier-a', businessName: 'A Foods', reason: 'Preferred for this item', selected: false as const }] },
    };
    jest.mocked(getSupplierSuggestions).mockResolvedValue(suggestions);

    const response = await GET(new Request('http://localhost/api/requests/request-a/suggestions?tenantId=tenant-b'), context);

    expect(getSupplierSuggestions).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, requestId: 'request-a',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(suggestions);
  });

  it('maps missing sessions, inaccessible requests, and inactive actors without leaking identifiers', async () => {
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const missingSession = await GET(new Request('http://localhost/api/requests/request-a/suggestions'), context);

    jest.mocked(getSupplierSuggestions).mockRejectedValueOnce(new SupplierSuggestionsNotFoundError());
    const missingRequest = await GET(new Request('http://localhost/api/requests/request-a/suggestions'), context);

    jest.mocked(getSupplierSuggestions).mockRejectedValueOnce(new AuthorizationError());
    const forbidden = await GET(new Request('http://localhost/api/requests/request-a/suggestions'), context);

    expect(missingSession.status).toBe(401);
    expect(missingRequest.status).toBe(404);
    expect(forbidden.status).toBe(403);
    for (const response of [missingSession, missingRequest, forbidden]) {
      expect(JSON.stringify(await response.json())).not.toContain('tenant-a');
    }
  });

  it('returns a bounded conflict when the supplier directory exceeds the safe scan limit', async () => {
    jest.mocked(getSupplierSuggestions).mockRejectedValueOnce(
      new SupplierSuggestionsCapacityError(),
    );

    const response = await GET(
      new Request('http://localhost/api/requests/request-a/suggestions'),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      title: 'Supplier suggestions need a smaller directory',
    }));
  });
});
