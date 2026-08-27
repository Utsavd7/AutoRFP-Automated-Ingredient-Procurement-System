import { NextResponse } from 'next/server';
import { problemResponse } from '@/lib/api/problem';
import { requireApiTenant } from '@/lib/api/require-api-tenant';
import {
  buildDeterministicMenuDraft,
  type DeterministicDishDraft,
} from '@/lib/menu/deterministic-draft';
import { parseMenuInput } from '@/lib/menu/menu-input';
import { callOllama, parseJSON } from '@/lib/llm';
import { prisma } from '@/lib/prisma';

type LocalMenuDraft = {
  dishes?: Array<{ name?: unknown }>;
};

function selectUserProvidedDishes(
  rawDraft: string,
  allowedDishes: DeterministicDishDraft[],
) {
  const parsed = parseJSON<LocalMenuDraft>(rawDraft);
  if (!Array.isArray(parsed?.dishes) || parsed.dishes.length === 0) return null;

  const allowedByName = new Map(
    allowedDishes.map((dish) => [dish.name.toLocaleLowerCase('en-US'), dish]),
  );
  const selected: DeterministicDishDraft[] = [];
  const seen = new Set<string>();

  for (const candidate of parsed.dishes) {
    if (typeof candidate?.name !== 'string') return null;

    const key = candidate.name.trim().toLocaleLowerCase('en-US');
    const userDish = allowedByName.get(key);
    if (!userDish) return null;
    if (seen.has(key)) continue;

    seen.add(key);
    selected.push(userDish);
  }

  return selected.length > 0 ? selected : null;
}

async function makeLocalReviewDraft(
  menuText: string,
  deterministicDraft: DeterministicDishDraft[],
) {
  const response = await callOllama(
    [
      {
        role: 'system',
        content:
          'Return JSON only. Select dish lines exactly as supplied. Never rewrite a line or add ingredients.',
      },
      {
        role: 'user',
        content: `Select only lines that are dishes from this menu. Copy each selected line exactly. Return {"dishes":[{"name":"exact user line"}]}.

Menu:
${menuText}`,
      },
    ],
    true,
  );

  return selectUserProvidedDishes(response, deterministicDraft);
}

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
  const deterministicDraft = buildDeterministicMenuDraft(menuText);
  let dishes = deterministicDraft;
  let modelSource = 'Deterministic review draft';

  try {
    const localDraft = await makeLocalReviewDraft(menuText, deterministicDraft);
    if (localDraft) {
      dishes = localDraft;
      modelSource = 'Ollama local review draft';
    }
  } catch {
    console.warn(
      '[parse-menu] Local model unavailable; using deterministic review draft.',
    );
  }

  try {
    const menu = await prisma.menu.create({
      data: {
        tenantId: access.tenant.id,
        text: menuText,
        sourceUrl: null,
        workflowStatus: 'DRAFT',
      },
    });

    const recipes = [];
    for (const dish of dishes) {
      const recipe = await prisma.recipe.create({
        data: {
          name: dish.name,
          menuId: menu.id,
          ingredients: { create: [] },
        },
        include: { ingredients: true },
      });
      recipes.push(recipe);
    }

    return NextResponse.json({
      success: true,
      menuId: menu.id,
      recipes,
      modelSource,
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
