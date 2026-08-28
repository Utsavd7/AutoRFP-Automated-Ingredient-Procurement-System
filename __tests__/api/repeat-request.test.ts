import { POST as repeatRoute } from '@/app/api/requests/[id]/repeat/route';
import {
  ProcurementRequestConflictError,
  repeatProcurementRequest,
} from '@/lib/procurement/request-service';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/procurement/request-service', () => ({
  repeatProcurementRequest: jest.fn(),
  ProcurementRequestConflictError: jest.requireActual('@/lib/procurement/request-service').ProcurementRequestConflictError,
  ProcurementRequestValidationError: jest.requireActual('@/lib/procurement/request-service').ProcurementRequestValidationError,
  ProcurementRequestNotFoundError: jest.requireActual('@/lib/procurement/request-service').ProcurementRequestNotFoundError,
}));

const account = {
  tenant: { id: 'tenant-a' },
  user: { id: 'member-a', tenantId: 'tenant-a', role: 'MEMBER', isActive: true },
};
const context = { params: Promise.resolve({ id: 'request-a' }) };
const body = {
  expectedSourceVersion: 3,
  title: 'Produce · next week',
  deliveryDate: '2027-01-17',
  quoteDeadline: '2027-01-16T10:00:00.000Z',
};

function request(value: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/requests/request-a/repeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', ...headers },
    body: JSON.stringify(value),
  });
}

describe('repeat procurement request API', () => {
  beforeEach(() => {
    jest.mocked(requireAccountContext).mockReset();
    jest.mocked(repeatProcurementRequest).mockReset();
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  });

  it('creates an actor-scoped draft from the server-selected source', async () => {
    jest.mocked(repeatProcurementRequest).mockResolvedValue({ id: 'request-new', status: 'DRAFT', sourceRequestId: 'request-a' } as never);
    const response = await repeatRoute(request({ ...body, tenantId: 'tenant-b' }), context);
    expect(repeatProcurementRequest).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      sourceRequestId: 'request-a',
      repeat: expect.objectContaining(body),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ request: { id: 'request-new', status: 'DRAFT' } });
  });

  it('rejects cross-origin and non-JSON requests before authentication or database work', async () => {
    const crossOrigin = await repeatRoute(request(body, { Origin: 'https://evil.example' }), context);
    const text = await repeatRoute(new Request('http://localhost/api/requests/request-a/repeat', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    }), context);
    expect(crossOrigin.status).toBe(403);
    expect(text.status).toBe(415);
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(repeatProcurementRequest).not.toHaveBeenCalled();
  });

  it('maps completed-state conflicts without exposing other tenant records', async () => {
    jest.mocked(repeatProcurementRequest).mockRejectedValue(new ProcurementRequestConflictError('Only a completed award can be run again.'));
    const response = await repeatRoute(request(body), context);
    expect(response.status).toBe(409);
    const problem = await response.json();
    expect(problem).toMatchObject({ detail: 'Only a completed award can be run again.' });
    expect(problem).not.toHaveProperty('tenantId');
  });
});
