import { SampleQuoteComparison } from './SampleQuoteComparison';
import {
  formatSampleInr,
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';

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
            <div><span>Sample request</span><strong>{restaurantSampleRequest.id}</strong></div>
            <span className="record-state">Ready for review</span>
          </header>
          <div className="tour-record__meta"><span>Sample restaurant · {restaurantSampleRequest.context}</span><span>Delivery · {restaurantSampleRequest.delivery}</span></div>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead>
            <tbody>{restaurantSampleRequest.items.slice(0, 4).map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.quantity}</td><td>{item.unit}</td></tr>)}</tbody>
          </table>
          <footer>4 of {restaurantSampleRequest.items.length} shown · {restaurantSampleQuotes.length} selected suppliers</footer>
        </article>
      </section>

      <section className="tour-step tour-step--reverse" aria-labelledby="tour-supplier-title">
        <div className="tour-step__copy">
          <span className="tour-index">02 / Supplier response</span>
          <h2 id="tour-supplier-title">Make the response easy to complete.</h2>
          <p>Each supplier receives an expiring link to a focused mobile form. There is no supplier account to create and no separate spreadsheet to reconcile.</p>
        </div>
        <article className="supplier-sheet" aria-label="Sample supplier view">
          <header><span>Sample supplier view · {restaurantSampleQuotes[0].supplierName}</span><strong>Quote for {restaurantSampleRequest.id}</strong></header>
          {restaurantSampleRequest.items.slice(0, 2).map((item) => (
            <div className="supplier-line" key={item.name}>
              <div><strong>{item.name}</strong><span>{item.quantity} {item.unit} requested</span></div>
              <span>{formatSampleInr(item.sampleRatePaise)} / {item.unit}</span>
            </div>
          ))}
          <div className="supplier-fields"><span>GST captured</span><span>Freight captured</span><span>Delivery confirmed</span></div>
          <footer>
            <span className="supplier-total__meta">Calculated landed total · all {restaurantSampleRequest.items.length} items · 2 of {restaurantSampleRequest.items.length} shown</span>
            <strong className="supplier-total__amount">{formatSampleInr(restaurantSampleQuotes[0].totalPaise)}</strong>
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
