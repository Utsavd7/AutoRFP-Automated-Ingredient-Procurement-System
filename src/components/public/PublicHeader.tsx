import Link from 'next/link';
import { Wordmark } from '@/components/brand/Wordmark';

type PublicHeaderProps = {
  home?: boolean;
  sticky?: boolean;
};

export function PublicHeader({ home = false, sticky = false }: PublicHeaderProps) {
  return (
    <header className={`public-header${sticky ? ' public-header--sticky' : ''}`}>
      <div className="public-container public-header__inner">
        <Link className="public-brand-link" href="/" aria-label="Home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary navigation" className="public-nav">
          <Link href="/product">Product</Link>
          <Link href={home ? '#how-it-works' : '/#how-it-works'}>How it works</Link>
          <Link href={home ? '#security' : '/#security'}>Security</Link>
        </nav>
        <div className="public-header__actions">
          <Link className="public-text-action" href="/signin">Sign in</Link>
          <Link className="public-button public-button--small" href="/start">Start a pilot</Link>
        </div>
      </div>
    </header>
  );
}
