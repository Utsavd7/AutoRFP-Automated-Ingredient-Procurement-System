const sampleSuppliers = [
  {
    name: 'Supplier A',
    total: '₹31,460.00',
    gst: 'Included line by line',
    delivery: '12 Sep 2026',
    coverage: '8 of 8 items',
    terms: '15 days',
    status: 'Submitted',
  },
  {
    name: 'Supplier B',
    total: '₹30,884.50',
    gst: 'Included line by line',
    delivery: '13 Sep 2026',
    coverage: '7 of 8 items',
    terms: '7 days',
    status: 'Submitted',
  },
  {
    name: 'Supplier C',
    total: '₹32,196.00',
    gst: 'Included line by line',
    delivery: '12 Sep 2026',
    coverage: '8 of 8 items',
    terms: '30 days',
    status: 'Submitted',
  },
];

export function SampleQuoteComparison({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`sample-ledger ${compact ? 'sample-ledger--compact' : ''}`}>
      <figcaption className="sample-ledger__heading">
        <div>
          <span className="sample-label">Sample data</span>
          <h2>Compare what suppliers actually submitted.</h2>
        </div>
        <div className="sample-request">
          <span>Sample request</span>
          <strong>QP-1042 · Weekly produce</strong>
        </div>
      </figcaption>

      <span className="sample-scroll-hint">Scroll to compare all suppliers →</span>
      <div className="sample-ledger__scroll" role="region" aria-label="Sample supplier quote comparison" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Commercial fact</th>
              {sampleSuppliers.map((supplier) => <th key={supplier.name} scope="col">{supplier.name}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Landed total (INR)</th>
              {sampleSuppliers.map((supplier) => <td className="ledger-money" key={supplier.name}>{supplier.total}</td>)}
            </tr>
            <tr>
              <th scope="row">GST</th>
              {sampleSuppliers.map((supplier) => <td key={supplier.name}>{supplier.gst}</td>)}
            </tr>
            <tr>
              <th scope="row">Delivery</th>
              {sampleSuppliers.map((supplier) => <td key={supplier.name}>{supplier.delivery}</td>)}
            </tr>
            <tr>
              <th scope="row">Coverage</th>
              {sampleSuppliers.map((supplier) => <td key={supplier.name}>{supplier.coverage}</td>)}
            </tr>
            <tr>
              <th scope="row">Payment terms</th>
              {sampleSuppliers.map((supplier) => <td key={supplier.name}>{supplier.terms}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sample-ledger__foot">
        <span><i className="status-dot" aria-hidden="true" />3 quotes {sampleSuppliers[0].status.toLowerCase()}</span>
        <span>No recommendation is made for you</span>
        <span className="sample-ledger__decision">Human award required →</span>
      </div>
    </figure>
  );
}
