'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import {
  ChefHat, ArrowRight, CheckCircle, TrendingUp,
  Zap, Brain
} from 'lucide-react';
import {
  ACCOUNT_KEY,
  readAccount,
  saveAccount,
  type RestaurantAccount,
} from '@/lib/tenant';
import { toastApiError } from '@/lib/toast';

export default function LandingPage() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [location, setLocation] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [preferredSuppliers, setPreferredSuppliers] = useState('');
  const [monthlyBudgetTarget, setMonthlyBudgetTarget] = useState('');
  const [savingsTargetPct, setSavingsTargetPct] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    fetch('/api/account')
      .then(async res => {
        if (!res.ok) {
          if (res.status === 401) localStorage.removeItem(ACCOUNT_KEY);
          return { account: null, allowLocalFallback: false };
        }
        const data = await res.json();
        return { account: data.account as RestaurantAccount, allowLocalFallback: true };
      })
      .then(({ account, allowLocalFallback }) => {
        if (account) {
          saveAccount(account);
          router.replace('/dashboard');
        } else if (allowLocalFallback && readAccount()) {
          router.replace('/dashboard');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  const valid = mode === 'signin'
    ? email.includes('@') && password.length >= 8
    : name.trim() && email.includes('@') && password.length >= 8 && location.trim() && cuisineType.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setAuthError('');
    try {
      const checkRes = await fetch('/api/auth/workspace-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          name,
          email,
          password,
          location,
          cuisineType,
        }),
      });
      if (!checkRes.ok) {
        const data = await checkRes.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to validate restaurant workspace.');
      }
      const result = await signIn('credentials', {
        redirect: false,
        mode,
        name,
        email,
        password,
        location,
        cuisineType,
        preferredSuppliers,
        monthlyBudgetTarget,
        savingsTargetPct,
      });
      if (result?.error) throw new Error(
        result.error === 'CredentialsSignin'
          ? (mode === 'signin' ? 'Email or password is incorrect.' : 'Unable to create workspace. Check the database connection and try again.')
          : result.error
      );
      const accountRes = await fetch('/api/account');
      if (!accountRes.ok) throw new Error('Unable to load restaurant workspace.');
      const { account } = await accountRes.json();
      saveAccount(account);
      router.push('/dashboard');
    } catch (err: any) {
      setAuthError(err.message || 'Unable to create restaurant session.');
      toastApiError(err, mode === 'signin' ? 'Sign in failed' : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;

  return (
    <div className="min-h-screen bg-black text-[#EEEEEE] font-sans overflow-x-hidden">
      {/* Fixed ambient glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-violet-600/8 blur-[140px] rounded-full" />
        <div className="absolute top-1/3 right-[-10%] w-[500px] h-[400px] bg-blue-600/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-1/4 left-[-5%] w-[400px] h-[300px] bg-indigo-600/5 blur-[100px] rounded-full" />
        <div className="hero-grid absolute inset-0 opacity-60" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 max-w-6xl mx-auto px-6 h-16 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg border border-violet-500/30 bg-violet-500/10 flex items-center justify-center shadow-[0_0_15px_rgba(139,92,246,0.2)]">
            <ChefHat className="w-4 h-4 text-violet-300" />
          </div>
          <div>
            <span className="font-bold text-[14px] text-[#EEEEEE] tracking-wide">AutoRFP</span>
            <span className="ml-2 text-[10px] font-bold text-[#8A8F98] uppercase tracking-[0.12em]">Procurement AI</span>
          </div>
        </div>
        <button
          onClick={() => { setMode('signin'); setShowForm(true); setAuthError(''); }}
          className="text-[12px] font-bold text-[#8A8F98] hover:text-white transition-colors"
        >
          Sign in →
        </button>
      </nav>

      {/* Hero */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-full text-[11px] font-bold text-violet-300 tracking-widest uppercase mb-10">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          LangGraph pipeline · CME live pricing · Inngest jobs · Sentry monitoring
        </div>

        <h1 className="text-[52px] md:text-[72px] font-black tracking-tight leading-[0.92] mb-7">
          <span className="gradient-text">Cut food costs</span>
          <br />
          <span className="text-white">with market-aware</span>
          <br />
          <span className="text-[#5A5F6A]">autonomous</span>
          <br />
          <span className="gradient-text">AI negotiation.</span>
        </h1>

        <p className="text-[17px] text-[#8A8F98] leading-relaxed max-w-2xl mx-auto mb-12">
          AutoRFP parses your menu, fetches live CME commodity prices, discovers local distributors, and autonomously negotiates the best deal — all without a single phone call.
        </p>

        {!showForm ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => { setMode('signup'); setShowForm(true); setAuthError(''); }}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[14px] rounded-xl transition-all duration-200 shadow-[0_0_30px_rgba(139,92,246,0.4)] hover:shadow-[0_0_45px_rgba(139,92,246,0.55)]"
            >
              Get started free
              <ArrowRight className="w-4 h-4" />
            </button>
            <span className="text-[12px] text-[#8A8F98]">No credit card required · Setup in 30 seconds</span>
          </div>
        ) : (
          <div className="max-w-sm mx-auto">
            <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-1 mb-5">
              <button
                type="button"
                onClick={() => { setMode('signin'); setAuthError(''); }}
                className={`flex-1 rounded-lg px-3 py-2 text-[12px] font-bold transition-all ${mode === 'signin' ? 'bg-white/10 text-[#EEEEEE]' : 'text-[#8A8F98] hover:text-[#EEEEEE]'}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setAuthError(''); }}
                className={`flex-1 rounded-lg px-3 py-2 text-[12px] font-bold transition-all ${mode === 'signup' ? 'bg-white/10 text-[#EEEEEE]' : 'text-[#8A8F98] hover:text-[#EEEEEE]'}`}
              >
                Sign up
              </button>
            </div>
            <p className="text-[12px] font-bold text-[#8A8F98] uppercase tracking-widest mb-4">
              {mode === 'signin' ? 'Open existing workspace' : 'Create restaurant workspace'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              {authError && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] font-semibold text-red-300">
                  {authError}
                </div>
              )}
              {mode === 'signup' && (
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Restaurant name (e.g. The Oak Room)"
                  autoFocus
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Work email"
                autoFocus={mode === 'signin'}
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
              />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signin' ? 'Password' : 'Create password (min 8 characters)'}
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
              />
              {mode === 'signup' && (
                <>
                  <input
                    type="text"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="City, State (e.g. New York, NY)"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                  />
                  <input
                    type="text"
                    value={cuisineType}
                    onChange={e => setCuisineType(e.target.value)}
                    placeholder="Cuisine type (e.g. Modern American)"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                  />
                  <input
                    type="text"
                    value={preferredSuppliers}
                    onChange={e => setPreferredSuppliers(e.target.value)}
                    placeholder="Preferred suppliers, comma separated"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                  />
                  <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min="0"
                  value={monthlyBudgetTarget}
                  onChange={e => setMonthlyBudgetTarget(e.target.value)}
                  placeholder="Monthly budget"
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                />
                <input
                  type="number"
                  min="0"
                  max="80"
                  value={savingsTargetPct}
                  onChange={e => setSavingsTargetPct(e.target.value)}
                  placeholder="Savings target"
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                />
                  </div>
                </>
              )}
              <button
                type="submit"
                disabled={!valid || loading}
                className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[14px] rounded-xl transition-all duration-200 shadow-[0_0_20px_rgba(139,92,246,0.3)] flex items-center justify-center gap-2"
              >
                {loading ? (mode === 'signin' ? 'Signing in…' : 'Setting up…') : (mode === 'signin' ? 'Sign in →' : 'Launch workspace →')}
              </button>
            </form>
            <p className="mt-4 text-center text-[11px] text-[#8A8F98]">
              {mode === 'signin' ? 'Sign in with your work email and password.' : 'Password is stored as a salted hash for this local workspace.'}
            </p>
          </div>
        )}

        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mt-14">
          {[
            'Menu parsing in 30 seconds',
            'CME / CBOT live futures',
            'LangGraph 5-node pipeline',
            'RAG procurement memory',
            'Inngest background jobs',
            'Row-level tenant isolation',
          ].map((feat, i) => (
            <span key={i} className="flex items-center gap-2 text-[12px] text-[#8A8F98]">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500/60 shrink-0" />
              {feat}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 mt-24 max-w-lg mx-auto border-t border-white/[0.06] pt-16">
          {[
            { value: 'Live', label: 'market-aware sourcing', color: 'text-emerald-400' },
            { value: 'AI',   label: 'agents in parallel', color: 'text-violet-400' },
            { value: 'Fast', label: 'menu to first quote', color: 'text-blue-400' },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <p className={`text-4xl font-black tracking-tighter ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-[#8A8F98] mt-2 font-medium leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Feature grid */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-28">
        <p className="text-center text-[11px] font-bold text-[#8A8F98] uppercase tracking-[0.2em] mb-8">How it works</p>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              icon: Brain,
              accent: 'violet',
              step: '01',
              title: 'AI Menu Parsing',
              desc: 'Paste any menu text or URL. Groq llama-3.3-70b extracts every dish, ingredient, and quantity with automatic model-fallback chain on rate-limit.',
            },
            {
              icon: TrendingUp,
              accent: 'blue',
              step: '02',
              title: 'Live Market Intelligence',
              desc: 'Real-time futures from CME, CBOT & ICE. ML regression forecasts 3-month price projections with anomaly spike alerts. Inngest refreshes pricing daily in the background.',
            },
            {
              icon: Zap,
              accent: 'emerald',
              step: '03',
              title: 'Autonomous Negotiation',
              desc: '5-node LangGraph pipeline — Orchestrator → Analyst → Negotiator → Vendor Sim → Auditor — runs fully autonomously. Tenant-isolated via row-level security.',
            },
          ].map((feat) => (
            <div key={feat.step} className={`linear-panel rounded-xl p-6 border transition-all duration-300 hover:bg-white/[0.03] ${
              feat.accent === 'violet'  ? 'border-violet-500/15 hover:border-violet-500/25' :
              feat.accent === 'blue'   ? 'border-blue-500/15 hover:border-blue-500/25' :
              'border-emerald-500/15 hover:border-emerald-500/25'
            }`}>
              <div className="flex items-center justify-between mb-5">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
                  feat.accent === 'violet'  ? 'bg-violet-500/10 border-violet-500/20' :
                  feat.accent === 'blue'   ? 'bg-blue-500/10 border-blue-500/20' :
                  'bg-emerald-500/10 border-emerald-500/20'
                }`}>
                  <feat.icon className={`w-4 h-4 ${
                    feat.accent === 'violet'  ? 'text-violet-400' :
                    feat.accent === 'blue'   ? 'text-blue-400' :
                    'text-emerald-400'
                  }`} />
                </div>
                <span className="text-[11px] font-black text-[#8A8F98]/40 tracking-widest">{feat.step}</span>
              </div>
              <h3 className="font-bold text-[15px] text-[#EEEEEE] mb-2 tracking-tight">{feat.title}</h3>
              <p className="text-[13px] text-[#8A8F98] leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <div className="inline-flex flex-col items-center gap-5 px-8 py-8 linear-panel rounded-2xl border border-white/[0.08]">
            <div className="flex -space-x-2">
              {['🎯','📊','🤝','🏪','✅'].map((emoji, i) => (
                <div key={i} className="w-9 h-9 rounded-full bg-black border border-white/10 flex items-center justify-center text-base shadow-lg">{emoji}</div>
              ))}
            </div>
            <div className="text-center">
              <p className="text-[15px] font-bold text-[#EEEEEE]">5 AI agents. Zero manual work.</p>
              <p className="text-[13px] text-[#8A8F98] mt-1">From paste-menu to negotiated contract in under 4 minutes.</p>
            </div>
            <button
              onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.06] border border-white/10 hover:bg-white/[0.09] hover:border-white/20 text-[13px] font-bold text-[#EEEEEE] rounded-lg transition-all"
            >
              Start for free <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.05]">
        <div className="max-w-5xl mx-auto px-6 pt-12 pb-8">
          {/* Brand row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="h-7 w-7 rounded-lg border border-violet-500/30 bg-violet-500/10 flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.2)]">
                  <ChefHat className="w-3.5 h-3.5 text-violet-300" />
                </div>
                <div>
                  <span className="font-bold text-[14px] text-[#EEEEEE] tracking-wide">AutoRFP</span>
                  <span className="ml-2 text-[10px] font-bold text-[#8A8F98] uppercase tracking-[0.12em]">Procurement AI</span>
                </div>
              </div>
              <p className="text-[12px] text-[#8A8F98] leading-relaxed max-w-sm">
                AI-powered restaurant ingredient procurement. Menu parsing, live CME pricing, and autonomous 5-agent negotiation.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {['LangGraph', 'Inngest', 'Groq', 'Ollama', 'Sentry'].map(tech => (
                <span key={tech} className="text-[10px] font-bold text-[#8A8F98]/70 bg-white/[0.03] border border-white/[0.07] px-2 py-0.5 rounded-md">
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[11px] text-[#8A8F98]/70 text-center sm:text-left">
              © 2026 AutoRFP · Built for restaurants that want to stop leaving money on the table.
            </p>
            <div className="flex items-center gap-5 text-[11px] text-[#8A8F98]/60">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                Local-first
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60" />
                Tenant-isolated RLS
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60" />
                Open-source stack
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
