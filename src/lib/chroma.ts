import { ChromaClient } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION = 'autorfp_procurement_history';

let client: ChromaClient | null = null;
let collectionReady = false;

async function getCollection() {
    try {
        if (!client) client = new ChromaClient({ path: CHROMA_URL });
        const col = await client.getOrCreateCollection({
            name: COLLECTION,
            metadata: { description: 'AutoRFP historical procurement quotes for RAG' },
        });
        collectionReady = true;
        return col;
    } catch (err: any) {
        if (!collectionReady) console.warn('[chroma] server not available — RAG context disabled. Start with: chroma run --path ./chroma_data');
        return null;
    }
}

export interface QuoteRecord {
    id: string;
    text: string;
    embedding: number[];
    metadata: {
        distributorName: string;
        location: string;
        price: number;
        ingredients: string;
        timestamp: string;
    };
}

export async function ingestQuote(record: QuoteRecord): Promise<boolean> {
    const col = await getCollection();
    if (!col) return false;
    try {
        await col.upsert({
            ids: [record.id],
            embeddings: [record.embedding],
            documents: [record.text],
            metadatas: [record.metadata as any],
        });
        console.log(`[chroma] ingested quote ${record.id} for ${record.metadata.distributorName}`);
        return true;
    } catch (err: any) {
        console.warn('[chroma] ingest failed:', err.message);
        return false;
    }
}

export async function searchSimilarQuotes(embedding: number[], nResults = 3): Promise<{
    documents: string[];
    metadatas: Record<string, any>[];
} | null> {
    const col = await getCollection();
    if (!col) return null;
    try {
        const results = await col.query({ queryEmbeddings: [embedding], nResults });
        return {
            documents: (results.documents[0] ?? []) as string[],
            metadatas: (results.metadatas[0] ?? []) as Record<string, any>[],
        };
    } catch (err: any) {
        console.warn('[chroma] search failed:', err.message);
        return null;
    }
}
