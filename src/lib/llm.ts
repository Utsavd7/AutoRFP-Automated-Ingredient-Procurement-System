import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Turbopack doesn't always propagate .env into process.env for server modules.
// dotenv.config() is a no-op if the vars are already set, so this is safe in all envs.
dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true } as any);

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

// Local Ollama — no key, no cost, runs on your machine
const ollamaClient = new OpenAI({
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    timeout: 8000,
});

// Groq client — lazily created on first use so the env var is always read at call time,
// not at module initialisation (avoids Turbopack cache timing issues).
let _groqClient: OpenAI | null | undefined = undefined;

function getGroqClient(): OpenAI | null {
    // Re-check env every time until we get a key — never permanently cache null.
    if (_groqClient) return _groqClient;
    const key = process.env.GROQ_API_KEY;
    if (!key) {
        console.warn('[llm] GROQ_API_KEY not set — Groq disabled');
        return null;
    }
    _groqClient = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1', timeout: 30000 });
    return _groqClient;
}

// Exported so routes can check if Groq is available without importing the client directly.
export const groqClient = { get value() { return getGroqClient(); } };

export async function callOllama(messages: Message[], jsonMode = false): Promise<string> {
    try {
        const response = await ollamaClient.chat.completions.create({
            model: 'llama3.2',
            messages,
            ...(jsonMode && { response_format: { type: 'json_object' } }),
        } as any);
        return response.choices[0].message.content ?? '';
    } catch (err: any) {
        console.warn('[llm] Ollama unavailable, falling back to Groq:', err.message);
        return callGroq(messages, jsonMode);
    }
}

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-8b-8192'];

export async function callGroq(messages: Message[], jsonMode = false): Promise<string> {
    const client = getGroqClient();
    if (!client) throw new Error('No GROQ_API_KEY configured');
    let lastErr: any;
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
        } catch (err: any) {
            lastErr = err;
            if (err?.status === 429) {
                console.warn(`[llm] Groq rate-limited on ${model}, trying next model`);
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

// Groq-first, Ollama-second — no circular retry if Groq already failed once.
export async function callGroqThenOllama(messages: Message[], jsonMode = false): Promise<string> {
    const client = getGroqClient();
    if (client) {
        try {
            return await callGroq(messages, jsonMode);
        } catch (err: any) {
            console.warn('[llm] Groq failed, falling back to Ollama:', err.message);
        }
    }
    try {
        const response = await ollamaClient.chat.completions.create({
            model: 'llama3.2',
            messages,
            ...(jsonMode && { response_format: { type: 'json_object' } }),
        } as any);
        const content = response.choices[0].message.content ?? '';
        if (content.trim()) return content;
        throw new Error('Empty Ollama response');
    } catch (err: any) {
        throw new Error(`Both Groq and Ollama unavailable: ${err.message}`);
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
