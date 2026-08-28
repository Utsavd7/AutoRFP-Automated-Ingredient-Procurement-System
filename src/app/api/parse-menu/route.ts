import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireApiTenant } from '@/lib/api/require-api-tenant';
import { createMenuDraft } from '@/lib/menu/create-menu-draft';
import { parseMenuInput } from '@/lib/menu/menu-input';

export async function POST(req: Request) {
  const access = await requireApiTenant();
  if (access.response) return access.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problemResponse(400, 'Invalid request', 'Provide a valid JSON body.');
  }

  const input = parseMenuInput(body);
  if (!input.ok) {
    return problemResponse(
      422,
      'Invalid request',
      'Paste a bounded menu as plain text.',
      { errors: input.errors },
    );
  }

  const { menuText } = input.value;

  try {
    const menu = await createMenuDraft({
      tenantId: access.tenant.id,
      menuText,
    });

    return NextResponse.json({
      success: true,
      menuId: menu.id,
      recipes: menu.recipes,
      modelSource: 'Deterministic review draft',
      requiresReview: true,
      menuInsight: null,
    });
  } catch {
    return problemResponse(
      500,
      'Unable to save menu',
      'The menu draft could not be saved. Try again.',
    );
  }
}
