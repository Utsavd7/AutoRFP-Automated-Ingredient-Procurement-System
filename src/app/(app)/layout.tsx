'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from 'sonner';
import {
  ChefHat, LayoutDashboard, PlusCircle, Clock, Settings,
  Menu, X, BrainCircuit, Command
} from 'lucide-react';
import type { RestaurantAccount } from '@/lib/tenant';
import { PageSkeleton } from '@/components/Skeleton';
import CommandPalette from '@/components/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { createSignInRedirect } from '@/lib/auth/callback-url';

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
}: {
  account: RestaurantAccount;
  pathname: string;
  onNav: () => void;
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
          <div className="text-[9px] font-bold text-[#8A8F98] uppercase tracking-[0.14em] mt-0.5">Launch workspace</div>
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
          onClick={() => {
            onNav();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
          }}
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
        <SignOutButton
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-[#8A8F98] hover:text-red-400 hover:bg-red-500/5 transition-all duration-150"
        />
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
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [accountRetry, setAccountRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const redirectToSignIn = () => {
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(createSignInRedirect(currentLocation));
    };

    fetch('/api/account', { cache: 'no-store' })
      .then(async res => {
        if (res.status === 401) {
          redirectToSignIn();
          return null;
        }
        if (!res.ok) throw new Error('Account request failed');
        const data = await res.json() as { account?: RestaurantAccount };
        if (!data.account) throw new Error('Account response was incomplete');
        return data.account;
      })
      .then(account => {
        if (!active || !account) return;
        setAccount(account);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setReady(false);
        setAccountUnavailable(true);
      });

    return () => {
      active = false;
    };
  }, [accountRetry, router]);

  if (accountUnavailable) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center px-5">
        <section
          className="w-full max-w-md rounded-xl border border-white/10 bg-[#0A0A0A] p-6 text-[#EEEEEE] shadow-2xl"
          role="alert"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">
            Workspace connection
          </p>
          <h1 className="mt-2 text-xl font-bold">Workspace is temporarily unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-[#A5A5A5]">
            Your session is still active. We could not load the restaurant account right now.
          </p>
          <button
            className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-[#E5E5E5]"
            onClick={() => {
              setAccountUnavailable(false);
              setAccountRetry(value => value + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

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
          <SidebarContent account={account} pathname={pathname} onNav={() => {}} />
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
              <SidebarContent account={account} pathname={pathname} onNav={() => setMobileOpen(false)} />
              <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 text-[#8A8F98] hover:text-white transition-colors">
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
          <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="text-[#8A8F98] hover:text-white transition-colors p-1">
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
                AutoRFP
              </span>
              <span className="hidden sm:flex items-center gap-2 text-[10px] text-[#8A8F98]/35 font-mono min-w-0 truncate">
                Launch workflow in progress
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#8A8F98]/35 shrink-0">
              <span>v0.1.0</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
