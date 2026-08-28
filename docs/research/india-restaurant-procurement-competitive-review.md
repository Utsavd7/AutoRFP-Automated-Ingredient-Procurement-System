# India restaurant procurement competitive review

Reviewed on 28 August 2026. Product claims below come from public company pages unless a different source is named. Private-company revenue figures are not live ARR and should not be presented as such.

## Launch decision

QuotePlate should launch as an accountable request-to-quote system for a restaurant's own suppliers. It should not expand into a POS, general inventory ERP, marketplace, logistics company, payment processor, or AI ordering product before real pilot usage proves that need.

The durable advantage is the complete buying record:

- a reviewed ingredient request;
- one private, expiring link per supplier;
- no supplier account or app;
- comparable quantities, GST, freight, delivery dates, substitutions, coverage, and terms;
- immutable quote revisions;
- whole-order or split-supplier awards made by a person;
- purchase-order and accounting exports;
- one-click repeat requests and permanent price/decision history.

This also answers the bypass risk. QuotePlate is not paid for introducing a dealer. A restaurant keeps using it because every new buying cycle is faster to repeat, prices remain comparable, and the final decision remains provable even when all parties already know one another.

## Direct India competitors

| Product | Publicly presented strength | Product/UI review | What QuotePlate should do |
|---|---|---|---|
| [Petpooja Purchase Manager](https://blog.petpooja.com/industry-business-guides/petpooja-purchase-manager-features-setup/) | Free POSS add-on comparing live Hyperpure, DMart, and uploaded local-supplier rates; cheapest-item cart; direct vendor checkout; inventory sync. | Strongest direct workflow competitor. The screen is a dense yellow-accent commerce catalogue with item cards and vendor carts. It is fast for known catalogues, but local supplier prices depend on uploaded rate cards rather than a supplier submitting a structured, revisioned quote. | Keep supplier response easier and more trustworthy. Do not imitate catalogue density. Later consider an optional supplier rate-card import only after pilots request it. |
| [SupplyNote](https://supplynote.in/ims) | Full F&B supply-chain suite: products, inventory, PO/GRN, supplier ledgers, recipes, production, batches, payments, forecasting, and 70+ reports. | Modern marketing page and broad enterprise scope. The dashboard presents many modules, cards, filters, and reports; it is capable but materially heavier than a four-restaurant pilot needs. | Stay focused and easier to adopt. Receiving/GRN and supplier delivery performance are the most credible post-pilot additions; the rest should remain deferred. |
| [Restroworks](https://www.restroworks.com/restaurant-supply-chain-management-software/) | Purchase requests, POs, invoices, vendor communication, outlet transfers, forecasting, 200+ reports, and 500+ integrations; company claims 25,000+ restaurants. | Enterprise marketing is extensive, while the published purchase-order screen is visually dated and form-heavy. It is designed for large, integrated restaurant operations. | Preserve QuotePlate's calmer comparison-first UI. Do not build broad integrations before a specific pilot requires one. |
| [Hyperpure](https://www.hyperpure.com/) | Large B2B ingredient catalogue and logistics network; next-day, urgent, and speciality supply; public site claims 130+ cities and 1 lakh+ partners. | Polished marketplace/e-commerce experience with search, product imagery, ratings, live prices, and add-to-cart actions. It solves fulfilment from Hyperpure's seller network, not neutral comparison of every restaurant's existing dealers. | Remain marketplace-neutral. A Hyperpure quote or purchase source can later be represented like any other supplier without becoming dependent on it. |
| [FrontPe supplier management](https://www.frontpe.com/features/supplier-management) | Supplier profiles, POs, partial receiving, payables, low-stock replenishment, and inventory updates. | Clear, readable page, but it uses a stock photograph and exposes little real product UI. The company says it was founded in 2026 and offers a broader POS platform. | Keep real product evidence on the website. Do not add payables or stock control until customers complete the current request-to-award loop. |

## Useful global benchmark

[MarketMan](https://www.marketman.com/platform) combines inventory, purchasing, receiving, invoice automation, recipes, accounts payable, multi-unit operations, mobile apps, and integrations. Its public pricing begins at $199 per location per month, so it is a useful enterprise feature benchmark but not the right launch scope or cost model for QuotePlate.

## Revenue and scale signals

These figures are not directly comparable: Hyperpure sells physical goods, while Petpooja and Restroworks are software businesses. They indicate competitor scale, not QuotePlate's obtainable market or a valuation.

| Company/product | Best public signal found | Confidence and limitation |
|---|---|---|
| Hyperpure | Eternal's official FY25 filing reports ₹6,196 crore of Hyperpure segment revenue; the official Q4 FY25 investor page reports ₹1,840 crore for the quarter. | High confidence historical revenue, but it is goods-led segment revenue and not SaaS ARR. Sources: [Eternal/Zomato investor relations](https://www.zomato.com/investor-relations/annual-reports), [NSE integrated filing](https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_89061_01052025190844_iXBRL_WEB.html). |
| Petpooja | A 2025 funding report states FY24 revenue was about ₹76 crore, up 43%; Petpooja publishes annual-return links on its corporate-information page. | Medium confidence, historical company revenue rather than Purchase Manager revenue or current ARR. Sources: [Petpooja corporate information](https://www.petpooja.com/corporate_information), [Restaurant India funding report](https://www.restaurantindia.in/news/restaurant-india-news-petpooja-raises-rs-137-crore-to-boost-ai-and-product-expansion-in). |
| Restroworks | A filing-data provider reports FY25 revenue of ₹40.44 crore. Restroworks separately claims 25,000+ restaurant locations and $5.57 billion of orders processed in 2025. | Medium confidence. The revenue extraction is third-party and current ARR is undisclosed. Sources: [company financial summary](https://www.thecompanycheck.com/company/restroworks-tech-private-limited/U72200DL2011PTC224247), [Restroworks company facts](https://www.restroworks.com/llm-info/). |
| SupplyNote | No reliable current revenue or ARR disclosure was found. | Do not publish an estimate. Public pages establish product breadth and customer claims, not revenue. |
| FrontPe | No revenue or ARR disclosure was found; its site says it was founded in 2026. | Too new for a defensible run-rate conclusion. |

## Feature decision after review

### Keep in the launch product

- menu-to-ingredient demand review;
- supplier directory and CSV import;
- private mobile quote links and QR exports;
- structured quotes with revisions;
- GST, freight, delivery, coverage, substitution, and term comparison;
- whole and split awards;
- immutable award snapshots and audit history;
- repeat requests, price-range insights, CSV/PDF/accounting exports;
- Google and credential sign-in, invitations, roles, tenant isolation, and responsive UI.

### Next only after pilot evidence

1. Receiving against an awarded purchase order: received quantity, variance, rejection reason, and delivery date.
2. Supplier performance based only on recorded facts: response time, quote coverage, awarded value, on-time delivery, and receiving variance.
3. Multi-outlet delivery locations if one pilot restaurant operates more than one outlet.
4. Optional catalogue/rate-card import for repeat local suppliers.

### Explicitly defer

- POS and customer billing;
- perpetual inventory and automatic stock consumption;
- warehouse, batch, barcode, expiry, or production planning;
- vendor payments, credit, or card handling;
- logistics or physical fulfilment;
- paid WhatsApp/SMS, OCR, LLM, forecasting, or price APIs;
- marketplace commissions or exclusive supplier relationships.

These deferred areas would add substantial data, operations, support, and billing risk without improving the first four restaurants' core quote-to-award job.
