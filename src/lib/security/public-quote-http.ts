import { NextResponse } from 'next/server';

import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import {
  exchangeSupplierGrantToken,
  PublicSupplierGrantError,
} from '@/lib/security/public-grant';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { publicClientRateLimit } from '@/lib/security/public-client-rate-limit';

const ACCESS_BODY_BYTES = 1_024;
export const SUPPLIER_SESSION_COOKIE = 'quoteplate_supplier_session';

type AccessDependencies = {
  exchange: typeof exchangeSupplierGrantToken;
  now: () => Date;
  production: boolean;
  clientRateLimit: (input: {
    request: Request;
    now: Date;
  }) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
};

const consumeAccessClientRateLimit = publicClientRateLimit('quote-access');

function clearSupplierSession(response: NextResponse, production: boolean) {
  response.cookies.set(SUPPLIER_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: production,
    path: '/api/public/quote',
    maxAge: 0,
  });
  return response;
}

function parseAccessBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.token !== 'string') {
    return null;
  }
  return { token: record.token };
}

function safeError(error: unknown, production: boolean) {
  if (error instanceof RequestBodyTooLargeError) {
    return privateNoStoreResponse(
      problemResponse(413, 'Request too large', error.message),
    );
  }
  if (error instanceof InvalidJsonBodyError) {
    return privateNoStoreResponse(problemResponse(400, 'Invalid request', error.message));
  }
  if (error instanceof PublicSupplierGrantError) {
    const response = problemResponse(
      error.status,
      error.code === 'RATE_LIMITED'
        ? 'Too many attempts'
        : 'Supplier link unavailable',
      error.message,
    );
    if (error.retryAfterSeconds) {
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
    }
    return clearSupplierSession(privateNoStoreResponse(response), production);
  }
  return privateNoStoreResponse(
    problemResponse(
      503,
      'Supplier link service unavailable',
      'Unable to open this supplier link right now. Try again shortly.',
    ),
  );
}

export function createPublicQuoteAccessHandler(
  dependencies: AccessDependencies = {
    exchange: exchangeSupplierGrantToken,
    now: () => new Date(),
    production: process.env.NODE_ENV === 'production',
    clientRateLimit: consumeAccessClientRateLimit,
  },
) {
  return async function publicQuoteAccess(request: Request) {
    try {
      const rejected = browserJsonMutationRejection(request);
      if (rejected) {
        return privateNoStoreResponse(
          rejected === 'CROSS_ORIGIN'
            ? problemResponse(
                403,
                'Request not allowed',
                'Open this supplier link on its original QuotePlate page.',
              )
            : problemResponse(
                415,
                'Unsupported media type',
                'Send this request as application/json.',
              ),
        );
      }
      const body = parseAccessBody(
        await readBoundedJson(request, ACCESS_BODY_BYTES),
      );
      if (!body) {
        return privateNoStoreResponse(
          problemResponse(
            400,
            'Invalid request',
            'Provide only the supplier link token.',
          ),
        );
      }

      const currentTime = dependencies.now();
      const clientAttempt = await dependencies.clientRateLimit({
        request,
        now: currentTime,
      });
      if (!clientAttempt.allowed) {
        const response = privateNoStoreResponse(
          problemResponse(
            429,
            'Too many attempts',
            'Wait before opening another supplier link.',
          ),
        );
        response.headers.set(
          'Retry-After',
          String(clientAttempt.retryAfterSeconds),
        );
        return response;
      }

      await dependencies.exchange({ token: body.token, now: currentTime });
      const response = privateNoStoreResponse(
        NextResponse.json({ ok: true }, { status: 201 }),
      );
      response.cookies.set(SUPPLIER_SESSION_COOKIE, body.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: dependencies.production,
        path: '/api/public/quote',
      });
      return response;
    } catch (error) {
      return safeError(error, dependencies.production);
    }
  };
}
