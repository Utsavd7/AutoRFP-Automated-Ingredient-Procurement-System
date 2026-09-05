import Link from 'next/link';
import {
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';
import { JourneyIcon } from './JourneyIcon';
import { LandingJourney } from './LandingJourney';
import { ProductDemoVideo } from './ProductDemoVideo';

const proofPoints = [
  [`${restaurantSampleQuotes.length} supplier replies`, 'Labelled sample replies, not customer activity.'],
  [`${restaurantSampleRequest.items.length} items requested`, `Requested in sample ${restaurantSampleRequest.id}; coverage stays visible supplier by supplier.`],
  ['1 decision waiting', 'One sample decision is waiting; the product never chooses automatically.'],
  ['Human approval required', 'Product rule: the restaurant records the final choice.'],
];

const restaurantBenefits = [
  {
    icon: 'list' as const,
    title: 'Buy faster each week',
    detail: 'Reuse checked menus and past requests instead of rebuilding the same list.',
  },
  {
    icon: 'price' as const,
    title: 'Compare the full cost',
    detail: 'See item prices, GST, freight, delivery and missing items together before you choose.',
  },
  {
    icon: 'approve' as const,
    title: 'Check every delivery',
    detail: 'Record what arrived as agreed, or note late, missing, wrong or poor quality items.',
  },
  {
    icon: 'receipt' as const,
    title: 'Catch invoice differences',
    detail: 'Enter the invoice total and see any difference from the accepted supplier total.',
  },
  {
    icon: 'history' as const,
    title: 'Remember supplier performance',
    detail: 'Keep delivery and buying history visible to your restaurant team.',
  },
  {
    icon: 'suppliers' as const,
    title: 'Repeat regular orders',
    detail: 'Copy a completed purchase into a new draft and ask suppliers for fresh prices.',
  },
];

export function PublicLandingPage() {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader home sticky />
      <main id="main-content">
        <section className="public-hero public-container">
          <div className="public-hero__copy public-reveal">
            <p className="public-eyebrow">Restaurant buying, made clear</p>
            <h1>
              Send one list.<br />
              Compare every supplier.<br />
              <em>Choose the best deal.</em>
            </h1>
            <p className="public-hero__lede">
              Use suppliers you already know and compare prices, GST, freight, delivery, missing
              items, and payment terms before your restaurant chooses.
            </p>
            <div className="public-hero__actions">
              <Link className="public-button" href="/product">See the product <span aria-hidden="true">→</span></Link>
              <a className="public-inline-link" href="#watch-demo">Watch the demo <span aria-hidden="true">↓</span></a>
              <Link className="public-inline-link" href="/start">Start free pilot <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="public-hero__note">No supplier commission. No card required.</p>
          </div>
          <div className="hero-route" role="group" aria-label="QuotePlate buying journey">
            <div>
              <JourneyIcon name="receipt" />
              <span>Menu</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true">→</span>
            <div>
              <JourneyIcon name="list" />
              <span>Request</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true">→</span>
            <div>
              <JourneyIcon name="price" />
              <span>Supplier prices</span>
            </div>
            <span className="hero-route__connector" aria-hidden="true">→</span>
            <div>
              <JourneyIcon name="approve" />
              <span>Your choice</span>
            </div>
          </div>
        </section>

        <section className="proof-band" aria-label="Sample decision facts">
          <div className="public-container proof-band__grid">
            {proofPoints.map(([title, detail]) => (
              <div key={title}><strong>{title}</strong><span>{detail}</span></div>
            ))}
          </div>
        </section>

        <ProductDemoVideo />

        <LandingJourney />

        <section className="restaurant-benefits" aria-labelledby="restaurant-benefits-title">
          <div className="public-container">
            <header className="restaurant-benefits__header">
              <p className="public-eyebrow">Why restaurants keep using it</p>
              <h2 id="restaurant-benefits-title">Useful for every purchase, not just the first one.</h2>
              <p>QuotePlate helps your team before, during and after each supplier order.</p>
            </header>
            <div className="restaurant-benefits__grid">
              {restaurantBenefits.map((benefit, index) => (
                <article className="restaurant-benefit" key={benefit.title}>
                  <span className="restaurant-benefit__number">{String(index + 1).padStart(2, '0')}</span>
                  <JourneyIcon name={benefit.icon} />
                  <h3>{benefit.title}</h3>
                  <p>{benefit.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="privacy-story" id="security" aria-labelledby="privacy-story-title">
          <div className="public-container privacy-story__grid">
            <header>
              <JourneyIcon name="privacy" />
              <p className="public-eyebrow">Clear boundaries</p>
              <h2 id="privacy-story-title">Your recipes stay private with your restaurant.</h2>
              <p>
                Your recipes, menus, supplier prices, and purchase records stay private to your
                restaurant. Other restaurants cannot see them, and suppliers see only the request
                you send to them.
              </p>
            </header>
            <div>
              <dl className="privacy-map">
                <div>
                  <dt>Your restaurant team</dt>
                  <dd>Menus, recipes, suppliers, quotes and buying history</dd>
                </div>
                <div>
                  <dt>Each supplier</dt>
                  <dd>Only the request sent to them</dd>
                </div>
                <div>
                  <dt>Other restaurants</dt>
                  <dd>Cannot see your information</dd>
                </div>
              </dl>
              <p className="privacy-story__note">
                Private supplier links expire. Quote changes and decisions stay recorded for your
                restaurant team.
              </p>
            </div>
          </div>
        </section>

        <section className="public-cta public-container" aria-labelledby="pilot-title">
          <div>
            <p className="public-eyebrow">Start with one purchase</p>
            <h2 id="pilot-title">Try QuotePlate with one real purchase.</h2>
          </div>
          <div>
            <p>
              Start with one ingredient request and your current suppliers. The pilot needs no
              payment card.
            </p>
            <div className="public-hero__actions">
              <Link className="public-button" href="/start">Start free pilot <span aria-hidden="true">→</span></Link>
              <Link className="public-inline-link" href="/product">See the product <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
