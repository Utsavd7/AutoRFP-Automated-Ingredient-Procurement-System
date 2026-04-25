'use client';
import { useState, useMemo } from 'react';
import {
  Loader2, ChefHat, Search, MapPin, Mail, Bot, Zap, Brain,
  MessageSquare, FileText, Package, DollarSign, Building2,
  FileCheck, AlertTriangle, CheckCircle, ArrowUpRight,
  ArrowDownRight, Minus, Sparkles, ShoppingCart, BarChart3,
  Clock, Target, Shield, Star, TrendingUp, ChevronRight,
  Activity, Cpu
} from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer
} from 'recharts';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// ─── Pill tag ─────────────────────────────────────────────────────────────────
function Tag({ children, color = 'gray' }: { children: React.ReactNode; color?: 'gray' | 'green' | 'blue' | 'amber' | 'red' | 'indigo' }) {
  const c = {
    gray:   'bg-slate-100 text-slate-600',
    green:  'bg-emerald-50 text-emerald-700',
    blue:   'bg-blue-50 text-blue-700',
    amber:  'bg-amber-50 text-amber-700',
    red:    'bg-red-50 text-red-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  }[color];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium', c)}>
      {children}
    </span>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, subtitle, step, done, children, action }: {
  title: string; subtitle?: string; step: number; done: boolean;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
          )}>
            {done ? <CheckCircle className="w-4 h-4" /> : step}
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ─── Primary button ───────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, loading, variant = 'primary', size = 'md' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  loading?: boolean; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md';
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all select-none';
  const sizes = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2' };
  const variants = {
    primary:   'bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed',
    secondary: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm',
    ghost:     'text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={cn(base, sizes[size], variants[variant])}>
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl shadow-sm', className)}>
      {children}
    </div>
  );
}

