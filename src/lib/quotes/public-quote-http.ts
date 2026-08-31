import { NextResponse } from 'next/server';

import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import {
  getPublicQuoteRequest,
  PUBLIC_QUOTE_BODY_BYTES,
  PublicQuoteDocumentSizeError,
  PublicQuoteReadLimitError,
  PublicQuoteRevisionConflictError,
  PublicQuoteRevisionLimitError,
  PublicQuoteSubmissionLimitError,
  PublicQuoteUnavailableError,
  PublicQuoteValidationError,
  submitPublicSupplierQuote,
} from '@/lib/quotes/public-quote-service';
import { SUPPLIER_SESSION_COOKIE } from '@/lib/security/public-quote-http';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import {
  type PublicClientRateLimit,
  publicClientRateLimit,
} from '@/lib/security/public-client-rate-limit';

type PublicQuoteDependencies = {
  load: typeof getPublicQuoteRequest;
  submit: typeof submitPublicSupplierQuote;
  readRateLimit?: PublicClientRateLimit;
  submissionClientRateLimit?: PublicClientRateLimit;
  now?: () => Date;
  production?: boolean;
};

const consumeReadRateLimit = publicClientRateLimit('quote-read');
const consumeSubmissionClientRateLimit = publicClientRateLimit('quote-submit');

function privacyHeaders(response: NextResponse) {
  return privateNoStoreResponse(response);
}

function sessionToken(request: Request) {
  const values = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SUPPLIER_SESSION_COOKIE}=`))
    .map((part) => part.slice(SUPPLIER_SESSION_COOKIE.length + 1));
  if (values.length !== 1 || !values[0]) return null;
  try {
    return decodeURIComponent(values[0]);
  } catch {
    return null;
  }
}

function clearSession(response: NextResponse, production: boolean) {
  response.cookies.set(SUPPLIER_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: production,
    path: '/api/public/quote',
    maxAge: 0,
  });
  return response;
}

function unavailableResponse(production: boolean) {
  return clearSession(
    privacyHeaders(
      problemResponse(
        410,
        'Supplier link unavailable',
        'This supplier link is invalid or no longer available.',
      ),
    ),
    production,
  );
}

function errorResponse(error: unknown, production: boolean) {
  if (error instanceof PublicQuoteUnavailableError) {
    return unavailableResponse(production);
  }
  if (error instanceof PublicQuoteValidationError) {
    return privacyHeaders(
      problemResponse(
        422,
        'Check your quote',
        error.message,
        { errors: error.errors },
      ),
    );
  }
  if (error instanceof PublicQuoteReadLimitError) {
    const response = privacyHeaders(
      problemResponse(429, 'Too many requests', error.message),
    );
    response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
  if (error instanceof PublicQuoteSubmissionLimitError) {
    const response = privacyHeaders(
      problemResponse(429, 'Too many quote submissions', error.message),
    );
    response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
  if (
    error instanceof PublicQuoteRevisionConflictError ||
    error instanceof PublicQuoteRevisionLimitError ||
    error instanceof PublicQuoteDocumentSizeError
  ) {
    return privacyHeaders(
      problemResponse(409, 'Quote changed', error.message),
    );
  }
  if (error instanceof RequestBodyTooLargeError) {
    return privacyHeaders(
      problemResponse(413, 'Request too large', error.message),
    );
  }
  if (error instanceof InvalidJsonBodyError) {
    return privacyHeaders(problemResponse(400, 'Invalid request', error.message));
  }
  return privacyHeaders(
    problemResponse(
      503,
      'Quote service unavailable',
      'Unable to save this quote right now. Try again shortly.',
    ),
  );
}

export function createPublicQuoteHandlers(
  dependencies: PublicQuoteDependencies = {
    load: getPublicQuoteRequest,
    submit: submitPublicSupplierQuote,
    production: process.env.NODE_ENV === 'production',
  },
) {
  const production = dependencies.production ?? false;
  const readRateLimit = dependencies.readRateLimit ?? consumeReadRateLimit;
  const submissionClientRateLimit =
    dependencies.submissionClientRateLimit ?? consumeSubmissionClientRateLimit;
  const now = dependencies.now ?? (() => new Date());

  return {
    async GET(request: Request) {
      const token = sessionToken(request);
      if (!token) return unavailableResponse(production);
      try {
        const attempt = await readRateLimit({ request, now: now() });
        if (!attempt.allowed) {
          const response = privacyHeaders(
            problemResponse(
              429,
              'Too many requests',
              'Wait before refreshing this supplier quote.',
            ),
          );
          response.headers.set('Retry-After', String(attempt.retryAfterSeconds));
          return response;
        }
        const result = await dependencies.load({ token });
        return privacyHeaders(NextResponse.json(result));
      } catch (error) {
        return errorResponse(error, production);
      }
    },
    async POST(request: Request) {
      const token = sessionToken(request);
      if (!token) return unavailableResponse(production);
      const rejected = browserJsonMutationRejection(request);
      if (rejected) {
        return privacyHeaders(
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
      try {
        const currentTime = now();
        const clientAttempt = await submissionClientRateLimit({
          request,
          now: currentTime,
        });
        if (!clientAttempt.allowed) {
          const response = privacyHeaders(
            problemResponse(
              429,
              'Too many quote submissions',
              'Wait before submitting another quote.',
            ),
          );
          response.headers.set(
            'Retry-After',
            String(clientAttempt.retryAfterSeconds),
          );
          return response;
        }
        const quote = await readBoundedJson(request, PUBLIC_QUOTE_BODY_BYTES);
        const result = await dependencies.submit({ token, quote });
        return privacyHeaders(NextResponse.json(result, { status: 201 }));
      } catch (error) {
        return errorResponse(error, production);
      }
    },
  };
}
