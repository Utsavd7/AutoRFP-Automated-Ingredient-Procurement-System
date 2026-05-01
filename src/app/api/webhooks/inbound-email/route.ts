import { NextResponse } from 'next/server';
import { callGroqThenOllama, parseJSON as parseLLMJSON } from '@/lib/llm';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const { rfpId, emailBody } = await req.json();

        if (!rfpId || !emailBody) {
            return NextResponse.json(
                { error: 'Missing rfpId or emailBody in request.' },
                { status: 400 }
            );
        }

        const rfp = await prisma.rFP.findUnique({
            where: { id: rfpId },
            include: { distributor: true }
        });

        if (!rfp) {
            return NextResponse.json({ error: 'RFP not found.' }, { status: 404 });
        }

        if (rfp.status === 'REPLIED' || rfp.status === 'ACCEPTED' || rfp.status === 'DECLINED') {
            return NextResponse.json({ error: 'A quote has already been submitted for this RFP.' }, { status: 400 });
        }

        const parsePrompt = `
You are an expert AI procurement agent. Parse this vendor email and extract the following fields.

Return ONLY valid JSON matching this shape exactly:
{
  "price": number | null,
  "deliveryTerms": "string",
  "details": "string",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "missingInfo": ["string"]
}

Vendor email:
"""
${emailBody}
"""
`;

        const parseText = await callGroqThenOllama([
            { role: 'system', content: 'You are a JSON-only API. Output only valid JSON, no markdown.' },
            { role: 'user', content: parsePrompt }
        ], true);

        const parsed = parseLLMJSON<{
            price: number | null;
            deliveryTerms: string;
            details: string;
            confidence: string;
            missingInfo: string[];
        }>(parseText) ?? JSON.parse(parseText || '{}');

        // If no clear price, generate a follow-up request
        if (!parsed.price || isNaN(Number(parsed.price)) || parsed.confidence === 'LOW') {
            const followUpPrompt = `
You are a professional procurement manager at a restaurant group.
A vendor replied to an RFP but their email was unclear or missing key information.

Missing information: ${JSON.stringify(parsed.missingInfo?.length ? parsed.missingInfo : ['total price', 'delivery terms'])}
Original email: """${emailBody}"""

Write a short, polite follow-up email (3–4 sentences) asking them to clarify the missing details.
Return ONLY the email body text — no subject line, no greeting needed.
`;

            const followUpEmail = await callGroqThenOllama([
                { role: 'user', content: followUpPrompt }
            ]) || 'Could you please clarify your total pricing and delivery terms for this order?';

            console.log(`\n📧 AUTONOMOUS FOLLOW-UP to ${rfp.distributor.email}:\n${followUpEmail}\n`);

            return NextResponse.json({
                success: false,
                action: 'FOLLOW_UP_SENT',
                followUpEmail,
                missingInfo: parsed.missingInfo,
                message: 'Quote was incomplete. A follow-up was automatically generated and logged.'
            });
        }

        const details = [
            parsed.deliveryTerms ? `Delivery: ${parsed.deliveryTerms}` : '',
            parsed.details || '',
            `[AI Confidence: ${parsed.confidence}]`
        ].filter(Boolean).join(' | ');

        const newQuote = await prisma.quote.create({
            data: { rfpId, price: Number(parsed.price), details, status: 'SUBMITTED' }
        });

        await prisma.rFP.update({
            where: { id: rfpId },
            data: { status: 'REPLIED', repliedAt: new Date() }
        });

        return NextResponse.json({
            success: true,
            action: 'QUOTE_SAVED',
            extractedQuote: newQuote,
            parsed
        });

    } catch (error: any) {
        console.error('Error in AI Email Parsing Webhook:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to parse email and save quote.' },
            { status: 500 }
        );
    }
}
