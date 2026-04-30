'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  DollarSign, Package, Building2, AlertTriangle,
  PlusCircle, Clock, CheckCircle, ChevronRight,
  Zap, Target, BarChart3
} from 'lucide-react';
import {
  readAccount,
  readActiveRfp,
  readTenantHistory,
  type ActiveRFP,
  type ProcurementRecord,
  type RestaurantAccount,
} from '@/lib/tenant';
import { PageSkeleton } from '@/components/Skeleton';

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'default',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'default' | 'green' | 'violet' | 'blue' | 'amber';
}) {
  const iconColors: Record<string, string> = {
    default: 'text-[#8A8F98]',
    green:   'text-emerald-400',
    violet:  'text-violet-400',
    blue:    'text-blue-400',
    amber:   'text-amber-400',
  };
  const valColors: Record<string, string> = {
    default: 'text-[#EEEEEE]',
    green:   'text-emerald-400',
    violet:  'text-violet-300',
    blue:    'text-blue-300',
    amber:   'text-amber-400',
  };
  return (
    <div className="linear-panel rounded-xl p-5 border border-white/[0.06] hover:border-white/[0.10] transition-colors">
      <div className="flex items-start justify-between">
        <Icon className={`w-4 h-4 ${iconColors[accent]} shrink-0 mt-0.5`} />
        {sub && <span className="text-[10px] font-bold text-[#8A8F98]/60 uppercase tracking-widest">{sub}</span>}
      </div>
      <p className={`text-[28px] font-black tracking-tighter mt-3 ${valColors[accent]}`}>{value}</p>
      <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [history, setHistory] = useState<ProcurementRecord[]>([]);
  const [activeRfp, setActiveRfp] = useState<ActiveRFP | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = readAccount();
    if (!saved) return;
    setAccount(saved);
    setHistory(readTenantHistory(saved.tenantId));
    setActiveRfp(readActiveRfp(saved.tenantId));
    setReady(true);
  }, []);

  const totalSavings = history.reduce((sum, r) => sum + (r.totalSavings ?? 0), 0);
  const totalSpend = history.reduce((sum, r) => sum + (r.totalSpend ?? r.winnerPrice ?? 0), 0);
  const totalIngredients = history.reduce((sum, r) => sum + r.ingredientsCount, 0);
  const totalSuppliers = history.reduce((sum, r) => sum + r.distributorsCount, 0);
  const alertCount = history.flatMap(r => r.marketAlerts ?? []).length;

  const lastRun = history[0];

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();

  if (!ready || !account) return <PageSkeleton />;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">

      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <p className="text-[12px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1">{greeting}</p>
          <h1 className="text-[32px] font-black text-[#EEEEEE] tracking-tight leading-none">
            {account.name}
          </h1>
          <p className="text-[13px] text-[#8A8F98] mt-2 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            {account.location} · {account.cuisineType}
          </p>
          <p className="text-[11px] text-[#8A8F98]/70 mt-1 font-mono">{account.tenantId}</p>
        </div>
        <Link
          href="/procurement"
          className="inline-flex items-center gap-2.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[13px] rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.45)]"
        >
          <PlusCircle className="w-4 h-4" />
          New Procurement
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Clock}
          label="Active RFPs"
          value={activeRfp ? 1 : '—'}
          accent={activeRfp ? 'blue' : 'default'}
          sub={activeRfp?.status}
        />
        <StatCard
          icon={DollarSign}
          label="Savings To Date"
          value={totalSavings > 0 ? `$${totalSavings.toFixed(0)}` : '—'}
          accent={totalSavings > 0 ? 'green' : 'default'}
          sub={totalSavings > 0 ? 'all time' : undefined}
        />
        <StatCard
          icon={Target}
          label="Last Outcome"
          value={lastRun?.winner ? lastRun.winner : '—'}
          accent={lastRun?.winner ? 'violet' : 'default'}
          sub={lastRun?.winner ? 'closed' : undefined}
        />
        <StatCard
          icon={AlertTriangle}
          label="Market Alerts"
          value={alertCount || '—'}
          accent={alertCount > 0 ? 'amber' : 'default'}
          sub={alertCount > 0 ? 'anomalies' : undefined}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 linear-panel rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-white/[0.01]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">Active RFPs</span>
            </div>
            <Link href="/procurement" className="text-[12px] font-bold text-violet-400 hover:text-violet-300 transition-colors">
              Open workbench →
            </Link>
          </div>
          {activeRfp ? (
            <div className="p-6 flex items-center justify-between gap-5 flex-wrap">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-black text-blue-300 uppercase tracking-widest bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
                  {activeRfp.status}
                </div>
                <p className="text-[20px] font-black text-[#EEEEEE] tracking-tight">{activeRfp.restaurantName || account.name}</p>
                <p className="text-[12px] text-[#8A8F98] mt-1">
                  {activeRfp.ingredientsCount} ingredients · {activeRfp.distributorsCount} suppliers · {activeRfp.quotesCount} quotes received
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Opened</p>
                <p className="text-[14px] font-bold text-[#EEEEEE] mt-1">
                  {new Date(activeRfp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 flex items-center justify-between gap-5 flex-wrap">
              <div>
                <p className="text-[16px] font-black text-[#EEEEEE]">No RFPs in market</p>
                <p className="text-[13px] text-[#8A8F98] mt-1">Launch a procurement run to track supplier outreach here.</p>
              </div>
              <Link href="/procurement" className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[12px] rounded-lg transition-all">
                <PlusCircle className="w-3.5 h-3.5" />
                New Procurement
              </Link>
            </div>
          )}
        </div>

        <div className="linear-panel rounded-xl border border-white/[0.06] p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[#8A8F98]" />
            <span className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">Procurement Footprint</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[22px] font-black text-[#EEEEEE]">{history.length || '—'}</p>
              <p className="text-[10px] text-[#8A8F98] uppercase tracking-widest mt-1">Runs</p>
            </div>
            <div>
              <p className="text-[22px] font-black text-blue-300">{totalSuppliers || '—'}</p>
              <p className="text-[10px] text-[#8A8F98] uppercase tracking-widest mt-1">Suppliers</p>
            </div>
            <div>
              <p className="text-[22px] font-black text-violet-300">{totalIngredients || '—'}</p>
              <p className="text-[10px] text-[#8A8F98] uppercase tracking-widest mt-1">Items</p>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Total spend</span>
            <span className="text-[16px] font-black text-[#EEEEEE]">${totalSpend.toFixed(0)}</span>
          </div>
        </div>
      </div>

      <div className="linear-panel rounded-xl border border-white/[0.06] p-5 flex items-center justify-between gap-5 flex-wrap">
        <div>
          <p className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">Restaurant Profile</p>
          <p className="text-[13px] text-[#8A8F98] mt-2">
            {account.cuisineType} · Budget {account.monthlyBudgetTarget ? `$${account.monthlyBudgetTarget.toLocaleString()}/mo` : 'not set'} · Savings target {account.savingsTargetPct != null ? `${account.savingsTargetPct}%` : 'not set'}
          </p>
          <p className="text-[12px] text-[#8A8F98]/70 mt-1">
            Preferred suppliers: {account.preferredSuppliers.length ? account.preferredSuppliers.join(', ') : 'none set'}
          </p>
        </div>
        <Link href="/settings" className="inline-flex items-center gap-2 px-4 py-2 border border-white/[0.08] hover:border-white/[0.16] text-[12px] font-bold text-[#EEEEEE] rounded-lg transition-all">
          Edit profile
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {history.length === 0 ? (
        /* Empty state */
        <div className="linear-panel rounded-2xl border border-white/[0.06] p-16 flex flex-col items-center text-center gap-6">
          <div className="flex -space-x-3">
            {['🎯','📊','🤝','🏪','✅'].map((e, i) => (
              <div key={i} className="w-11 h-11 rounded-full bg-black border border-white/10 flex items-center justify-center text-lg shadow-lg">{e}</div>
            ))}
          </div>
          <div>
            <h2 className="text-[20px] font-black text-[#EEEEEE] tracking-tight">Your AI procurement co-pilot is ready</h2>
            <p className="text-[14px] text-[#8A8F98] mt-2 max-w-sm">
              Run your first procurement to see savings analytics, market insights, and negotiation history here.
            </p>
          </div>
          <Link
            href="/procurement"
            className="inline-flex items-center gap-2.5 px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[14px] rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)]"
          >
            <Zap className="w-4 h-4" />
            Start First Procurement
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] text-[#8A8F98]">
            <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500/50" />Menu parsing</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500/50" />Live pricing</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500/50" />Supplier search</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500/50" />AI negotiation</span>
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Last negotiation */}
          <div className="lg:col-span-2 linear-panel rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-white/[0.01]">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-violet-400" />
                <span className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">Last Negotiation</span>
              </div>
              <span className="text-[11px] text-[#8A8F98]">
                {new Date(lastRun.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <div className="p-6 space-y-5">
              {lastRun.winner ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1">Winner</p>
                      <p className="text-[22px] font-black text-[#EEEEEE] tracking-tight">{lastRun.winner}</p>
                    </div>
                    {lastRun.totalSavings != null && lastRun.totalSavings > 0 && (
                      <div className="text-right">
                        <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1">Saved</p>
                        <p className="text-[22px] font-black text-emerald-400 tracking-tight">
                          ${lastRun.totalSavings.toFixed(2)}
                        </p>
                        {lastRun.savingsPercentage != null && (
                          <p className="text-[11px] font-bold text-emerald-500/70 mt-0.5">
                            {lastRun.savingsPercentage.toFixed(1)}% reduction
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {lastRun.executiveSummary && (
                    <p className="text-[13px] text-[#8A8F98] leading-relaxed border-t border-white/[0.05] pt-4">
                      {lastRun.executiveSummary.slice(0, 180)}{lastRun.executiveSummary.length > 180 ? '…' : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-[11px] text-[#8A8F98] font-medium">
                    <span className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" />{lastRun.ingredientsCount} ingredients</span>
                    <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />{lastRun.distributorsCount} suppliers</span>
                    {lastRun.winnerPrice != null && (
                      <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" />${lastRun.winnerPrice.toFixed(2)} final</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="py-6 text-center text-[#8A8F98] text-[13px]">
                  No negotiation completed yet
                </div>
              )}
            </div>
          </div>

          {/* Quick stats / recent */}
          <div className="space-y-4">
            <Link
              href="/intelligence"
              className="flex items-center justify-between gap-3 p-5 linear-panel rounded-xl border border-amber-500/15 hover:border-amber-500/25 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-[#EEEEEE]">Intelligence Inbox</p>
                  <p className="text-[11px] text-[#8A8F98]">{alertCount || 'No'} market alerts · supplier scoring</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#8A8F98] group-hover:text-[#EEEEEE] transition-colors" />
            </Link>

            {/* CTA */}
            <Link
              href="/procurement"
              className="flex items-center justify-between gap-3 p-5 linear-panel rounded-xl border border-violet-500/15 hover:border-violet-500/25 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                  <PlusCircle className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-[#EEEEEE]">New Procurement</p>
                  <p className="text-[11px] text-[#8A8F98]">Run the full pipeline</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#8A8F98] group-hover:text-[#EEEEEE] transition-colors" />
            </Link>
          </div>
        </div>
      )}

      {/* History preview */}
      {history.length > 1 && (
        <div className="linear-panel rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-white/[0.01]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#8A8F98]" />
              <span className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">Recent Activity</span>
            </div>
            <Link href="/history" className="text-[12px] font-bold text-violet-400 hover:text-violet-300 transition-colors">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {history.slice(0, 4).map((run) => (
              <div key={run.id} className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${run.winner ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-white/5 border border-white/10'}`}>
                  {run.winner ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Clock className="w-4 h-4 text-[#8A8F98]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-[#EEEEEE] truncate">{run.winner ?? 'In progress'}</p>
                  <p className="text-[11px] text-[#8A8F98]">{run.recipesCount} dishes · {run.ingredientsCount} ingredients</p>
                </div>
                <div className="text-right shrink-0">
                  {run.totalSavings != null && run.totalSavings > 0 ? (
                    <p className="text-[13px] font-bold text-emerald-400">−${run.totalSavings.toFixed(0)}</p>
                  ) : (
                    <p className="text-[12px] text-[#8A8F98]">—</p>
                  )}
                  <p className="text-[10px] text-[#8A8F98] mt-0.5">
                    {new Date(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
