'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Clock, CheckCircle, Package, Building2, DollarSign,
  Zap, PlusCircle, Trash2, RotateCcw
} from 'lucide-react';
import {
  ACCOUNT_KEY,
  readAccount,
  saveAccount,
  tenantKey,
  type ProcurementRecord,
  type RestaurantAccount,
} from '@/lib/tenant';
import { PageSkeleton } from '@/components/Skeleton';

export default function HistoryPage() {
  const router = useRouter();
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [history, setHistory] = useState<ProcurementRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/account').then(async res => {
        if (!res.ok) {
          if (res.status === 401) localStorage.removeItem(ACCOUNT_KEY);
          return { account: null, allowLocalFallback: false };
        }
        return { account: (await res.json()).account as RestaurantAccount, allowLocalFallback: true };
      }),
      fetch('/api/dashboard').then(async res => res.ok ? await res.json() : null),
    ]).then(([accountResult, dashboard]) => {
      const account = accountResult.account;
      const fallback = account ?? (accountResult.allowLocalFallback ? readAccount() : null);
      if (!fallback) return;
      if (account) saveAccount(account);
      setAccount(fallback);
      setHistory(dashboard?.history ?? []);
      setReady(true);
    }).catch(() => {
      const saved = readAccount();
      if (!saved) return;
      setAccount(saved);
      setReady(true);
    });
  }, []);

  const clearHistory = async () => {
    if (!account) return;
    if (!confirm('Clear all procurement history?')) return;
    await fetch('/api/history', { method: 'DELETE' });
    setHistory([]);
  };

  const runAgain = (run: ProcurementRecord) => {
    if (!account || !run.menuText) return;
    localStorage.setItem(tenantKey(account.tenantId, 'run_again'), JSON.stringify({
      menuText: run.menuText,
      sourceRunId: run.id,
      date: new Date().toISOString(),
    }));
    router.push('/procurement');
  };

  const totalSpend = history.reduce((sum, run) => sum + (run.totalSpend ?? run.winnerPrice ?? 0), 0);
  const totalSavings = history.reduce((sum, run) => sum + (run.totalSavings ?? 0), 0);
  const averageSavingsPct = history.length
    ? history.reduce((sum, run) => sum + (run.savingsPercentage ?? 0), 0) / history.length
    : 0;

  if (!ready) return <PageSkeleton />;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-black text-[#EEEEEE] tracking-tight">Procurement History</h1>
          <p className="text-[13px] text-[#8A8F98] mt-1">
            {history.length} {history.length === 1 ? 'run' : 'runs'} recorded{account ? ` · ${account.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-bold text-[#8A8F98] hover:text-red-400 hover:bg-red-500/5 border border-white/[0.06] hover:border-red-500/20 rounded-lg transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
          <Link
            href="/procurement"
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[12px] rounded-lg transition-all shadow-[0_0_15px_rgba(139,92,246,0.25)]"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            New Run
          </Link>
        </div>
      </div>

      {history.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="linear-panel rounded-xl border border-white/[0.06] p-4">
            <p className="text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">Total Spend</p>
            <p className="text-[24px] font-black text-[#EEEEEE] mt-2">${totalSpend.toFixed(0)}</p>
          </div>
          <div className="linear-panel rounded-xl border border-white/[0.06] p-4">
            <p className="text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">Savings</p>
            <p className="text-[24px] font-black text-emerald-400 mt-2">${totalSavings.toFixed(0)}</p>
          </div>
          <div className="linear-panel rounded-xl border border-white/[0.06] p-4">
            <p className="text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">Avg Reduction</p>
            <p className="text-[24px] font-black text-violet-300 mt-2">{averageSavingsPct.toFixed(1)}%</p>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="linear-panel rounded-2xl border border-white/[0.06] p-16 flex flex-col items-center text-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-center">
            <Clock className="w-7 h-7 text-[#8A8F98]/40" />
          </div>
          <div>
            <h2 className="text-[18px] font-black text-[#EEEEEE]">No history yet</h2>
            <p className="text-[13px] text-[#8A8F98] mt-2 max-w-xs">
              Completed negotiations are saved here automatically. Run your first procurement to get started.
            </p>
          </div>
          <Link
            href="/procurement"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[13px] rounded-xl transition-all"
          >
            <Zap className="w-4 h-4" />
            Start Procurement
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((run) => (
            <div
              key={run.id}
              className="linear-panel rounded-xl border border-white/[0.06] hover:border-white/[0.10] transition-all overflow-hidden"
            >
              {/* Row */}
              <button
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                className="w-full flex items-center gap-4 px-6 py-5 text-left"
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  run.winner
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : 'bg-white/[0.03] border border-white/[0.06]'
                }`}>
                  {run.winner
                    ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                    : <Clock className="w-4 h-4 text-[#8A8F98]" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <p className="text-[14px] font-bold text-[#EEEEEE] truncate">
                      {run.winner ?? 'Incomplete negotiation'}
                    </p>
                    {run.savingsPercentage != null && run.savingsPercentage > 0 && (
                      <span className="shrink-0 text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md uppercase tracking-wide">
                        −{run.savingsPercentage.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-[#8A8F98]">
                    <span className="flex items-center gap-1"><Package className="w-3 h-3" />{run.ingredientsCount} ing.</span>
                    <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{run.distributorsCount} suppliers</span>
                    <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${(run.totalSpend ?? run.winnerPrice ?? 0).toFixed(0)} spend</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />
                      {new Date(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {run.totalSavings != null && run.totalSavings > 0 ? (
                    <>
                      <p className="text-[16px] font-black text-emerald-400 tracking-tight">−${run.totalSavings.toFixed(2)}</p>
                      <p className="text-[10px] text-[#8A8F98]">saved</p>
                    </>
                  ) : run.winnerPrice != null ? (
                    <>
                      <p className="text-[16px] font-black text-[#EEEEEE] tracking-tight">${run.winnerPrice.toFixed(2)}</p>
                      <p className="text-[10px] text-[#8A8F98]">final price</p>
                    </>
                  ) : (
                    <p className="text-[13px] text-[#8A8F98]">—</p>
                  )}
                </div>
              </button>

              {/* Expanded */}
              {expanded === run.id && run.executiveSummary && (
                <div className="border-t border-white/[0.05] px-6 py-5 bg-white/[0.01] space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <p className="text-[10px] text-[#8A8F98] uppercase tracking-widest">Best vendor</p>
                      <p className="text-[12px] font-bold text-[#EEEEEE] mt-1">{run.winner ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#8A8F98] uppercase tracking-widest">Total spend</p>
                      <p className="text-[12px] font-bold text-[#EEEEEE] mt-1">${(run.totalSpend ?? run.winnerPrice ?? 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#8A8F98] uppercase tracking-widest">Savings %</p>
                      <p className="text-[12px] font-bold text-emerald-400 mt-1">{(run.savingsPercentage ?? 0).toFixed(1)}%</p>
                    </div>
                    <div className="flex justify-start md:justify-end items-start">
                      <button
                        onClick={() => runAgain(run)}
                        disabled={!run.menuText}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed border border-white/[0.08] text-[11px] font-bold text-[#EEEEEE] rounded-lg transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Run again
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-violet-400 uppercase tracking-[0.18em] mb-2">Executive Summary</p>
                    <p className="text-[13px] text-[#CCCCCC] leading-relaxed">{run.executiveSummary}</p>
                  </div>
                  {(run.marketAlerts ?? []).length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.18em] mb-2">Market Alerts Detected</p>
                      <div className="flex flex-wrap gap-2">
                        {run.marketAlerts!.map((a, i) => (
                          <span key={i} className="text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-md">
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
