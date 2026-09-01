import { SampleQuoteComparison } from './SampleQuoteComparison';
import {
  formatSampleInr,
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';

export function ProductTour() {
  const requestItems = restaurantSampleRequest.items.slice(0, 4);
  const supplierItems = restaurantSampleRequest.items.slice(0, 2);

  return (
    <div className="product-tour">
      <section className="tour-step" aria-labelledby="tour-request-title">
        <div className="tour-step__copy">
          <span className="tour-index">01 / Request record</span>
          <h2 id="tour-request-title">Turn the list into a checked request.</h2>
          <p>Set the ingredients, quantities, delivery details, and invited suppliers in one record. Opening it preserves what the restaurant asked suppliers to price.</p>
        </div>
        <div className="tour-product" role="group" aria-label="Illustrative request workspace">
          <div className="tour-product__bar">
            <span>Request workspace</span>
            <strong>Sample data · illustrative only</strong>
          </div>
          <div className="tour-product__surface">
            <article className="tour-record" aria-label="Sample request record">
              <header>
                <div><span>Sample request</span><strong>{restaurantSampleRequest.id}</strong></div>
                <span className="record-state">{restaurantSampleRequest.cadence}</span>
              </header>
              <div className="tour-record__meta"><span>Sample restaurant · {restaurantSampleRequest.context}</span><span>Delivery · {restaurantSampleRequest.delivery}</span></div>
              <table>
                <thead><tr><th scope="col">Ingredient</th><th scope="col">Quantity</th><th scope="col">Unit</th></tr></thead>
                <tbody>{requestItems.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.quantity}</td><td>{item.unit}</td></tr>)}</tbody>
              </table>
              <footer>{requestItems.length} of {restaurantSampleRequest.items.length} ingredients shown · {restaurantSampleQuotes.length} sample supplier records</footer>
            </article>
          </div>
        </div>
      </section>

      <section className="tour-step tour-step--reverse" aria-labelledby="tour-supplier-title">
        <div className="tour-step__copy">
          <span className="tour-index">02 / Supplier response</span>
          <h2 id="tour-supplier-title">Give suppliers one clear response sheet.</h2>
          <p>Each supplier receives an expiring link to a focused mobile form. There is no supplier account to create and no separate spreadsheet to reconcile.</p>
        </div>
        <div className="tour-product tour-product--supplier" role="group" aria-label="Illustrative supplier response workspace">
          <div className="tour-product__bar">
            <span>Supplier response</span>
            <strong>Sample data · illustrative only</strong>
          </div>
          <div className="tour-product__surface">
            <article className="supplier-sheet" aria-label="Sample supplier response">
              <header><span>Sample supplier view · {restaurantSampleQuotes[0].supplierName}</span><strong>Quote for {restaurantSampleRequest.id}</strong></header>
              {supplierItems.map((item) => (
                <div className="supplier-line" key={item.name}>
                  <div><strong>{item.name}</strong><span>{item.quantity} {item.unit} requested</span></div>
                  <span>{formatSampleInr(item.sampleRatePaise)} / {item.unit}</span>
                </div>
              ))}
              <div className="supplier-fields">
                <span><small>GST</small><strong>{formatSampleInr(restaurantSampleQuotes[0].gstPaise)}</strong></span>
                <span><small>Freight</small><strong>{formatSampleInr(restaurantSampleQuotes[0].freightPaise)}</strong></span>
                <span><small>Delivery</small><strong>{restaurantSampleQuotes[0].delivery}</strong></span>
              </div>
              <footer>
                <span className="supplier-total__meta">Calculated landed total · all {restaurantSampleRequest.items.length} ingredients · {supplierItems.length} shown</span>
                <strong className="supplier-total__amount">{formatSampleInr(restaurantSampleQuotes[0].totalPaise)}</strong>
              </footer>
            </article>
          </div>
        </div>
      </section>

      <section id="compare" className="tour-step tour-step--comparison" aria-labelledby="tour-comparison-title">
        <div className="tour-step__copy">
          <span className="tour-index">03 / Compare and award</span>
          <h2 id="tour-comparison-title">Compare the facts before you award.</h2>
          <p>Compare total cost, GST, delivery, missing items, and payment terms. Choose one supplier for the full order, or different suppliers for different items.</p>
        </div>
        <div className="tour-product tour-product--comparison" role="group" aria-label="Illustrative comparison workspace">
          <div className="tour-product__bar">
            <span>Comparison workspace</span>
            <strong>Sample data · illustrative only</strong>
          </div>
          <div className="tour-product__surface">
            <SampleQuoteComparison compact />
          </div>
        </div>
      </section>
    </div>
  );
}
