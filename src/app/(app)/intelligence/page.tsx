'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bell, Building2, ChevronRight, CircleDollarSign,
  LineChart as LineChartIcon, Medal, PackageSearch, Radar, Sparkles, TrendingUp
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {
  ACCOUNT_KEY,
  readAccount,
  saveAccount,
  type ProcurementRecord,
  type RestaurantAccount,
} from '@/lib/tenant';
import { PageSkeleton } from '@/components/Skeleton';

type SupplierScore = NonNullable<ProcurementRecord['supplierScorecards']>[number];

function money(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`linear-panel rounded-xl border border-white/[0.06] ${className}`}>{children}</div>;
}

function fallbackScorecards(history: ProcurementRecord[]): SupplierScore[] {
  return history
    .filter(run => run.winner)
    .map(run => ({
      supplier: run.winner!,
      originalPrice: (run.winnerPrice ?? 0) + (run.totalSavings ?? 0),
      finalPrice: run.winnerPrice ?? 0,
      savings: run.totalSavings ?? 0,
      decision: 'ACCEPT',
      priceCompetitiveness: Math.min(100, Math.round(72 + (run.savingsPercentage ?? 0))),
      responseSpeed: 82,
      dealQuality: Math.min(100, Math.round(68 + (run.savingsPercentage ?? 0) * 1.5)),
      overall: Math.min(100, Math.round(74 + (run.savingsPercentage ?? 0))),
    }));
}

