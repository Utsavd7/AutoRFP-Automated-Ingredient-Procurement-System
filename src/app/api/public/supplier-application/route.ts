import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { privateNoStoreResponse } from '@/lib/api/private-response';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { publicClientRateLimit } from '@/lib/security/public-client-rate-limit';
import { PublicSupplierGrantError } from '@/lib/security/public-grant';
import {
  PUBLIC_SUPPLIER_APPLICATION_UNAVAILABLE_MESSAGE,
  PublicSupplierApplicationUnavailableError,
  PublicSupplierApplicationValidationError,
  submitPublicSupplierApplication,
} from '@/lib/suppliers/public-application-service';

export const PUBLIC_SUPPLIER_APPLICATION_BODY_BYTES = 32 * 1_024;

type Dependencies = {
  submit: typeof submitPublicSupplierApplication;
  now: () => Date;
  clientRateLimit: (input: {
    request: Request;
    now: Date;
  }) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
};

const consumeApplicationClientRateLimit = publicClientRateLimit(
  'supplier-application',
);

function privateResponse<T extends Response>(response: T) {
  return privateNoStoreResponse(response);
}

function unavailableResponse() {
  return privateResponse(problemResponse(
    410,
    'Application link unavailable',
    PUBLIC_SUPPLIER_APPLICATION_UNAVAILABLE_MESSAGE,
  ));
}

function safeError(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return privateResponse(
      problemResponse(413, 'Request too large', error.message),
    );
  }
  if (error instanceof InvalidJsonBodyError) {
    return privateResponse(
      problemResponse(400, 'Invalid request', error.message),
    );
  }
  if (error instanceof PublicSupplierApplicationValidationError) {
    return privateResponse(problemResponse(
      422,
      'Invalid supplier application',
      'Review the highlighted application fields.',
      { errors: error.errors },
    ));
  }
  if (error instanceof PublicSupplierApplicationUnavailableError) {
    return unavailableResponse();
  }
  if (error instanceof PublicSupplierGrantError) {
    if (error.code === 'GRANT_UNAVAILABLE') return unavailableResponse();
    const response = privateResponse(problemResponse(
      429,
      'Too many attempts',
      'Wait before submitting another supplier application.',
    ));
    if (error.retryAfterSeconds) {
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
    }
    return response;
  }
  return privateResponse(problemResponse(
    503,
    'Application service unavailable',
    'Unable to accept this supplier application right now. Try again shortly.',
  ));
}

export function createPublicSupplierApplicationHandler(
  dependencies: Dependencies = {
    submit: submitPublicSupplierApplication,
    now: () => new Date(),
    clientRateLimit: consumeApplicationClientRateLimit,
  },
) {
  return async function publicSupplierApplication(request: Request) {
    try {
      const rejected = browserJsonMutationRejection(request);
      if (rejected) {
        return privateResponse(
          rejected === 'CROSS_ORIGIN'
            ? problemResponse(
                403,
                'Request not allowed',
                'Submit this application from its original QuotePlate page.',
              )
            : problemResponse(
                415,
                'Unsupported media type',
                'Send this request as application/json.',
              ),
        );
      }

      const currentTime = dependencies.now();
      const clientAttempt = await dependencies.clientRateLimit({
        request,
        now: currentTime,
      });
      if (!clientAttempt.allowed) {
        const response = privateResponse(problemResponse(
          429,
          'Too many attempts',
          'Wait before submitting another supplier application.',
        ));
        response.headers.set(
          'Retry-After',
          String(clientAttempt.retryAfterSeconds),
        );
        return response;
      }

      const application = await readBoundedJson(
        request,
        PUBLIC_SUPPLIER_APPLICATION_BODY_BYTES,
      );
      await dependencies.submit({ application, now: currentTime });
      return privateResponse(NextResponse.json(
        { accepted: true },
        { status: 202 },
      ));
    } catch (error) {
      return safeError(error);
    }
  };
}

export const POST = createPublicSupplierApplicationHandler();
