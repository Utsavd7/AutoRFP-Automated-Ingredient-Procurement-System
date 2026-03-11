import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET endpoint to fetch all quotes for a specific menuId
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const menuId = searchParams.get('menuId');

        if (!menuId) {
            return NextResponse.json({ error: 'Menu ID is required' }, { status: 400 });
        }

        // Find all RFPs for this menu that have quotes
        const rfps = await prisma.rFP.findMany({
            where: {
                menuId: menuId,
                status: 'REPLIED'
            },
            include: {
                distributor: true,
                quotes: {
                    orderBy: {
                        price: 'asc' // Order quotes from lowest price to highest
                    }
                }
            }
        });

        // Flatten and format for the frontend
        const formattedQuotes = rfps.map((rfp: any) => {
            const bestQuote = rfp.quotes[0]; // Assuming the first one is the best due to order
            return {
                ...bestQuote,
                distributorName: rfp.distributor.name,
                distributorLocation: rfp.distributor.location,
                rfpId: rfp.id
            };
        }).filter((q: any) => q.price !== undefined); // only include valid quotes

        // Sort the final array by lowest total price
        formattedQuotes.sort((a: any, b: any) => a.price - b.price);

        return NextResponse.json({ quotes: formattedQuotes });

    } catch (error: any) {
        console.error('Error fetching quotes:', error);
        return NextResponse.json(
            { error: 'Failed to fetch quotes' },
            { status: 500 }
        );
    }
}
