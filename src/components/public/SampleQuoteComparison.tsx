import {
  formatSampleInr,
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';

export function SampleQuoteComparison({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`sample-ledger ${compact ? 'sample-ledger--compact' : ''}`}>
      <figcaption className="sample-ledger__heading">
        <div>
          <span className="sample-label">Sample data</span>
          <h2>Compare what suppliers actually submitted.</h2>
        </div>
        <div className="sample-request">
          <span>Sample request · {restaurantSampleRequest.context}</span>
          <strong>{restaurantSampleRequest.id} · {restaurantSampleRequest.cadence}</strong>
        </div>
      </figcaption>

      <span className="sample-scroll-hint">Scroll to compare all suppliers →</span>
      <div className="sample-ledger__scroll" role="region" aria-label="Sample supplier quote comparison" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Commercial fact</th>
              {restaurantSampleQuotes.map((quote) => <th key={quote.supplierName} scope="col">{quote.supplierName}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Landed total (INR)</th>
              {restaurantSampleQuotes.map((quote) => <td className="ledger-money" key={quote.supplierName}>{formatSampleInr(quote.totalPaise)}</td>)}
            </tr>
            <tr>
              <th scope="row">Subtotal</th>
              {restaurantSampleQuotes.map((quote) => <td key={quote.supplierName}>{formatSampleInr(quote.subtotalPaise)}</td>)}
            </tr>
            <tr>
              <th scope="row">GST declared</th>
              {restaurantSampleQuotes.map((quote) => <td key={quote.supplierName}>{formatSampleInr(quote.gstPaise)}</td>)}
            </tr>
            <tr>
              <th scope="row">Freight</th>
              {restaurantSampleQuotes.map((quote) => <td key={quote.supplierName}>{formatSampleInr(quote.freightPaise)}</td>)}
            </tr>
            <tr>
              <th scope="row">Delivery</th>
              {restaurantSampleQuotes.map((quote) => <td key={quote.supplierName}>{quote.delivery}</td>)}
            </tr>
            <tr>
              <th scope="row">Coverage</th>
              {restaurantSampleQuotes.map((quote) => <td key={quote.supplierName}>{quote.coverageCount} of {restaurantSampleRequest.items.length} items</td>)}
            </tr>
            <tr>
              <th scope="row">Payment terms</th>
              {restaurantSampleQuotes.map((quote) => <td key={quote.supplierName}>{quote.terms}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sample-ledger__foot">
        <span><i className="status-dot" aria-hidden="true" />{restaurantSampleQuotes.length} quotes {restaurantSampleQuotes[0].status.toLowerCase()}</span>
        <span>Illustrative prices · not live market data</span>
        <span className="sample-ledger__decision">Human award required →</span>
      </div>
    </figure>
  );
}
