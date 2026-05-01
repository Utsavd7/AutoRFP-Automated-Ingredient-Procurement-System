import type { ActiveRFP } from '@/lib/tenant';

export const ACTIVE_RFP_STATUSES = ['SENT', 'VIEWED', 'REPLIED', 'NEGOTIATING'] as const;

export type ActiveRfpStatus = typeof ACTIVE_RFP_STATUSES[number];

export const ACTIVE_MENU_WORKFLOW_STATUSES = [
  'DRAFT',
  'PARSED',
  'PRICED',
  'SUPPLIERS_FOUND',
  'RFP_SENT',
  'QUOTES_RECEIVED',
  'NEGOTIATING',
] as const;

export function getRfpStatusLabel(status: string) {
  switch (status) {
    case 'VIEWED':
      return 'Supplier reviewing';
    case 'REPLIED':
      return 'Quotes received';
    case 'NEGOTIATING':
      return 'Negotiation live';
    case 'ACCEPTED':
      return 'Awarded';
    case 'DECLINED':
      return 'Closed';
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'RFPs in market';
  }
}

export function isActiveRfpStatus(status: string) {
  return ACTIVE_RFP_STATUSES.includes(status as ActiveRfpStatus);
}

export function isActiveMenuWorkflowStatus(status?: string | null) {
  return !!status && ACTIVE_MENU_WORKFLOW_STATUSES.includes(status as typeof ACTIVE_MENU_WORKFLOW_STATUSES[number]);
}

type SummaryInput = {
  menu: {
    id: string;
    createdAt?: Date;
    lastActivityAt?: Date;
    text?: string | null;
    mealName?: string | null;
    guestCount?: number | null;
    bufferPct?: number | null;
    requestedIngredients?: any;
    workflowStatus?: string | null;
    recipes?: Array<{ ingredients?: Array<unknown> }>;
  };
  tenantId: string;
  restaurantName: string;
  rfps: Array<{
    id: string;
    status: string;
    distributor?: { name: string; location: string } | null;
    quotes?: Array<{ id: string; price: number; details?: string | null; status?: string | null }>;
  }>;
};

export function buildActiveRfpSummary({ menu, tenantId, restaurantName, rfps }: SummaryInput): ActiveRFP & {
  menuId: string;
  workflowStatus: string | null | undefined;
  mealName?: string | null;
  guestCount?: number | null;
  bufferPct?: number | null;
} {
  const statuses = new Set(rfps.map(rfp => rfp.status));
  const quotesCount = rfps.reduce((sum, rfp) => sum + (rfp.quotes?.length ?? 0), 0);
  const ingredientsCount = Array.isArray(menu.requestedIngredients)
    ? menu.requestedIngredients.length
    : (menu.recipes ?? []).reduce((sum, recipe) => sum + (recipe.ingredients?.length ?? 0), 0);

  let status = 'RFPs in market';
  if (statuses.has('NEGOTIATING')) status = getRfpStatusLabel('NEGOTIATING');
  else if (statuses.has('REPLIED')) status = getRfpStatusLabel('REPLIED');
  else if (statuses.has('VIEWED')) status = getRfpStatusLabel('VIEWED');
  else if (statuses.has('SENT')) status = getRfpStatusLabel('SENT');

  return {
    id: menu.id,
    menuId: menu.id,
    date: (menu.lastActivityAt ?? menu.createdAt ?? new Date()).toISOString(),
    tenantId,
    restaurantName,
    ingredientsCount,
    distributorsCount: rfps.length,
    quotesCount,
    status,
    workflowStatus: menu.workflowStatus,
    mealName: menu.mealName,
    guestCount: menu.guestCount,
    bufferPct: menu.bufferPct,
  };
}
