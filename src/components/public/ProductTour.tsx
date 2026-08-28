import { SampleQuoteComparison } from './SampleQuoteComparison';

const requestItems = [
  ['Tomato, red', '38', 'kg'],
  ['Onion, red', '24', 'kg'],
  ['Paneer', '16', 'kg'],
  ['Coriander', '3', 'kg'],
];

export function ProductTour() {
  return (
    <div className="product-tour">
      <section className="tour-step" aria-labelledby="tour-request-title">
        <div className="tour-step__copy">
          <span className="tour-index">01 / Request</span>
          <h2 id="tour-request-title">Issue one reviewed list.</h2>
          <p>Choose reviewed ingredients, quantities, delivery details, and suppliers. Opening the request preserves the commercial record.</p>
        </div>
        <article className="tour-record" aria-label="Sample request">
          <header>
            <div><span>Sample request</span><strong>QP-1042</strong></div>
            <span className="record-state">Ready for review</span>
          </header>
          <div className="tour-record__meta"><span>Weekly produce</span><span>Delivery · 12 Sep 2026</span></div>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead>
            <tbody>{requestItems.map(([item, quantity, unit]) => <tr key={item}><td>{item}</td><td>{quantity}</td><td>{unit}</td></tr>)}</tbody>
          </table>
          <footer>4 of 8 shown · 3 selected suppliers</footer>
        </article>
      </section>

      <section className="tour-step tour-step--reverse" aria-labelledby="tour-supplier-title">
        <div className="tour-step__copy">
          <span className="tour-index">02 / Supplier response</span>
          <h2 id="tour-supplier-title">Make the response easy to complete.</h2>
          <p>Each supplier receives an expiring link to a focused mobile form. There is no supplier account to create and no separate spreadsheet to reconcile.</p>
        </div>
        <article className="supplier-sheet" aria-label="Sample supplier view">
          <header><span>Sample supplier view</span><strong>Quote for QP-1042</strong></header>
          <div className="supplier-line"><div><strong>Tomato, red</strong><span>38 kg requested</span></div><span>₹42.00 / kg</span></div>
          <div className="supplier-line"><div><strong>Onion, red</strong><span>24 kg requested</span></div><span>₹36.50 / kg</span></div>
          <div className="supplier-fields"><span>GST captured</span><span>Freight captured</span><span>Delivery confirmed</span></div>
          <footer>
            <span className="supplier-total__meta">Calculated total · all 8 items · 2 of 8 shown</span>
            <strong className="supplier-total__amount">₹31,460.00</strong>
          </footer>
        </article>
      </section>

      <section className="tour-step tour-step--comparison" aria-labelledby="tour-comparison-title">
        <div className="tour-step__copy">
          <span className="tour-index">03 / Compare and award</span>
          <h2 id="tour-comparison-title">Keep the decision accountable.</h2>
          <p>Compare landed total, GST, delivery, coverage, and terms side by side. A person records the whole-basket or split award.</p>
        </div>
        <div aria-label="Sample comparison">
          <SampleQuoteComparison compact />
        </div>
      </section>
    </div>
  );
}