export default function Home() {

  // ── State ─────────────────────────────────────────────────────────────────
  const [menuText, setMenuText] = useState('');
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);

  const [pricingData, setPricingData] = useState<any[]>([]);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [mlForecasts, setMlForecasts] = useState<Record<string, any>>({});

  const [distributors, setDistributors] = useState<any[]>([]);
  const [distributorLocation, setDistributorLocation] = useState('');
  const [loadingDistributors, setLoadingDistributors] = useState(false);
  const [distributorSource, setDistributorSource] = useState<string | null>(null);
  const [sendingRFPs, setSendingRFPs] = useState(false);
  const [sentRFPs, setSentRFPs] = useState<any[]>([]);

  const [quotes, setQuotes] = useState<any[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [showEmailSimulator, setShowEmailSimulator] = useState(false);
  const [simulatedEmailBody, setSimulatedEmailBody] = useState('');
  const [simulatedEmailRfpId, setSimulatedEmailRfpId] = useState('');
  const [simulatingEmail, setSimulatingEmail] = useState(false);
  const [followUpEmail, setFollowUpEmail] = useState('');
  const [recommendation, setRecommendation] = useState<any>(null);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);
  const [conversationLogs, setConversationLogs] = useState<Record<string, any[]>>({});
  const [simulatingConversation, setSimulatingConversation] = useState(false);

  const [negotiating, setNegotiating] = useState(false);
  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const [emailThread, setEmailThread] = useState<any[]>([]);
  const [negotiationComplete, setNegotiationComplete] = useState<any>(null);

  const [error, setError] = useState('');

  // ── Derived stats ─────────────────────────────────────────────────────────
  const marketValue = useMemo(() => {
    if (!pricingData.length || !ingredients.length) return 0;
    const priceMap = new Map(pricingData.map(p => [p.name.toLowerCase(), p.currentPrice]));
    return ingredients.reduce((sum, ing) => {
      const price = priceMap.get(ing.name.toLowerCase()) ?? 0;
      return sum + (typeof ing.quantity === 'number' ? price * ing.quantity : price);
    }, 0);
  }, [pricingData, ingredients]);

  const liveCount = useMemo(() => pricingData.filter(p => p.isLive).length, [pricingData]);
  const anomalyCount = useMemo(() => Object.values(mlForecasts).filter((f: any) => f.anomaly).length, [mlForecasts]);

  const steps = useMemo(() => [
    { id: 1, label: 'Menu Analysis',      done: recipes.length > 0 },
    { id: 2, label: 'Market Pricing',     done: pricingData.length > 0 },
    { id: 3, label: 'Find Suppliers',     done: distributors.length > 0 },
    { id: 4, label: 'Collect Quotes',     done: quotes.length > 0 },
    { id: 5, label: 'AI Negotiation',     done: !!negotiationComplete },
  ], [recipes, pricingData, distributors, quotes, negotiationComplete]);

  const currentStep = steps.findIndex(s => !s.done) + 1 || 5;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleParseMenu = async () => {
    if (!menuText.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/parse-menu', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse menu');
      setRecipes(data.recipes);
      const map = new Map<string, any>();
      data.recipes.forEach((r: any) => r.ingredients.forEach((ing: any) => {
        if (!map.has(ing.name)) map.set(ing.name, { ...ing });
        else {
          const ex = map.get(ing.name);
          if (ex.unit === ing.unit && typeof ex.quantity === 'number' && typeof ing.quantity === 'number')
            ex.quantity += ing.quantity;
        }
      }));
      setIngredients(Array.from(map.values()));
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleFetchPricing = async () => {
    if (!ingredients.length) return;
    setLoadingPricing(true); setError('');
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPricingData(data.pricing);
      try {
        const forecastRes = await fetch('/api/ml/forecast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredients: data.pricing }),
        });
        const forecastData = await forecastRes.json();
        const map: Record<string, any> = {};
        (forecastData.forecasts ?? []).forEach((f: any) => { map[f.name] = f; });
        setMlForecasts(map);
      } catch { /* forecast is non-critical */ }
    } catch (err: any) { setError(err.message); }
    finally { setLoadingPricing(false); }
  };

  const handleFindDistributors = async () => {
    if (!distributorLocation.trim()) return;
    setLoadingDistributors(true); setError('');
    try {
      const res = await fetch('/api/distributors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: distributorLocation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to find distributors');
      setDistributors(data.distributors);
      setDistributorSource(data.source || null);
    } catch (err: any) { setError(err.message); }
    finally { setLoadingDistributors(false); }
  };

  const handleSendRFPs = async () => {
    if (!distributors.length || !ingredients.length) return;
    setSendingRFPs(true); setError('');
    try {
      const res = await fetch('/api/send-rfp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributorIds: distributors.map(d => d.id),
          menuId: recipes[0]?.menuId || 'demo-menu-id',
          ingredients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send RFPs');
      setSentRFPs(data.rfps);
    } catch (err: any) { setError(err.message); }
    finally { setSendingRFPs(false); }
  };

  const handleFetchQuotes = async () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;
    setLoadingQuotes(true); setError('');
    try {
      const res = await fetch(`/api/quotes?menuId=${menuId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch quotes');
      setQuotes(data.quotes);
    } catch (err: any) { setError(err.message); }
    finally { setLoadingQuotes(false); }
  };

  const handleSimulateEmail = async () => {
    if (!simulatedEmailRfpId || !simulatedEmailBody.trim()) return;
    setSimulatingEmail(true); setError('');
    try {
      const res = await fetch('/api/webhooks/inbound-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfpId: simulatedEmailRfpId, emailBody: simulatedEmailBody }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process email.');
      if (data.action === 'FOLLOW_UP_SENT') {
        setFollowUpEmail(data.followUpEmail);
        setSimulatedEmailBody(''); setSimulatedEmailRfpId('');
      } else {
        setFollowUpEmail(''); setSimulatedEmailBody(''); setSimulatedEmailRfpId('');
        setShowEmailSimulator(false);
        await handleFetchQuotes();
      }
    } catch (err: any) { setError(err.message); }
    finally { setSimulatingEmail(false); }
  };

  const handleAutoConversation = async () => {
    if (!sentRFPs.length) return;
    setSimulatingConversation(true); setError('');
    const newLogs: Record<string, any[]> = {};
    try {
      const unresolved = sentRFPs.filter(rfp => !quotes.some(q => q.rfpId === rfp.id));
      for (const rfp of unresolved) {
        const res = await fetch('/api/simulate-conversation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rfpId: rfp.id, ingredients, pricingData }),
        });
        const data = await res.json();
        newLogs[rfp.id] = [
          { role: 'system', message: `Simulating conversation with ${rfp.distributorName}...` },
          ...(data.conversationLog || []),
          { role: 'system', message: data.message },
        ];
      }
      setConversationLogs(newLogs);
      await handleFetchQuotes();
    } catch (err: any) { setError(err.message); }
    finally { setSimulatingConversation(false); }
  };

  const handleGetRecommendation = async () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;
    setLoadingRecommendation(true); setError('');
    try {
      const res = await fetch(`/api/recommend?menuId=${menuId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get recommendation');
      setRecommendation(data.recommendation);
    } catch (err: any) { setError(err.message); }
    finally { setLoadingRecommendation(false); }
  };

  const handleAgentNegotiation = () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;
    setNegotiating(true); setAgentEvents([]); setEmailThread([]); setNegotiationComplete(null);
    const es = new EventSource(`/api/agent/negotiate?menuId=${menuId}`);
    const add = (type: string, data: any) => setAgentEvents(prev => [...prev, { type, ...data }]);
    es.addEventListener('agent_start',       e => add('agent_start',       JSON.parse((e as MessageEvent).data)));
    es.addEventListener('agent_result',      e => add('agent_result',      JSON.parse((e as MessageEvent).data)));
    es.addEventListener('negotiation_round', e => add('negotiation_round', JSON.parse((e as MessageEvent).data)));
    es.addEventListener('email_sent',        e => { const d = JSON.parse((e as MessageEvent).data); add('email_sent', d); setEmailThread(p => [...p, { direction: 'sent', ...d }]); });
    es.addEventListener('email_received',    e => { const d = JSON.parse((e as MessageEvent).data); add('email_received', d); setEmailThread(p => [...p, { direction: 'received', ...d }]); });
    es.addEventListener('complete',          e => { const d = JSON.parse((e as MessageEvent).data); setNegotiationComplete(d); add('complete', d); setNegotiating(false); es.close(); });
    es.addEventListener('error',             e => { const raw = (e as MessageEvent).data; if (raw) add('error', JSON.parse(raw)); setNegotiating(false); es.close(); });
    es.onerror = () => { setNegotiating(false); es.close(); };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">

      {/* ── Sticky top block: nav + stepper + stats ───────────────────────── */}
      <div className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">

        {/* Navbar */}
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <ChefHat className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-slate-900 text-[15px]">AutoRFP</span>
            <span className="hidden sm:block text-slate-400 text-sm">/ Procurement</span>
          </div>
          <div className="flex items-center gap-3">
            {anomalyCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                {anomalyCount} price {anomalyCount === 1 ? 'anomaly' : 'anomalies'}
              </span>
            )}
            <span className="text-xs text-slate-500 font-medium">
              Step {currentStep} of 5
            </span>
          </div>
        </div>

        {/* Progress stepper */}
        <div className="border-t border-slate-100 bg-slate-50/80">
          <div className="max-w-6xl mx-auto px-6">
            <ol className="flex items-center">
              {steps.map((step, idx) => {
                const isActive = step.id === currentStep;
                const isDone   = step.done;
                return (
                  <li key={step.id} className="flex items-center flex-1 min-w-0">
                    <div className={cn(
                      'flex items-center gap-2 py-2.5 px-1 text-xs font-medium min-w-0 truncate',
                      isDone   ? 'text-emerald-600' :
                      isActive ? 'text-blue-600' :
                                 'text-slate-400'
                    )}>
                      <div className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        isDone   ? 'bg-emerald-500 text-white' :
                        isActive ? 'bg-blue-600 text-white' :
                                   'bg-slate-200 text-slate-500'
                      )}>
                        {isDone ? '✓' : step.id}
                      </div>
                      <span className="hidden sm:block truncate">{step.label}</span>
                    </div>
                    {idx < steps.length - 1 && (
                      <div className={cn(
                        'flex-1 h-px mx-2',
                        steps[idx].done ? 'bg-emerald-300' : 'bg-slate-200'
                      )} />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Stats strip */}
        <div className="border-t border-slate-100">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex divide-x divide-slate-100">
              {[
                { label: 'Ingredients',  value: ingredients.length || '—',  icon: Package,   hi: ingredients.length > 0 },
                { label: 'Market Value', value: marketValue > 0 ? `$${marketValue.toFixed(0)}` : '—', icon: DollarSign, hi: marketValue > 0 },
                { label: 'Suppliers',    value: distributors.length || '—', icon: Building2,  hi: distributors.length > 0 },
                { label: 'Quotes',       value: sentRFPs.length ? `${quotes.length} / ${sentRFPs.length}` : '—', icon: FileCheck, hi: quotes.length > 0 },
                { label: 'AI Savings',   value: negotiationComplete ? `$${Number(negotiationComplete.totalSavings).toFixed(0)}` : '—', icon: Target, hi: !!negotiationComplete, green: true },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 px-5 py-2.5">
                  <s.icon className={cn('w-3.5 h-3.5 shrink-0', s.green && s.hi ? 'text-emerald-500' : s.hi ? 'text-blue-500' : 'text-slate-300')} />
                  <div>
                    <span className={cn('text-sm font-semibold', s.green && s.hi ? 'text-emerald-600' : s.hi ? 'text-slate-900' : 'text-slate-400')}>
                      {s.value}
                    </span>
                    <span className="text-xs text-slate-400 ml-1.5">{s.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-12">

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* ════════════════════════════════════════════════
            STEP 1 — Menu Analysis
        ════════════════════════════════════════════════ */}
        <Section
          step={1} done={recipes.length > 0}
          title="Menu Analysis"
          subtitle="Paste your menu or a URL — AI extracts every dish and ingredient automatically"
        >
          <div className="grid lg:grid-cols-5 gap-5">
            {/* Input */}
            <Card className="lg:col-span-2 p-5 flex flex-col gap-4">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Menu Input</label>
              <textarea
                rows={10}
                className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none font-mono leading-relaxed"
                placeholder={"Classic Cheeseburger  $12\nSpaghetti Bolognese  $16\nGrilled Salmon  $24\n\nor paste a URL to auto-fetch"}
                value={menuText}
                onChange={e => setMenuText(e.target.value)}
              />
              <Btn onClick={handleParseMenu} disabled={!menuText.trim()} loading={loading}>
                <Sparkles className="w-3.5 h-3.5" />
                {loading ? 'Analyzing with Groq…' : 'Extract Ingredients'}
              </Btn>
            </Card>

            {/* Dishes */}
            <Card className="lg:col-span-3 p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Extracted Dishes</span>
                {recipes.length > 0 && <Tag color="blue">{recipes.length} dishes</Tag>}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 min-h-[220px]">
                {recipes.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 py-10">
                    <ChefHat className="w-8 h-8 opacity-30" />
                    <p className="text-sm">Dishes appear here after extraction</p>
                  </div>
                ) : recipes.map((recipe, i) => (
                  <div key={i} className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors">
                    <span className="text-sm text-slate-800 font-medium">{recipe.name}</span>
                    <span className="text-xs text-slate-400">{recipe.ingredients?.length ?? 0} ingredients</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Ingredient list */}
            {ingredients.length > 0 && (
              <Card className="lg:col-span-5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Procurement List</span>
                  <Tag color="blue">{ingredients.length} unique ingredients</Tag>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {ingredients.map((ing, i) => (
                    <div key={i} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-xs font-medium text-slate-800 truncate">{ing.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{ing.quantity} {ing.unit}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </Section>

        {/* ════════════════════════════════════════════════
            STEP 2 — Market Pricing
        ════════════════════════════════════════════════ */}
        <Section
          step={2} done={pricingData.length > 0}
          title="Market Pricing & Forecasting"
          subtitle="Live commodity data from CME/CBOT futures · ML regression with 3-month price forecast"
          action={
            <div className="flex items-center gap-2 flex-wrap">
              {liveCount > 0 && <Tag color="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{liveCount} live</Tag>}
              {Object.keys(mlForecasts).length > 0 && <Tag color="indigo"><Activity className="w-3 h-3" />ML active</Tag>}
              <Btn onClick={handleFetchPricing} disabled={!ingredients.length} loading={loadingPricing}>
                <BarChart3 className="w-3.5 h-3.5" />
                {loadingPricing ? 'Fetching…' : 'Run Analysis'}
              </Btn>
            </div>
          }
        >
          {pricingData.length === 0 ? (
            <Card className="py-16 flex flex-col items-center text-slate-400 gap-2">
              <BarChart3 className="w-9 h-9 opacity-20" />
              <p className="text-sm">Run market analysis after extracting ingredients</p>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {pricingData.map((item, idx) => {
                const current = item.history[item.history.length - 1]?.price ?? item.currentPrice;
                const prev    = item.history[item.history.length - 2]?.price ?? current;
                const pct     = prev > 0 ? ((current - prev) / prev) * 100 : 0;
                const forecast = mlForecasts[item.name];

                const chartData = [
                  ...item.history.map((h: any, i: number) => ({
                    date: h.date, price: h.price,
                    forecast: i === item.history.length - 1 ? h.price : null
                  })),
                  ...(forecast?.forecast ?? []).map((f: any) => ({
                    date: f.date, price: null, forecast: f.price
                  }))
                ];

                const trendColor = forecast?.trend === 'RISING' ? 'text-red-600' : forecast?.trend === 'FALLING' ? 'text-emerald-600' : 'text-slate-500';

                return (
                  <Card key={idx} className="p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 truncate text-sm">{item.name}</h3>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {item.isLive
                            ? <Tag color="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live</Tag>
                            : <Tag color="gray">Simulated</Tag>
                          }
                          {forecast?.trend && forecast.trend !== 'STABLE' && (
                            <span className={cn('text-[11px] font-medium flex items-center gap-0.5', trendColor)}>
                              {forecast.trend === 'RISING' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                              {forecast.trend} {forecast.trendPct > 0 && `${forecast.trendPct}%`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-bold text-slate-900">${item.currentPrice.toFixed(2)}</p>
                        <p className={cn('text-xs mt-0.5', pct > 0 ? 'text-red-500' : pct < 0 ? 'text-emerald-500' : 'text-slate-400')}>
                          {pct > 0 ? '+' : ''}{pct.toFixed(1)}% MoM
                        </p>
                      </div>
                    </div>

                    {forecast?.anomaly && (
                      <div className={cn(
                        'text-xs px-3 py-2 rounded-lg flex items-start gap-1.5',
                        forecast.anomaly.type === 'SPIKE' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                      )}>
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        {forecast.anomaly.type === 'SPIKE'
                          ? `Price spike: ${forecast.anomaly.deviationPct}% above average`
                          : `Below average: ${forecast.anomaly.deviationPct}% — good time to buy`}
                      </div>
                    )}

                    <div className="h-20">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <defs>
                            <linearGradient id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} hide />
                          <Tooltip
                            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '11px', color: '#1e293b' }}
                            labelFormatter={l => new Date(l).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            formatter={(v: any, n) => [v !== null ? `$${Number(v).toFixed(2)}` : '—', n === 'forecast' ? 'ML Forecast' : 'Market Price'] as [string, string]}
                          />
                          <Area type="monotone" dataKey="price" stroke="#3B82F6" strokeWidth={1.5} fill={`url(#grad-${idx})`} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="forecast" stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    {forecast?.buySignal && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className={cn(
                          'font-semibold flex items-center gap-1',
                          forecast.buySignal.signal === 'BUY_NOW' ? 'text-emerald-600' :
                          forecast.buySignal.signal === 'WAIT'    ? 'text-amber-600' : 'text-slate-400'
                        )}>
                          {forecast.buySignal.signal === 'BUY_NOW'
                            ? <><ShoppingCart className="w-3 h-3" />Buy now</>
                            : forecast.buySignal.signal === 'WAIT'
                            ? <><Clock className="w-3 h-3" />Wait</>
                            : <><Minus className="w-3 h-3" />Neutral</>}
                        </span>
                        <span className="text-slate-400">R²={forecast.r2} · {forecast.confidence}</span>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </Section>

        {/* ════════════════════════════════════════════════
            STEP 3 — Supplier Discovery
        ════════════════════════════════════════════════ */}
        <Section
          step={3} done={distributors.length > 0}
          title="Supplier Discovery"
          subtitle="Search by city or zip code to find nearby wholesale food distributors"
        >
          <Card className="p-5 space-y-5">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={distributorLocation}
                  onChange={e => setDistributorLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFindDistributors()}
                  placeholder="e.g. New York, NY  or  10001"
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <Btn onClick={handleFindDistributors} disabled={!distributorLocation.trim()} loading={loadingDistributors}>
                <Search className="w-3.5 h-3.5" />
                {loadingDistributors ? 'Searching…' : 'Find Suppliers'}
              </Btn>
            </div>

            {distributors.length === 0 && !loadingDistributors && (
              <div className="py-10 flex flex-col items-center text-slate-400 gap-2 border border-dashed border-slate-200 rounded-lg">
                <Building2 className="w-8 h-8 opacity-25" />
                <p className="text-sm">Enter a location to discover local distributors</p>
              </div>
            )}

            {distributors.length > 0 && (
              <>
                {distributorSource && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Source:</span>
                    <Tag color={distributorSource.startsWith('OpenStreetMap') ? 'green' : 'gray'}>
                      {distributorSource.startsWith('OpenStreetMap') && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                      {distributorSource}
                    </Tag>
                  </div>
                )}
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {distributors.map((dist, i) => (
                    <div key={i} className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 hover:bg-blue-50/30 transition-colors flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm text-slate-900 truncate">{dist.name}</h3>
                          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 shrink-0" />{dist.location}
                          </p>
                        </div>
                        {sentRFPs.some(r => r.distributorName === dist.name) && (
                          <Tag color="green"><CheckCircle className="w-3 h-3" />Sent</Tag>
                        )}
                      </div>
                      {dist.specialty && <p className="text-[11px] text-slate-500 leading-snug">{dist.specialty}</p>}
                      <p className="text-[11px] text-slate-400 font-mono truncate">{dist.email}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Btn
                    onClick={handleSendRFPs}
                    disabled={sendingRFPs || sentRFPs.length > 0}
                    loading={sendingRFPs}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {sentRFPs.length > 0 ? `RFPs sent to ${sentRFPs.length} suppliers` : `Send RFPs to ${distributors.length} suppliers`}
                  </Btn>
                </div>
              </>
            )}
          </Card>
        </Section>

        {/* ════════════════════════════════════════════════
            STEP 4 — Quote Collection
        ════════════════════════════════════════════════ */}
        {sentRFPs.length > 0 && (
          <Section
            step={4} done={quotes.length > 0}
            title="Quote Collection"
            subtitle={`${quotes.length} of ${sentRFPs.length} suppliers responded`}
            action={
              <div className="flex items-center gap-2">
                <Btn variant="secondary" size="sm" onClick={() => setShowEmailSimulator(s => !s)}>Manual</Btn>
                <Btn size="sm" onClick={handleAutoConversation} disabled={simulatingConversation || quotes.length >= sentRFPs.length} loading={simulatingConversation}>
                  <Bot className="w-3 h-3" />
                  {simulatingConversation ? 'Simulating…' : 'Auto-simulate responses'}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={handleFetchQuotes} disabled={loadingQuotes}>
                  {loadingQuotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
                </Btn>
              </div>
            }
          >
            {/* Conversation logs */}
            {Object.keys(conversationLogs).length > 0 && (
              <Card className="p-5 space-y-4">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Negotiation Conversations</h3>
                {sentRFPs.map((rfp: any) => {
                  const logs = conversationLogs[rfp.id];
                  if (!logs) return null;
                  return (
                    <div key={rfp.id} className="space-y-1.5 border-t border-slate-100 pt-4 first:border-0 first:pt-0">
                      <p className="text-xs font-semibold text-slate-600">{rfp.distributorName}</p>
                      {logs.map((entry: any, i: number) => (
                        <div key={i} className={cn(
                          'text-xs rounded-lg px-3.5 py-2.5',
                          entry.role === 'AutoRFP Agent' ? 'bg-blue-50 text-blue-800'
                          : entry.role === 'system' ? 'text-slate-400 italic' : 'bg-slate-50 text-slate-700'
                        )}>
                          {entry.role !== 'system' && <span className="font-semibold block mb-0.5">{entry.role}</span>}
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Card>
            )}

            {/* Manual email simulator */}
            {showEmailSimulator && (
              <Card className="p-5 space-y-4 border-blue-200 bg-blue-50/40">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Process Vendor Email</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Paste a vendor reply — AI parses the quote automatically</p>
                </div>
                <select
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  value={simulatedEmailRfpId}
                  onChange={e => setSimulatedEmailRfpId(e.target.value)}
                >
                  <option value="">Select vendor…</option>
                  {sentRFPs.map(rfp => <option key={rfp.id} value={rfp.id}>{rfp.distributorName}</option>)}
                </select>
                <textarea
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[100px] font-mono"
                  placeholder="Hi, we can supply everything. Total: $840.00, delivery Tue/Fri."
                  value={simulatedEmailBody}
                  onChange={e => setSimulatedEmailBody(e.target.value)}
                />
                <div className="flex justify-end">
                  <Btn onClick={handleSimulateEmail} disabled={!simulatedEmailRfpId || !simulatedEmailBody.trim()} loading={simulatingEmail}>
                    Extract Quote
                  </Btn>
                </div>
              </Card>
            )}

            {followUpEmail && (
              <Card className="p-5 space-y-3 border-amber-200 bg-amber-50/40">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><Zap className="w-4 h-4" />Incomplete quote — follow-up generated</p>
                <pre className="bg-white border border-amber-200 rounded-lg p-3.5 text-xs text-slate-700 font-mono whitespace-pre-wrap">{followUpEmail}</pre>
                <button onClick={() => setFollowUpEmail('')} className="text-xs text-amber-600 hover:text-amber-800">Dismiss</button>
              </Card>
            )}

            {/* Quotes table */}
            <Card className="overflow-hidden">
              {quotes.length === 0 ? (
                <div className="py-14 flex flex-col items-center text-slate-400 gap-2">
                  <FileCheck className="w-8 h-8 opacity-20" />
                  <p className="text-sm">No quotes yet — use Auto-simulate above</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Supplier</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Notes</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Total Quote</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {quotes.map((q, i) => (
                      <tr key={i} className={cn('hover:bg-slate-50 transition-colors', i === 0 && 'bg-emerald-50/50')}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            {i === 0 && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
                            <div>
                              <p className="font-semibold text-slate-900">{q.distributorName}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{q.distributorLocation}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500 hidden md:table-cell max-w-xs">
                          <span className="line-clamp-2">{q.details || '—'}</span>
                        </td>
                        <td className={cn('px-5 py-4 text-right font-bold text-base', i === 0 ? 'text-emerald-600' : 'text-slate-800')}>
                          ${Number(q.price).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {quotes.length > 0 && (
                <div className="border-t border-slate-200 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-500" />AI Recommendation
                    </h3>
                    <Btn size="sm" onClick={handleGetRecommendation} loading={loadingRecommendation}>
                      {loadingRecommendation ? 'Analyzing…' : 'Get recommendation'}
                    </Btn>
                  </div>
                  {recommendation ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2.5">
                      <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide">Recommended supplier</p>
                      <h4 className="text-lg font-bold text-slate-900">{recommendation.recommendedDistributor}</h4>
                      <p className="text-sm text-slate-700 leading-relaxed">{recommendation.reasoning}</p>
                      {recommendation.potentialRisks && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{recommendation.potentialRisks}
                        </div>
                      )}
                      {recommendation.savings > 0 && (
                        <p className="text-sm font-semibold text-emerald-600">
                          ${Number(recommendation.savings).toFixed(2)} saved vs most expensive quote
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg py-5 text-center">
                      Click to get an AI-powered supplier recommendation
                    </p>
                  )}
                </div>
              )}
            </Card>
          </Section>
        )}

        {/* ════════════════════════════════════════════════
            STEP 5 — AI Negotiation
        ════════════════════════════════════════════════ */}
        {quotes.length > 0 && (
          <Section
            step={5} done={!!negotiationComplete}
            title="AI Negotiation Engine"
            subtitle="5 specialized agents negotiate pricing autonomously via email — no human needed"
            action={
              <Btn
                onClick={handleAgentNegotiation}
                disabled={negotiating || !!negotiationComplete}
                loading={negotiating}
              >
                <Zap className="w-3.5 h-3.5" />
                {negotiating ? 'Agents running…' : negotiationComplete ? 'Negotiation complete' : 'Launch agent pipeline'}
              </Btn>
            }
          >
            {agentEvents.length === 0 && !negotiating && !negotiationComplete && (
              <Card className="py-14 flex flex-col items-center gap-4">
                <div className="flex -space-x-2">
                  {['🎯','📊','🤝','🏪','✅'].map((e, i) => (
                    <div key={i} className="w-9 h-9 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-base shadow-sm">{e}</div>
                  ))}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-700">5 AI agents ready to negotiate on your behalf</p>
                  <p className="text-xs text-slate-400 mt-1">Orchestrator → Market Analyst → Negotiation Agent → Vendor Simulator → Deal Auditor</p>
                </div>
              </Card>
            )}

            {agentEvents.length > 0 && (
              <div className="grid lg:grid-cols-2 gap-5">
                {/* Agent Activity */}
                <Card className="flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 bg-slate-50">
                    <Cpu className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Agent Activity</span>
                    {negotiating && <span className="ml-auto w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[440px]">
                    {agentEvents.map((ev, i) => (
                      <div key={i}>
                        {ev.type === 'agent_start' && (
                          <div className="flex items-start gap-2.5 py-2 border-b border-slate-100">
                            <span className="text-base leading-none mt-0.5">{ev.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-800">{ev.agent}</p>
                              <p className="text-[11px] text-slate-500">{ev.task}</p>
                            </div>
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping mt-1.5" />
                          </div>
                        )}
                        {ev.type === 'agent_result' && (
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                            <p className="text-[11px] font-semibold text-emerald-600 mb-1">{ev.emoji} {ev.agent} — done</p>
                            <pre className="text-[10px] text-slate-500 font-mono whitespace-pre-wrap max-h-16 overflow-hidden">
                              {JSON.stringify(ev.data, null, 2).slice(0, 250)}{JSON.stringify(ev.data||{}).length > 250 ? '…' : ''}
                            </pre>
                          </div>
                        )}
                        {ev.type === 'email_sent' && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                            <span className="text-blue-600 font-bold">↑</span>
                            <span className="text-slate-600 flex-1 truncate">Counter-offer → {ev.to}</span>
                            {ev.proposedPrice && <span className="font-mono font-semibold text-blue-700">${Number(ev.proposedPrice).toFixed(2)}</span>}
                          </div>
                        )}
                        {ev.type === 'email_received' && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                            <span className="text-amber-600 font-bold">↓</span>
                            <span className="text-slate-500 flex-1 truncate">{ev.from}</span>
                            {ev.decision && (
                              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
                                ev.decision==='ACCEPT' ? 'bg-emerald-100 text-emerald-700' :
                                ev.decision==='COUNTER' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                              )}>{ev.decision}</span>
                            )}
                          </div>
                        )}
                        {ev.type === 'negotiation_round' && (
                          <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs font-mono">
                            <span className="text-slate-500 font-sans truncate max-w-[80px]">{ev.vendorName}</span>
                            <span className="text-slate-400">${Number(ev.originalPrice).toFixed(0)}</span>
                            <ChevronRight className="w-3 h-3 text-slate-300" />
                            <span className="text-slate-500">${Number(ev.counterPrice).toFixed(0)}</span>
                            <ChevronRight className="w-3 h-3 text-slate-300" />
                            <span className={cn('font-semibold', ev.savings > 0 ? 'text-emerald-600' : 'text-slate-500')}>
                              ${Number(ev.finalPrice).toFixed(0)}
                            </span>
                            {ev.savings > 0 && <span className="ml-auto text-emerald-600">−${Number(ev.savings).toFixed(2)}</span>}
                          </div>
                        )}
                        {ev.type === 'error' && (
                          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">✗ {ev.message}</div>
                        )}
                      </div>
                    ))}
                    {negotiating && (
                      <div className="flex items-center gap-2 py-2 text-xs text-slate-400 animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin" />Next agent processing…
                      </div>
                    )}
                  </div>
                </Card>

                {/* Email Thread */}
                <Card className="flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 bg-slate-50">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Negotiation Thread</span>
                    <span className="ml-auto text-[10px] text-slate-400">AI-to-AI · no real emails sent</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[440px]">
                    {emailThread.length === 0 && (
                      <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                        Email exchanges appear here as agents negotiate
                      </div>
                    )}
                    {emailThread.map((email, i) => (
                      <div key={i} className={cn(
                        'rounded-xl p-4 text-xs space-y-2 border',
                        email.direction === 'sent'
                          ? 'bg-blue-50 border-blue-200 ml-6'
                          : 'bg-white border-slate-200 mr-6'
                      )}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-800">
                            {email.direction === 'sent' ? '↑ AutoRFP Agent' : `↓ ${email.from}`}
                          </span>
                          <span className="text-[10px] text-slate-400">→ {email.to}</span>
                        </div>
                        <p className="font-semibold text-slate-700 text-[11px]">{email.subject}</p>
                        <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">{email.body}</p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {email.proposedPrice && (
                            <Tag color="blue">Proposed ${Number(email.proposedPrice).toFixed(2)}</Tag>
                          )}
                          {email.finalPrice && email.decision && (
                            <Tag color={email.decision==='ACCEPT' ? 'green' : email.decision==='COUNTER' ? 'amber' : 'red'}>
                              {email.decision}: ${Number(email.finalPrice).toFixed(2)}
                            </Tag>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Final deal summary */}
            {negotiationComplete && (
              <Card className="p-6 border-emerald-200 space-y-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wide mb-1">Negotiation complete</p>
                    <h3 className="text-2xl font-bold text-slate-900">{negotiationComplete.winner}</h3>
                    <p className="text-sm text-slate-500 mt-1">Best negotiated deal · {new Date().toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-slate-900">${Number(negotiationComplete.winnerPrice).toFixed(2)}</p>
                    <p className="text-sm text-slate-500 mt-1">Final price</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Savings',   value: `$${Number(negotiationComplete.totalSavings).toFixed(2)}`,     color: 'emerald' },
                    { label: 'Cost Reduction',  value: `${Number(negotiationComplete.savingsPercentage).toFixed(1)}%`, color: 'blue' },
                    { label: 'Deals Improved',  value: negotiationComplete.negotiationResults?.filter((r: any) => r.savings > 0).length ?? 0, color: 'indigo' },
                  ].map((s, i) => (
                    <div key={i} className={cn(
                      'rounded-lg p-4 text-center border',
                      s.color === 'emerald' ? 'bg-emerald-50 border-emerald-200' :
                      s.color === 'blue'    ? 'bg-blue-50 border-blue-200' : 'bg-indigo-50 border-indigo-200'
                    )}>
                      <p className={cn('text-2xl font-bold',
                        s.color === 'emerald' ? 'text-emerald-700' :
                        s.color === 'blue'    ? 'text-blue-700' : 'text-indigo-700'
                      )}>{s.value}</p>
                      <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Executive Summary</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{negotiationComplete.executiveSummary}</p>
                </div>

                {negotiationComplete.actionItems?.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1.5">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Action Items</p>
                    {negotiationComplete.actionItems.map((item: string, i: number) => (
                      <p key={i} className="text-sm text-amber-800">• {item}</p>
                    ))}
                  </div>
                )}

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-4 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                    <div className="col-span-2">Supplier</div>
                    <div className="text-right">Original</div>
                    <div className="text-right">Final</div>
                  </div>
                  {negotiationComplete.negotiationResults?.map((r: any, i: number) => (
                    <div key={i} className="grid grid-cols-4 px-4 py-3 text-sm border-b border-slate-100 last:border-0 items-center hover:bg-slate-50 transition-colors">
                      <div className="col-span-2 flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-800 truncate">{r.vendorName}</span>
                        <Tag color={
                          r.decision==='ACCEPT'        ? 'green' :
                          r.decision==='COUNTER'       ? 'amber' :
                          r.decision==='NOT_TARGETED'  ? 'gray'  : 'red'
                        }>
                          {r.decision==='NOT_TARGETED' ? 'skipped' : r.decision.toLowerCase()}
                        </Tag>
                      </div>
                      <div className="text-right text-slate-400 font-mono text-xs">${Number(r.originalPrice).toFixed(2)}</div>
                      <div className={cn('text-right font-mono text-xs font-semibold', r.savings > 0 ? 'text-emerald-600' : 'text-slate-700')}>
                        ${Number(r.negotiatedPrice).toFixed(2)}
                        {r.savings > 0 && <span className="text-emerald-500 text-[10px] ml-1">−${Number(r.savings).toFixed(0)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </Section>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-slate-400">
          <span>AutoRFP · Intelligent Procurement Platform</span>
          <div className="flex items-center gap-3">
            <span>Groq LLaMA 3.3 70B</span>
            <span>·</span>
            <span>CME/CBOT Live Pricing</span>
            <span>·</span>
            <span>OpenStreetMap</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
