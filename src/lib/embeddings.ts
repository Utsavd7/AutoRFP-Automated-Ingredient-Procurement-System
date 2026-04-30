const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';

export async function getEmbedding(text: string): Promise<number[] | null> {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
            signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data.embedding) ? data.embedding : null;
    } catch (err: any) {
        console.warn('[embeddings] failed:', err.message);
        return null;
    }
}
