const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';
const EMBED_DIMENSIONS = 768;

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = error.message;
        if (typeof message === 'string') return message;
    }
    return 'Unknown Ollama error';
}

function fallbackEmbedding(text: string): number[] {
    const vector = new Array(EMBED_DIMENSIONS).fill(0);
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    for (const token of tokens) {
        let hash = 2166136261;
        for (let i = 0; i < token.length; i++) {
            hash ^= token.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        const index = Math.abs(hash) % EMBED_DIMENSIONS;
        vector[index] += 1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map(value => value / magnitude);
}

export async function getEmbedding(text: string): Promise<number[] | null> {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
            signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
        const data: unknown = await res.json();
        if (typeof data !== 'object' || data === null || !('embedding' in data)) return null;
        const embedding = data.embedding;
        return Array.isArray(embedding) && embedding.every((value) => typeof value === 'number')
            ? embedding
            : null;
    } catch (error: unknown) {
        console.warn('[embeddings] Ollama unavailable, using deterministic fallback:', errorMessage(error));
        return fallbackEmbedding(text);
    }
}