export default function IntelligencePage() {
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [history, setHistory] = useState<ProcurementRecord[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    Promise.all([
      fetch('/api/account').then(async response => {
        if (!response.ok) {
          if (response.status === 401) localStorage.removeItem(ACCOUNT_KEY);
          return { account: null, allowLocalFallback: false };
        }
        return { account: (await response.json()).account as RestaurantAccount, allowLocalFallback: true };
      }),
      fetch('/api/dashboard').then(async response => response.ok ? await response.json() as { history?: ProcurementRecord[] } : null),
    ]).then(([accountResult, dashboard]) => {
      if (!alive) return;
      const remoteAccount = accountResult.account;
      const fallbackAccount = remoteAccount ?? (accountResult.allowLocalFallback ? readAccount() : null);
      if (!fallbackAccount) {
        setReady(true);
        return;
      }
      if (remoteAccount) saveAccount(remoteAccount);
      setAccount(fallbackAccount);
      setHistory(dashboard?.history ?? []);
      setReady(true);
    }).catch(() => {
      if (!alive) return;
      const saved = readAccount();
      if (saved) setAccount(saved);
      setReady(true);
    });

    return () => {
      alive = false;
    };
  }, []);

  const chronological = useMemo(() => [...history].reverse(), [history]);
  const savingsTrend = useMemo(() => {
    let cumulativeSavings = 0;
    let cumulativeMarket = 0;
    return chronological.map((run, index) => {
      const savings = run.totalSavings ?? 0;
      const spend = run.totalSpend ?? run.winnerPrice ?? 0;
      cumulativeSavings += savings;
      cumulativeMarket += spend + savings;
      return {
        run: `Run ${index + 1}`,
        date: new Date(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        savings,
        spend,
        market: spend + savings,
        cumulativeSavings,
        cumulativeMarket,
      };
    });
  }, [chronological]);

  const alerts = useMemo(() => history.flatMap(run =>
    (run.marketAlerts ?? []).map(alert => ({
      id: `${run.id}-${alert}`,
      alert,
      run,
      date: run.date,
    }))
  ), [history]);

  const categorySavings = useMemo(() => {
    const map = new Map<string, { category: string; savings: number; spend: number }>();
    for (const run of history) {
      for (const item of run.categorySavings ?? []) {
        const current = map.get(item.category) ?? { category: item.category, savings: 0, spend: 0 };
        current.savings += item.savings;
        current.spend += item.spend;
        map.set(item.category, current);
      }
    }
    if (map.size === 0 && history.length > 0) {
      const savings = history.reduce((sum, run) => sum + (run.totalSavings ?? 0), 0);
      const spend = history.reduce((sum, run) => sum + (run.totalSpend ?? run.winnerPrice ?? 0), 0);
      map.set('Menu Basket', { category: 'Menu Basket', savings, spend });
    }
    return Array.from(map.values()).sort((a, b) => b.savings - a.savings);
  }, [history]);

  const supplierScores = useMemo(() => {
    const raw = history.flatMap(run => run.supplierScorecards ?? []);
    const scores = raw.length ? raw : fallbackScorecards(history);
    const grouped = new Map<string, SupplierScore & { runs: number }>();
    for (const score of scores) {
      const current = grouped.get(score.supplier);
      if (!current) {
        grouped.set(score.supplier, { ...score, runs: 1 });
      } else {
        const runs = current.runs + 1;
        grouped.set(score.supplier, {
          ...current,
          finalPrice: current.finalPrice + score.finalPrice,
          originalPrice: current.originalPrice + score.originalPrice,
          savings: current.savings + score.savings,
          priceCompetitiveness: Math.round((current.priceCompetitiveness * current.runs + score.priceCompetitiveness) / runs),
          responseSpeed: Math.round((current.responseSpeed * current.runs + score.responseSpeed) / runs),
          dealQuality: Math.round((current.dealQuality * current.runs + score.dealQuality) / runs),
          overall: Math.round((current.overall * current.runs + score.overall) / runs),
          runs,
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.overall - a.overall);
  }, [history]);

  const totals = useMemo(() => ({
    savings: history.reduce((sum, run) => sum + (run.totalSavings ?? 0), 0),
    spend: history.reduce((sum, run) => sum + (run.totalSpend ?? run.winnerPrice ?? 0), 0),
    market: history.reduce((sum, run) => sum + (run.totalSpend ?? run.winnerPrice ?? 0) + (run.totalSavings ?? 0), 0),
    runs: history.length,
  }), [history]);

  if (!ready || !account) return <PageSkeleton />;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div>
          <p className="text-[12px] font-bold text-violet-300 uppercase tracking-widest mb-1">Intelligence Layer</p>
          <h1 className="text-[30px] font-black text-[#EEEEEE] tracking-tight">Alerts, savings analytics, and supplier scoring</h1>
          <p className="text-[13px] text-[#8A8F98] mt-2">{account.name} · tenant-scoped procurement memory</p>
        </div>
        <Link href="/procurement" className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[12px] rounded-lg transition-all">
          <Sparkles className="w-3.5 h-3.5" />
          Run Procurement
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: CircleDollarSign, label: 'Cumulative Savings', value: totals.savings > 0 ? money(totals.savings) : '—', color: 'text-emerald-400' },
          { icon: TrendingUp, label: 'Market Baseline', value: totals.market > 0 ? money(totals.market) : '—', color: 'text-blue-300' },
          { icon: Bell, label: 'Open Alerts', value: alerts.length || '—', color: 'text-amber-400' },
          { icon: Medal, label: 'Tracked Suppliers', value: supplierScores.length || '—', color: 'text-violet-300' },
        ].map(item => (
          <Panel key={item.label} className="p-5">
            <item.icon className={`w-4 h-4 ${item.color}`} />
            <p className={`text-[28px] font-black tracking-tighter mt-3 ${item.color}`}>{item.value}</p>
            <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mt-1">{item.label}</p>
          </Panel>
        ))}
      </div>

      {history.length === 0 ? (
        <Panel className="p-14 text-center">
          <PackageSearch className="w-10 h-10 text-[#8A8F98]/40 mx-auto" />
          <h2 className="text-[18px] font-black text-[#EEEEEE] mt-4">No intelligence yet</h2>
          <p className="text-[13px] text-[#8A8F98] mt-2">Complete a negotiation to populate alerts, savings charts, and supplier scorecards.</p>
        </Panel>
      ) : (
        <>
          <div className="grid lg:grid-cols-5 gap-6">
            <Panel className="lg:col-span-3 p-5">
              <div className="flex items-center gap-2 mb-5">
                <LineChartIcon className="w-4 h-4 text-emerald-400" />
                <h2 className="text-[13px] font-bold text-[#EEEEEE] uppercase tracking-wider">Savings vs Market Price</h2>
              </div>
              <div className="h-72 min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart data={savingsTrend} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#8A8F98', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#8A8F98', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={money} />
                    <Tooltip contentStyle={{ background: '#080808', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => money(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#8A8F98' }} />
                    <Area type="monotone" dataKey="market" name="Market baseline" stroke="#60a5fa" fill="transparent" strokeWidth={2} />
                    <Area type="monotone" dataKey="spend" name="Negotiated spend" stroke="#a78bfa" fill="transparent" strokeWidth={2} />
                    <Area type="monotone" dataKey="cumulativeSavings" name="Cumulative savings" stroke="#34d399" fill="url(#savingsFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel className="lg:col-span-2 p-5">
              <div className="flex items-center gap-2 mb-5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h2 className="text-[13px] font-bold text-[#EEEEEE] uppercase tracking-wider">Alerts Inbox</h2>
              </div>
              {alerts.length === 0 ? (
                <div className="h-72 flex flex-col items-center justify-center text-center border border-dashed border-white/10 rounded-xl">
                  <Bell className="w-8 h-8 text-[#8A8F98]/30" />
                  <p className="text-[13px] font-bold text-[#EEEEEE] mt-3">No active price alerts</p>
                  <p className="text-[12px] text-[#8A8F98] mt-1">Spike detection will appear here after market analysis.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {alerts.map(item => (
                    <div key={item.id} className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/15">
                      <p className="text-[12px] font-bold text-amber-300">{item.alert}</p>
                      <p className="text-[12px] text-[#8A8F98] mt-1">Consider locking contract terms or widening supplier coverage before the next run.</p>
                      <p className="text-[10px] font-bold text-[#8A8F98]/70 uppercase tracking-widest mt-3">
                        {new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Panel className="p-5">
              <div className="flex items-center gap-2 mb-5">
                <Radar className="w-4 h-4 text-blue-300" />
                <h2 className="text-[13px] font-bold text-[#EEEEEE] uppercase tracking-wider">Savings By Category</h2>
              </div>
              <div className="h-72 min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={categorySavings} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 11 }} tickFormatter={money} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="category" tick={{ fill: '#8A8F98', fontSize: 11 }} width={80} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#080808', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => money(Number(v))} />
                    <Bar dataKey="savings" name="Savings" fill="#34d399" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel className="p-5">
              <div className="flex items-center gap-2 mb-5">
                <Building2 className="w-4 h-4 text-violet-300" />
                <h2 className="text-[13px] font-bold text-[#EEEEEE] uppercase tracking-wider">Best Suppliers Over Time</h2>
              </div>
              <div className="space-y-3">
                {supplierScores.slice(0, 5).map((supplier, index) => (
                  <div key={supplier.supplier} className="p-4 rounded-lg bg-white/[0.025] border border-white/[0.06]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-[#EEEEEE] truncate">{index + 1}. {supplier.supplier}</p>
                        <p className="text-[11px] text-[#8A8F98] mt-1">{money(supplier.savings)} saved · {supplier.decision.toLowerCase()}</p>
                      </div>
                      <p className="text-[24px] font-black text-violet-300">{supplier.overall}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        ['Price', supplier.priceCompetitiveness],
                        ['Speed', supplier.responseSpeed],
                        ['Deal', supplier.dealQuality],
                      ].map(([label, value]) => (
                        <div key={label} className="space-y-1">
                          <div className="flex justify-between text-[10px] text-[#8A8F98] font-bold uppercase tracking-widest">
                            <span>{label}</span><span>{value}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-violet-400" style={{ width: `${value}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
