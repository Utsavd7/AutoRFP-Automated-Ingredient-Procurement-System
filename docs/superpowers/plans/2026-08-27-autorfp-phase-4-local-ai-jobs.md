# AutoRFP Phase 4 Local AI and Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable PostgreSQL-backed background work and an optional local AI assistant without making procurement depend on AI or a hosted provider.

**Architecture:** A single worker process dispatches committed outbox rows into pg-boss and consumes a short fixed queue list. Normal jobs run with concurrency two; AI runs with concurrency one. One native-fetch llama.cpp adapter produces schema-constrained suggestions. Results are stored as proposals that require human review and never directly mutate issued procurement records.

**Tech Stack:** pg-boss, PostgreSQL, Node/TypeScript worker, llama.cpp OpenAI-compatible local endpoint, Qwen3.5 4B/2B GGUF, Zod, Jest/Testcontainers.

---

## Simplicity boundary

No LangGraph, agent team, vector database, RAG, Redis, hosted LLM fallback, prompt orchestration framework, or separate queue service. Use one worker binary, one local-model adapter, one inference slot, fixed Zod schemas, and at most one repair attempt. If a deterministic screen is already clear, do not add AI text.

## File map

Create:

- `src/worker/index.ts`
- `src/worker/boss.ts`
- `src/worker/dispatch-outbox.ts`
- `src/worker/register-handlers.ts`
- `src/worker/handlers/menu-parse.ts`
- `src/worker/handlers/menu-ai-review.ts`
- `src/worker/handlers/price-ingest.ts`
- `src/worker/handlers/document-generate.ts`
- `src/worker/handlers/retention-enforce.ts`
- `src/lib/local-ai/client.ts`
- `src/lib/local-ai/schemas.ts`
- `src/lib/local-ai/prompts.ts`
- `src/services/ai/create-suggestion.ts`
- `src/app/api/jobs/[jobId]/route.ts`
- `scripts/benchmark-local-model.ts`
- `benchmarks/menu-extraction/fixtures.jsonl`
- `benchmarks/menu-extraction/README.md`

Delete after replacement: `src/inngest`, `src/app/api/inngest`, `src/lib/chroma.ts`, `src/lib/embeddings.ts`, legacy `src/lib/llm.ts`, and remaining negotiation/recommendation simulation modules.

## Task 1: Add pg-boss with one fixed queue registry

- [ ] Install `pg-boss`; add `worker`, `worker:dev`, and `test:worker` package scripts.
- [ ] Define the fixed queues from the design in one typed constant. Do not add a queue abstraction interface around pg-boss.
- [ ] Write an integration smoke test that starts pg-boss on the test database, publishes one job, consumes it once, and stops cleanly.
- [ ] Implement one worker entry that creates the database/boss clients, registers handlers, reports readiness, and handles SIGTERM with bounded shutdown.
- [ ] Run the worker smoke test. Expected: PASS with no open handle.
- [ ] Commit with `git commit -m "feat: add PostgreSQL-backed worker process"`.

## Task 2: Dispatch the transactional outbox idempotently

- [ ] Write crash-boundary tests for: event committed before publish, publish before dispatched marker, duplicate dispatcher run, handler retry, and permanent failure.
- [ ] Use OutboxEvent ID as the pg-boss singleton/idempotency key. Mark `dispatchedAt` only after successful publish.
- [ ] Keep handlers idempotent with a unique business idempotency key; do not assume exactly-once execution.
- [ ] Add three retries with exponential backoff/jitter and 14-day failed-job retention. Set explicit expiry per queue.
- [ ] Ensure every tenant job stores organization ID, actor ID, correlation ID, input schema version, and idempotency key; handler opens `withOrganization` before data access.
- [ ] Run the crash-boundary integration suite. Expected: one business effect and one audit trail per logical event.
- [ ] Commit with `git commit -m "feat: dispatch transactional outbox jobs idempotently"`.

## Task 3: Move deterministic long-running work to handlers

- [ ] Register menu parsing, both government ingestion tasks, document generation, audit export, retention, and backup verification handlers.
- [ ] Keep normal concurrency at two. Each handler validates payload version, updates queued/running/completed/failed state, and emits safe metrics.
- [ ] Add restart tests for menu import and document generation midway through work; rerun must not duplicate versions or artifacts.
- [ ] Replace any request-path long operation with enqueue plus `202 Accepted` and job status URL.
- [ ] Add `GET /api/jobs/[jobId]` scoped to organization and returning only state, safe error, timestamps, and result reference.
- [ ] Commit with `git commit -m "refactor: run long tasks in idempotent background jobs"`.

