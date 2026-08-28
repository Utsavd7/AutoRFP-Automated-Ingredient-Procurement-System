'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import {
  ChefHat, ArrowRight, CheckCircle, ClipboardCheck,
  Link2, Scale
} from 'lucide-react';
import {
  beginGoogleAuthentication,
  loadGoogleProviderAvailability,
} from '@/lib/auth/google-client';
import { toastApiError } from '@/lib/toast';

export default function LandingPage() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pin, setPin] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    fetch('/api/account')
      .then(async res => {
        if (!res.ok) return false;
        const data = await res.json() as { account?: unknown };
        return Boolean(data.account);
      })
      .then(authenticated => {
        if (authenticated) {
          router.replace('/dashboard');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  useEffect(() => {
    let active = true;
    loadGoogleProviderAvailability(fetch).then(available => {
      if (active) setGoogleAvailable(available);
    });
    return () => {
      active = false;
    };
  }, []);

  const valid = mode === 'signin'
    ? email.includes('@') && password.length >= 8
    : name.trim() && ownerName.trim() && email.includes('@') &&
      password.length >= 8 && addressLine.trim() && city.trim() &&
      state.trim() && /^\d{6}$/.test(pin) && phone.trim();

  const googleSignupValid = name.trim() && ownerName.trim() &&
    email.includes('@') && addressLine.trim() && city.trim() &&
    state.trim() && /^\d{6}$/.test(pin) && phone.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setAuthError('');
    try {
      if (mode === 'signup') {
        const startRes = await fetch('/api/auth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'email',
            restaurantName: name,
            ownerName,
            email,
            password,
            addressLine,
            city,
            state,
            pin,
            phone,
            timezone: 'Asia/Kolkata',
            gstin: '',
          }),
        });
        if (!startRes.ok) {
          const data = await startRes.json().catch(() => ({}));
          throw new Error(data.error || 'Unable to create restaurant workspace.');
        }
      }
      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
      });
      if (result?.error) throw new Error(
        result.error === 'CredentialsSignin'
          ? (mode === 'signin' ? 'Email or password is incorrect.' : 'Unable to create workspace. Check the database connection and try again.')
          : result.error
      );
      const accountRes = await fetch('/api/account');
      if (!accountRes.ok) throw new Error('Unable to load restaurant workspace.');
      router.push('/dashboard');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to create restaurant session.';
      setAuthError(message);
      toastApiError(error, mode === 'signin' ? 'Sign in failed' : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!googleAvailable || (mode === 'signup' && !googleSignupValid)) return;
    setLoading(true);
    setAuthError('');
    try {
      await beginGoogleAuthentication(
        mode === 'signin'
          ? { mode: 'signin' }
          : {
              mode: 'signup',
              signup: {
                restaurantName: name,
                ownerName,
                email,
                addressLine,
                city,
                state,
                pin,
                phone,
                timezone: 'Asia/Kolkata',
                gstin: '',
              },
            },
        {
          fetcher: fetch,
          googleSignIn: provider => signIn(provider),
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Unable to continue with Google.';
      setAuthError(message);
      toastApiError(error, mode === 'signin' ? 'Sign in failed' : 'Sign up failed');
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
            <span className="ml-2 text-[10px] font-bold text-[#8A8F98] uppercase tracking-[0.12em]">Restaurant procurement</span>
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
          Launch workflow · Owner review required
        </div>

        <h1 className="text-[52px] md:text-[72px] font-black tracking-tight leading-[0.92] mb-7">
          <span className="gradient-text">Prepare your menu</span>
          <br />
          <span className="text-white">for a clear</span>
          <br />
          <span className="gradient-text">procurement workflow.</span>
        </h1>

        <p className="text-[17px] text-[#8A8F98] leading-relaxed max-w-2xl mx-auto mb-12">
          Today, AutoRFP saves a deterministic menu draft for owner review. The
          launch workflow will move reviewed menus into supplier links, comparable quotes, and a recorded award as each step becomes available.
        </p>

        {!showForm ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => { setMode('signup'); setShowForm(true); setAuthError(''); }}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-[14px] rounded-xl transition-all duration-200 shadow-[0_0_30px_rgba(139,92,246,0.4)] hover:shadow-[0_0_45px_rgba(139,92,246,0.55)]"
            >
              Create workspace
              <ArrowRight className="w-4 h-4" />
            </button>
            <span className="text-[12px] text-[#8A8F98]">Start with a reviewable menu draft</span>
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
                <>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Restaurant name"
                    autoFocus
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                  />
                  <input
                    type="text"
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                  />
                </>
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
                placeholder={mode === 'signin' ? 'Password' : (googleAvailable ? 'Password for email signup (min 8 characters)' : 'Create password (min 8 characters)')}
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
              />
              {mode === 'signup' && (
                <>
                  <input
                    type="text"
                    value={addressLine}
                    onChange={e => setAddressLine(e.target.value)}
                    placeholder="Street address"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      placeholder="City"
                      className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                    />
                    <input
                      type="text"
                      value={state}
                      onChange={e => setState(e.target.value)}
                      placeholder="State"
                      className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pin}
                      onChange={e => setPin(e.target.value)}
                      placeholder="6-digit PIN"
                      className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                    />
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="Phone"
                      className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/40 transition-all"
                    />
                  </div>
                </>
              )}
              {googleAvailable && (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading || (mode === 'signup' && !googleSignupValid)}
                  className="w-full py-3.5 bg-white hover:bg-[#EEEEEE] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-[14px] rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {loading ? 'Opening Google…' : (mode === 'signin' ? 'Continue with Google' : 'Create workspace with Google')}
                </button>
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
              {mode === 'signin' ? 'Sign in with your work email and password.' : 'Create credentials for this restaurant workspace.'}
            </p>
          </div>
        )}

        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mt-14">
          {[
            'Available now · Save a deterministic menu draft',
            'Available now · Review the saved dish list',
            'Upcoming · Send secure supplier links',
            'Upcoming · Collect comparable quotes',
            'Upcoming · Record an award decision',
          ].map((feat, i) => (
            <span key={i} className="flex items-center gap-2 text-[12px] text-[#8A8F98]">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500/60 shrink-0" />
              {feat}
            </span>
          ))}
        </div>

      </main>

      {/* Feature grid */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-28">
        <p className="text-center text-[11px] font-bold text-[#8A8F98] uppercase tracking-[0.2em] mb-8">How it works</p>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              icon: ClipboardCheck,
              accent: 'violet',
              step: '01',
              title: 'Menu draft and review · Available now',
              desc: 'Paste one dish per line. AutoRFP saves the source text and a deterministic dish list for owner review before any supplier outreach.',
            },
            {
              icon: Link2,
              accent: 'blue',
              step: '02',
              title: 'Supplier quote links · Upcoming',
              desc: 'A reviewed request will be shared through secure supplier links so structured quotes can be collected against the same items.',
            },
            {
              icon: Scale,
              accent: 'emerald',
              step: '03',
              title: 'Compare and award · Upcoming',
              desc: 'Comparable supplier quotes will support an owner-reviewed selection and a recorded award decision.',
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
              <p className="text-[15px] font-bold text-[#EEEEEE]">Start with a reviewable menu draft.</p>
              <p className="text-[13px] text-[#8A8F98] mt-1">Supplier links, quote comparison, and awards are upcoming launch steps.</p>
            </div>
            <button
              onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.06] border border-white/10 hover:bg-white/[0.09] hover:border-white/20 text-[13px] font-bold text-[#EEEEEE] rounded-lg transition-all"
            >
              Create workspace <ArrowRight className="w-3.5 h-3.5" />
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
                  <span className="ml-2 text-[10px] font-bold text-[#8A8F98] uppercase tracking-[0.12em]">Restaurant procurement</span>
                </div>
              </div>
              <p className="text-[12px] text-[#8A8F98] leading-relaxed max-w-sm">
                A review-first launch workflow for restaurant ingredient procurement.
              </p>
            </div>
            <p className="text-[11px] text-[#8A8F98]/70">Menu drafts available · Remaining workflow upcoming</p>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[11px] text-[#8A8F98]/70 text-center sm:text-left">
              © 2026 AutoRFP · Launch workflow in progress.
            </p>
            <div className="flex items-center gap-5 text-[11px] text-[#8A8F98]/60">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                Menu drafts available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60" />
                Supplier workflow upcoming
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
