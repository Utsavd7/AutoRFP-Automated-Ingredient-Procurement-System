#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

LOG_DIR="${TMPDIR:-/tmp}/autorfp-demo"
mkdir -p "$LOG_DIR"

echo "AutoRFP demo setup"
echo "Workspace: $ROOT_DIR"

if command -v chroma >/dev/null 2>&1; then
  if ! lsof -i :8000 >/dev/null 2>&1; then
    echo "Starting ChromaDB on :8000..."
    chroma run --path "$ROOT_DIR/chroma_data" > "$LOG_DIR/chroma.log" 2>&1 &
  else
    echo "ChromaDB already running on :8000."
  fi
else
  echo "ChromaDB command not found. Skipping vector store startup; app will degrade gracefully."
fi

if ! lsof -i :3000 >/dev/null 2>&1; then
  echo "Starting Next.js on :3000..."
  npm run dev > "$LOG_DIR/next.log" 2>&1 &
else
  echo "Next.js already running on :3000."
fi

echo "Waiting for app..."
for _ in {1..40}; do
  if curl -fsS "http://localhost:3000" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Seeding demo RAG memory..."
if curl -fsS -X POST "http://localhost:3000/api/demo/seed-rag" > "$LOG_DIR/seed-rag.json" 2>&1; then
  echo "Demo RAG seed complete."
else
  echo "Demo RAG seed skipped. See $LOG_DIR/seed-rag.json; app will still run."
fi

DEMO_URL="http://localhost:3000/demo-seed"
echo "Opening $DEMO_URL"
if command -v open >/dev/null 2>&1; then
  open "$DEMO_URL"
else
  echo "Open this URL: $DEMO_URL"
fi

echo ""
echo "Demo login after sign out:"
echo "  email:    demo@autorfp.local"
echo "  password: demo-password"
echo ""
echo "Logs:"
echo "  Next.js:  $LOG_DIR/next.log"
echo "  Chroma:   $LOG_DIR/chroma.log"
echo "  RAG seed: $LOG_DIR/seed-rag.json"
