import Link from 'next/link';
import {
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';
import { ProductDecisionPreview } from './ProductDecisionPreview';

const proofPoints = [
  [`${restaurantSampleQuotes.length} supplier replies`, 'Labelled sample replies, not customer activity.'],
  [`${restaurantSampleRequest.items.length} items requested`, `Requested in sample ${restaurantSampleRequest.id}; coverage stays visible supplier by supplier.`],
  ['1 decision waiting', 'One sample decision is waiting; the product never chooses automatically.'],
  ['Human approval required', 'Product rule: the restaurant records the final choice.'],
];

const workflow = [
  ['Use suppliers you know', 'Start with the suppliers your restaurant already trusts and works with.'],
  ['Send one clear request', 'Share the same itemised need once; each supplier can answer with no supplier account.'],
  ['Compare the full quote', 'Review price, delivery, item coverage, GST, freight, and payment terms together.'],
  ['Reuse the saved record', 'Bring the ingredients, suppliers, quote changes, and decision forward next time.'],
];

export function PublicLandingPage() {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader home />
      <main id="main-content">
        <section className="public-hero public-container">
          <div className="public-hero__copy public-reveal">
            <p className="public-eyebrow">Restaurant buying, made accountable</p>
            <h1>Compare every quote.<br /><em>Choose with proof.</em></h1>
            <p className="public-hero__lede">Send one ingredient list to approved suppliers. Compare prices, delivery, missing items, GST, freight, and payment terms before you choose.</p>
            <div className="public-hero__actions">
              <Link className="public-button" href="/product">See the product <span aria-hidden="true">→</span></Link>
              <Link className="public-inline-link" href="/start">Start a pilot <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="public-hero__note">Controlled free pilot for approved restaurant workspaces. No marketplace or supplier commission. No card required.</p>
          </div>
          <ProductDecisionPreview />
        </section>

        <section className="proof-band" aria-label="Sample decision facts">
          <div className="public-container proof-band__grid">
            {proofPoints.map(([title, detail]) => (
              <div key={title}><strong>{title}</strong><span>{detail}</span></div>
            ))}
          </div>
        </section>

        <section className="workflow public-container" id="how-it-works" aria-labelledby="workflow-title">
          <header className="section-heading">
            <p className="public-eyebrow">A record that compounds</p>
            <h2 id="workflow-title">Useful for this order.<br />More useful for the next.</h2>
            <p>Run the request again with saved ingredients and suppliers. The saved history keeps the next comparison grounded in what your team asked, received, and chose before.</p>
          </header>
          <ol className="workflow__list">
            {workflow.map(([title, detail], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><p>{detail}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="security-section" id="security" aria-labelledby="security-title">
          <div className="public-container security-section__grid">
            <div>
              <p className="public-eyebrow public-eyebrow--light">Clear boundaries</p>
              <h2 id="security-title">Commercial records deserve plain security.</h2>
            </div>
            <div className="security-section__points">
              <article><span>01</span><div><h3>Your restaurant records stay private</h3><p>Your recipes, menus, supplier prices, and purchase records stay private to your restaurant. Other restaurants cannot see them, and suppliers see only the request you send to them.</p></div></article>
              <article><span>02</span><div><h3>Private supplier links expire</h3><p>Each supplier sees only the request shared with them, and the restaurant can revoke or replace that link.</p></div></article>
              <article><span>03</span><div><h3>Your team makes the final choice</h3><p>Quote changes and decisions stay recorded so the restaurant can review what changed and who chose.</p></div></article>
            </div>
          </div>
        </section>

        <section className="public-cta public-container" aria-labelledby="pilot-title">
          <div>
            <p className="public-eyebrow">Controlled pilot</p>
            <h2 id="pilot-title">Bring one real request.<br />See the entire decision.</h2>
          </div>
          <div>
            <p>The controlled free pilot is limited to up to twenty approved restaurant workspaces. An approved Google account is required. No card is needed.</p>
            <Link className="public-button" href="/start">Start a pilot <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
