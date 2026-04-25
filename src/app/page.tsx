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
function Tag({ children, color = 'gray', className }: { children: React.ReactNode; color?: 'gray' | 'green' | 'blue' | 'amber' | 'red' | 'indigo'; className?: string }) {
  const base = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide border';
  const c = {
    gray:   'bg-white/5 text-[#8A8F98] border-white/10',
    green:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue:   'bg-white/5 text-[#F2F2F2] border-white/15',
    amber:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red:    'bg-red-500/10 text-red-400 border-red-500/20',
    indigo: 'bg-white/5 text-[#F2F2F2] border-white/15',
  }[color];
  return (
    <span className={cn(base, c, className)}>
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
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold border',
            done ? 'bg-white/10 text-white border-white/20' : 'bg-white/5 text-[#8A8F98] border-white/10'
          )}>
            {done ? <CheckCircle className="w-3.5 h-3.5" /> : step}
          </div>
          <div>
            <h2 className="text-lg font-medium text-[#EEEEEE] tracking-tight">{title}</h2>
            {subtitle && <p className="text-sm text-[#8A8F98] mt-1">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ─── Primary button ───────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, loading, variant = 'primary', size = 'md', className }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  loading?: boolean; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-md transition-all select-none focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';
  const sizes = { sm: 'text-[11px] px-3 py-1.5', md: 'text-[13px] px-4 py-2' };
  const variants = {
    primary:   'linear-btn text-[#EEEEEE] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed',
    secondary: 'bg-transparent border border-white/10 text-[#8A8F98] hover:text-[#EEEEEE] hover:bg-white/5 shadow-none disabled:opacity-50 disabled:cursor-not-allowed',
    ghost:     'text-[#8A8F98] hover:text-[#EEEEEE] hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={cn(base, sizes[size], variants[variant], className)}>
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('linear-panel rounded-xl', className)}>
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
    <div className="min-h-screen bg-[#000000] text-[#EEEEEE] font-sans selection:bg-white/15 selection:text-white">

      {/* ── Sticky top block: nav + stepper + stats ───────────────────────── */}
      <div className="sticky top-0 z-50 bg-[#000000]/80 backdrop-blur-2xl border-b border-white/10 shadow-lg shadow-black/50">

        {/* Navbar */}
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded border border-white/10 bg-white/5 flex items-center justify-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
              <ChefHat className="w-3.5 h-3.5 text-[#EEEEEE]" />
            </div>
            <span className="font-bold text-[#EEEEEE] text-[13px] tracking-wide">AutoRFP</span>
            <span className="hidden sm:block text-[#8A8F98] text-[11px] font-medium tracking-wide">/ PROCUREMENT</span>
          </div>
          <div className="flex items-center gap-4">
            {anomalyCount > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md drop-shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                <AlertTriangle className="w-3 h-3" />
                {anomalyCount} {anomalyCount === 1 ? 'anomaly' : 'anomalies'}
              </span>
            )}
            <span className="text-[11px] text-[#8A8F98] font-bold uppercase tracking-widest">
              Step {currentStep} <span className="opacity-40">/ 5</span>
            </span>
          </div>
        </div>

        {/* Progress stepper */}
        <div className="border-t border-white/5 bg-white/[0.01]">
          <div className="max-w-6xl mx-auto px-6">
            <ol className="flex items-center">
              {steps.map((step, idx) => {
                const isActive = step.id === currentStep;
                const isDone   = step.done;
                return (
                  <li key={step.id} className="flex items-center flex-1 min-w-0">
                    <div className={cn(
                      'flex items-center gap-2.5 py-3 px-1 text-[11px] font-bold uppercase tracking-widest min-w-0 truncate transition-colors duration-300',
                      isDone   ? 'text-[#EEEEEE]' :
                      isActive ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]' :
                                 'text-[#8A8F98]'
                    )}>
                      <div className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-black border transition-all duration-300',
                        isDone   ? 'bg-white/8 text-white border-white/15' :
                        isActive ? 'bg-white/10 text-white border-white/20 ' :
                                   'bg-white/5 text-[#8A8F98] border-white/10'
                      )}>
                        {isDone ? '✓' : step.id}
                      </div>
                      <span className="hidden sm:block truncate">{step.label}</span>
                    </div>
                    {idx < steps.length - 1 && (
                      <div className={cn(
                        'flex-1 h-px mx-3 transition-colors duration-300',
                        steps[idx].done ? 'bg-white/[0.03]0 ' : 'bg-white/5'
                      )} />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Stats strip */}
        <div className="border-t border-white/10 bg-white/[0.02]">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex divide-x divide-white/5">
              {[
                { label: 'Ingredients',  value: ingredients.length || '—',  icon: Package,   hi: ingredients.length > 0 },
                { label: 'Market Value', value: marketValue > 0 ? `$${marketValue.toFixed(0)}` : '—', icon: DollarSign, hi: marketValue > 0 },
                { label: 'Suppliers',    value: distributors.length || '—', icon: Building2,  hi: distributors.length > 0 },
                { label: 'Quotes',       value: sentRFPs.length ? `${quotes.length} / ${sentRFPs.length}` : '—', icon: FileCheck, hi: quotes.length > 0 },
                { label: 'AI Savings',   value: negotiationComplete ? `$${Number(negotiationComplete.totalSavings).toFixed(0)}` : '—', icon: Target, hi: !!negotiationComplete, green: true },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-white/[0.03]">
                  <s.icon className={cn('w-4 h-4 shrink-0', s.green && s.hi ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]' : s.hi ? 'text-[#EEEEEE]' : 'text-[#8A8F98]')} />
                  <div>
                    <span className={cn('text-[13px] font-bold tracking-tight', s.green && s.hi ? 'text-[#EEEEEE]' : s.hi ? 'text-[#EEEEEE]' : 'text-[#8A8F98]')}>
                      {s.value}
                    </span>
                    <span className="text-[10px] text-[#8A8F98] font-medium tracking-wide ml-2 uppercase">{s.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-6 py-12 space-y-16">

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-md text-[13px] font-medium text-red-400 linear-panel">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400/60 hover:text-red-400 transition-colors pointer-events-auto">×</button>
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
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Input */}
            <Card className="lg:col-span-2 p-6 flex flex-col gap-5 border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_30px_rgba(0,0,0,0.5)]">
              <label className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Menu Input</label>
              <textarea
                rows={10}
                className="flex-1 w-full bg-[#000000] border border-white/10 rounded-lg p-4 text-[13px] text-[#EEEEEE] placeholder:text-[#8A8F98]/50 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/20 resize-none font-mono leading-relaxed shadow-inner"
                placeholder={"Classic Cheeseburger  $12\nSpaghetti Bolognese  $16\nGrilled Salmon  $24\n\nor paste a URL to auto-fetch"}
                value={menuText}
                onChange={e => setMenuText(e.target.value)}
              />
              <Btn onClick={handleParseMenu} disabled={!menuText.trim()} loading={loading}>
                <Sparkles className="w-4 h-4" />
                {loading ? 'Analyzing with Groq…' : 'Extract Ingredients'}
              </Btn>
            </Card>

            {/* Dishes */}
            <Card className="lg:col-span-3 p-6 flex flex-col border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] bg-[#000000]/60 z-10 relative">
               <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[80px] rounded-full pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative z-10">
                <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Extracted Dishes</span>
                {recipes.length > 0 && <Tag color="blue" className="bg-white/8 border-white/15">{recipes.length} dishes</Tag>}
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 min-h-[220px] relative z-10">
                {recipes.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-[#8A8F98] gap-3 py-10 border border-dashed border-white/10 rounded-lg">
                    <ChefHat className="w-8 h-8 opacity-20" />
                    <p className="text-[13px] font-medium tracking-tight">Dishes appear here after extraction</p>
                  </div>
                ) : recipes.map((recipe, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 rounded-lg transition-all duration-300">
                    <span className="text-[13px] text-[#EEEEEE] font-bold tracking-tight">{recipe.name}</span>
                    <span className="text-[11px] font-medium text-[#8A8F98] uppercase tracking-widest">{recipe.ingredients?.length ?? 0} ingredients</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Ingredient list */}
            {ingredients.length > 0 && (
              <Card className="lg:col-span-5 p-6 border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_30px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Procurement List</span>
                  <Tag color="blue" className="bg-white/8 border-white/15">{ingredients.length} unique ingredients</Tag>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {ingredients.map((ing, i) => (
                    <div key={i} className="px-4 py-3 bg-[#080808] border border-white/10 rounded-[8px] hover:border-white/20 transition-colors shadow-inner">
                      <p className="text-[13px] font-bold text-[#EEEEEE] truncate">{ing.name}</p>
                      <p className="text-[11px] text-[#8A8F98] font-medium mt-1 truncate">{ing.quantity} {ing.unit}</p>
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
            <div className="flex items-center gap-3 flex-wrap">
              {liveCount > 0 && <Tag color="green" className="bg-emerald-500/20 border-emerald-500/30"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />{liveCount} live</Tag>}
              {Object.keys(mlForecasts).length > 0 && <Tag color="indigo" className="bg-indigo-500/20 border-indigo-500/30"><Activity className="w-3.5 h-3.5" />ML active</Tag>}
              <Btn onClick={handleFetchPricing} disabled={!ingredients.length} loading={loadingPricing}>
                <BarChart3 className="w-4 h-4" />
                {loadingPricing ? 'Fetching…' : 'Run Analysis'}
              </Btn>
            </div>
          }
        >
          {pricingData.length === 0 ? (
            <Card className="py-20 flex flex-col items-center border border-dashed border-white/10 text-[#8A8F98] gap-3 bg-[rgba(255,255,255,0.01)] shadow-none">
              <BarChart3 className="w-10 h-10 opacity-20" />
              <p className="text-[13px] font-medium tracking-tight">Run market analysis after extracting ingredients</p>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
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

                const trendColor = forecast?.trend === 'RISING' ? 'text-red-400' : forecast?.trend === 'FALLING' ? 'text-emerald-400' : 'text-[#8A8F98]';

                return (
                  <Card key={idx} className="p-5 flex flex-col gap-4 border border-white/10 hover:border-white/20 transition-all duration-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-[#EEEEEE] truncate text-[15px] tracking-tight">{item.name}</h3>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {item.isLive
                            ? <Tag color="green" className="bg-emerald-500/20 border-emerald-500/30 text-[10px]"><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.8)]" />Live</Tag>
                            : <Tag color="gray" className="text-[10px]">Simulated</Tag>
                          }
                          {forecast?.trend && forecast.trend !== 'STABLE' && (
                            <span className={cn('text-[10px] font-bold uppercase tracking-widest flex items-center gap-0.5', trendColor)}>
                              {forecast.trend === 'RISING' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                              {forecast.trend} {forecast.trendPct > 0 && `${forecast.trendPct}%`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[22px] font-black text-[#EEEEEE] tracking-tighter">${item.currentPrice.toFixed(2)}</p>
                        <p className={cn('text-[11px] font-bold tracking-widest mt-1', pct > 0 ? 'text-red-400' : pct < 0 ? 'text-emerald-400' : 'text-[#8A8F98]')}>
                          {pct > 0 ? '↑' : pct < 0 ? '↓' : ''}{Math.abs(pct).toFixed(1)}% MoM
                        </p>
                      </div>
                    </div>

                    {forecast?.anomaly && (
                      <div className={cn(
                        'text-[11px] font-bold uppercase tracking-wide px-3 py-2 rounded-[6px] flex items-center gap-1.5 border',
                        forecast.anomaly.type === 'SPIKE' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      )}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {forecast.anomaly.type === 'SPIKE'
                          ? `Price spike: ${forecast.anomaly.deviationPct}% above avg`
                          : `Below average: ${forecast.anomaly.deviationPct}% — buy now`}
                      </div>
                    )}

                    <div className="h-24 pointer-events-none mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <defs>
                            <linearGradient id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#FFFFFF" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#FFFFFF" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} hide />
                          <Tooltip
                            contentStyle={{ background: '#080808', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px', color: '#EEEEEE', fontWeight: 'bold' }}
                            itemStyle={{ color: '#8A8F98' }}
                            labelStyle={{ color: '#EEEEEE', marginBottom: '4px' }}
                            labelFormatter={l => new Date(l).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            formatter={(v: any, n) => [v !== null ? `$${Number(v).toFixed(2)}` : '—', n === 'forecast' ? 'ML Forecast' : 'Market Price'] as [string, string]}
                          />
                          <Area type="monotone" dataKey="price" stroke="#FFFFFF" strokeWidth={2} fill={`url(#grad-${idx})`} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="forecast" stroke="#8A8F98" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    {forecast?.buySignal && (
                      <div className="flex items-center justify-between pt-3 border-t border-white/10 text-[11px] font-bold uppercase tracking-widest mt-auto">
                        <span className={cn(
                          'flex items-center gap-1.5',
                          forecast.buySignal.signal === 'BUY_NOW' ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]' :
                          forecast.buySignal.signal === 'WAIT'    ? 'text-amber-400' : 'text-[#8A8F98]'
                        )}>
                          {forecast.buySignal.signal === 'BUY_NOW'
                            ? <><ShoppingCart className="w-3.5 h-3.5" />Buy now</>
                            : forecast.buySignal.signal === 'WAIT'
                            ? <><Clock className="w-3.5 h-3.5" />Wait</>
                            : <><Minus className="w-3.5 h-3.5" />Neutral</>}
                        </span>
                        <span className="text-[#8A8F98]">R² {forecast.r2} · {forecast.confidence}</span>
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
          <Card className="p-6 space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8F98]" />
                <input
                  type="text"
                  value={distributorLocation}
                  onChange={e => setDistributorLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFindDistributors()}
                  placeholder="e.g. New York, NY  or  10001"
                  className="w-full pl-11 pr-4 py-2.5 bg-[#000000] border border-white/10 rounded-lg text-[13px] text-[#EEEEEE] placeholder:text-[#8A8F98]/50 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/20 shadow-inner"
                />
              </div>
              <Btn onClick={handleFindDistributors} disabled={!distributorLocation.trim()} loading={loadingDistributors}>
                <Search className="w-4 h-4" />
                {loadingDistributors ? 'Searching…' : 'Find Suppliers'}
              </Btn>
            </div>

            {distributors.length === 0 && !loadingDistributors && (
              <div className="py-14 flex flex-col items-center text-[#8A8F98] gap-3 border border-dashed border-white/10 rounded-lg bg-white/[0.01]">
                <Building2 className="w-8 h-8 opacity-20" />
                <p className="text-[13px] font-medium tracking-tight">Enter a location to discover local distributors</p>
              </div>
            )}

            {distributors.length > 0 && (
              <>
                {distributorSource && (
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#8A8F98]">
                    <span>Source:</span>
                    <Tag color={distributorSource.startsWith('OpenStreetMap') ? 'green' : 'gray'}>
                      {distributorSource.startsWith('OpenStreetMap') && <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.5)]" />}
                      {distributorSource}
                    </Tag>
                  </div>
                )}
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {distributors.map((dist, i) => (
                    <div key={i} className="border border-white/10 rounded-lg p-5 hover:border-white/20 hover:bg-white/[0.03] transition-all duration-300 flex flex-col gap-3 group relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                      <div className="flex items-start justify-between gap-3 relative z-10">
                        <div className="min-w-0">
                          <h3 className="font-bold text-[14px] text-[#EEEEEE] truncate tracking-tight">{dist.name}</h3>
                          <p className="text-[11px] text-[#8A8F98] mt-1 flex items-center gap-1.5 truncate font-medium">
                            <MapPin className="w-3 h-3 shrink-0" />{dist.location}
                          </p>
                        </div>
                        {sentRFPs.some(r => r.distributorName === dist.name) && (
                          <Tag color="green" className="bg-emerald-500/10 border-emerald-500/20 text-[10px]"><CheckCircle className="w-3 h-3" />Sent</Tag>
                        )}
                      </div>
                      {dist.specialty && <p className="text-[11px] text-[#8A8F98] leading-relaxed relative z-10">{dist.specialty}</p>}
                      <p className="text-[11px] text-[#8A8F98]/70 font-mono truncate relative z-10">{dist.email}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <Btn
                    onClick={handleSendRFPs}
                    disabled={sendingRFPs || sentRFPs.length > 0}
                    loading={sendingRFPs}
                  >
                    <Mail className="w-4 h-4" />
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
              <Card className="p-6 space-y-5">
                <h3 className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Negotiation Conversations</h3>
                {sentRFPs.map((rfp: any) => {
                  const logs = conversationLogs[rfp.id];
                  if (!logs) return null;
                  return (
                    <div key={rfp.id} className="space-y-2 border-t border-white/5 pt-5 first:border-0 first:pt-0">
                      <p className="text-[13px] font-bold text-[#EEEEEE]">{rfp.distributorName}</p>
                      {logs.map((entry: any, i: number) => (
                        <div key={i} className={cn(
                          'text-[13px] rounded-lg px-4 py-3 leading-relaxed tracking-tight',
                          entry.role === 'AutoRFP Agent' ? 'bg-white/5 text-white border border-white/10 '
                          : entry.role === 'system' ? 'text-[#8A8F98]/60 italic font-mono text-[11px]' : 'bg-white/[0.03] text-[#EEEEEE] border border-white/5'
                        )}>
                          {entry.role !== 'system' && <span className="font-bold uppercase text-[10px] tracking-widest block mb-1 opacity-60">{entry.role}</span>}
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
              <Card className="p-6 space-y-4 border-white/15 bg-white/[0.03] ">
                <div>
                  <h3 className="text-sm font-bold text-[#EEEEEE]">Process Vendor Email</h3>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-[#8A8F98] mt-1">Paste a vendor reply — AI parses the quote automatically</p>
                </div>
                <select
                  className="w-full bg-[#000000] border border-white/15 rounded-lg p-3 text-[13px] text-[#EEEEEE] focus:outline-none focus:ring-1 focus:ring-white/20"
                  value={simulatedEmailRfpId}
                  onChange={e => setSimulatedEmailRfpId(e.target.value)}
                >
                  <option value="">Select vendor…</option>
                  {sentRFPs.map(rfp => <option key={rfp.id} value={rfp.id}>{rfp.distributorName}</option>)}
                </select>
                <textarea
                  className="w-full bg-[#000000] border border-white/15 rounded-lg p-4 text-[13px] text-[#EEEEEE] focus:outline-none focus:ring-1 focus:ring-white/20 min-h-[100px] font-mono leading-relaxed"
                  placeholder="Hi, we can supply everything. Total: $840.00, delivery Tue/Fri."
                  value={simulatedEmailBody}
                  onChange={e => setSimulatedEmailBody(e.target.value)}
                />
                <div className="flex justify-end">
                  <Btn onClick={handleSimulateEmail} disabled={!simulatedEmailRfpId || !simulatedEmailBody.trim()} loading={simulatingEmail} className="linear-glow">
                    Extract Quote
                  </Btn>
                </div>
              </Card>
            )}

            {followUpEmail && (
              <Card className="p-5 space-y-3 border-amber-500/20 bg-amber-500/5">
                <p className="text-[13px] font-bold text-amber-500 flex items-center gap-1.5"><Zap className="w-4 h-4" />Incomplete quote — follow-up generated</p>
                <pre className="bg-[#000000] border border-amber-500/20 rounded-lg p-4 text-[11px] text-amber-200/80 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">{followUpEmail}</pre>
                <button onClick={() => setFollowUpEmail('')} className="text-[11px] font-bold uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors">Dismiss</button>
              </Card>
            )}

            {/* Quotes table */}
            <Card className="overflow-hidden">
              {quotes.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-[#8A8F98] gap-3">
                  <FileCheck className="w-10 h-10 opacity-20" />
                  <p className="text-[13px] font-medium tracking-tight">No quotes yet — use Auto-simulate above</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.02] text-left">
                        <th className="px-6 py-4 text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest w-1/3">Supplier</th>
                        <th className="px-6 py-4 text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest hidden md:table-cell">Notes</th>
                        <th className="px-6 py-4 text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest text-right w-32">Total Quote</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {quotes.map((q, i) => (
                        <tr key={i} className={cn('hover:bg-white/[0.03] transition-colors', i === 0 && 'bg-white/[0.02]')}>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              {i === 0 && <Star className="w-4 h-4 text-emerald-400 fill-emerald-400 shrink-0 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
                              <div>
                                <p className="font-bold text-[#EEEEEE] tracking-tight">{q.distributorName}</p>
                                <p className="text-[11px] font-medium text-[#8A8F98] mt-1">{q.distributorLocation}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-[12px] text-[#8A8F98] hidden md:table-cell">
                            <span className="line-clamp-2 leading-relaxed">{q.details || '—'}</span>
                          </td>
                          <td className={cn('px-6 py-5 text-right font-mono text-[14px] font-bold tracking-tight', i === 0 ? 'text-emerald-400' : 'text-[#EEEEEE]')}>
                            ${Number(q.price).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {quotes.length > 0 && (
                <div className="border-t border-white/10 p-6 space-y-5 bg-white/[0.01]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-[#EEEEEE] flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-white" />AI Recommendation
                    </h3>
                    <Btn size="sm" onClick={handleGetRecommendation} loading={loadingRecommendation}>
                      {loadingRecommendation ? 'Analyzing…' : 'Get recommendation'}
                    </Btn>
                  </div>
                  {recommendation ? (
                    <div className="bg-white/[0.02] border border-white/10 rounded-xl p-5 space-y-3 relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent pointer-events-none" />
                      <p className="text-[10px] text-white font-black uppercase tracking-[0.2em] relative z-10">Recommended supplier</p>
                      <h4 className="text-xl font-bold text-[#EEEEEE] tracking-tight relative z-10">{recommendation.recommendedDistributor}</h4>
                      <p className="text-[13px] text-[#8A8F98] leading-relaxed relative z-10">{recommendation.reasoning}</p>
                      {recommendation.potentialRisks && (
                        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-md px-3.5 py-3 text-[12px] text-amber-500 font-medium relative z-10 shadow-inner">
                          <AlertTriangle className="w-4 h-4 shrink-0" />{recommendation.potentialRisks}
                        </div>
                      )}
                      {recommendation.savings > 0 && (
                        <p className="text-[13px] font-bold text-emerald-400 relative z-10">
                          <span className="inline-block px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded mr-2">−${Number(recommendation.savings).toFixed(2)}</span>
                          saved vs most expensive quote
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-8 border border-dashed border-white/10 rounded-xl text-[#8A8F98] text-[13px] font-medium">
                      Click to get an AI-powered supplier recommendation
                    </div>
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
                className="linear-glow"
              >
                <Zap className="w-3.5 h-3.5" />
                {negotiating ? 'Agents running…' : negotiationComplete ? 'Negotiation complete' : 'Launch agent pipeline'}
              </Btn>
            }
          >
            {agentEvents.length === 0 && !negotiating && !negotiationComplete && (
              <Card className="py-20 flex flex-col items-center gap-5 border border-dashed border-white/10 bg-white/[0.01] shadow-none">
                <div className="flex -space-x-3">
                  {['🎯','📊','🤝','🏪','✅'].map((e, i) => (
                    <div key={i} className="w-10 h-10 rounded-full bg-[#000000] border border-white/10 flex items-center justify-center text-lg z-10">{e}</div>
                  ))}
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-bold text-[#EEEEEE] tracking-tight">5 AI agents ready to negotiate on your behalf</p>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-[#8A8F98] mt-2">Orchestrator → Market Analyst → Negotiation Agent → Vendor Simulator → Deal Auditor</p>
                </div>
              </Card>
            )}

            {agentEvents.length > 0 && (
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Agent Activity */}
                <Card className="flex flex-col overflow-hidden border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] bg-[#000000]/60 relative z-10 group">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-white/5 blur-[80px] rounded-full pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-1000" />
                  <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/10 bg-white/[0.02] relative z-10">
                    <Cpu className="w-4 h-4 text-white" />
                    <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Agent terminal</span>
                    {negotiating && <span className="ml-auto w-2 h-2 rounded-full bg-white/10 animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.2)]" />}
                  </div>
                  <div className="flex-1 overflow-y-auto p-5 space-y-3 max-h-[500px] relative z-10">
                    {agentEvents.map((ev, i) => (
                      <div key={i}>
                        {ev.type === 'agent_start' && (
                          <div className="flex items-start gap-3 py-3 border-b border-white/5">
                            <span className="text-xl leading-none mt-0.5">{ev.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-bold text-[#EEEEEE]">{ev.agent}</p>
                              <p className="text-[12px] text-[#8A8F98] leading-relaxed mt-0.5 font-mono">{ev.task}</p>
                            </div>
                            <span className="w-1.5 h-1.5 rounded-full bg-white/10 mt-1.5" />
                          </div>
                        )}
                        {ev.type === 'agent_result' && (
                          <div className="bg-[#000000] border border-white/10 rounded-lg px-4 py-3 mt-2 shadow-inner">
                            <p className="text-[11px] font-bold text-emerald-400 mb-1.5 flex items-center gap-1.5">{ev.emoji} {ev.agent} <span className="text-white/30 font-medium">— done</span></p>
                            <pre className="text-[11px] text-[#8A8F98]/80 font-mono whitespace-pre-wrap max-h-24 overflow-hidden leading-relaxed">
                              {JSON.stringify(ev.data, null, 2).slice(0, 250)}{JSON.stringify(ev.data||{}).length > 250 ? '…' : ''}
                            </pre>
                          </div>
                        )}
                        {ev.type === 'email_sent' && (
                          <div className="flex items-center gap-2.5 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-[12px] mt-2 ">
                            <span className="text-white font-black">↑</span>
                            <span className="text-white/60 flex-1 truncate font-medium">Counter-offer → {ev.to}</span>
                            {ev.proposedPrice && <span className="font-mono font-bold text-white">${Number(ev.proposedPrice).toFixed(2)}</span>}
                          </div>
                        )}
                        {ev.type === 'email_received' && (
                          <div className="flex items-center gap-2.5 px-4 py-3 bg-white/[0.03] border border-white/10 rounded-lg text-[12px] mt-2">
                            <span className="text-amber-500 font-black">↓</span>
                            <span className="text-[#8A8F98] flex-1 truncate font-medium">{ev.from}</span>
                            {ev.decision && (
                              <span className={cn('px-2 py-0.5 rounded-[4px] text-[10px] font-bold uppercase tracking-widest',
                                ev.decision==='ACCEPT' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                ev.decision==='COUNTER' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                              )}>{ev.decision}</span>
                            )}
                          </div>
                        )}
                        {ev.type === 'negotiation_round' && (
                          <div className="flex items-center gap-2 px-4 py-3 bg-white/[0.02] border border-white/5 rounded-lg text-[12px] font-mono mt-2">
                            <span className="text-[#8A8F98] font-sans font-bold truncate max-w-[80px]">{ev.vendorName}</span>
                            <span className="text-red-400/80 line-through decoration-red-500/50">${Number(ev.originalPrice).toFixed(0)}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-white/20" />
                            <span className="text-amber-400">${Number(ev.counterPrice).toFixed(0)}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-white/20" />
                            <span className={cn('font-bold tracking-tight', ev.savings > 0 ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'text-[#8A8F98]')}>
                              ${Number(ev.finalPrice).toFixed(0)}
                            </span>
                            {ev.savings > 0 && <span className="ml-auto text-emerald-400 font-bold">−${Number(ev.savings).toFixed(2)}</span>}
                          </div>
                        )}
                        {ev.type === 'error' && (
                          <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] font-medium text-red-400 mt-2">✗ {ev.message}</div>
                        )}
                      </div>
                    ))}
                    {negotiating && (
                      <div className="flex items-center gap-2.5 py-4 text-[12px] font-medium text-[#8A8F98]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />System processing…
                      </div>
                    )}
                  </div>
                </Card>

                {/* Email Thread */}
                <Card className="flex flex-col overflow-hidden border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] bg-[#000000]">
                  <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/10 bg-white/[0.02]">
                    <MessageSquare className="w-4 h-4 text-[#8A8F98]" />
                    <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Email Interceptors</span>
                    <span className="ml-auto text-[10px] font-bold text-white/30 uppercase tracking-widest">AI-to-AI ONLY</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[500px]">
                    {emailThread.length === 0 && (
                      <div className="py-14 text-center text-[#8A8F98] text-[13px] font-medium border border-dashed border-white/5 rounded-xl">
                        Intercepted emails appear here
                      </div>
                    )}
                    {emailThread.map((email, i) => (
                      <div key={i} className={cn(
                        'rounded-xl p-4 text-[13px] space-y-2 border shadow-inner',
                        email.direction === 'sent'
                          ? 'bg-white/[0.03] border-white/10  ml-10'
                          : 'bg-white/[0.02] border-white/5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] mr-10'
                      )}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-bold text-[#EEEEEE] tracking-tight">
                            {email.direction === 'sent' ? '↑ Agent' : `↓ ${email.from}`}
                          </span>
                          <span className="text-[10px] text-[#8A8F98] font-bold uppercase tracking-widest truncate max-w-[100px]">→ {email.to}</span>
                        </div>
                        <p className="font-bold text-[#8A8F98] text-[11px] uppercase tracking-wide">{email.subject}</p>
                        <p className="text-[#8A8F98]/90 whitespace-pre-wrap leading-relaxed pb-1">{email.body}</p>
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                          {email.proposedPrice && (
                            <Tag color="blue" className="bg-white/5 border-white/10">Proposed ${Number(email.proposedPrice).toFixed(2)}</Tag>
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
              <Card className="p-8 border-white/10 space-y-8 bg-[#000000]/60 relative z-10 overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                <div className="absolute inset-0 // removed gradient" />
                <div className="flex items-start justify-between gap-4 flex-wrap relative z-10">
                  <div>
                    <p className="text-[10px] text-white font-black uppercase tracking-[0.2em] mb-2 ">Negotiation complete</p>
                    <h3 className="text-3xl font-black text-[#EEEEEE] tracking-tight">{negotiationComplete.winner}</h3>
                    <p className="text-[13px] font-medium text-[#8A8F98] mt-1.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      Best negotiated deal secured · {new Date().toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[40px] font-black text-[#EEEEEE] tracking-tighter leading-none">${Number(negotiationComplete.winnerPrice).toFixed(2)}</p>
                    <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mt-2">Final price</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
                  {[
                    { label: 'Total Savings',   value: `$${Number(negotiationComplete.totalSavings).toFixed(2)}`,     color: 'emerald' },
                    { label: 'Cost Reduction',  value: `${Number(negotiationComplete.savingsPercentage).toFixed(1)}%`, color: 'blue' },
                    { label: 'Deals Improved',  value: negotiationComplete.negotiationResults?.filter((r: any) => r.savings > 0).length ?? 0, color: 'indigo' },
                  ].map((s, i) => (
                    <div key={i} className={cn(
                      'rounded-xl p-5 border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]',
                      s.color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/20' :
                      s.color === 'blue'    ? 'bg-white/5 border-white/10' : 'bg-indigo-500/10 border-indigo-500/20'
                    )}>
                      <p className={cn('text-2xl font-black tracking-tight',
                        s.color === 'emerald' ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' :
                        s.color === 'blue'    ? 'text-white' : 'text-white'
                      )}>{s.value}</p>
                      <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mt-1.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-[#000000] border border-white/10 rounded-xl p-6 relative z-10 shadow-inner">
                  <p className="text-[11px] font-bold text-white uppercase tracking-widest mb-3 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Executive Summary</p>
                  <p className="text-[14px] text-[#EEEEEE]/90 leading-relaxed font-medium">{negotiationComplete.executiveSummary}</p>
                </div>

                {negotiationComplete.actionItems?.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-6 py-5 space-y-2.5 relative z-10 shadow-[inset_0_1px_0_0_rgba(245,158,11,0.1)]">
                    <p className="text-[11px] font-bold text-amber-500 uppercase tracking-widest mb-1 shadow-sm">Action Items</p>
                    {negotiationComplete.actionItems.map((item: string, i: number) => (
                      <p key={i} className="text-[13px] font-medium text-amber-400/90 flex items-start gap-2">
                        <span className="text-amber-500 opacity-60 flex-shrink-0 mt-1">•</span> {item}
                      </p>
                    ))}
                  </div>
                )}

                <div className="border border-white/10 rounded-xl overflow-hidden relative z-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] bg-[#000000]">
                  <div className="grid grid-cols-4 px-5 py-3.5 bg-white/[0.02] border-b border-white/10 text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">
                    <div className="col-span-2">Supplier</div>
                    <div className="text-right">Original</div>
                    <div className="text-right">Final</div>
                  </div>
                  {negotiationComplete.negotiationResults?.map((r: any, i: number) => (
                    <div key={i} className="grid grid-cols-4 px-5 py-4 text-[13px] font-medium border-b border-white/5 last:border-0 items-center hover:bg-white/[0.03] transition-colors">
                      <div className="col-span-2 flex items-center gap-3 min-w-0">
                        <span className="font-bold text-[#EEEEEE] truncate tracking-tight">{r.vendorName}</span>
                        <Tag color={
                          r.decision==='ACCEPT'        ? 'green' :
                          r.decision==='COUNTER'       ? 'amber' :
                          r.decision==='NOT_TARGETED'  ? 'gray'  : 'red'
                        } className="hidden sm:inline-flex shadow-sm">
                          {r.decision==='NOT_TARGETED' ? 'skipped' : r.decision.toLowerCase()}
                        </Tag>
                      </div>
                      <div className="text-right text-[#8A8F98] font-mono text-[12px] line-through decoration-red-500/40">${Number(r.originalPrice).toFixed(2)}</div>
                      <div className={cn('text-right font-mono text-[13px] font-bold tracking-tight', r.savings > 0 ? 'text-emerald-400' : 'text-[#8A8F98]')}>
                        ${Number(r.negotiatedPrice).toFixed(2)}
                        {r.savings > 0 && <span className="text-emerald-500 text-[10px] ml-1.5 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded shadow-sm">−${Number(r.savings).toFixed(0)}</span>}
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
      <footer className="border-t border-white/5 bg-[#000000] mt-16 relative z-10">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center justify-between text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest gap-4">
          <span className="flex items-center gap-2"><ChefHat className="w-3.5 h-3.5 text-white" /> AutoRFP Engine</span>
          <div className="flex items-center flex-wrap gap-3">
            <span className="hover:text-[#EEEEEE] transition-colors cursor-default">Groq LLaMA 3.3 70B</span>
            <span className="opacity-30">/</span>
            <span className="hover:text-[#EEEEEE] transition-colors cursor-default">CME / CBOT Pricing</span>
            <span className="opacity-30">/</span>
            <span className="hover:text-[#EEEEEE] transition-colors cursor-default">OSM Nodes</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
