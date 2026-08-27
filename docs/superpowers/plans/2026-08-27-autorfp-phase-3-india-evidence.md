# AutoRFP Phase 3 India Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every simulated price and supplier claim with dated, provenanced Indian evidence, restaurant invoice history, or actual supplier quotes.

**Architecture:** Two explicit government-source adapters fetch and validate AGMARKNET and Department of Consumer Affairs observations. The database retains source snapshots, normalized observations, mapping versions, and quality flags. Restaurant invoice entries and actual quotes are the business-price sources. Supplier records are manually confirmed; an optional offline Foursquare Open Source Places importer can seed clearly unverified candidates.

**Tech Stack:** TypeScript, Zod, PostgreSQL/Prisma, Node fetch, CSV parsing, Jest/Testcontainers.

---

## Simplicity boundary

Build exactly two government adapters and one invoice CSV format. Do not build a generic ETL designer, web scraper, geocoder, supplier crawler, streaming pipeline, or price-prediction model. Government values are context, never promised delivery prices or savings baselines.

## File map

Create:

- `src/integrations/india/agmarknet/client.ts`
- `src/integrations/india/agmarknet/schema.ts`
- `src/integrations/india/consumer-affairs/client.ts`
- `src/integrations/india/consumer-affairs/schema.ts`
- `src/integrations/india/source-snapshot.ts`
- `src/domain/evidence/commodity-mapping.ts`
- `src/domain/evidence/freshness.ts`
- `src/services/evidence/ingest-agmarknet.ts`
- `src/services/evidence/ingest-consumer-affairs.ts`
- `src/services/evidence/import-invoices.ts`
- `src/services/suppliers/import-foursquare-candidates.ts`
- `src/app/api/evidence/prices/route.ts`
- `src/app/api/invoices/import/route.ts`
- `src/app/api/suppliers/route.ts`
- `src/components/evidence/PriceEvidenceTable.tsx`
- `src/components/suppliers/SupplierForm.tsx`
- `scripts/import-foursquare-places.ts`
- source fixtures under `__tests__/fixtures/india-data/`

## Task 1: Add evidence and supplier provenance columns

- [ ] Add `PriceSource`, `PriceObservation`, `SourceSnapshot`, `CommodityMapping`, and `InvoiceObservation` models with organization ownership only where data is private.
- [ ] Store raw source record ID/URL, observed/ingested dates, commodity, variety, market/district/state, raw unit/value, normalized unit/value, mapping version, checksum, and quality flags.
- [ ] Extend Supplier/Contact with `MANUAL_CONFIRMED` or `UNVERIFIED_CANDIDATE`, source ID, source date, and confirming user/time.
- [ ] Add uniqueness that makes ingestion idempotent by source plus source record identity; add RLS for private invoice and supplier data.
- [ ] Write migration/RLS tests and run them against PostgreSQL.
- [ ] Commit with `git commit -m "feat: add Indian price evidence and supplier provenance schema"`.

## Task 2: Implement the AGMARKNET adapter against saved fixtures first

- [ ] Save small representative official response fixtures covering multiple states, markets, varieties, units, missing fields, and a deliberately changed schema.
- [ ] Write failing parser tests asserting exact field mapping, Indian date handling, positive numeric validation, duplicate identity, and fail-closed schema change behavior.
- [ ] Implement a source-specific Zod parser; do not share a generic dynamic mapping engine.
- [ ] Implement bounded fetch with an official data.gov.in endpoint, free API credential from `DATA_GOV_IN_API_KEY`, timeout, maximum response size, pagination cap, and no redirects to non-government hosts.
- [ ] Checksum and persist the raw response before parsing; retain it for 30 days.
- [ ] Write an integration test proving rerunning the same page creates no duplicate observations.
- [ ] Commit with `git commit -m "feat: ingest provenanced AGMARKNET observations"`.

## Task 3: Implement the Consumer Affairs adapter

- [ ] Add official-source fixtures for daily retail/wholesale observations, missing publication day, malformed prices, and format change.
- [ ] Write failing tests that preserve retail versus wholesale, location scope, observed date, raw unit, and source identity.
- [ ] Implement the second explicit adapter with the same network bounds and snapshot/checksum behavior, but no abstract base class beyond the small shared snapshot writer.
- [ ] Mark a source stale after two expected publication intervals; retain and serve the last accepted observation with a stale flag when a fetch or parse fails.
- [ ] Add idempotency and stale-behavior integration tests.
- [ ] Commit with `git commit -m "feat: ingest Consumer Affairs price observations"`.

