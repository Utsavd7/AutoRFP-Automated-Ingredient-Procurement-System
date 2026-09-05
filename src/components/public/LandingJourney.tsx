import { JourneyStage } from './JourneyStage';
import { ProductDecisionPreview } from './ProductDecisionPreview';
import { JourneyIcon, type JourneyIconName } from './JourneyIcon';

const intakeOptions = [
  ['camera', 'Take menu photos'],
  ['upload', 'Upload existing photos'],
  ['list', 'Type dishes or ingredients'],
] satisfies ReadonlyArray<readonly [JourneyIconName, string]>;

const supplierCategories = [
  'Vegetables',
  'Fruits',
  'Dairy',
  'Dry goods',
  'Beverages',
  'Coffee & tea',
  'Sweets',
  'Packaged foods',
  'Outsourced snacks',
] as const;

const requestRecipients = [
  'Vegetable supplier',
  'Dairy supplier',
  'Dry goods supplier',
] as const;

export function LandingJourney() {
  return (
    <section className="landing-story" id="how-it-works" aria-labelledby="landing-story-title">
      <header className="public-container landing-story__intro">
        <p className="public-eyebrow">One buying journey</p>
        <h2 id="landing-story-title">From today&apos;s menu to tomorrow&apos;s order.</h2>
        <p>
          See what happens at every step. Nothing is sent or selected without your restaurant
          team.
        </p>
      </header>

      <JourneyStage>
        <ol className="landing-story__track" role="list">
          <li className="story-scene story-scene--intake" id="journey-step-1">
            <div className="story-scene__copy">
              <span className="story-scene__number" aria-hidden="true">1</span>
              <h3>Tell us what your kitchen needs</h3>
              <p>
                Start with a menu or enter the items yourself. QuotePlate turns the dishes into an
                ingredient list for your team to check before it is used.
              </p>
            </div>
            <div
              className="intake-diagram"
              role="group"
              aria-label="Three ways to add a menu or ingredient list"
            >
              {intakeOptions.map(([icon, label]) => (
                <div key={label}>
                  <JourneyIcon name={icon} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </li>

          <li className="story-scene story-scene--suppliers" id="journey-step-2">
            <div className="story-scene__copy">
              <span className="story-scene__number" aria-hidden="true">2</span>
              <h3>Choose who should send prices</h3>
              <p>
                Use your existing suppliers, select suppliers for specific items, or allow new
                suppliers to apply, then approve them yourself.
              </p>
            </div>
            <div
              className="supplier-diagram"
              role="group"
              aria-label="Supplier categories selected by the restaurant"
            >
              <div className="supplier-diagram__centre">
                <JourneyIcon name="suppliers" />
                <strong>Your suppliers</strong>
              </div>
              <ul>
                {supplierCategories.map((category) => <li key={category}>{category}</li>)}
              </ul>
            </div>
          </li>

          <li className="story-scene story-scene--request" id="journey-step-3">
            <div className="story-scene__copy">
              <span className="story-scene__number" aria-hidden="true">3</span>
              <h3>Send one clear request</h3>
              <p>
                Each supplier receives only the items and quantities assigned to them through a
                private link, with the relevant delivery requirements and terms. No supplier
                account needed.
              </p>
            </div>
            <div
              className="request-route"
              role="group"
              aria-label="Assigned items from one request sent to vegetable, dairy and dry goods suppliers by private links"
            >
              <div>
                <JourneyIcon name="list" />
                <strong>One request</strong>
              </div>
              <span className="request-route__link" aria-hidden="true">
                <JourneyIcon name="link" />
              </span>
              <ul>
                {requestRecipients.map((supplier) => <li key={supplier}>{supplier}</li>)}
              </ul>
            </div>
          </li>

          <li className="story-scene story-scene--comparison" id="journey-step-4">
            <div className="story-scene__copy">
              <span className="story-scene__number" aria-hidden="true">4</span>
              <h3>Compare the complete cost</h3>
              <p>
                Prices, GST, freight, delivery and missing items stay together. See the full request
                total and the price of every item. Your restaurant can choose one supplier or split
                items between suppliers.
              </p>
            </div>
            <ProductDecisionPreview headingLevel={4} />
          </li>

          <li className="story-scene story-scene--decision" id="journey-step-5">
            <div className="story-scene__copy">
              <span className="story-scene__number" aria-hidden="true">5</span>
              <h3>Choose and save the decision</h3>
              <p>
                Your restaurant makes the final choice. The saved order keeps the approval and
                price history together, so your team can run the request again from saved history.
              </p>
            </div>
            <div
              className="decision-route"
              role="group"
              aria-label="Selected supplier saved to buying history"
            >
              <div>
                <JourneyIcon name="approve" />
                <span>Supplier selected</span>
              </div>
              <span aria-hidden="true" />
              <div>
                <JourneyIcon name="history" />
                <span>Saved buying history</span>
              </div>
            </div>
          </li>
        </ol>
      </JourneyStage>
    </section>
  );
}
