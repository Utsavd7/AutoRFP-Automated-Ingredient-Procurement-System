'use client';

import { ChefHat, CheckCircle2, FileText } from 'lucide-react';
import { FormEvent, useState } from 'react';

type SavedRecipe = {
  id: string;
  name: string;
};

type MenuDraftResponse = {
  menuId?: string;
  recipes?: SavedRecipe[];
  detail?: string;
};

const SAVED_MESSAGE =
  'Your menu and extracted dish names are saved; nothing has been sent to suppliers.';

export default function ProcurementPage() {
  const [menuText, setMenuText] = useState('');
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!menuText.trim() || saving) return;

    setSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuText }),
      });
      const result = (await response.json()) as MenuDraftResponse;
      if (!response.ok) {
        throw new Error(result.detail || 'The menu draft could not be saved.');
      }

      setRecipes(result.recipes ?? []);
      setStatus('Menu draft saved for review');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The menu draft could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-200">
          <FileText className="h-3.5 w-3.5" />
          Review draft
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white">
          Start with your menu
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9A9FA8]">
          Paste one dish per line. AutoRFP saves the exact text and creates a
          deterministic dish list for review.
        </p>
      </div>

      <form
        onSubmit={saveDraft}
        className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-7"
      >
        <label
          htmlFor="menu-text"
          className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#B7BBC3]"
        >
          Menu text
        </label>
        <textarea
          id="menu-text"
          value={menuText}
          onChange={(event) => setMenuText(event.target.value)}
          rows={12}
          maxLength={50_000}
          placeholder={'Paneer Tikka\nDal Makhani\nJeera Rice'}
          className="w-full resize-y rounded-xl border border-white/[0.09] bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/10"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!menuText.trim() || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChefHat className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save menu draft'}
          </button>
          <span className="text-xs text-[#7F848D]">
            Nothing is sent to suppliers.
          </span>
        </div>
        {error && (
          <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
      </form>

      {status && (
        <section className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            {status}
          </div>
          <p className="mt-2 text-sm leading-6 text-[#B3B8C0]">
            {SAVED_MESSAGE}
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {recipes.map((recipe) => (
              <li
                key={recipe.id}
                className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2 text-sm text-white"
              >
                {recipe.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
