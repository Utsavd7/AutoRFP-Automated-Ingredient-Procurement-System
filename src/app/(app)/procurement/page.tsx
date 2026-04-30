'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ChefHat, Search, MapPin, Mail, Bot, Zap, Brain,
  MessageSquare, FileText, Package, DollarSign, Building2,
  FileCheck, AlertTriangle, CheckCircle, ArrowUpRight,
  ArrowDownRight, Minus, Sparkles, ShoppingCart, BarChart3,
  Clock, Target, Shield, Star, TrendingUp, ChevronRight,
  Activity, Cpu, RotateCcw
} from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend,
} from 'recharts';
import {
  clearActiveRfp,
  readAccount,
  tenantKey,
  writeActiveRfp,
  writeTenantHistory,
  readTenantHistory,
  type RestaurantAccount,
} from '@/lib/tenant';
import { Skeleton } from '@/components/Skeleton';
import { toastApiError } from '@/lib/toast';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// ─── Shared UI primitives ──────────────────────────────────────────────────────

function Tag({ children, color = 'gray', className }: { children: React.ReactNode; color?: 'gray'|'green'|'blue'|'amber'|'red'|'indigo'; className?: string }) {
  const base = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide border';
  const c = {
    gray:   'bg-white/5 text-[#8A8F98] border-white/10',
    green:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue:   'bg-blue-500/10 text-blue-300 border-blue-500/20',
    amber:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red:    'bg-red-500/10 text-red-400 border-red-500/20',
    indigo: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  }[color];
  return <span className={cn(base, c, className)}>{children}</span>;
}

function Section({ title, subtitle, done, children, action }: {
  title: string; subtitle?: string; done: boolean;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
            done ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : 'bg-white/[0.04] text-[#8A8F98] border-white/[0.08]'
          )}>
            {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Activity className="w-3.5 h-3.5" />}
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

function Btn({ children, onClick, disabled, loading, variant = 'primary', size = 'md', className }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  loading?: boolean; variant?: 'primary'|'secondary'|'ghost'; size?: 'sm'|'md'; className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-md transition-all select-none focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';
  const sizes = { sm: 'text-[11px] px-3 py-1.5', md: 'text-[13px] px-4 py-2' };
  const variants = {
    primary:   'linear-btn text-[#EEEEEE] hover:text-white',
    secondary: 'bg-transparent border border-white/10 text-[#8A8F98] hover:text-[#EEEEEE] hover:bg-white/5',
    ghost:     'text-[#8A8F98] hover:text-[#EEEEEE] hover:bg-white/5',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={cn(base, sizes[size], variants[variant], className)}>
      {children}
    </button>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('linear-panel rounded-xl', className)}>{children}</div>;
}

function scaleIngredientForGuests(ingredient: any, guestCount: number, bufferPct: number) {
  const originalUnit = String(ingredient.unit || 'unit').trim();
  const normalizedUnit = originalUnit.toLowerCase();
  const perGuestQuantity = Number(ingredient.quantity) > 0 ? Number(ingredient.quantity) : 1;
  let quantity = perGuestQuantity * Math.max(1, guestCount) * (1 + Math.max(0, bufferPct) / 100);
  let unit = originalUnit || 'unit';

  if (['oz', 'ounce', 'ounces'].includes(normalizedUnit)) {
    quantity = quantity / 16;
    unit = 'lb';
  } else if (['g', 'gram', 'grams'].includes(normalizedUnit)) {
    quantity = quantity / 453.592;
    unit = 'lb';
  } else if (['kg', 'kilogram', 'kilograms'].includes(normalizedUnit)) {
    quantity = quantity * 2.20462;
    unit = 'lb';
  } else if (['lb', 'lbs', 'pound', 'pounds'].includes(normalizedUnit)) {
    unit = 'lb';
  } else if (['gal', 'gallon', 'gallons'].includes(normalizedUnit)) {
    quantity = quantity * 8.34;
    unit = 'lb';
  } else if (['qt', 'quart', 'quarts'].includes(normalizedUnit)) {
    quantity = quantity * 2.085;
    unit = 'lb';
  } else if (['pt', 'pint', 'pints'].includes(normalizedUnit)) {
    quantity = quantity * 1.04;
    unit = 'lb';
  } else if (['cup', 'cups'].includes(normalizedUnit)) {
    quantity = quantity * 0.52;
    unit = 'lb';
  }

  const countLike = /^(ct|count|piece|pieces|each|ea|bun|buns|head|heads|pack|packs|can|cans|doz|dozen)$/i.test(unit);
  const roundedQuantity = countLike ? Math.ceil(quantity) : Number(quantity.toFixed(quantity >= 10 ? 1 : 2));

  return {
    ...ingredient,
    quantity: roundedQuantity,
    unit,
    perGuestQuantity,
    perGuestUnit: originalUnit || unit,
  };
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim();
}

// ─── Agent pipeline UI ─────────────────────────────────────────────────────────

const AGENT_DEFS = [
  { key: 'Orchestrator Agent',  emoji: '🎯', color: 'violet', role: 'Strategic Planning' },
  { key: 'Market Analyst Agent', emoji: '📊', color: 'blue',   role: 'Market Intelligence' },
  { key: 'Negotiation Agent',    emoji: '🤝', color: 'amber',  role: 'Counter-offer Drafting' },
  { key: 'Vendor Simulator',     emoji: '🏪', color: 'orange', role: 'Vendor Response' },
  { key: 'Deal Auditor',         emoji: '✅', color: 'emerald', role: 'Deal Verification' },
] as const;

type AgentStatus = 'waiting' | 'running' | 'done';

