import { ChromaClient, type Metadata } from 'chromadb';

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
            embeddingFunction: null,
        });
        collectionReady = true;
        return col;
    } catch {
        if (!collectionReady) console.warn('[chroma] server not available — RAG context disabled. Start with: chroma run --path ./chroma_data');
        return null;
    }
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = error.message;
        if (typeof message === 'string') return message;
    }
    return 'Unknown ChromaDB error';
}

export interface QuoteRecord {
    id: string;
    text: string;
    embedding: number[];
    metadata: Metadata & {
        distributorName: string;
        tenantId?: string;
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
            metadatas: [record.metadata],
        });
        console.log(`[chroma] ingested quote ${record.id} for ${record.metadata.distributorName}`);
        return true;
    } catch (error: unknown) {
        console.warn('[chroma] ingest failed:', errorMessage(error));
        return false;
    }
}

export interface SimilarQuotesResult {
    documents: (string | null)[];
    metadatas: (Metadata | null)[];
}

export async function searchSimilarQuotes(
    embedding: number[],
    nResults = 3,
    tenantId?: string,
): Promise<SimilarQuotesResult | null> {
    const col = await getCollection();
    if (!col) return null;
    try {
        const results = await col.query({
            queryEmbeddings: [embedding],
            nResults,
            ...(tenantId ? { where: { tenantId } } : {}),
        });
        return {
            documents: results.documents[0] ?? [],
            metadatas: results.metadatas[0] ?? [],
        };
    } catch (error: unknown) {
        console.warn('[chroma] search failed:', errorMessage(error));
        return null;
    }
}