## Task 4: Add reviewed commodity mapping and unit normalization

- [ ] Write tests for exact canonical match, approved alias, variety-specific mapping, ambiguous commodity, unknown unit, and mapping-version change.
- [ ] Implement a reviewed mapping table with explicit source commodity/variety and canonical ingredient. Ambiguous rows remain unmapped and never enter automatic comparison.
- [ ] Normalize only conversions supported by Phase 2 unit rules. Keep raw value/unit alongside normalized value/unit.
- [ ] Add an Owner/Procurement Manager review screen for unresolved mappings; every approval increments mapping version and writes audit.
- [ ] Reprocessing creates new normalized records tied to the new mapping version without rewriting old evidence.
- [ ] Commit with `git commit -m "feat: add reviewed commodity mappings"`.

## Task 5: Add restaurant invoice history as the preferred savings evidence

- [ ] Define one CSV template: invoice date, location, supplier, ingredient, quantity, unit, subtotal INR, GST INR, freight INR, and invoice reference.
- [ ] Write parser/calculation tests for valid rows, duplicates, unknown units, invalid money, cross-location data, and landed-cost normalization.
- [ ] Add manual entry and CSV import APIs/UI. Imports first produce a validation report; only explicit confirmation writes observations.
- [ ] Store money in paise and quantities in canonical Decimal units. Do not infer missing GST, freight, pack size, or ingredient mapping.
- [ ] Connect the Phase 2 savings function to the most recent comparable paid landed cost and preserve median-current-quote fallback.
- [ ] Commit with `git commit -m "feat: use invoice history for comparable savings baselines"`.

## Task 6: Replace supplier discovery with confirmed supplier records

- [ ] Add supplier create/update/list screens requiring name, locality, and at least one user-confirmed contact method before selection for an RFP.
- [ ] Remove runtime Google Places, generated emails, public Nominatim, curated fake suppliers, and automatic location network calls.
- [ ] Write tests proving unverified candidates cannot receive invitations and confirmation records actor/time/source.
- [ ] Implement `scripts/import-foursquare-places.ts` as an optional offline import of the Foursquare Open Source Places release. It reads a local file, filters a configured Indian locality/category, and inserts only `UNVERIFIED_CANDIDATE` rows.
- [ ] Do not download the large Foursquare dataset during normal build, deploy, startup, or tests.
- [ ] Commit with `git commit -m "feat: use manually confirmed supplier records"`.

## Task 7: Present evidence with provenance and honest freshness

- [ ] Add API output with `sourceType`, source label, source URL, market/geography, observed date, ingested date, raw/normalized units, and stale/quality flags.
- [ ] Add `Market benchmark` UI labels with explicit `Wholesale` or `Retail`; never use `live`, `real-time`, `supplier price`, or `expected quote` for government data.
- [ ] Show `Evidence unavailable` when no comparable observation exists. Do not fill gaps from averages, LLM output, or static price tables.
- [ ] Add component tests for fresh, stale, ambiguous, and unavailable states.
- [ ] Remove legacy pricing/distributor code and their unused dependencies after the new screens pass.
- [ ] Commit with `git commit -m "feat: display dated price provenance and freshness"`.

## Task 8: Prove the Phase 3 exit gate

- [ ] Replay all stored official fixtures and confirm exact accepted/rejected counts.
- [ ] Simulate source HTTP failure and schema change; confirm last good data remains, turns stale, and raises an operational event without inserting partial rows.
- [ ] Run `rg -n "Yahoo|BLS|Google Places|Nominatim|Estimated|MOCK_POOL|generateEmail|AI Price" src package.json README.md`.

Expected: no runtime implementation or misleading claim remains.

- [ ] Run `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Commit verification fixes with `git commit -m "test: verify India evidence provenance gate"`.

## Phase 3 exit gate

- [ ] Every displayed external price has source, geography, type, date, mapping version, and freshness.
- [ ] Missing or ambiguous evidence is unavailable, not generated.
- [ ] Savings uses invoice history, comparable current-quote median, or no value in that order.
- [ ] Only manually confirmed suppliers can receive an RFP invitation.
- [ ] No runtime paid/place/geocoding API, fake supplier pool, or generated supplier contact remains.
