import { problemResponse } from '@/lib/api/problem';

describe('problemResponse', () => {
  it('returns RFC problem details without internal exceptions', async () => {
    const response = problemResponse(422, 'Invalid request', 'Correct the highlighted fields.', {
      errors: { menuText: ['Required'] },
    });

    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({
      type: 'about:blank',
      status: 422,
      title: 'Invalid request',
      detail: 'Correct the highlighted fields.',
      errors: { menuText: ['Required'] },
    });
  });

  it('does not allow extensions to replace core problem fields', async () => {
    const response = problemResponse(400, 'Bad request', 'Check the submitted values.', {
      type: 'https://example.com/internal',
      status: 500,
      title: 'Database failure',
      detail: 'The database password was exposed.',
      requestId: 'request_123',
    });

    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      status: 400,
      title: 'Bad request',
      detail: 'Check the submitted values.',
      requestId: 'request_123',
    });
  });

  it('omits exception objects and stack traces from extensions', async () => {
    const exception = Object.assign(new Error('database password exposed'), {
      internalCode: 'DB_SECRET',
    });

    const response = problemResponse(500, 'Internal server error', 'Please try again later.', {
      exception,
      reason: exception,
      stack: exception.stack,
      requestId: 'request_456',
    });
    const body = await response.json();

    expect(body).toEqual({
      type: 'about:blank',
      status: 500,
      title: 'Internal server error',
      detail: 'Please try again later.',
      requestId: 'request_456',
    });
    expect(JSON.stringify(body)).not.toContain('database password exposed');
    expect(JSON.stringify(body)).not.toContain('DB_SECRET');
  });
});