function AgentPipeline({ events, negotiating }: { events: any[]; negotiating: boolean }) {
  const agentStates = useMemo(() => {
    return AGENT_DEFS.map(def => {
      const started = events.find(e => e.type === 'agent_start' && e.agent === def.key);
      const finished = events.find(e => e.type === 'agent_result' && e.agent === def.key);
      const status: AgentStatus = finished ? 'done' : started ? (negotiating ? 'running' : 'done') : 'waiting';
      return { ...def, status, task: started?.task, resultData: finished?.data };
    });
  }, [events, negotiating]);

  const colorMap: Record<string, { ring: string; bg: string; text: string; border: string }> = {
    violet: { ring: 'shadow-[0_0_0_2px_rgba(139,92,246,0.6)]', bg: 'bg-violet-500/15 border-violet-500/25', text: 'text-violet-300', border: 'border-violet-500/20' },
    blue:   { ring: 'shadow-[0_0_0_2px_rgba(59,130,246,0.6)]',  bg: 'bg-blue-500/15 border-blue-500/25',   text: 'text-blue-300',   border: 'border-blue-500/20' },
    amber:  { ring: 'shadow-[0_0_0_2px_rgba(245,158,11,0.6)]',  bg: 'bg-amber-500/15 border-amber-500/25', text: 'text-amber-300',  border: 'border-amber-500/20' },
    orange: { ring: 'shadow-[0_0_0_2px_rgba(249,115,22,0.6)]',  bg: 'bg-orange-500/15 border-orange-500/25', text: 'text-orange-300', border: 'border-orange-500/20' },
    emerald:{ ring: 'shadow-[0_0_0_2px_rgba(16,185,129,0.6)]',  bg: 'bg-emerald-500/15 border-emerald-500/25', text: 'text-emerald-300', border: 'border-emerald-500/20' },
  };

  return (
    <div className="space-y-2.5">
      {agentStates.map((agent, i) => {
        const c = colorMap[agent.color];
        const isRunning = agent.status === 'running';
        const isDone = agent.status === 'done';
        const isWaiting = agent.status === 'waiting';

        return (
          <div
            key={agent.key}
            className={cn(
              'flex items-center gap-4 p-4 rounded-xl border transition-all duration-500',
              isDone   ? `${c.bg} ${c.border}` :
              isRunning ? `${c.bg} ${c.border} ${c.ring} agent-running` :
              'bg-white/[0.02] border-white/[0.05] opacity-40'
            )}
          >
            {/* Avatar */}
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border',
              isDone || isRunning ? `${c.bg} ${c.border}` : 'bg-white/[0.03] border-white/[0.05]'
            )}>
              {agent.emoji}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={cn('text-[13px] font-bold', isDone || isRunning ? c.text : 'text-[#8A8F98]')}>
                  {agent.key}
                </p>
                {isDone && (
                  <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wide">
                    Done ✓
                  </span>
                )}
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-white/70 uppercase tracking-wide">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />Running
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#8A8F98] mt-0.5">
                {isWaiting ? agent.role : (agent.task || agent.role)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Live chat thread ──────────────────────────────────────────────────────────

function ChatThread({ messages }: { messages: any[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-[#8A8F98] py-12 border border-dashed border-white/[0.06] rounded-xl">
        <MessageSquare className="w-8 h-8 opacity-20" />
        <p className="text-[13px] font-medium">Negotiation emails appear here in real time</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto max-h-[520px] pr-1">
      {messages.map((msg, i) => {
        const isSent = msg.direction === 'sent';
        const decision = msg.decision as string | undefined;
        const ts = msg.timestamp
          ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        return (
          <div
            key={i}
            className={cn('flex gap-3 chat-message', isSent ? 'flex-row-reverse' : 'flex-row')}
          >
            {/* Avatar */}
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-1 border',
              isSent
                ? 'bg-violet-500/15 border-violet-500/25 text-[15px]'
                : 'bg-white/[0.05] border-white/10 text-[15px]'
            )}>
              {isSent ? '🤖' : '🏢'}
            </div>

            {/* Bubble */}
            <div className={cn('max-w-[80%] space-y-2', isSent ? 'items-end' : 'items-start', 'flex flex-col')}>
              {/* Sender + time */}
              <div className={cn('flex items-center gap-2 text-[10px] font-bold text-[#8A8F98] uppercase tracking-wide', isSent ? 'flex-row-reverse' : 'flex-row')}>
                <span>{isSent ? 'AutoRFP Agent' : (msg.from ?? 'Vendor')}</span>
                <span className="opacity-50">{ts}</span>
              </div>

              {/* Message card */}
              <div className={cn(
                'rounded-2xl px-4 py-3 border text-[13px] leading-relaxed',
                isSent
                  ? 'bg-violet-500/10 border-violet-500/20 text-[#EEEEEE] rounded-tr-sm'
                  : 'bg-white/[0.03] border-white/[0.08] text-[#CCCCCC] rounded-tl-sm'
              )}>
                {/* Subject */}
                {msg.subject && (
                  <p className="text-[11px] font-black text-[#8A8F98] uppercase tracking-wider mb-2 pb-2 border-b border-white/[0.06]">
                    {msg.subject}
                  </p>
                )}
                <p>{msg.body}</p>
              </div>

              {/* Chips */}
              <div className={cn('flex items-center gap-2 flex-wrap', isSent ? 'flex-row-reverse' : 'flex-row')}>
                {msg.proposedPrice && (
                  <span className="text-[11px] font-black text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-lg">
                    Proposed ${Number(msg.proposedPrice).toFixed(2)}
                  </span>
                )}
                {decision && (
                  <span className={cn(
                    'text-[11px] font-black px-3 py-1 rounded-lg uppercase tracking-wide',
                    decision === 'ACCEPT'  ? 'deal-chip-accept' :
                    decision === 'COUNTER' ? 'deal-chip-counter' :
                    'deal-chip-reject'
                  )}>
                    {decision === 'ACCEPT' ? '✓ ACCEPTED' : decision === 'COUNTER' ? '↔ COUNTER' : '✗ REJECTED'}
                    {msg.finalPrice ? ` · $${Number(msg.finalPrice).toFixed(2)}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantEmail, setRestaurantEmail] = useState('');

  const [menuText, setMenuText] = useState('');
  const [loading, setLoading] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState('');
  const [recipes, setRecipes] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [parseModelSource, setParseModelSource] = useState<string | null>(null);
  const [menuInsight, setMenuInsight] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState(50);
  const [bufferPct, setBufferPct] = useState(10);

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
  const [riskScores, setRiskScores] = useState<any[]>([]);
  const [conversationLogs, setConversationLogs] = useState<Record<string, any[]>>({});
  const [simulatingConversation, setSimulatingConversation] = useState(false);

  const [negotiating, setNegotiating] = useState(false);
  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const [emailThread, setEmailThread] = useState<any[]>([]);
  const [negotiationComplete, setNegotiationComplete] = useState<any>(null);

  const [error, setError] = useState('');

  useEffect(() => {
    const saved = readAccount();
    if (saved) {
      setAccount(saved);
      setRestaurantName(saved.name || '');
      setRestaurantEmail(saved.email || '');
      if (saved.location) setDistributorLocation(saved.location);

      const rerun = localStorage.getItem(tenantKey(saved.tenantId, 'run_again'));
      if (rerun) {
        try {
          const parsed = JSON.parse(rerun);
          if (parsed.menuText) setMenuText(parsed.menuText);
        } catch { /* ignore */ }
        localStorage.removeItem(tenantKey(saved.tenantId, 'run_again'));
      }
    }
  }, []);

  const handleReset = () => {
    setMenuText(''); setRecipes([]); setIngredients([]); setParseModelSource(null); setMenuInsight(null);
    setGuestCount(50); setBufferPct(10);
    setPricingData([]); setMlForecasts({}); setDistributors([]); setDistributorSource(null);
    setSentRFPs([]); setQuotes([]); setConversationLogs({}); setRecommendation(null); setRiskScores([]);
    setAgentEvents([]); setEmailThread([]); setNegotiationComplete(null); setError('');
  };

  // ── Derived stats ──────────────────────────────────────────────────────────
  const marketValue = useMemo(() => {
    if (!pricingData.length || !ingredients.length) return 0;
    const priceMap = new Map(pricingData.map(p => [p.name.toLowerCase(), p.currentPrice]));
    return ingredients.reduce((sum, ing) => {
      const priced = pricingData.find(p => p.name.toLowerCase() === ing.name.toLowerCase());
      if (typeof priced?.lineTotal === 'number') return sum + priced.lineTotal;
      const price = priceMap.get(ing.name.toLowerCase()) ?? 0;
      return sum + (typeof ing.quantity === 'number' ? price * ing.quantity : price);
    }, 0);
  }, [pricingData, ingredients]);

  const liveCount = useMemo(() => pricingData.filter(p => p.isLive).length, [pricingData]);
  const anomalyCount = useMemo(() => Object.values(mlForecasts).filter((f: any) => f.anomaly).length, [mlForecasts]);

  const activeStage = useMemo(() => {
    if (negotiationComplete) return 'Deal closed';
    if (negotiating) return 'AI negotiation live';
    if (quotes.length > 0) return 'Quotes under review';
    if (sentRFPs.length > 0) return 'RFPs in market';
    if (distributors.length > 0) return 'Suppliers ready';
    if (pricingData.length > 0) return 'Market priced';
    if (recipes.length > 0) return 'Menu parsed';
    return 'Drafting';
  }, [distributors.length, negotiationComplete, negotiating, pricingData.length, quotes.length, recipes.length, sentRFPs.length]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const resolveLocation = (): Promise<string> => {
    if (distributorLocation.trim()) return Promise.resolve(distributorLocation.trim());
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve('New York, NY');
      navigator.geolocation.getCurrentPosition(
        async pos => {
          try {
            const { latitude: lat, longitude: lon } = pos.coords;
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, { headers: { 'User-Agent': 'AutoRFP/1.0' } });
            const d = await res.json();
            const city = d.address?.city || d.address?.town || d.address?.county || 'New York, NY';
            resolve(city);
          } catch { resolve('New York, NY'); }
        },
        () => resolve('New York, NY'),
        { timeout: 5000 }
      );
    });
  };

  const buildWholeMenuProcurementList = (menuRecipes = recipes, guests = guestCount, buffer = bufferPct) => {
    const map = new Map<string, any>();
    menuRecipes.forEach((recipe: any) => {
      (recipe.ingredients ?? []).forEach((ing: any) => {
        const scaled = scaleIngredientForGuests(ing, guests, buffer);
        const key = `${String(scaled.name).trim().toLowerCase()}::${String(scaled.unit).trim().toLowerCase()}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantity = Number((Number(existing.quantity) + Number(scaled.quantity)).toFixed(existing.unit === 'lb' ? 2 : 0));
          existing.sourceDishes = Array.from(new Set([...(existing.sourceDishes ?? []), recipe.name]));
        } else {
          map.set(key, { ...scaled, sourceDishes: [recipe.name] });
        }
      });
    });
    return Array.from(map.values()).map(ing => ({
      ...ing,
      quantity: /^(ct|count|piece|pieces|each|ea|bun|buns|head|heads|pack|packs|can|cans|doz|dozen)$/i.test(String(ing.unit))
        ? Math.ceil(Number(ing.quantity))
        : Number(Number(ing.quantity).toFixed(Number(ing.quantity) >= 10 ? 1 : 2)),
    }));
  };

  const applyWholeMenuSizing = async (guests = guestCount, buffer = bufferPct) => {
    if (!recipes.length) return;
    const sized = buildWholeMenuProcurementList(recipes, guests, buffer);
    setIngredients(sized);
    setPricingData([]);
    setMlForecasts({});
    setSentRFPs([]);
    setQuotes([]);
    setConversationLogs({});
    setRecommendation(null);
    setRiskScores([]);
    setAgentEvents([]);
    setEmailThread([]);
    setNegotiationComplete(null);
    setPipelineStatus('Fetching live market prices…');
    await handleFetchPricing(sized);
    setPipelineStatus('Finding nearby suppliers…');
    const loc = await resolveLocation();
    const foundDistributors = await handleFindDistributors(loc);
    if (foundDistributors.length) {
      setPipelineStatus('Sending RFPs…');
      await handleSendRFPs({ distributorList: foundDistributors, ingredientList: sized, guests, buffer });
    }
    setPipelineStatus('');
  };

  const handleFetchPricing = async (ingredientList: any[] = ingredients) => {
    if (!ingredientList.length) return;
    setLoadingPricing(true);
    try {
      const res = await fetch('/api/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingredients: ingredientList }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPricingData(data.pricing);
      try {
        const fr = await fetch('/api/ml/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingredients: data.pricing }) });
        const fd = await fr.json();
        const map: Record<string, any> = {};
        (fd.forecasts ?? []).forEach((f: any) => { map[f.name] = f; });
        setMlForecasts(map);
      } catch { /* non-critical */ }
    } catch (err: any) { setError(err.message); toastApiError(err, 'Market pricing failed'); }
    finally { setLoadingPricing(false); }
  };

  const handleFindDistributors = async (locationOverride?: string) => {
    const loc = locationOverride ?? distributorLocation.trim();
    if (!loc) return [];
    setLoadingDistributors(true);
    try {
      const res = await fetch('/api/distributors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: loc }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to find distributors');
      setDistributors(data.distributors);
      setDistributorSource(data.source || null);
      setDistributorLocation(loc);
      return data.distributors ?? [];
    } catch (err: any) { setError(err.message); toastApiError(err, 'Supplier search failed'); }
    finally { setLoadingDistributors(false); }
    return [];
  };

  const handleParseMenu = async () => {
    if (!menuText.trim()) return;
    setLoading(true); setError(''); setPipelineStatus('Extracting dishes…');
    try {
      const res = await fetch('/api/parse-menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ menuText }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse menu');
      setRecipes(data.recipes);
      setParseModelSource(data.modelSource ?? null);
      setMenuInsight(data.menuInsight ?? null);
      setIngredients([]);
      setPricingData([]);
      setMlForecasts({});
      setDistributors([]);
      setDistributorSource(null);
      setSentRFPs([]);
      setQuotes([]);
      setRecommendation(null);
      setRiskScores([]);
      setPipelineStatus('Enter guests and apply quantities…');
    } catch (err: any) { setError(err.message); toastApiError(err, 'Menu parsing failed'); }
    finally { setLoading(false); setPipelineStatus(''); }
  };

  const handleSendRFPs = async (opts?: { distributorList?: any[]; ingredientList?: any[]; guests?: number; buffer?: number }) => {
    const targetDistributors = opts?.distributorList ?? distributors;
    const targetIngredients = opts?.ingredientList ?? ingredients;
    const targetGuests = opts?.guests ?? guestCount;
    const targetBuffer = opts?.buffer ?? bufferPct;
    if (!targetDistributors.length || !targetIngredients.length) return;
    setSendingRFPs(true); setError('');
    try {
      const tenantId = account?.tenantId ?? 'tenant_demo';
      const res = await fetch('/api/send-rfp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ distributorIds: targetDistributors.map(d => d.id), menuId: recipes[0]?.menuId || 'demo-menu-id', ingredients: targetIngredients, tenantId, mealName: 'Full menu', guestCount: targetGuests, bufferPct: targetBuffer }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send RFPs');
      setSentRFPs(data.rfps);
      writeActiveRfp(tenantId, {
        id: recipes[0]?.menuId || Date.now().toString(),
        date: new Date().toISOString(),
        tenantId,
        restaurantName,
        ingredientsCount: targetIngredients.length,
        distributorsCount: data.rfps?.length ?? targetDistributors.length,
        quotesCount: 0,
        status: 'RFPs in market',
      });
    } catch (err: any) { setError(err.message); toastApiError(err, 'RFP dispatch failed'); }
    finally { setSendingRFPs(false); }
  };

  const handleFetchQuotes = async (): Promise<any[]> => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return [];
    setLoadingQuotes(true); setError('');
    try {
      const tenantId = account?.tenantId ?? 'tenant_demo';
      const res = await fetch(`/api/quotes?menuId=${menuId}&tenantId=${encodeURIComponent(tenantId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch quotes');
      setQuotes(data.quotes);
      if (sentRFPs.length > 0) {
        writeActiveRfp(tenantId, {
          id: recipes[0]?.menuId || Date.now().toString(),
          date: new Date().toISOString(),
          tenantId,
          restaurantName,
          ingredientsCount: ingredients.length,
          distributorsCount: distributors.length,
          quotesCount: data.quotes?.length ?? 0,
          status: 'Quotes received',
        });
      }
      return data.quotes;
    } catch (err: any) { setError(err.message); toastApiError(err, 'Quote refresh failed'); return []; }
    finally { setLoadingQuotes(false); }
  };

  const handleFetchRiskScores = async (quotesOverride?: any[]) => {
    const q = quotesOverride ?? quotes;
    if (!q.length) return;
    try {
      const res = await fetch('/api/risk-score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quotes: q, pricingData, ingredients }) });
      const data = await res.json();
      setRiskScores(data.scores ?? []);
    } catch { /* non-critical */ }
  };

  const handleSimulateEmail = async () => {
    if (!simulatedEmailRfpId || !simulatedEmailBody.trim()) return;
    setSimulatingEmail(true); setError('');
    try {
      const res = await fetch('/api/webhooks/inbound-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rfpId: simulatedEmailRfpId, emailBody: simulatedEmailBody }) });
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
    } catch (err: any) { setError(err.message); toastApiError(err, 'Vendor email processing failed'); }
    finally { setSimulatingEmail(false); }
  };

  const handleAutoConversation = async () => {
    if (!sentRFPs.length) return;
    setSimulatingConversation(true); setError('');
    const newLogs: Record<string, any[]> = {};
    try {
      const unresolved = sentRFPs.filter(rfp => !quotes.some(q => q.rfpId === rfp.id));
      for (const rfp of unresolved) {
        const res = await fetch('/api/simulate-conversation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rfpId: rfp.id, ingredients, pricingData, tenantId: account?.tenantId, mealName: 'Full menu', guestCount, bufferPct }) });
        const data = await res.json();
        newLogs[rfp.id] = [
          { role: 'system', message: `Processing vendor response from ${rfp.distributorName}...` },
          ...(data.conversationLog || []),
          { role: 'system', message: data.message },
        ];
      }
      setConversationLogs(newLogs);
      const fetchedQuotes = await handleFetchQuotes();
      await Promise.all([handleGetRecommendation(), handleFetchRiskScores(fetchedQuotes)]);
    } catch (err: any) { setError(err.message); toastApiError(err, 'Vendor response simulation failed'); }
    finally { setSimulatingConversation(false); }
  };

  const handleGetRecommendation = async () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;
    setLoadingRecommendation(true); setError('');
    try {
      const tenantId = account?.tenantId ?? 'tenant_demo';
      const params = new URLSearchParams({
        menuId,
        tenantId,
        mealName: 'Full menu',
        guestCount: String(guestCount),
        marketValue: String(marketValue),
      });
      const res = await fetch(`/api/recommend?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get recommendation');
      setRecommendation(data.recommendation);
    } catch (err: any) { setError(err.message); toastApiError(err, 'AI recommendation failed'); }
    finally { setLoadingRecommendation(false); }
  };

  const handleAgentNegotiation = () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;
    setNegotiating(true); setAgentEvents([]); setEmailThread([]); setNegotiationComplete(null);
    const tenantId = account?.tenantId ?? 'tenant_demo';
    const es = new EventSource(`/api/agent/negotiate?menuId=${menuId}&tenantId=${encodeURIComponent(tenantId)}`);
    const stamp = () => new Date().toISOString();
    const add = (type: string, data: any) => setAgentEvents(prev => [...prev, { type, timestamp: stamp(), ...data }]);
    es.addEventListener('agent_start',       e => add('agent_start',       JSON.parse((e as MessageEvent).data)));
    es.addEventListener('agent_result',      e => add('agent_result',      JSON.parse((e as MessageEvent).data)));
    es.addEventListener('negotiation_round', e => add('negotiation_round', JSON.parse((e as MessageEvent).data)));
    es.addEventListener('email_sent',        e => { const d = JSON.parse((e as MessageEvent).data); const timestamp = stamp(); add('email_sent', { ...d, timestamp }); setEmailThread(p => [...p, { direction: 'sent', timestamp, ...d }]); });
    es.addEventListener('email_received',    e => { const d = JSON.parse((e as MessageEvent).data); const timestamp = stamp(); add('email_received', { ...d, timestamp }); setEmailThread(p => [...p, { direction: 'received', timestamp, ...d }]); });
    es.addEventListener('complete',          e => {
      const d = JSON.parse((e as MessageEvent).data);
      setNegotiationComplete(d); add('complete', d); setNegotiating(false); es.close();
      const totalSavings = Number(d.totalSavings) || 0;
      const totalMarketSpend = Number(marketValue) || Number(d.winnerPrice) || 0;
      const categories = ingredients.reduce((acc: Record<string, { spend: number; count: number }>, ing: any) => {
        const name = String(ing.name ?? '').toLowerCase();
        const category =
          /beef|steak|chicken|pork|fish|salmon|shrimp|meat|turkey/.test(name) ? 'Proteins' :
          /cheese|milk|cream|butter|yogurt/.test(name) ? 'Dairy' :
          /lettuce|tomato|onion|pepper|herb|vegetable|produce|potato|mushroom/.test(name) ? 'Produce' :
          /flour|pasta|rice|bread|bun|grain/.test(name) ? 'Dry Goods' :
          'Other';
        const price = pricingData.find((p: any) => String(p.name).toLowerCase() === name)?.currentPrice ?? 0;
        const spend = price * (typeof ing.quantity === 'number' ? ing.quantity : 1);
        acc[category] = acc[category] ?? { spend: 0, count: 0 };
        acc[category].spend += spend;
        acc[category].count += 1;
        return acc;
      }, {});
      const categorySavings = Object.entries(categories).map(([category, value]) => {
        const share = totalMarketSpend > 0 ? value.spend / totalMarketSpend : 1 / Math.max(Object.keys(categories).length, 1);
        return { category, spend: value.spend, savings: totalSavings * share };
      });
      const supplierScorecards = (d.negotiationResults ?? []).map((r: any) => {
        const originalPrice = Number(r.originalPrice) || 0;
        const finalPrice = Number(r.negotiatedPrice) || Number(r.finalPrice) || 0;
        const savings = Number(r.savings) || Math.max(0, originalPrice - finalPrice);
        const savingsPct = originalPrice > 0 ? savings / originalPrice : 0;
        const priceCompetitiveness = Math.max(0, Math.min(100, Math.round(100 - ((finalPrice - Number(d.winnerPrice || finalPrice)) / Math.max(finalPrice, 1)) * 120)));
        const responseSpeed = r.decision === 'ACCEPT' ? 92 : r.decision === 'COUNTER' ? 78 : r.decision === 'NOT_TARGETED' ? 50 : 58;
        const dealQuality = Math.max(0, Math.min(100, Math.round(62 + savingsPct * 260)));
        return {
          supplier: r.vendorName,
          originalPrice,
          finalPrice,
          savings,
          decision: r.decision ?? 'REVIEW',
          priceCompetitiveness,
          responseSpeed,
          dealQuality,
          overall: Math.round(priceCompetitiveness * 0.4 + responseSpeed * 0.25 + dealQuality * 0.35),
        };
      });
      // Save to localStorage history
      const historyItem = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        tenantId,
        restaurantName,
        menuText,
        recipesCount: recipes.length,
        ingredientsCount: ingredients.length,
        distributorsCount: distributors.length,
        quotesCount: quotes.length,
        totalSpend: d.winnerPrice,
        winner: d.winner,
        winnerPrice: d.winnerPrice,
        totalSavings: d.totalSavings,
        savingsPercentage: d.savingsPercentage,
        executiveSummary: d.executiveSummary,
        marketAlerts: Object.entries(mlForecasts).filter(([, f]: any) => f.anomaly).map(([name, f]: any) =>
          `${name}: ${f.anomaly?.type === 'SPIKE' ? 'price spike' : 'below average'} detected`
        ),
        categorySavings,
        supplierScorecards,
      };
      const existing = readTenantHistory(tenantId);
      writeTenantHistory(tenantId, [historyItem, ...existing].slice(0, 20));
      clearActiveRfp(tenantId);
    });
    es.addEventListener('error', e => { const raw = (e as MessageEvent).data; if (raw) add('error', JSON.parse(raw)); setNegotiating(false); es.close(); });
    es.onerror = () => { setNegotiating(false); es.close(); };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="text-[#EEEEEE] font-sans selection:bg-violet-500/30 selection:text-white">

      {/* ── Sticky top: workbench status + stats ─────────────────────────────── */}
      <div className="sticky top-0 lg:top-0 z-20 bg-black/90 backdrop-blur-2xl border-b border-white/[0.07] shadow-lg shadow-black/50">

        {/* Page header */}
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-[14px] text-[#EEEEEE]">New Procurement</h1>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md">
              <span className={cn('w-1.5 h-1.5 rounded-full bg-blue-300', negotiating && 'animate-pulse')} />
              {activeStage}
            </span>
            {anomalyCount > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                <AlertTriangle className="w-3 h-3" />
                {anomalyCount} {anomalyCount === 1 ? 'alert' : 'alerts'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {restaurantName && (
              <span className="text-[12px] font-semibold text-[#8A8F98] hidden sm:block">{restaurantName}</span>
            )}
            {(recipes.length > 0 || pricingData.length > 0) && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-[11px] font-bold text-[#8A8F98] hover:text-[#EEEEEE] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div className="border-t border-white/[0.06] bg-white/[0.01]">
          <div className="max-w-5xl mx-auto px-6">
            <div className="flex divide-x divide-white/5 overflow-x-auto">
              {[
                { label: 'Order Items',  value: ingredients.length || '—',  icon: Package,   hi: ingredients.length > 0 },
                { label: 'Order Baseline', value: marketValue > 0 ? `$${marketValue.toFixed(0)}` : '—', icon: DollarSign, hi: marketValue > 0 },
                { label: 'Suppliers',    value: distributors.length || '—', icon: Building2,  hi: distributors.length > 0 },
                { label: 'Quotes',       value: sentRFPs.length ? `${quotes.length} / ${sentRFPs.length}` : '—', icon: FileCheck, hi: quotes.length > 0 },
                { label: 'AI Savings',   value: negotiationComplete ? `$${Number(negotiationComplete.totalSavings).toFixed(0)}` : '—', icon: Target, hi: !!negotiationComplete, green: true },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5 shrink-0 hover:bg-white/[0.02] transition-colors">
                  <s.icon className={cn('w-3.5 h-3.5 shrink-0', s.green && s.hi ? 'text-emerald-400' : s.hi ? 'text-[#EEEEEE]' : 'text-[#8A8F98]')} />
                  <div>
                    <span className={cn('text-[13px] font-bold', s.green && s.hi ? 'text-emerald-400' : s.hi ? 'text-[#EEEEEE]' : 'text-[#8A8F98]')}>{s.value}</span>
                    <span className="text-[10px] text-[#8A8F98] font-medium tracking-wide ml-2 uppercase">{s.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-6 py-12 space-y-16">

        {/* Hero — shown before first run */}
        {recipes.length === 0 && !loading && (
          <div className="relative py-8 text-center space-y-5 border-b border-white/5 pb-14 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 -z-10">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[250px] rounded-full bg-violet-600/10 blur-[80px]" />
            </div>
            <h1 className="text-[38px] font-black tracking-tight gradient-text leading-none">Procurement, automated.</h1>
            <p className="text-[14px] text-[#8A8F98] max-w-xl mx-auto leading-relaxed">
              Paste your menu below — AI extracts ingredients, fetches live prices, finds local distributors, and negotiates the best deal.
            </p>
            <div className="flex items-center justify-center flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold uppercase tracking-widest">
              <span className="flex items-center gap-1.5 text-violet-400"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />Local AI optional · Groq fallback</span>
              <span className="text-white/20">/</span>
              <span className="text-blue-400">CME · CBOT · BLS live prices</span>
              <span className="text-white/20">/</span>
              <span className="text-[#8A8F98]">5-agent negotiation</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-md text-[13px] font-medium text-red-400 linear-panel">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400/60 hover:text-red-400">×</button>
          </div>
        )}

        {/* ════════════════════
            Menu Analysis
        ════════════════════ */}
        <Section done={recipes.length > 0} title="Menu Intelligence" subtitle="Paste your menu or a URL — AI uses menu descriptions first, then Groq inference to complete missing ingredients">
          <div className="grid lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-2 p-6 flex flex-col gap-5 border border-white/10">
              <label className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Menu Input</label>
              <textarea
                rows={10}
                className="flex-1 w-full bg-black border border-white/10 rounded-lg p-4 text-[13px] text-[#EEEEEE] placeholder:text-[#8A8F98]/50 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/20 resize-none font-mono leading-relaxed shadow-inner"
                placeholder={"Classic Cheeseburger  $12\nSpaghetti Bolognese  $16\nGrilled Salmon  $24\n\nor paste a URL to auto-fetch"}
                value={menuText}
                onChange={e => setMenuText(e.target.value)}
              />
              <div className="flex items-center justify-end gap-3">
                <Btn onClick={handleParseMenu} disabled={!menuText.trim()} loading={loading}>
                  <Sparkles className="w-4 h-4" />
                  {loading ? (pipelineStatus || 'Extracting dishes…') : 'Run Pipeline'}
                </Btn>
              </div>
            </Card>

            <Card className="lg:col-span-3 p-6 flex flex-col border border-white/10 bg-black/60 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[80px] rounded-full pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative z-10">
                <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Extracted Dishes</span>
                <div className="flex items-center gap-2">
                  {parseModelSource && parseModelSource !== 'Mock' && (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] font-bold text-violet-400">
                      <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" />{parseModelSource}
                    </span>
                  )}
                  {recipes.length > 0 && <Tag color="blue">{recipes.length} dishes</Tag>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 min-h-[220px] relative z-10">
                {loading ? (
                  <div className="space-y-3">
                    {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : recipes.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-[#8A8F98] gap-3 py-10 border border-dashed border-white/10 rounded-lg">
                    <ChefHat className="w-8 h-8 opacity-20" />
                    <p className="text-[13px] font-medium">Dishes appear here after extraction</p>
                  </div>
                ) : recipes.map((recipe, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 rounded-lg transition-all">
                    <span className="text-[13px] text-[#EEEEEE] font-bold">{recipe.name}</span>
                    <span className="text-[11px] text-[#8A8F98] uppercase tracking-widest">{recipe.ingredients?.length ?? 0} ingredients</span>
                  </div>
                ))}
              </div>
            </Card>

            {recipes.length > 0 && (
              <Card className="lg:col-span-5 p-6 border border-blue-500/20 bg-blue-500/[0.03]">
	                <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
	                  <div>
	                    <span className="text-[11px] font-bold text-blue-300 uppercase tracking-widest">Whole Menu Order Sizing</span>
	                    <p className="text-[13px] text-[#8A8F98] mt-1">Enter the guest count once. AutoRFP scales every extracted dish, combines duplicate ingredients, then runs pricing, supplier discovery, and sends RFPs.</p>
	                  </div>
	                  <Tag color="blue">{recipes.length} dishes</Tag>
	                </div>
	                <div className="grid md:grid-cols-[130px_130px_auto] gap-3 items-end">
	                  <label className="space-y-2">
	                    <span className="text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">Guests</span>
	                    <input
                      type="number"
                      min={1}
                      value={guestCount}
	                      onChange={e => {
	                        const next = Math.max(1, Number(e.target.value) || 1);
	                        setGuestCount(next);
	                        setIngredients([]);
	                        setPricingData([]); setMlForecasts({}); setQuotes([]); setSentRFPs([]); setRecommendation(null); setDistributors([]);
	                      }}
	                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-[#EEEEEE] focus:outline-none focus:ring-1 focus:ring-white/20"
	                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">Buffer %</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={bufferPct}
	                      onChange={e => {
	                        const next = Math.max(0, Math.min(50, Number(e.target.value) || 0));
	                        setBufferPct(next);
	                        setIngredients([]);
	                        setPricingData([]); setMlForecasts({}); setQuotes([]); setSentRFPs([]); setRecommendation(null); setDistributors([]);
	                      }}
	                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-[#EEEEEE] focus:outline-none focus:ring-1 focus:ring-white/20"
	                    />
	                  </label>
	                  <Btn onClick={() => applyWholeMenuSizing()} disabled={!recipes.length || loadingPricing || loadingDistributors || sendingRFPs} loading={loadingPricing || loadingDistributors || sendingRFPs}>
	                    <Target className="w-4 h-4" />
	                    {pipelineStatus || 'Apply and send RFPs'}
	                  </Btn>
	                </div>
              </Card>
            )}

            {ingredients.length > 0 && (
              <Card className="lg:col-span-5 p-6 border border-white/10">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Procurement List</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tag color="blue">{ingredients.length} ingredients</Tag>
                    <Tag color="indigo">{guestCount} guests + {bufferPct}% buffer</Tag>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {ingredients.map((ing, i) => (
                    <div key={i} className="px-4 py-3 bg-[#080808] border border-white/10 rounded-[8px] hover:border-white/20 transition-colors shadow-inner">
                      <p className="text-[13px] font-bold text-[#EEEEEE] truncate">{ing.name}</p>
                      <p className="text-[11px] text-[#8A8F98] font-medium mt-1 truncate">{ing.quantity} {ing.unit}</p>
                      <p className="text-[10px] text-[#8A8F98]/60 mt-1 truncate">from {ing.perGuestQuantity} {ing.perGuestUnit}/guest</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {menuInsight && (
              <Card className="lg:col-span-5 p-5 border border-violet-500/20 bg-violet-500/[0.03]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/10 border border-violet-500/20">
                    <Brain className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-400">AI insight · local first, Groq fallback</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    </div>
                    <p className="text-[13px] text-[#CCCCCC] leading-relaxed">{menuInsight}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </Section>

        {/* ════════════════════
            Market Pricing
        ════════════════════ */}
        <Section
          done={pricingData.length > 0}
          title="Market Pricing & Forecasting"
          subtitle="Live commodity data from CME/CBOT futures · ML regression with 3-month price forecast"
          action={
            <div className="flex items-center gap-3 flex-wrap">
              {liveCount > 0 && <Tag color="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{liveCount} live</Tag>}
              {Object.keys(mlForecasts).length > 0 && <Tag color="indigo"><Activity className="w-3.5 h-3.5" />ML active</Tag>}
              <Btn onClick={() => handleFetchPricing()} disabled={!ingredients.length} loading={loadingPricing}>
                <BarChart3 className="w-4 h-4" />
                {loadingPricing ? 'Fetching…' : 'Run Analysis'}
              </Btn>
            </div>
          }
        >
          {loadingPricing ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-56" />)}
            </div>
          ) : pricingData.length === 0 ? (
            <Card className="py-20 flex flex-col items-center border border-dashed border-white/10 text-[#8A8F98] gap-3 bg-white/[0.01] shadow-none">
              <BarChart3 className="w-10 h-10 opacity-20" />
              <p className="text-[13px] font-medium">Run market analysis after extracting ingredients</p>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {pricingData.map((item, idx) => {
                const current  = item.history[item.history.length - 1]?.price ?? item.currentPrice;
                const prev     = item.history[item.history.length - 2]?.price ?? current;
                const pct      = prev > 0 ? ((current - prev) / prev) * 100 : 0;
                const forecast = mlForecasts[item.name];
                const chartData = [
                  ...item.history.map((h: any, i: number) => ({ date: h.date, price: h.price, forecast: i === item.history.length - 1 ? h.price : null })),
                  ...(forecast?.forecast ?? []).map((f: any) => ({ date: f.date, price: null, forecast: f.price }))
                ];
                const trendColor = forecast?.trend === 'RISING' ? 'text-red-400' : forecast?.trend === 'FALLING' ? 'text-emerald-400' : 'text-[#8A8F98]';
                return (
                  <Card key={idx} className="p-5 flex flex-col gap-4 border border-white/10 hover:border-white/20 transition-all">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-[#EEEEEE] truncate text-[15px]">{item.name}</h3>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {item.isLive
                            ? <Tag color="green" className="text-[10px]"><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />Live</Tag>
                            : <Tag color="gray" className="text-[10px]">Estimated</Tag>
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
                    {typeof item.lineTotal === 'number' && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-white/[0.03] border border-white/10 text-[11px] font-bold">
                        <span className="text-[#8A8F98] uppercase tracking-widest">{item.orderQuantity} {item.orderUnit} order</span>
                        <span className="text-[#EEEEEE]">${item.lineTotal.toFixed(2)} est.</span>
                      </div>
                    )}
                    {forecast?.anomaly && (
                      <div className={cn('text-[11px] font-bold uppercase tracking-wide px-3 py-2 rounded-[6px] flex items-center gap-1.5 border',
                        forecast.anomaly.type === 'SPIKE' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      )}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {forecast.anomaly.type === 'SPIKE' ? `Price spike: ${forecast.anomaly.deviationPct}% above avg` : `Below average: ${forecast.anomaly.deviationPct}% — buy now`}
                      </div>
                    )}
                    <div className="h-24 min-w-0 min-h-24 pointer-events-none mt-2">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <ComposedChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <defs>
                            <linearGradient id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#FFFFFF" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#FFFFFF" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} hide />
                          <Tooltip contentStyle={{ background: '#080808', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px', color: '#EEEEEE', fontWeight: 'bold' }} itemStyle={{ color: '#8A8F98' }} labelStyle={{ color: '#EEEEEE', marginBottom: '4px' }} labelFormatter={l => new Date(l).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} formatter={(v: any, n) => [v !== null ? `$${Number(v).toFixed(2)}` : '—', n === 'forecast' ? 'ML Forecast' : 'Market Price'] as [string, string]} />
                          <Area type="monotone" dataKey="price" stroke="#FFFFFF" strokeWidth={2} fill={`url(#grad-${idx})`} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="forecast" stroke="#8A8F98" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    {forecast?.buySignal && (
                      <div className="flex items-center justify-between pt-3 border-t border-white/10 text-[11px] font-bold uppercase tracking-widest mt-auto">
                        <span className={cn('flex items-center gap-1.5',
                          forecast.buySignal.signal === 'BUY_NOW' ? 'text-emerald-400' :
                          forecast.buySignal.signal === 'WAIT'    ? 'text-amber-400'   : 'text-[#8A8F98]'
                        )}>
                          {forecast.buySignal.signal === 'BUY_NOW' ? <><ShoppingCart className="w-3.5 h-3.5" />Buy now</> : forecast.buySignal.signal === 'WAIT' ? <><Clock className="w-3.5 h-3.5" />Wait</> : <><Minus className="w-3.5 h-3.5" />Neutral</>}
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

        {/* ════════════════════
            Supplier Discovery
        ════════════════════ */}
        <Section done={distributors.length > 0} title="Supplier Discovery" subtitle="Search by city or zip code to find nearby wholesale food distributors">
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
                  className="w-full pl-11 pr-4 py-2.5 bg-black border border-white/10 rounded-lg text-[13px] text-[#EEEEEE] placeholder:text-[#8A8F98]/50 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/20 shadow-inner"
                />
              </div>
              <Btn onClick={() => handleFindDistributors()} disabled={!distributorLocation.trim()} loading={loadingDistributors}>
                <Search className="w-4 h-4" />
                {loadingDistributors ? 'Searching…' : 'Find Suppliers'}
              </Btn>
            </div>
            {loadingDistributors && (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-36" />)}
              </div>
            )}
            {distributors.length === 0 && !loadingDistributors && (
              <div className="py-14 flex flex-col items-center text-[#8A8F98] gap-3 border border-dashed border-white/10 rounded-lg bg-white/[0.01]">
                <Building2 className="w-8 h-8 opacity-20" />
                <p className="text-[13px] font-medium">Enter a location to discover local distributors</p>
              </div>
            )}
            {distributors.length > 0 && (
              <>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {distributors.map((dist, i) => (
                    <div key={i} className="border border-white/10 rounded-lg p-5 hover:border-white/20 hover:bg-white/[0.03] transition-all flex flex-col gap-3 group relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      <div className="flex items-start justify-between gap-3 relative z-10">
                        <div className="min-w-0">
                          <h3 className="font-bold text-[14px] text-[#EEEEEE] truncate">{dist.name}</h3>
                          <p className="text-[11px] text-[#8A8F98] mt-1 flex items-center gap-1.5 truncate font-medium"><MapPin className="w-3 h-3 shrink-0" />{dist.location}</p>
                        </div>
                        {sentRFPs.some(r => r.distributorName === dist.name) && (
                          <Tag color="green" className="text-[10px]"><CheckCircle className="w-3 h-3" />Sent</Tag>
                        )}
                      </div>
                      {dist.specialty && <p className="text-[11px] text-[#8A8F98] leading-relaxed relative z-10">{dist.specialty}</p>}
                      <p className="text-[11px] text-[#8A8F98]/70 font-mono truncate relative z-10">{dist.email}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <Btn onClick={handleSendRFPs} disabled={sendingRFPs || sentRFPs.length > 0} loading={sendingRFPs}>
                    <Mail className="w-4 h-4" />
                    {sentRFPs.length > 0 ? `RFPs sent to ${sentRFPs.length} suppliers` : `Send RFPs to ${distributors.length} suppliers`}
                  </Btn>
                </div>
              </>
            )}
          </Card>
        </Section>

        {/* ════════════════════
            Quote Collection
        ════════════════════ */}
        {sentRFPs.length > 0 && (
          <Section
            done={quotes.length > 0}
            title="Quote Collection"
            subtitle={`${quotes.length} of ${sentRFPs.length} suppliers responded`}
            action={
              <div className="flex items-center gap-2">
                <Btn variant="secondary" size="sm" onClick={() => setShowEmailSimulator(s => !s)}>Manual</Btn>
                <Btn size="sm" onClick={handleAutoConversation} disabled={simulatingConversation || quotes.length >= sentRFPs.length} loading={simulatingConversation}>
                  <Bot className="w-3 h-3" />
                  {simulatingConversation ? 'Generating…' : 'Generate vendor responses'}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={handleFetchQuotes} disabled={loadingQuotes}>
                  {loadingQuotes ? 'Refreshing…' : 'Refresh'}
                </Btn>
              </div>
            }
          >
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
                          'text-[13px] rounded-lg px-4 py-3 leading-relaxed',
                          entry.role === 'AutoRFP Agent' ? 'bg-white/5 text-white border border-white/10'
                          : entry.role === 'system' ? 'text-[#8A8F98]/60 italic font-mono text-[11px]'
                          : 'bg-white/[0.03] text-[#EEEEEE] border border-white/5'
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

            {showEmailSimulator && (
              <Card className="p-6 space-y-4 border-white/15 bg-white/[0.03]">
                <div>
                  <h3 className="text-sm font-bold text-[#EEEEEE]">Process Vendor Email</h3>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-[#8A8F98] mt-1">Paste a vendor reply — AI parses the quote automatically</p>
                </div>
                <select className="w-full bg-black border border-white/15 rounded-lg p-3 text-[13px] text-[#EEEEEE] focus:outline-none focus:ring-1 focus:ring-white/20" value={simulatedEmailRfpId} onChange={e => setSimulatedEmailRfpId(e.target.value)}>
                  <option value="">Select vendor…</option>
                  {sentRFPs.map(rfp => <option key={rfp.id} value={rfp.id}>{rfp.distributorName}</option>)}
                </select>
                <textarea className="w-full bg-black border border-white/15 rounded-lg p-4 text-[13px] text-[#EEEEEE] focus:outline-none focus:ring-1 focus:ring-white/20 min-h-[100px] font-mono leading-relaxed" placeholder="Hi, we can supply everything. Total: $840.00, delivery Tue/Fri." value={simulatedEmailBody} onChange={e => setSimulatedEmailBody(e.target.value)} />
                <div className="flex justify-end">
                  <Btn onClick={handleSimulateEmail} disabled={!simulatedEmailRfpId || !simulatedEmailBody.trim()} loading={simulatingEmail}>Extract Quote</Btn>
                </div>
              </Card>
            )}

            {followUpEmail && (
              <Card className="p-5 space-y-3 border-amber-500/20 bg-amber-500/5">
                <p className="text-[13px] font-bold text-amber-500 flex items-center gap-1.5"><Zap className="w-4 h-4" />Incomplete quote — follow-up generated</p>
                <pre className="bg-black border border-amber-500/20 rounded-lg p-4 text-[11px] text-amber-200/80 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">{followUpEmail}</pre>
                <button onClick={() => setFollowUpEmail('')} className="text-[11px] font-bold uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors">Dismiss</button>
              </Card>
            )}

            <Card className="overflow-hidden">
              {simulatingConversation || loadingQuotes ? (
                <div className="p-6 space-y-3">
                  {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : quotes.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-[#8A8F98] gap-3">
                  <FileCheck className="w-10 h-10 opacity-20" />
                  <p className="text-[13px] font-medium">No quotes yet — click "Generate vendor responses" above</p>
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
                                <p className="font-bold text-[#EEEEEE]">{q.distributorName}</p>
                                <p className="text-[11px] font-medium text-[#8A8F98] mt-1">{q.distributorLocation}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-[12px] text-[#8A8F98] hidden md:table-cell"><span className="line-clamp-2 leading-relaxed">{q.details || '—'}</span></td>
                          <td className={cn('px-6 py-5 text-right font-mono text-[14px] font-bold', i === 0 ? 'text-emerald-400' : 'text-[#EEEEEE]')}>${Number(q.price).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {riskScores.length > 0 && (() => {
                const COLORS = ['#34d399','#60a5fa','#a78bfa','#fbbf24','#f87171'];
                const radarData = ['Price','Reliability','Speed','Market Rate','Coverage'].map(axis => {
                  const point: any = { axis };
                  riskScores.forEach(s => { point[s.distributorName] = s.axes.find((a: any) => a.axis === axis)?.score ?? 0; });
                  return point;
                });
                return (
                  <div className="border-t border-white/10 p-6 space-y-5">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-400" />
                      <h3 className="text-[13px] font-bold text-[#EEEEEE]">Supplier Intelligence Report</h3>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#8A8F98] ml-1">5-axis risk scoring</span>
                    </div>
                    <div className="grid lg:grid-cols-2 gap-6 items-center">
                      <div className="h-64 min-w-0 min-h-64">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                            <PolarGrid stroke="rgba(255,255,255,0.08)" />
                            <PolarAngleAxis dataKey="axis" tick={{ fill: '#8A8F98', fontSize: 11, fontWeight: 600 }} />
                            {riskScores.map((s, i) => (
                              <Radar key={s.distributorName} name={s.distributorName} dataKey={s.distributorName} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.12} strokeWidth={2} />
                            ))}
                            <Legend wrapperStyle={{ fontSize: 11, color: '#8A8F98' }} />
                            <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#EEEEEE', fontWeight: 700 }} itemStyle={{ color: '#8A8F98' }} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-3">
                        {riskScores.map((s, i) => (
                          <div key={s.distributorName} className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/8 rounded-lg">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-[#EEEEEE] truncate">{s.distributorName}</p>
                              <div className="flex gap-2 mt-1.5 flex-wrap">
                                {s.axes.map((a: any) => (
                                  <span key={a.axis} className="text-[10px] text-[#8A8F98]">
                                    {a.axis} <span className="font-bold" style={{ color: a.score >= 70 ? '#34d399' : a.score >= 45 ? '#fbbf24' : '#f87171' }}>{a.score}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[18px] font-black" style={{ color: COLORS[i % COLORS.length] }}>{s.overall}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-[#8A8F98]">overall</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {quotes.length > 0 && (
                <div className="border-t border-white/10 p-6 space-y-5 bg-white/[0.01]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-[#EEEEEE] flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-400" />AI Recommendation
                      {loadingRecommendation && <span className="text-[11px] text-violet-300">Analyzing…</span>}
                    </h3>
                  </div>
                  {loadingRecommendation ? (
                    <div className="space-y-3">
                      <Skeleton className="h-7 w-48" />
                      <Skeleton className="h-24" />
                      <Skeleton className="h-12" />
                    </div>
                  ) : recommendation ? (
                    <div className="bg-white/[0.02] border border-white/10 rounded-xl p-5 space-y-3 relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent pointer-events-none" />
                      <div className="flex items-center gap-2 relative z-10">
                        <p className="text-[10px] text-white font-black uppercase tracking-[0.2em]">Recommended supplier</p>
                        {recommendation.ragEnhanced && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[9px] font-bold text-blue-400 uppercase tracking-widest">
                            <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />RAG
                          </span>
                        )}
                      </div>
                      <h4 className="text-xl font-bold text-[#EEEEEE] tracking-tight relative z-10">{recommendation.recommendedDistributor}</h4>
                      <p className="text-[13px] text-[#8A8F98] leading-relaxed relative z-10">{stripMarkdown(recommendation.reasoning ?? '')}</p>
                      {recommendation.potentialRisks && (
                        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-md px-3.5 py-3 text-[12px] text-amber-500 font-medium relative z-10">
                          <AlertTriangle className="w-4 h-4 shrink-0" />{stripMarkdown(recommendation.potentialRisks)}
                        </div>
                      )}
                      {recommendation.savings > 0 && (
                        <p className="text-[13px] font-bold text-emerald-400 relative z-10">
                          <span className="inline-block px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded mr-2">−${Number(recommendation.savings).toFixed(2)}</span>
                          saved vs most expensive quote
                        </p>
                      )}
                      {recommendation.verification && (
                        <div className="border-t border-white/10 pt-3 mt-1 relative z-10">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8A8F98] mb-2">Dual-Model Verification</p>
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-[#EEEEEE]"><span className="w-1.5 h-1.5 rounded-full bg-violet-400" />Local/Groq · {recommendation.verification.ollamaChoice ?? '—'}</span>
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-[#EEEEEE]"><span className="w-1.5 h-1.5 rounded-full bg-orange-400" />Groq · {recommendation.verification.groqChoice ?? '—'}</span>
                            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${recommendation.verification.agreed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                              {recommendation.verification.agreed ? '✓ Models agree' : '⚠ Models differ'}
                              <span className="opacity-70">· {recommendation.verification.confidence}% confidence</span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-8 border border-dashed border-white/10 rounded-xl text-[#8A8F98] text-[13px] font-medium">
                      AI recommendation will appear automatically after quotes are collected
                    </div>
                  )}
                </div>
              )}
            </Card>
          </Section>
        )}

        {/* ════════════════════
            AI Negotiation
        ════════════════════ */}
        {quotes.length > 0 && (
          <Section
            done={!!negotiationComplete}
            title="AI Negotiation Engine"
            subtitle="5 specialized agents negotiate pricing autonomously via email — no human needed"
            action={
              <Btn onClick={handleAgentNegotiation} disabled={negotiating || !!negotiationComplete} loading={negotiating} className="linear-glow">
                <Zap className="w-3.5 h-3.5" />
                {negotiating ? 'Agents running…' : negotiationComplete ? 'Negotiation complete' : 'Launch agent pipeline'}
              </Btn>
            }
          >
            {/* Pre-launch state */}
            {agentEvents.length === 0 && !negotiating && !negotiationComplete && (
              <Card className="py-16 flex flex-col items-center gap-6 border border-dashed border-white/10 bg-white/[0.01] shadow-none">
                <div className="flex -space-x-3">
                  {AGENT_DEFS.map((a, i) => (
                    <div key={i} className="w-11 h-11 rounded-full bg-black border border-white/10 flex items-center justify-center text-lg z-10 shadow-lg">{a.emoji}</div>
                  ))}
                </div>
                <div className="text-center">
                  <p className="text-[15px] font-bold text-[#EEEEEE]">5 AI agents ready to negotiate on your behalf</p>
                  <p className="text-[12px] font-medium text-[#8A8F98] mt-2 max-w-md">
                    Orchestrator → Market Analyst → Negotiation Agent → Vendor Simulator → Deal Auditor
                  </p>
                </div>
              </Card>
            )}

            {/* Live pipeline */}
            {(agentEvents.length > 0 || negotiating) && !negotiationComplete && (
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Agent pipeline */}
                <Card className="flex flex-col overflow-hidden border border-white/10">
                  <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.07] bg-white/[0.02]">
                    <Cpu className="w-4 h-4 text-violet-400" />
                    <span className="text-[11px] font-bold text-[#EEEEEE] uppercase tracking-widest">Agent Pipeline</span>
                    {negotiating && (
                      <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-white/50 uppercase tracking-wide">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                        Running
                      </span>
                    )}
                  </div>
                  <div className="p-5">
                    <AgentPipeline events={agentEvents} negotiating={negotiating} />
                  </div>

                  {/* Negotiation rounds */}
                  {agentEvents.filter(e => e.type === 'negotiation_round').length > 0 && (
                    <div className="border-t border-white/[0.07] px-5 py-4 space-y-2">
                      <p className="text-[10px] font-black text-[#8A8F98] uppercase tracking-widest mb-3">Price Movement</p>
                      {agentEvents.filter(e => e.type === 'negotiation_round').map((ev, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] border border-white/[0.05] rounded-lg text-[12px] font-mono">
                          <span className="text-[#8A8F98] font-sans font-bold truncate max-w-[70px] text-[11px]">{ev.vendorName}</span>
                          <span className="text-red-400/80 line-through decoration-red-500/50">${Number(ev.originalPrice).toFixed(0)}</span>
                          <ChevronRight className="w-3 h-3 text-white/20 shrink-0" />
                          <span className="text-amber-400">${Number(ev.counterPrice).toFixed(0)}</span>
                          <ChevronRight className="w-3 h-3 text-white/20 shrink-0" />
                          <span className={cn('font-bold', ev.savings > 0 ? 'text-emerald-400' : 'text-[#8A8F98]')}>${Number(ev.finalPrice).toFixed(0)}</span>
                          {ev.savings > 0 && <span className="ml-auto text-emerald-400 font-bold text-[11px]">−${Number(ev.savings).toFixed(0)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Live chat thread */}
                <Card className="flex flex-col overflow-hidden border border-white/10">
                  <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.07] bg-white/[0.02] shrink-0">
                    <MessageSquare className="w-4 h-4 text-[#8A8F98]" />
                    <span className="text-[11px] font-bold text-[#EEEEEE] uppercase tracking-widest">Live Negotiation Thread</span>
                    <span className="ml-auto text-[10px] font-bold text-white/30 uppercase tracking-widest">AI-to-AI</span>
                  </div>
                  <div className="flex-1 p-5 overflow-hidden">
                    <ChatThread messages={emailThread} />
                  </div>
                  {negotiating && (
                    <div className="border-t border-white/[0.07] px-5 py-3 flex items-center gap-2.5 text-[12px] text-[#8A8F98]">
                      Agents processing…
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* Final deal summary */}
            {negotiationComplete && (
              <Card className="p-8 border-white/10 space-y-8 bg-black/60 relative overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                {/* Winner banner */}
                <div className="flex items-start justify-between gap-4 flex-wrap relative z-10">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 text-violet-400">Negotiation complete</p>
                    <h3 className="text-3xl font-black gradient-text tracking-tight">{negotiationComplete.winner}</h3>
                    <p className="text-[13px] font-medium text-[#8A8F98] mt-1.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Best negotiated deal secured · {new Date().toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[40px] font-black text-[#EEEEEE] tracking-tighter leading-none">${Number(negotiationComplete.winnerPrice).toFixed(2)}</p>
                    <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mt-2">Final price</p>
                  </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
                  {[
                    { label: 'Total Savings',  value: `$${Number(negotiationComplete.totalSavings).toFixed(2)}`,    color: 'emerald' },
                    { label: 'Cost Reduction', value: `${Number(negotiationComplete.savingsPercentage).toFixed(1)}%`, color: 'blue' },
                    { label: 'Deals Improved', value: negotiationComplete.negotiationResults?.filter((r: any) => r.savings > 0).length ?? 0, color: 'indigo' },
                  ].map((s, i) => (
                    <div key={i} className={cn('rounded-xl p-5 border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]',
                      s.color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/20' :
                      s.color === 'blue'    ? 'bg-white/5 border-white/10' : 'bg-indigo-500/10 border-indigo-500/20'
                    )}>
                      <p className={cn('text-2xl font-black tracking-tight',
                        s.color === 'emerald' ? 'text-emerald-400' : 'text-white'
                      )}>{s.value}</p>
                      <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mt-1.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Executive Summary */}
                <div className="bg-black border border-white/10 rounded-xl p-6 relative z-10 shadow-inner">
                  <p className="text-[11px] font-bold text-violet-300 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Executive Summary</p>
                  <p className="text-[14px] text-[#EEEEEE]/90 leading-relaxed font-medium">{negotiationComplete.executiveSummary}</p>
                </div>

                {/* Action items */}
                {negotiationComplete.actionItems?.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-6 py-5 space-y-2.5 relative z-10">
                    <p className="text-[11px] font-bold text-amber-500 uppercase tracking-widest mb-1">Action Items</p>
                    {negotiationComplete.actionItems.map((item: string, i: number) => (
                      <p key={i} className="text-[13px] font-medium text-amber-400/90 flex items-start gap-2">
                        <span className="text-amber-500 opacity-60 shrink-0 mt-1">•</span> {item}
                      </p>
                    ))}
                  </div>
                )}

                {/* Results table */}
                <div className="border border-white/10 rounded-xl overflow-hidden relative z-10 bg-black">
                  <div className="grid grid-cols-4 px-5 py-3.5 bg-white/[0.02] border-b border-white/10 text-[10px] font-black text-[#8A8F98] uppercase tracking-widest">
                    <div className="col-span-2">Supplier</div>
                    <div className="text-right">Original</div>
                    <div className="text-right">Final</div>
                  </div>
                  {negotiationComplete.negotiationResults?.map((r: any, i: number) => (
                    <div key={i} className="grid grid-cols-4 px-5 py-4 text-[13px] font-medium border-b border-white/5 last:border-0 items-center hover:bg-white/[0.03] transition-colors">
                      <div className="col-span-2 flex items-center gap-3 min-w-0">
                        <span className="font-bold text-[#EEEEEE] truncate">{r.vendorName}</span>
                        <Tag color={r.decision==='ACCEPT' ? 'green' : r.decision==='COUNTER' ? 'amber' : r.decision==='NOT_TARGETED' ? 'gray' : 'red'} className="hidden sm:inline-flex">
                          {r.decision==='NOT_TARGETED' ? 'skipped' : r.decision?.toLowerCase()}
                        </Tag>
                      </div>
                      <div className="text-right text-[#8A8F98] font-mono text-[12px] line-through decoration-red-500/40">${Number(r.originalPrice).toFixed(2)}</div>
                      <div className={cn('text-right font-mono text-[13px] font-bold', r.savings > 0 ? 'text-emerald-400' : 'text-[#8A8F98]')}>
                        ${Number(r.negotiatedPrice).toFixed(2)}
                        {r.savings > 0 && <span className="text-emerald-500 text-[10px] ml-1.5 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">−${Number(r.savings).toFixed(0)}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Replay chat at the bottom */}
                {emailThread.length > 0 && (
                  <div className="relative z-10 space-y-3">
                    <p className="text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest">Negotiation Thread Recap</p>
                    <ChatThread messages={emailThread} />
                  </div>
                )}
              </Card>
            )}
          </Section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-black mt-16">
        <div className="max-w-5xl mx-auto px-6 py-5 flex flex-col md:flex-row md:items-center justify-between text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest gap-3">
          <span className="flex items-center gap-2"><ChefHat className="w-3.5 h-3.5 text-white/30" /> AutoRFP Engine</span>
          <div className="flex items-center flex-wrap gap-3">
            <span>Local AI optional · Groq fallback</span>
            <span className="opacity-30">/</span>
            <span>CME · CBOT · BLS Pricing</span>
            <span className="opacity-30">/</span>
            <span>Google Places Suppliers</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