## Task 4: Add the minimal llama.cpp adapter

- [ ] Write client tests using a local HTTP stub for success, timeout, connection refusal, malformed JSON, schema mismatch, oversized output, and one repair attempt.
- [ ] Implement native `fetch` to the private `LLAMA_BASE_URL`; fixed model name comes from configuration. Set 8,192 max context, bounded output, five-minute job timeout, and no hosted fallback.
- [ ] Keep prompts versioned as short constants. Request non-thinking, schema-constrained JSON; discard output that remains invalid after one repair.
- [ ] Redact inputs/outputs from normal logs. Store hashes and metadata; store accepted/rejected proposal bodies only under the approved retention rules.
- [ ] Run the local-client unit suite. Expected: all failure modes become typed unavailable/invalid results, not thrown request-path errors.
- [ ] Commit with `git commit -m "feat: add bounded local llama inference adapter"`.

## Task 5: Add only approved human-reviewed AI suggestions

- [ ] Add an `AiSuggestion` model with task, input hash, model/hash, prompt version, output, validator result, status, accepting user, edited final value, and retention timestamps; add RLS.
- [ ] Implement three tasks only: ambiguous menu interpretation, factual quote-difference summary from precomputed facts, and negotiation draft for manual sharing.
- [ ] Write tests that prohibit price creation, authoritative calculation fields, winner/award actions, sending actions, and mutation of issued RFP/submitted quote/award/PO rows.
- [ ] Add accept/edit/reject APIs and simple review UI. No auto-accept, model confidence badge, agent persona, or background mutation.
- [ ] Stop llama.cpp and run the full procurement Playwright journey.

Expected: PASS; AI controls show unavailable/manual fallback without blocking work.

- [ ] Commit with `git commit -m "feat: add optional reviewed AI suggestions"`.

## Task 6: Benchmark Qwen3.5 4B versus 2B on the actual ARM64 shape

- [ ] Create 50 hand-labelled representative Indian menu lines with expected explicit ingredients, quantities, units, and ambiguity flags. Store no real customer data.
- [ ] Implement a benchmark script recording model file hash, quantization, prompt version, fixture hash, peak host memory, latency, schema validity, ingredient F1, and quantity/unit exact match.
- [ ] Run one inference at a time for both candidates on the production-equivalent 2-OCPU/12-GB ARM64 host.
- [ ] Select 4B only if every approved gate passes; otherwise configure 2B. Write the measured report to `docs/benchmarks/local-model-arm64-2026-08-27.md`.
- [ ] Do not tune against or alter expected labels after seeing failures without recording a new dataset version.
- [ ] Commit with `git commit -m "bench: select local model from ARM64 measurements"`.

## Task 7: Remove hosted AI and legacy orchestration dependencies

- [ ] Remove packages for Groq, OpenAI hosted client if unused, LangChain, LangGraph, ChromaDB, Inngest, Resend, IMAP, mail parsing, and Sentry if Phase 5 telemetry has replaced it.
- [ ] Delete legacy source files and environment variables. Regenerate `package-lock.json` and the license report.
- [ ] Run `rg -n "groq|langchain|langgraph|chroma|inngest|resend|OPENAI_API_KEY|GROQ_API_KEY" src package.json .env.sample`.

Expected: no runtime matches.

- [ ] Run unit, integration, worker, and end-to-end tests with outbound internet blocked.
- [ ] Commit with `git commit -m "chore: remove hosted AI and legacy job dependencies"`.

## Task 8: Prove the Phase 4 exit gate

- [ ] Kill the model during a queued AI job; confirm timeout/failure state, manual fallback, retry cap, and unaffected procurement latency.
- [ ] Kill the worker after publish and before completion; restart and confirm one business result.
- [ ] Verify dead-letter visibility and safe operator retry.
- [ ] Run `npm test`, `npm run test:integration`, `npm run test:worker`, `npm run test:e2e`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Commit verification fixes with `git commit -m "test: verify local AI independence and job reliability"`.

## Phase 4 exit gate

- [ ] Core procurement works with worker-delayed AI and with llama.cpp stopped.
- [ ] Outbox/job crash tests produce no lost or duplicated business effect.
- [ ] AI can only create reviewable suggestions for the three approved tasks.
- [ ] The selected 4B/2B artifact passes the measured resource/quality gates.
- [ ] No hosted AI, vector database, Inngest, autonomous agent, or paid API dependency remains.
