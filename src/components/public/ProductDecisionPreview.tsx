import {
  formatSampleInr,
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';

type ProductDecisionPreviewProps = {
  headingLevel?: 2 | 3 | 4;
};

const headingTags = {
  2: 'h2',
  3: 'h3',
  4: 'h4',
} as const;

export function ProductDecisionPreview({ headingLevel = 2 }: ProductDecisionPreviewProps = {}) {
  const Heading = headingTags[headingLevel];

  return (
    <figure className="decision-preview" aria-labelledby="decision-preview-title">
      <div className="decision-preview__shell">
        <div className="decision-preview__window">
          <header className="decision-preview__bar">
            <span className="decision-preview__traffic" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <Heading id="decision-preview-title">Quote comparison</Heading>
            <span className="sample-label">Sample data</span>
          </header>

          <div className="decision-preview__body">
            <div className="decision-preview__sidebar" aria-hidden="true">
              <strong>Kitchen procurement</strong>
              <span>Requests</span>
              <span>Suppliers</span>
              <span>History</span>
            </div>

            <section className="decision-preview__main" aria-label="Quote decision">
              <div className="decision-preview__summary">
                <div>
                  <span>Sample request · {restaurantSampleRequest.id}</span>
                  <strong>{restaurantSampleRequest.cadence}</strong>
                </div>
                <span>{restaurantSampleQuotes.length} quotes ready</span>
              </div>

              <p>
                {restaurantSampleRequest.items.length} items · {restaurantSampleRequest.context}
              </p>
              <span className="decision-preview__scroll-hint">Scroll to compare suppliers →</span>

              <div
                className="decision-preview__table-scroll"
                role="region"
                aria-label="Sample supplier quote comparison"
                tabIndex={0}
              >
                <table className="decision-preview__table">
                  <thead>
                    <tr>
                      <th scope="col">Supplier</th>
                      <th scope="col">Landed total</th>
                      <th scope="col">Coverage</th>
                      <th scope="col">Terms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restaurantSampleQuotes.map((quote) => (
                      <tr key={quote.supplierName}>
                        <th scope="row">{quote.supplierName}</th>
                        <td>{formatSampleInr(quote.totalPaise)}</td>
                        <td>
                          {quote.coverageCount} of {restaurantSampleRequest.items.length} items
                        </td>
                        <td>{quote.terms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="decision-preview__footer">
                <span>Human decision required</span>
                <a href="#watch-demo">Watch demo</a>
              </footer>
            </section>
          </div>
        </div>
      </div>

      <figcaption>
        <span>Sample supplier response</span>
        <span>Illustrative prices · not live market data</span>
      </figcaption>
    </figure>
  );
}
