import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET endpoint to fetch RFP details for the Quote Submission page
export async function GET(
    req: Request,
    { params }: { params: Promise<{ rfpId: string }> } // updated type to Promise as required by Next 15 App Router
) {
    try {
        const { rfpId } = await params;

        const rfp = await prisma.rFP.findUnique({
            where: { id: rfpId },
            include: {
                distributor: true,
                menu: {
                    include: {
                        recipes: {
                            include: {
                                ingredients: true
                            }
                        }
                    }
                }
            }
        });

        if (!rfp) {
            return NextResponse.json({ error: 'RFP not found' }, { status: 404 });
        }

        return NextResponse.json({ rfp });
    } catch (error: any) {
        console.error('Error fetching RFP:', error);
        return NextResponse.json(
            { error: 'Failed to fetch RFP details' },
            { status: 500 }
        );
    }
}

// POST endpoint to submit a quote
export async function POST(
    req: Request,
    { params }: { params: Promise<{ rfpId: string }> } // updated type to Promise as required by Next 15 App Router
) {
    try {
        const { rfpId } = await params;
        const body = await req.json();
        const { price, details } = body;

        if (price === undefined || price === null) {
            return NextResponse.json(
                { error: 'A quote price is required' },
                { status: 400 }
            );
        }

        // Verify RFP exists and hasn't already been replied to
        const rfp = await prisma.rFP.findUnique({
            where: { id: rfpId }
        });

        if (!rfp) {
            return NextResponse.json({ error: 'RFP not found' }, { status: 404 });
        }

        if (rfp.status === 'REPLIED') {
            return NextResponse.json({ error: 'A quote has already been submitted for this RFP' }, { status: 400 });
        }

        // Use a transaction to create the quote and update the RFP status
        const result = await prisma.$transaction(async (tx) => {
            const newQuote = await tx.quote.create({
                data: {
                    rfpId,
                    price: parseFloat(price),
                    details: details || null
                }
            });

            const updatedRFP = await tx.rFP.update({
                where: { id: rfpId },
                data: { status: 'REPLIED' }
            });

            return { newQuote, updatedRFP };
        });

        return NextResponse.json({ success: true, quote: result.newQuote });

    } catch (error: any) {
        console.error('Error submitting quote:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to submit quote' },
            { status: 500 }
        );
    }
}
