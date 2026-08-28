import Link from 'next/link';
import { brand } from '@/config/brand';
import { BrandMark } from '@/components/brand/BrandMark';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';
import { SampleQuoteComparison } from './SampleQuoteComparison';

const proofPoints = [
  ['INR + GST', 'Commercial inputs stay visible line by line.'],
  ['Expiring links', 'Each supplier receives its own request link.'],
  ['No supplier account', 'Suppliers can answer from a focused mobile form.'],
  ['Human awards', 'Your team makes and records the final decision.'],
];

const workflow = [
  ['Review demand', 'Turn the menu into quantities your team can check before outreach.'],
  ['Issue the request', 'Choose suppliers and share one consistent, itemised brief.'],
  ['Collect quotes', 'Capture rates, GST, freight, delivery, coverage, and terms.'],
  ['Award with context', 'Compare the same facts and record the whole or split decision.'],
];

export function PublicLandingPage() {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader home />
      <main id="main-content">
        <section className="public-hero public-container">
          <div className="public-hero__copy public-reveal">
            <p className="public-eyebrow">For restaurant procurement teams in India</p>
            <h1>Every supplier quote.<br /><em>One accountable decision.</em></h1>
            <p className="public-hero__lede">{brand.productName} keeps ingredient requests, supplier responses, landed costs, and award decisions in one factual record.</p>
            <div className="public-hero__actions">
              <Link className="public-button" href="/product">See the product <span aria-hidden="true">→</span></Link>
              <Link className="public-inline-link" href="/start">Start a pilot <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="public-hero__note">Built around your existing suppliers. No marketplace or paid messaging service required.</p>
          </div>
          <div className="public-hero__mark" aria-hidden="true">
            <span>Request</span>
            <BrandMark decorative tone="duotone" />
            <span>Decision</span>
          </div>
        </section>

        <section className="public-preview public-container public-reveal public-reveal--delay">
          <SampleQuoteComparison />
        </section>

        <section className="proof-band" aria-label="Product facts">
          <div className="public-container proof-band__grid">
            {proofPoints.map(([title, detail]) => (
              <div key={title}><strong>{title}</strong><span>{detail}</span></div>
            ))}
          </div>
        </section>

        <section className="workflow public-container" id="how-it-works" aria-labelledby="workflow-title">
          <header className="section-heading">
            <p className="public-eyebrow">One commercial thread</p>
            <h2 id="workflow-title">From reviewed demand<br />to a recorded award.</h2>
            <p>Restaurant teams control the request and the decision. Suppliers only see and answer the request shared with them.</p>
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
              <article><span>01</span><div><h3>Tenant isolation</h3><p>Workspace records are separated at the database boundary, not only hidden in the interface.</p></div></article>
              <article><span>02</span><div><h3>Expiring supplier links</h3><p>Supplier-specific links can expire, be revoked, and be replaced without exposing another supplier&apos;s response.</p></div></article>
              <article><span>03</span><div><h3>Audit history</h3><p>Commercial actions retain a compact factual trail so the team can see what changed and who decided.</p></div></article>
            </div>
          </div>
        </section>

        <section className="public-cta public-container" aria-labelledby="pilot-title">
          <div>
            <p className="public-eyebrow">Controlled pilot</p>
            <h2 id="pilot-title">Bring one real request.<br />See the entire decision.</h2>
          </div>
          <div>
            <p>Start with a restaurant workspace, your supplier list, and a reviewed ingredient requirement.</p>
            <Link className="public-button" href="/start">Start a pilot <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
