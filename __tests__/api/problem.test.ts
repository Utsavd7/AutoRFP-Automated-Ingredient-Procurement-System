import { problemResponse } from '@/lib/api/problem';

function createLeakingFunction(scope: string) {
  return Object.assign(
    () => ({ stack: `${scope}_TO_JSON_PROPERTY_LEAK` }),
    { toJSON: () => ({ stack: `${scope}_FUNCTION_VALUE_LEAK` }) },
  );
}

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

  it('recursively omits exception objects and stack traces from nested extensions', async () => {
    const exception = Object.assign(new Error('nested database password exposed'), {
      internalCode: 'NESTED_DB_SECRET',
    });

    const response = problemResponse(500, 'Internal server error', 'Please try again later.', {
      diagnostics: {
        requestId: 'request_789',
        nested: {
          exception,
          reason: exception,
          stack: exception.stack,
          safe: 'retained',
        },
        attempts: [
          { status: 'failed', error: exception },
          exception,
          { status: 'queued' },
        ],
      },
    });
    const body = await response.json();

    expect(body.diagnostics).toEqual({
      requestId: 'request_789',
      nested: { safe: 'retained' },
      attempts: [{ status: 'failed' }, { status: 'queued' }],
    });
    expect(JSON.stringify(body)).not.toContain('nested database password exposed');
    expect(JSON.stringify(body)).not.toContain('NESTED_DB_SECRET');
  });

  it('omits reserved toJSON properties from top-level extensions', async () => {
    const response = problemResponse(400, 'Bad request', 'Check the request.', {
      requestId: 'request_top_level_property',
      toJSON: createLeakingFunction('TOP_LEVEL'),
    });

    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      status: 400,
      title: 'Bad request',
      detail: 'Check the request.',
      requestId: 'request_top_level_property',
    });
  });

  it('omits function values from top-level extensions', async () => {
    const response = problemResponse(400, 'Bad request', 'Check the request.', {
      requestId: 'request_top_level_function',
      callback: createLeakingFunction('TOP_LEVEL'),
    });

    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      status: 400,
      title: 'Bad request',
      detail: 'Check the request.',
      requestId: 'request_top_level_function',
    });
  });

  it('recursively omits reserved toJSON properties from nested extensions', async () => {
    const response = problemResponse(400, 'Bad request', 'Check the request.', {
      diagnostics: {
        safe: 'retained',
        toJSON: createLeakingFunction('NESTED'),
      },
    });

    const body = await response.json();
    expect(body.diagnostics).toEqual({ safe: 'retained' });
  });

  it('recursively omits function values from nested extensions', async () => {
    const response = problemResponse(400, 'Bad request', 'Check the request.', {
      diagnostics: {
        safe: 'retained',
        callback: createLeakingFunction('NESTED'),
      },
    });

    const body = await response.json();
    expect(body.diagnostics).toEqual({ safe: 'retained' });
  });

  it('omits circular references without overflowing the stack', async () => {
    const circularRecord: Record<string, unknown> = { safe: 'retained' };
    circularRecord.self = circularRecord;
    const circularArray: unknown[] = ['retained'];
    circularArray.push(circularArray);

    const response = problemResponse(400, 'Bad request', 'Check the request.', {
      circularRecord,
      circularArray,
    });

    await expect(response.json()).resolves.toMatchObject({
      circularRecord: { safe: 'retained' },
      circularArray: ['retained'],
    });
  });
});
