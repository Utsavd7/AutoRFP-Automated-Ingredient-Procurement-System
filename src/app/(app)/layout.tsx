'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import {
  ChefHat, LayoutDashboard, PlusCircle, Clock, Settings,
  Menu, X, LogOut, ChevronRight, BrainCircuit
} from 'lucide-react';
import { readAccount, ACCOUNT_KEY, type RestaurantAccount } from '@/lib/tenant';
import { PageSkeleton } from '@/components/Skeleton';

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
    <div className="flex flex-col h-full bg-[#080808] border-r border-white/[0.06]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-[60px] border-b border-white/[0.06] shrink-0">
        <div className="h-7 w-7 rounded-lg border border-violet-500/30 bg-violet-500/10 flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.2)] shrink-0">
          <ChefHat className="w-3.5 h-3.5 text-violet-300" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-[13px] text-[#EEEEEE] tracking-wide leading-none">AutoRFP</div>
          <div className="text-[9px] font-bold text-[#8A8F98] uppercase tracking-[0.14em] mt-0.5">Procurement AI</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-5 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNav}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-150 ${
                active
                  ? 'sidebar-link-active text-[#EEEEEE]'
                  : 'text-[#8A8F98] hover:text-[#EEEEEE] hover:bg-white/[0.04]'
              }`}
            >
              <item.icon className={`w-4 h-4 shrink-0 transition-colors ${active ? 'text-violet-400' : 'text-[#8A8F98]'}`} />
              {item.label}
              {active && <ChevronRight className="w-3 h-3 ml-auto text-[#8A8F98]/50" />}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="px-2.5 pb-4 pt-3 border-t border-white/[0.06] shrink-0 space-y-1">
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
    const saved = readAccount();
    if (!saved) {
      router.replace('/');
      return;
    }
    setAccount(saved);
    setReady(true);
  }, [router]);

  // Close mobile sidebar on route change
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
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col">
        <div className="fixed top-0 left-0 w-56 h-full z-40">
          <SidebarContent
            account={account}
            pathname={pathname}
            onNav={() => {}}
            onSignOut={handleSignOut}
          />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute top-0 left-0 w-64 h-full z-10">
            <SidebarContent
              account={account}
              pathname={pathname}
              onNav={() => setMobileOpen(false)}
              onSignOut={handleSignOut}
            />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-[#8A8F98] hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-white/[0.06] bg-[#080808] shrink-0 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-[#8A8F98] hover:text-white transition-colors p-1"
          >
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

        <main className="flex-1 page-ambient">
          {children}
        </main>
      </div>
    </div>
  );
}
