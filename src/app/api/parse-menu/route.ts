import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireApiTenant } from '@/lib/api/require-api-tenant';
import { buildDeterministicMenuDraft } from '@/lib/menu/deterministic-draft';
import { parseMenuInput } from '@/lib/menu/menu-input';
import { prisma } from '@/lib/prisma';

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
  const dishes = buildDeterministicMenuDraft(menuText);

  try {
    const menu = await prisma.menu.create({
      data: {
        tenantId: access.tenant.id,
        name: 'Menu draft',
        sourceText: menuText,
        status: 'DRAFT',
        recipes: {
          create: dishes.map((dish, position) => ({
            name: dish.name,
            position,
            tenant: { connect: { id: access.tenant.id } },
            ingredients: { create: [] },
          })),
        },
      },
      include: { recipes: { include: { ingredients: true } } },
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
