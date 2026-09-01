'use client';

import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PROCUREMENT_CATEGORIES,
  type ProcurementCategory,
} from '@/lib/domain/procurement-categories';
import type {
  IngredientSuggestionDto,
  MenuCleanupProposal,
  MenuDocumentV1,
} from '@/lib/menu/menu-document';

import styles from './menu-editor.module.css';

type Unit = 'KILOGRAM' | 'GRAM' | 'LITRE' | 'MILLILITRE' | 'PIECE' | 'PACK' | 'CASE' | 'CRATE';

type DishDraft = MenuDocumentV1['dishes'][number];
type IngredientDraft = DishDraft['ingredients'][number];

type ReviewedMenu = {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
  sourceText: string | null;
  approvedAt: string | null;
  updatedAt: string;
  document: MenuDocumentV1;
  cleanupProposals?: MenuCleanupProposal[];
  ingredientSuggestionsByDishId?: Record<string, IngredientSuggestionDto[]>;
};

const unitOptions: Array<{ value: Unit; label: string }> = [
  { value: 'KILOGRAM', label: 'kg' },
  { value: 'GRAM', label: 'g' },
  { value: 'LITRE', label: 'L' },
  { value: 'MILLILITRE', label: 'ml' },
  { value: 'PIECE', label: 'piece' },
  { value: 'PACK', label: 'pack' },
  { value: 'CASE', label: 'case' },
  { value: 'CRATE', label: 'crate' },
];

const categoryOptions = Object.entries(PROCUREMENT_CATEGORIES) as Array<
  [ProcurementCategory, string]
>;

function documentId(prefix: 'd' | 'i') {
  return `${prefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 23)}`;
}

const newIngredient = (): IngredientDraft => {
  const id = documentId('i');
  return {
    id,
    itemKey: `item-${id}`,
    name: '',
    quantity: '',
    unit: 'KILOGRAM',
    specification: { v: 1, category: 'OTHER' },
  };
};

const newDish = (): DishDraft => ({
  id: documentId('d'),
  name: '',
  position: 0,
  ingredients: [newIngredient()],
});

function normalizeMenu(menu: ReviewedMenu): ReviewedMenu {
  return {
    ...menu,
    document: {
      ...menu.document,
      dishes: menu.document.dishes.map((dish) => ({
        ...dish,
        ingredients: dish.ingredients.map((ingredient) => ({
          ...ingredient,
          quantity: String(ingredient.quantity),
        })),
      })),
    },
  };
}

export function applyMenuCleanupProposal(
  document: MenuDocumentV1,
  proposal: MenuCleanupProposal,
): MenuDocumentV1 {
  if (proposal.kind === 'MERGE_DUPLICATE_DISH') {
    return {
      ...document,
      dishes: document.dishes
        .filter(({ id }) => id !== proposal.dishId)
        .map((dish, position) => ({ ...dish, position })),
    };
  }
  return {
    ...document,
    dishes: document.dishes.map((dish) => {
      if (dish.id !== proposal.dishId) return dish;
      if (proposal.ingredientId === null) {
        return dish.name === proposal.before ? { ...dish, name: proposal.after } : dish;
      }
      if (proposal.kind === 'MERGE_DUPLICATE_ITEM') {
        return {
          ...dish,
          ingredients: dish.ingredients.filter(({ id }) => id !== proposal.ingredientId),
        };
      }
      return {
        ...dish,
        ingredients: dish.ingredients.map((ingredient) => {
          if (ingredient.id !== proposal.ingredientId) return ingredient;
          if (proposal.kind === 'NORMALIZE_UNIT') {
            return { ...ingredient, unit: proposal.after as IngredientDraft['unit'] };
          }
          return ingredient.name === proposal.before
            ? { ...ingredient, name: proposal.after }
            : ingredient;
        }),
      };
    }),
  };
}

async function problemMessage(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    errors?: Record<string, string[]>;
  };
  return {
    message: problem.detail || problem.error || fallback,
    fields: problem.errors ?? {},
  };
}

