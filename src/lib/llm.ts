import OpenAI from 'openai';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

// Local Ollama — no key, no cost, runs on your machine
const ollamaClient = new OpenAI({
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    timeout: 60000,
});

// Groq — free tier cross-verifier
export const groqClient = process.env.GROQ_API_KEY
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    : null;

export async function callOllama(messages: Message[], jsonMode = false): Promise<string> {
    const response = await ollamaClient.chat.completions.create({
        model: 'llama3.2',
        messages,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
    } as any);
    return response.choices[0].message.content ?? '';
}

export async function callGroq(messages: Message[], jsonMode = false): Promise<string> {
    if (!groqClient) throw new Error('No GROQ_API_KEY configured');
    const response = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
    });
    return response.choices[0].message.content ?? '';
}

export function parseJSON<T>(text: string): T | null {
    try {
        const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        return JSON.parse(clean) as T;
    } catch {
        return null;
    }
}
