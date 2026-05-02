'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from 'sonner';
import {
  ChefHat, LayoutDashboard, PlusCircle, Clock, Settings,
  Menu, X, LogOut, BrainCircuit, Command
} from 'lucide-react';
import { readAccount, saveAccount, ACCOUNT_KEY, type RestaurantAccount } from '@/lib/tenant';
import { PageSkeleton } from '@/components/Skeleton';
import CommandPalette from '@/components/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const NAV = [
  { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/procurement',  icon: PlusCircle,      label: 'New Procurement' },
  { href: '/intelligence', icon: BrainCircuit,    label: 'Intelligence' },
  { href: '/history',      icon: Clock,           label: 'History' },
  { href: '/settings',     icon: Settings,        label: 'Settings' },
];

function SidebarContent({
  account,
  pathname,
  onNav,
  onSignOut,
}: {
  account: RestaurantAccount;
  pathname: string;
  onNav: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex flex-col h-full bg-[#060606] border-r border-white/[0.06]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-[60px] border-b border-white/[0.06] shrink-0">
        <div className="h-7 w-7 rounded-lg border border-violet-500/30 bg-violet-500/10 flex items-center justify-center shadow-[0_0_14px_rgba(139,92,246,0.25)] shrink-0">
          <ChefHat className="w-3.5 h-3.5 text-violet-300" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-[13px] text-[#EEEEEE] tracking-wide leading-none">AutoRFP</div>
          <div className="text-[9px] font-bold text-[#8A8F98] uppercase tracking-[0.14em] mt-0.5">Procurement AI</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNav}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-150 ${
                active
                  ? 'sidebar-link-active text-[#EEEEEE]'
                  : 'text-[#8A8F98] hover:text-[#EEEEEE] hover:bg-white/[0.04]'
              }`}
            >
              <item.icon className={`w-4 h-4 shrink-0 transition-colors ${active ? 'text-violet-400' : 'text-[#8A8F98] group-hover:text-[#EEEEEE]'}`} />
              {item.label}
              {active && (
                <motion.div
                  layoutId="activeNav"
                  className="ml-auto w-1 h-4 rounded-full bg-violet-400"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ⌘K hint */}
      <div className="px-2.5 pb-3">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-[#8A8F98] hover:text-[#EEEEEE]"
        >
          <Command className="w-3 h-3 shrink-0" />
          <span className="text-[11px] font-medium flex-1 text-left">Search…</span>
          <kbd className="text-[9px] font-bold bg-white/[0.05] border border-white/10 rounded px-1 py-0.5">⌘K</kbd>
        </button>
      </div>

      {/* User section */}
      <div className="px-2.5 pb-4 pt-1 border-t border-white/[0.06] shrink-0 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-[11px] font-black text-violet-300 uppercase shrink-0">
            {account.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-[#EEEEEE] truncate">{account.name}</p>
            <p className="text-[10px] text-[#8A8F98] truncate">{account.cuisineType} · {account.location}</p>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-[#8A8F98] hover:text-red-400 hover:bg-red-500/5 transition-all duration-150"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

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
        const fallback = account ?? (allowLocalFallback ? readAccount() : null);
        if (!fallback) { router.replace('/'); return; }
        if (account) saveAccount(account);
        setAccount(fallback);
        setReady(true);
      })
      .catch(() => {
        const fallback = readAccount();
        if (!fallback) router.replace('/');
        else { setAccount(fallback); setReady(true); }
      });
  }, [router]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    localStorage.removeItem(ACCOUNT_KEY);
    router.push('/');
  };

  if (!ready || !account) {
    return <div className="min-h-screen bg-black"><PageSkeleton /></div>;
  }

  return (
    <div className="min-h-screen bg-black flex">
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
      <CommandPalette />

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col">
        <div className="fixed top-0 left-0 w-56 h-full z-40">
          <SidebarContent account={account} pathname={pathname} onNav={() => {}} onSignOut={handleSignOut} />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.div
              className="absolute top-0 left-0 w-64 h-full z-10"
              initial={{ x: -256 }}
              animate={{ x: 0 }}
              exit={{ x: -256 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            >
              <SidebarContent account={account} pathname={pathname} onNav={() => setMobileOpen(false)} onSignOut={handleSignOut} />
              <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 text-[#8A8F98] hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-white/[0.06] bg-[#060606] shrink-0 sticky top-0 z-30">
          <button onClick={() => setMobileOpen(true)} className="text-[#8A8F98] hover:text-white transition-colors p-1">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded border border-violet-500/30 bg-violet-500/10 flex items-center justify-center">
              <ChefHat className="w-3 h-3 text-violet-300" />
            </div>
            <span className="font-bold text-[13px] text-[#EEEEEE]">AutoRFP</span>
          </div>
          <span className="ml-auto text-[11px] font-semibold text-[#8A8F98]">{account.name}</span>
        </div>

        <motion.main
          key={pathname}
          className="flex-1 page-ambient"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </motion.main>

        {/* App footer */}
        <footer className="shrink-0 border-t border-white/[0.04] bg-[#060606]">
          <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-4 min-w-0">
            <div className="flex items-center gap-4 min-w-0">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#8A8F98]/50 uppercase tracking-wider shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/50" />
                AutoRFP Engine
              </span>
              <span className="hidden sm:flex items-center gap-2 text-[10px] text-[#8A8F98]/35 font-mono min-w-0 truncate">
                LangGraph · Inngest · Groq · Sentry
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#8A8F98]/35 shrink-0">
              <span className="hidden sm:inline">Tenant-scoped RLS</span>
              <span className="hidden sm:inline">·</span>
              <span>v0.1.0</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
