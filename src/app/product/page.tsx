import type { Metadata } from 'next';
import Link from 'next/link';
import { brand } from '@/config/brand';
import { ProductTour } from '@/components/public/ProductTour';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicFooter } from '@/components/public/PublicFooter';

export const metadata: Metadata = {
  title: 'Product',
  description: 'Follow a sample ingredient request from reviewed demand through supplier response, factual comparison, and a human award.',
};

export default function ProductPage() {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader />
      <main id="main-content">
        <section className="product-hero public-container">
          <p className="public-eyebrow">Guided product tour · Sample data throughout</p>
          <h1>A clean path from<br /><em>request to award.</em></h1>
          <div className="product-hero__intro">
            <p>{brand.productName} gives restaurant teams one structured commercial record while keeping the supplier response simple.</p>
            <span>Scroll through one sample request ↓</span>
          </div>
        </section>
        <ProductTour />
        <section className="product-principles public-container" aria-labelledby="principles-title">
          <header>
            <p className="public-eyebrow">Product boundaries</p>
            <h2 id="principles-title">Facts in. A person decides.</h2>
          </header>
          <dl>
            <div><dt>No hidden recommendation</dt><dd>Totals and commercial differences are shown; your team chooses.</dd></div>
            <div><dt>No supplier onboarding</dt><dd>A supplier answers the specific request shared through its link.</dd></div>
            <div><dt>No rewritten history</dt><dd>Issued requests, submitted quote revisions, and awards remain factual records.</dd></div>
          </dl>
        </section>
        <section className="public-cta public-container" aria-labelledby="tour-pilot-title">
          <div><p className="public-eyebrow">Your request, next</p><h2 id="tour-pilot-title">Ready to test the workflow?</h2></div>
          <div><p>Use a real ingredient list and your existing suppliers in a controlled pilot.</p><Link className="public-button" href="/start">Start a pilot <span aria-hidden="true">→</span></Link></div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