export function MenuEditor({
  menuId,
  initialMenu,
}: {
  menuId: string;
  initialMenu?: ReviewedMenu;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<ReviewedMenu | null>(initialMenu ? normalizeMenu(initialMenu) : null);
  const [name, setName] = useState(initialMenu?.name ?? '');
  const [dishes, setDishes] = useState<DishDraft[]>(initialMenu ? normalizeMenu(initialMenu).document.dishes : []);
  const [loading, setLoading] = useState(!initialMenu);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const initialLoadStarted = useRef(false);

  const loadMenu = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/menus/${encodeURIComponent(menuId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await problemMessage(response, 'We could not load this menu.')).message);
      const result = (await response.json()) as { menu: ReviewedMenu };
      const loaded = normalizeMenu(result.menu);
      setMenu(loaded);
      setName(loaded.name);
      setDishes(loaded.document.dishes);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load this menu.');
    } finally {
      setLoading(false);
    }
  }, [menuId]);

  useEffect(() => {
    if (initialMenu || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMenu();
  }, [initialMenu, loadMenu]);

  function changeDish(index: number, patch: Partial<DishDraft>) {
    setDishes((current) => current.map((dish, dishIndex) => dishIndex === index ? { ...dish, ...patch } : dish));
  }

  function changeIngredient(dishIndex: number, ingredientIndex: number, patch: Partial<IngredientDraft>) {
    setDishes((current) => current.map((dish, currentDishIndex) => currentDishIndex === dishIndex
      ? {
          ...dish,
          ingredients: dish.ingredients.map((ingredient, currentIngredientIndex) =>
            currentIngredientIndex === ingredientIndex ? { ...ingredient, ...patch } : ingredient,
          ),
        }
      : dish));
  }

  function removeIngredient(dishIndex: number, ingredientIndex: number) {
    setDishes((current) => current.map((dish, currentDishIndex) => currentDishIndex === dishIndex
      ? { ...dish, ingredients: dish.ingredients.filter((_, index) => index !== ingredientIndex) }
      : dish));
  }

  function removeDish(dishIndex: number) {
    if (!window.confirm('Remove this dish from the draft?')) return;
    setDishes((current) => current.filter((_, index) => index !== dishIndex));
  }

  function addSuggestedIngredient(dishIndex: number, suggestion: IngredientSuggestionDto) {
    if (suggestion.kind !== 'INGREDIENT') return;
    setDishes((current) => current.map((dish, currentDishIndex) => {
      if (currentDishIndex !== dishIndex) return dish;
      if (dish.ingredients.some(({ itemKey }) => itemKey === suggestion.itemKey)) return dish;
      return {
        ...dish,
        ingredients: [
          ...dish.ingredients,
          {
            id: documentId('i'),
            itemKey: suggestion.itemKey,
            name: suggestion.name,
            quantity: suggestion.quantity,
            unit: suggestion.unit,
            specification: suggestion.specification,
          },
        ],
      };
    }));
  }

  function applyCleanupProposal(proposal: MenuCleanupProposal) {
    setDishes((current) => applyMenuCleanupProposal(
      { ...menu!.document, dishes: current },
      proposal,
    ).dishes);
    setMenu((current) => current ? {
      ...current,
      cleanupProposals: (current.cleanupProposals ?? []).filter(({ id }) => id !== proposal.id),
    } : current);
  }

  const complete = Boolean(
    name.trim() &&
    dishes.length > 0 &&
    dishes.every((dish) =>
      dish.name.trim() &&
      dish.ingredients.length > 0 &&
      dish.ingredients.every((ingredient) => ingredient.name.trim() && ingredient.quantity.trim()),
    ),
  );

  async function saveDraft() {
    if (!menu || saving || !complete) return null;
    setSaving(true);
    setError('');
    setNotice('');
    setFieldErrors({});
    try {
      const response = await fetch(`/api/menus/${encodeURIComponent(menu.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: menu.version,
          name: name.trim(),
          sourceText: menu.sourceText,
          document: {
            ...menu.document,
            dishes: dishes.map((dish, dishIndex) => ({
              ...dish,
              name: dish.name.trim(),
              position: dishIndex,
              ingredients: dish.ingredients.map((ingredient) => ({
                ...ingredient,
                name: ingredient.name.trim(),
                quantity: ingredient.quantity.trim(),
              })),
            })),
          },
        }),
      });
      if (!response.ok) {
        const problem = await problemMessage(response, 'We could not save this menu.');
        setFieldErrors(problem.fields);
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { menu: ReviewedMenu };
      const saved = normalizeMenu(result.menu);
      setMenu({
        ...saved,
        ingredientSuggestionsByDishId: menu.ingredientSuggestionsByDishId,
      });
      setName(saved.name);
      setDishes(saved.document.dishes);
      setNotice('Draft saved.');
      return saved;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save this menu.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!menu || approving || !complete) return;
    if (!window.confirm('Approve this menu? Use only quantities your team has checked.')) return;
    setApproving(true);
    setError('');
    const saved = await saveDraft();
    if (!saved) {
      setApproving(false);
      return;
    }
    try {
      const response = await fetch(`/api/menus/${encodeURIComponent(saved.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: saved.version }),
      });
      if (!response.ok) throw new Error((await problemMessage(response, 'We could not approve this menu.')).message);
      const result = (await response.json()) as { menu: ReviewedMenu };
      const approved = normalizeMenu(result.menu);
      setMenu(approved);
      setName(approved.name);
      setDishes(approved.document.dishes);
      setNotice('Menu approved and ready for procurement.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not approve this menu.');
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading} aria-label="Loading menu"><span /><span /><span /></div></main>;
  }

  if (!menu) {
    return (
      <main className={styles.page}>
        <section className={styles.missing}>
          <h1>Menu unavailable</h1>
          <p>{error || 'This menu could not be found.'}</p>
          <button type="button" onClick={() => void loadMenu()}>Try again</button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <button className={styles.back} type="button" onClick={() => router.push('/menus')}>
            <ArrowLeft aria-hidden="true" /> Menus
          </button>
          <p className={styles.eyebrow}>Review menu</p>
          <input aria-label="Menu name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
          <p>Check every dish, ingredient, quantity and unit before approval.</p>
        </div>
        <div className={styles.headerActions}>
          <span className={menu.status === 'APPROVED' ? styles.approved : styles.draft}>
            {menu.status === 'APPROVED' ? <CheckCircle2 aria-hidden="true" /> : null}
            {menu.status === 'APPROVED' ? 'Approved' : 'Draft'} · v{menu.version}
          </span>
          <button className={styles.secondaryButton} type="button" disabled={!complete || saving || approving} onClick={() => void saveDraft()}>
            <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button className={styles.primaryButton} type="button" disabled={!complete || saving || approving} onClick={() => void approve()}>
            <CheckCircle2 aria-hidden="true" /> {approving ? 'Approving…' : 'Approve menu'}
          </button>
        </div>
      </header>

      {menu.status === 'APPROVED' && (
        <div className={styles.warning}>Editing an approved menu and saving it will return it to draft for another review.</div>
      )}
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      {Object.keys(fieldErrors).length > 0 && (
        <div className={styles.error} role="alert">Check the highlighted menu details and try again.</div>
      )}

      {(menu.cleanupProposals?.length ?? 0) > 0 && (
        <section className={styles.cleanupPanel} aria-label="Suggested menu cleanup">
          <header>
            <div><p className={styles.eyebrow}>Suggested cleanup</p><h2>Small changes to review</h2></div>
            <span>{menu.cleanupProposals!.length} found</span>
          </header>
          <div>
            {menu.cleanupProposals!.map((proposal) => (
              <article key={proposal.id}>
                <span><strong>{proposal.before}</strong><small>Change to {proposal.after}</small></span>
                <button type="button" onClick={() => applyCleanupProposal(proposal)}>Use change</button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className={styles.dishes} aria-label="Menu dishes">
        {dishes.map((dish, dishIndex) => (
          <article className={styles.dish} key={dish.id ?? `new-dish-${dishIndex}`}>
            <header>
              <span>{String(dishIndex + 1).padStart(2, '0')}</span>
              <label>
                <span>Dish name</span>
                <input
                  aria-label={`Dish ${dishIndex + 1} name`}
                  value={dish.name}
                  maxLength={160}
                  placeholder="Dal makhani"
                  onChange={(event) => changeDish(dishIndex, { name: event.target.value })}
                />
              </label>
              <button type="button" aria-label={`Remove ${dish.name || `dish ${dishIndex + 1}`}`} onClick={() => removeDish(dishIndex)}>
                <Trash2 aria-hidden="true" />
              </button>
            </header>
            <div className={styles.ingredientHeader} aria-hidden="true">
              <span>Ingredient</span><span>Quantity</span><span>Unit</span><span>Category</span><span />
            </div>
            <div className={styles.ingredients}>
              {dish.ingredients.map((ingredient, ingredientIndex) => (
                <div className={styles.ingredient} key={ingredient.id ?? `new-ingredient-${ingredientIndex}`}>
                  <label>
                    <span>Ingredient</span>
                    <input
                      aria-label={`${dish.name || `Dish ${dishIndex + 1}`} ingredient ${ingredientIndex + 1}`}
                      value={ingredient.name}
                      maxLength={160}
                      placeholder="Urad dal"
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, { name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Quantity</span>
                    <input
                      aria-label={`${ingredient.name || 'Ingredient'} quantity`}
                      inputMode="decimal"
                      value={ingredient.quantity}
                      placeholder="2.5"
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, { quantity: event.target.value })}
                    />
                  </label>
                  <label className={styles.unitSelect}>
                    <span>Unit</span>
                    <select
                      aria-label={`${ingredient.name || 'Ingredient'} unit`}
                      value={ingredient.unit}
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, { unit: event.target.value as Unit })}
                    >
                      {unitOptions.map((unit) => <option value={unit.value} key={unit.value}>{unit.label}</option>)}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                  <label className={styles.unitSelect}>
                    <span>Category</span>
                    <select
                      aria-label={`${ingredient.name || 'Ingredient'} category`}
                      value={ingredient.specification.category}
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, {
                        specification: {
                          ...ingredient.specification,
                          category: event.target.value as ProcurementCategory,
                        },
                      })}
                    >
                      {categoryOptions.map(([category, label]) => (
                        <option value={category} key={category}>{label}</option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                  <label className={styles.referenceField}>
                    <span>Food photo or product link, optional</span>
                    <input
                      aria-label={`${ingredient.name || 'Ingredient'} food reference link`}
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/item"
                      value={ingredient.specification.referenceUrl ?? ''}
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, {
                        specification: {
                          ...ingredient.specification,
                          referenceUrl: event.target.value || null,
                        },
                      })}
                    />
                  </label>
                  <button type="button" aria-label={`Remove ${ingredient.name || 'ingredient'}`} onClick={() => removeIngredient(dishIndex, ingredientIndex)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            {(menu.ingredientSuggestionsByDishId?.[dish.id] ?? []).some(({ kind }) => kind === 'INGREDIENT') && (
              <div className={styles.suggestions}>
                <span>Quick add</span>
                {(menu.ingredientSuggestionsByDishId?.[dish.id] ?? [])
                  .filter((suggestion) => suggestion.kind === 'INGREDIENT')
                  .filter((suggestion) => !dish.ingredients.some(({ itemKey }) => itemKey === suggestion.itemKey))
                  .map((suggestion) => (
                    <button type="button" key={suggestion.id} onClick={() => addSuggestedIngredient(dishIndex, suggestion)}>
                      <Plus aria-hidden="true" />
                      <span><strong>{suggestion.name}</strong><small>{suggestion.quantity} {unitOptions.find(({ value }) => value === suggestion.unit)?.label ?? suggestion.unit} · {suggestion.sourceLabel}</small></span>
                    </button>
                  ))}
              </div>
            )}
            <button
              className={styles.addRow}
              type="button"
              onClick={() => changeDish(dishIndex, { ingredients: [...dish.ingredients, newIngredient()] })}
            >
              <Plus aria-hidden="true" /> Add ingredient
            </button>
          </article>
        ))}
        <button className={styles.addDish} type="button" onClick={() => setDishes((current) => [...current, newDish()])}>
          <Plus aria-hidden="true" /> Add dish
        </button>
      </section>

      <footer className={styles.stickyActions}>
        <span>{dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'} · {dishes.reduce((sum, dish) => sum + dish.ingredients.length, 0)} {dishes.reduce((sum, dish) => sum + dish.ingredients.length, 0) === 1 ? 'ingredient' : 'ingredients'}</span>
        <button className={styles.secondaryButton} type="button" disabled={!complete || saving || approving} onClick={() => void saveDraft()}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button className={styles.primaryButton} type="button" disabled={!complete || saving || approving} onClick={() => void approve()}>
          {approving ? 'Approving…' : 'Approve menu'}
        </button>
      </footer>
    </main>
  );
}
