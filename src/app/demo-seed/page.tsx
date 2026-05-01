'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { CheckCircle } from 'lucide-react';
import {
  saveAccount,
  writeTenantHistory,
  type ProcurementRecord,
} from '@/lib/tenant';

const DEMO_EMAIL = 'demo@autorfp.local';
const DEMO_PASSWORD = 'demo-password';

export default function DemoSeedPage() {
  const router = useRouter();
  const [status, setStatus] = useState('Preparing demo workspace…');

  useEffect(() => {
    async function seed() {
      const seedRes = await fetch('/api/demo/seed-account', { method: 'POST' });
      if (!seedRes.ok) throw new Error('Could not seed demo tenant');
      const { account } = await seedRes.json();
      await signIn('credentials', {
        redirect: false,
        mode: 'signin',
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
      saveAccount(account);

      const now = Date.now();
      const history: ProcurementRecord[] = [
        {
          id: 'demo-run-3',
          date: new Date(now - 1000 * 60 * 60 * 24 * 3).toISOString(),
          tenantId: account.tenantId,
          restaurantName: account.name,
          menuText: 'Steak frites\nCaesar salad\nRoast chicken\nMushroom pasta',
          recipesCount: 4,
          ingredientsCount: 18,
          distributorsCount: 5,
          quotesCount: 5,
          totalSpend: 18420,
          winner: 'Century Wholesale',
          winnerPrice: 18420,
          totalSavings: 2140,
          savingsPercentage: 10.4,
          executiveSummary: 'Century Wholesale delivered the strongest total basket after counter-offers, with meaningful leverage on proteins and dairy.',
          marketAlerts: ['Beef: price spike detected', 'Butter: below average detected'],
          categorySavings: [
            { category: 'Proteins', spend: 9200, savings: 1280 },
            { category: 'Dairy', spend: 3100, savings: 420 },
            { category: 'Produce', spend: 2600, savings: 260 },
            { category: 'Dry Goods', spend: 2100, savings: 180 },
          ],
          supplierScorecards: [
            { supplier: 'Century Wholesale', originalPrice: 20560, finalPrice: 18420, savings: 2140, decision: 'ACCEPT', priceCompetitiveness: 94, responseSpeed: 88, dealQuality: 93, overall: 92 },
            { supplier: 'Baldor Specialty Foods', originalPrice: 21100, finalPrice: 19780, savings: 1320, decision: 'COUNTER', priceCompetitiveness: 83, responseSpeed: 78, dealQuality: 82, overall: 81 },
            { supplier: 'US Foods Metro', originalPrice: 21800, finalPrice: 20900, savings: 900, decision: 'COUNTER', priceCompetitiveness: 76, responseSpeed: 84, dealQuality: 74, overall: 77 },
          ],
        },
        {
          id: 'demo-run-2',
          date: new Date(now - 1000 * 60 * 60 * 24 * 16).toISOString(),
          tenantId: account.tenantId,
          restaurantName: account.name,
          menuText: 'Salmon bowl\nTurkey club\nRigatoni\nApple tart',
          recipesCount: 4,
          ingredientsCount: 16,
          distributorsCount: 4,
          quotesCount: 4,
          totalSpend: 14180,
          winner: 'Baldor Specialty Foods',
          winnerPrice: 14180,
          totalSavings: 1180,
          savingsPercentage: 7.7,
          executiveSummary: 'Baldor won on delivery reliability and produce pricing, with enough savings to justify a short-term order.',
          marketAlerts: ['Salmon: price spike detected'],
          categorySavings: [
            { category: 'Proteins', spend: 6400, savings: 650 },
            { category: 'Produce', spend: 3900, savings: 390 },
            { category: 'Dry Goods', spend: 2500, savings: 140 },
          ],
          supplierScorecards: [
            { supplier: 'Baldor Specialty Foods', originalPrice: 15360, finalPrice: 14180, savings: 1180, decision: 'ACCEPT', priceCompetitiveness: 88, responseSpeed: 91, dealQuality: 86, overall: 88 },
            { supplier: 'Century Wholesale', originalPrice: 15190, finalPrice: 14650, savings: 540, decision: 'COUNTER', priceCompetitiveness: 84, responseSpeed: 79, dealQuality: 74, overall: 79 },
          ],
        },
      ];

      writeTenantHistory(account.tenantId, history);
      await Promise.all(history.map(record => fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }).catch(() => null)));
      setStatus(`Demo ready. Sign in later with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
      window.setTimeout(() => router.replace('/dashboard'), 900);
    }

    seed().catch(() => setStatus('Demo seed failed. Check the browser console.'));
  }, [router]);

  return (
    <div className="min-h-screen bg-black text-[#EEEEEE] flex items-center justify-center px-6">
      <div className="linear-panel rounded-2xl border border-emerald-500/20 p-8 max-w-md w-full text-center">
        <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
        <h1 className="text-[22px] font-black mt-5">Seeding demo workspace</h1>
        <p className="text-[13px] text-[#8A8F98] leading-relaxed mt-2">{status}</p>
      </div>
    </div>
  );
}
