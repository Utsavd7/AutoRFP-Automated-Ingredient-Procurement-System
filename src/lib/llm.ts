import OpenAI from 'openai';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
type ExternalAIEnvironment = {
    AUTORFP_ALLOW_EXTERNAL_AI?: string;
    NODE_ENV?: string;
};

// Local Ollama — no key, no cost, runs on your machine
const ollamaClient = new OpenAI({
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    timeout: 5000,
    maxRetries: 0,
});

// Groq client — lazily created on first use so the env var is always read at call time,
// not at module initialisation (avoids Turbopack cache timing issues).
let _groqClient: { key: string; client: OpenAI } | null = null;

export function isExternalAIEnabled(
    env: ExternalAIEnvironment = process.env,
): boolean {
    return env.AUTORFP_ALLOW_EXTERNAL_AI === 'true' && env.NODE_ENV !== 'production';
}

function getGroqClient(): OpenAI | null {
    if (!isExternalAIEnabled()) return null;

    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    if (_groqClient?.key === key) return _groqClient.client;

    const client = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1', timeout: 30000 });
    _groqClient = { key, client };
    return client;
}

// Exported so routes can check if Groq is available without importing the client directly.
export const groqClient = { get value() { return getGroqClient(); } };

export async function callOllama(messages: Message[], jsonMode = false): Promise<string> {
    const response = await ollamaClient.chat.completions.create({
        model: 'llama3.2',
        messages,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
    });
    return response.choices[0].message.content ?? '';
}

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-8b-8192'];

export async function callGroq(messages: Message[], jsonMode = false): Promise<string> {
    const client = getGroqClient();
    if (!client) throw new Error('External AI is disabled or unavailable');
    let lastError: unknown;
    for (const model of GROQ_MODELS) {
        try {
            const response = await client.chat.completions.create({
                model,
                messages,
                ...(jsonMode && { response_format: { type: 'json_object' } }),
            });
            const content = response.choices[0].message.content ?? '';
            if (model !== GROQ_MODELS[0]) console.log(`[llm] Groq used fallback model: ${model}`);
            return content;
        } catch (error: unknown) {
            lastError = error;
            if (
                typeof error === 'object' &&
                error !== null &&
                'status' in error &&
                error.status === 429
            ) {
                console.warn(`[llm] Groq rate-limited on ${model}, trying next model`);
                continue;
            }
            throw error;
        }
    }
    throw lastError ?? new Error('External AI request failed');
}

// Groq-first, Ollama-second — no circular retry if Groq already failed once.
export async function callGroqThenOllama(messages: Message[], jsonMode = false): Promise<string> {
    const client = getGroqClient();
    if (client) {
        try {
            return await callGroq(messages, jsonMode);
        } catch {
            console.warn('[llm] External AI failed; trying local Ollama.');
        }
    }
    try {
        const content = await callOllama(messages, jsonMode);
        if (content.trim()) return content;
        throw new Error('Empty Ollama response');
    } catch {
        throw new Error('No configured language model is available');
    }
}

export function parseJSON<T>(text: string): T | null {
    try {
        const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        return JSON.parse(clean) as T;
    } catch {
        return null;
    }
}
