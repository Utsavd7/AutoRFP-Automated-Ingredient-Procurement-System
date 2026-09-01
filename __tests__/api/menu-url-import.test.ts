import { POST } from '@/app/api/menu-import/url/route';
import { importPermittedMenuUrl } from '@/lib/menu/url-import';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/menu/url-import', () => {
  const actual = jest.requireActual('@/lib/menu/url-import');
  return { ...actual, importPermittedMenuUrl: jest.fn() };
});

function request(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request('http://localhost/api/menu-import/url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('menu URL import API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue({
      tenant: { id: 'tenant-a' }, user: { id: 'member-a' },
    } as never);
  });

  it('returns bounded visible text without persisting it', async () => {
    jest.mocked(importPermittedMenuUrl).mockResolvedValue({
      menuText: 'Paneer Tikka\nDal Makhani',
      canonicalUrl: 'https://restaurant.example/menu',
    });
    const response = await POST(request({
      url: 'https://restaurant.example/menu?from=owner',
      permissionConfirmed: true,
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      menuText: 'Paneer Tikka\nDal Makhani',
      canonicalUrl: 'https://restaurant.example/menu',
    });
  });

  it('rejects cross-origin, non-JSON, unauthenticated, and oversized requests before import', async () => {
    const crossOrigin = await POST(request({
      url: 'https://restaurant.example/menu', permissionConfirmed: true,
    }, { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' }));
    const text = await POST(new Request('http://localhost/api/menu-import/url', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    }));
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const unauthorized = await POST(request({
      url: 'https://restaurant.example/menu', permissionConfirmed: true,
    }));
    const oversized = await POST(request({
      url: `https://restaurant.example/${'a'.repeat(4_200)}`,
      permissionConfirmed: true,
    }));

    expect([crossOrigin.status, text.status, unauthorized.status, oversized.status])
      .toEqual([403, 415, 401, 413]);
    expect(importPermittedMenuUrl).not.toHaveBeenCalled();
  });
});
