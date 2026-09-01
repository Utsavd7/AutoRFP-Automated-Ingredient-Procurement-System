import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { requireAccountContext } from '@/lib/server-account';
import {
  getSupplierSuggestions,
  SupplierSuggestionsNotFoundError,
} from '@/lib/suggestions/supplier-suggestions';

type SuggestionsContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: SuggestionsContext) {
  const account = await requireAccountContext();
  if (!account) {
    return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const { id } = await context.params;
  try {
    const suggestions = await getSupplierSuggestions({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      requestId: id,
    });
    return privateResponse(NextResponse.json(suggestions));
  } catch (error) {
    if (error instanceof SupplierSuggestionsNotFoundError) {
      return privateResponse(problemResponse(
        404,
        'Procurement request not found',
        'The procurement request is unavailable.',
      ));
    }
    if (error instanceof AuthorizationError) {
      return privateResponse(problemResponse(403, 'Forbidden', 'You cannot view these suggestions.'));
    }
    throw error;
  }
}
