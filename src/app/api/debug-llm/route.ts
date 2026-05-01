import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function GET() {
    const key = process.env.GROQ_API_KEY ?? '';
    const keyPresent = !!key;
    const keyPrefix = key.slice(0, 8);

    let groqResult: string | null = null;
    let groqError: string | null = null;

    if (keyPresent) {
        try {
            const client = new OpenAI({
                apiKey: key,
                baseURL: 'https://api.groq.com/openai/v1',
                timeout: 15000,
            });
            const res = await client.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: 'Reply with just: OK' }],
                max_tokens: 5,
            });
            groqResult = res.choices[0].message.content ?? '(empty)';
        } catch (err: any) {
            groqError = err.message;
        }
    }

    return NextResponse.json({
        keyPresent,
        keyPrefix,
        groqResult,
        groqError,
    });
}
