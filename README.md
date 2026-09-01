# QuotePlate

![QuotePlate, restaurant procurement made accountable](public/brand/social-card.png)

QuotePlate is a procurement workspace for restaurants in India. A restaurant can turn a menu into an ingredient request, collect private supplier quotes, compare the real landed cost, record its decision, and repeat the next buying cycle from a factual history.

Live product: [quoteplate.netlify.app](https://quoteplate.netlify.app)

Built by [Utsav Doshi](https://github.com/Utsavd7).

## Product

The current release supports:

- create a menu by typing dish names, uploading up to five laptop photos, scanning a QR code to send up to ten original phone photos at a time, or importing a menu page you have permission to use;
- scan menu photos in the browser, review the detected text, remove unwanted text, and approve the final dishes and ingredients;
- organise ingredients using categories familiar to Indian restaurants;
- keep existing suppliers, choose more than one sourcing route, or accept applications from verified new suppliers;
- send each supplier a private quote link with no supplier account required;
- collect quantities, rates, GST, freight, availability, delivery, substitutions, and payment terms;
- compare complete and incomplete quotes while keeping the final decision with the restaurant;
- award the full request to one supplier or split items across suppliers;
- download request, comparison, award, accounting, QR, supplier, and purchase order records;
- repeat a previous request and use prior buying facts as guidance;
- manage restaurant details, roles, invitations, Google sign in, sign out, and an optional six step setup guide;
- use the public site and product workspace on phones, tablets, and laptops.

The product does not introduce suppliers and then disappear from the workflow. Its value is the reusable request, quote, decision, purchase order, and price history for every buying cycle.

## Safety and privacy

- Restaurant data is isolated by workspace at the database layer.
- Supplier links are random, stored only as digests, limited to one request, replaceable, revocable, and time limited.
- Award records preserve the checked prices, quantities, supplier facts, and delivery terms used for the decision.
- Owner only actions protect restaurant settings, team access, supplier verification, and awards.
- Production startup fails closed when required configuration is missing.
- Rate limits cover account creation, invitations, supplier access, supplier submissions, and applications.
- Security headers block framing, content type guessing, browser referrer leakage, and unnecessary device permissions.
- Phone photos travel as temporary encrypted copies. The decryption key stays in the QR link, and retrieved originals are kept only in that restaurant workspace on the current browser.
- Backup and restore tools are included for the operator.

## Run locally

Requirements: Node.js 24 and PostgreSQL 16.

```bash
npm install
cp .env.sample .env
npx prisma migrate deploy
npm run dev
```

Replace the placeholders in `.env` with your own values and never commit that file. The application accepts up to twenty approved pilot owner emails.

## Production setup

1. Configure the values documented in `.env.sample` on the hosting service.
2. Apply the committed migrations before the first deployment.
3. Add the production address and Google callback address to the OAuth client.
4. Check the live and readiness endpoints before inviting a restaurant.

## Verification

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The checks cover access control, workspace isolation, authentication, menu intake, OCR boundaries, supplier workflow, quote integrity, landed cost calculations, awards, exports, responsive layouts, accessibility, migrations, and a bounded twenty restaurant load profile.

## Project references

- [Brand assets and usage](docs/brand/README.md)
- [India restaurant procurement review](docs/research/india-restaurant-procurement-competitive-review.md)

Repository: [github.com/Utsavd7/QuotePlate](https://github.com/Utsavd7/QuotePlate)
