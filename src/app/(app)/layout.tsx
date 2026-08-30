'use client';

import {
  BarChart3,
  BookOpen,
  ClipboardList,
  History,
  LayoutDashboard,
  Menu,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { PageSkeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { createSignInRedirect } from '@/lib/auth/callback-url';
import type { RestaurantAccount } from '@/lib/tenant';

import styles from './app-shell.module.css';

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { href: '/procurement', icon: ClipboardList, label: 'Procurement' },
  { href: '/menus', icon: BookOpen, label: 'Menus' },
  { href: '/suppliers', icon: Users, label: 'Suppliers' },
  { href: '/insights', icon: BarChart3, label: 'Insights' },
  { href: '/history', icon: History, label: 'History' },
  { href: '/settings', icon: Settings, label: 'Settings' },
] as const;

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
    <div className={styles.sidebarContent}>
      <Link className={styles.brand} href="/dashboard" aria-label="QuotePlate home" onClick={onNav}>
        <Wordmark />
      </Link>

      <Link className={styles.newRequest} href="/procurement/new" onClick={onNav}>
        <Plus aria-hidden="true" /> New request
      </Link>

      <nav className={styles.nav} aria-label="Workspace navigation">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={active ? styles.navActive : styles.navLink}
              href={item.href}
              key={item.href}
              onClick={onNav}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.account}>
        <span className={styles.accountInitial}>{account.name.charAt(0).toUpperCase()}</span>
        <span className={styles.accountName}>
          <strong>{account.name}</strong>
          <small>{[account.city, account.state].filter(Boolean).join(', ') || account.addressLine}</small>
        </span>
      </div>
      <SignOutButton className={styles.signOut} />
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
  const closeNavigation = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    const redirectToSignIn = () => {
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(createSignInRedirect(currentLocation));
    };

    fetch('/api/account', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToSignIn();
          return null;
        }
        if (!response.ok) throw new Error('Account request failed');
        const data = (await response.json()) as { account?: RestaurantAccount };
        if (!data.account) throw new Error('Account response was incomplete');
        return data.account;
      })
      .then((loadedAccount) => {
        if (!active || !loadedAccount) return;
        setAccount(loadedAccount);
        setAccountUnavailable(false);
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

  useEffect(() => {
    if (!mobileOpen) return;
    closeNavigation.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  if (accountUnavailable) {
    return (
      <main className={styles.connectionPage}>
        <section className={styles.connectionCard} role="alert">
          <p>Workspace connection</p>
          <h1>Workspace is temporarily unavailable</h1>
          <span>Your session is still active. We could not load the restaurant account right now.</span>
          <button
            onClick={() => {
              setAccountUnavailable(false);
              setAccountRetry((value) => value + 1);
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
    return <div className={styles.loadingPage}><PageSkeleton /></div>;
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.desktopSidebar}>
        <SidebarContent account={account} pathname={pathname} onNav={() => {}} />
      </aside>

      {mobileOpen && (
        <div className={styles.mobileOverlay} role="dialog" aria-modal="true" aria-label="Workspace navigation">
          <button className={styles.mobileScrim} aria-label="Close navigation" onClick={() => setMobileOpen(false)} type="button" />
          <aside className={styles.mobileSidebar}>
            <SidebarContent account={account} pathname={pathname} onNav={() => setMobileOpen(false)} />
            <button
              aria-label="Close navigation"
              className={styles.mobileClose}
              onClick={() => setMobileOpen(false)}
              ref={closeNavigation}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </aside>
        </div>
      )}

      <div className={styles.workspace}>
        <header className={styles.mobileHeader}>
          <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} type="button">
            <Menu aria-hidden="true" />
          </button>
          <Link href="/dashboard" aria-label="QuotePlate home"><Wordmark /></Link>
          <span>{account.name}</span>
        </header>

        <ErrorBoundary>
          <div className={styles.content}>{children}</div>
        </ErrorBoundary>

        <footer className={styles.footer}>
          <span>QuotePlate</span>
          <span>Every quote, accountable.</span>
        </footer>
      </div>
    </div>
  );
}
