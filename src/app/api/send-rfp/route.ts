import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// In a real application, you would use an email service like Resend or Nodemailer
// e.g., import { Resend } from 'resend'; const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
    try {
        const { distributorIds, menuId, ingredients } = await req.json();

        if (!distributorIds || distributorIds.length === 0 || !menuId || !ingredients) {
            return NextResponse.json(
                { error: 'Missing required fields: distributorIds, menuId, or ingredients.' },
                { status: 400 }
            );
        }

        const distributors = await prisma.distributor.findMany({
            where: {
                id: { in: distributorIds }
            }
        });

        if (distributors.length === 0) {
            return NextResponse.json({ error: 'No valid distributors found.' }, { status: 404 });
        }

        const sentRFPs = [];

        // Format the ingredient list for the email body
        const ingredientListText = ingredients.map((ing: any) => `- ${ing.quantity} ${ing.unit} of ${ing.name}`).join('\n');

        // Generate and send an RFP for each distributor
        for (const distributor of distributors) {
            // 1. Create RFP record in database
            const rfp = await prisma.rFP.create({
                data: {
                    menuId: menuId,
                    distributorId: distributor.id,
                    status: 'SENT'
                }
            });

            // 2. Construct Email Content
            const dateString = new Date().toLocaleDateString();
            const emailSubject = `Request for Proposal (RFP) - Ingredient Sourcing [${dateString}]`;

            // Let's generate a unique quote upload link for Step 5 (nice-to-have)
            const quoteFormLink = `http://localhost:3000/quote/${rfp.id}`;

            const emailBody = `
Dear ${distributor.name} Team,

We are looking to source the following ingredients for our upcoming menu cycle.
Please provide your best wholesale pricing and estimated delivery times.

Ingredients Required:
${ingredientListText}

Please submit your quote by clicking the secure link below:
${quoteFormLink}

Thank you,
AutoRFP Procurement Team
        `.trim();

            // 3. Send Email (Mocked for this demo unless API key provided)
            console.log('----------------------------------------------------');
            console.log(`[EMAIL DISPATCHED TO: ${distributor.email}]`);
            console.log(`Subject: ${emailSubject}`);
            console.log(`Body:\n${emailBody}`);
            console.log('----------------------------------------------------');

            /* 
            // Example implementation with Resend if API key was present:
            if (process.env.RESEND_API_KEY) {
               await resend.emails.send({
                 from: 'AutoRFP <procurement@autorfp.demo>',
                 to: distributor.email, // using the mock email generated earlier
                 subject: emailSubject,
                 text: emailBody,
               });
            }
            */

            sentRFPs.push({
                id: rfp.id,
                distributorName: distributor.name,
                status: rfp.status,
                email: distributor.email
            });
        }

        return NextResponse.json({
            success: true,
            message: `Successfully dispatched ${sentRFPs.length} RFPs.`,
            rfps: sentRFPs
        });

    } catch (error: any) {
        console.error('Error sending RFPs:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to send RFP emails' },
            { status: 500 }
        );
    }
}
