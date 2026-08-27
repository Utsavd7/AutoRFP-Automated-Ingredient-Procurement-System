import { NextResponse } from 'next/server';
import { requireApiTenant } from '@/lib/api/require-api-tenant';
import { prisma } from '@/lib/prisma';

// GET endpoint to fetch all quotes for a specific menuId
export async function GET(req: Request) {
    const access = await requireApiTenant();
    if (access.response) return access.response;

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
                tenantId: access.tenant.id,
                status: { in: ['REPLIED', 'NEGOTIATING', 'ACCEPTED', 'DECLINED'] }
            },
            include: {
                distributor: true,
                quotes: {
                    orderBy: {
                        price: 'asc'
                    }
                }
            }
        });

        // Flatten and format for the frontend
        const formattedQuotes = rfps.flatMap((rfp) => {
            const bestQuote = rfp.quotes[0]; // Assuming the first one is the best due to order
            if (!bestQuote) return [];
            return [{
                ...bestQuote,
                distributorName: rfp.distributor.name,
                distributorLocation: rfp.distributor.location,
                rfpId: rfp.id,
                lifecycleStatus: rfp.status,
            }];
        });

        // Sort the final array by lowest total price
        formattedQuotes.sort((a, b) => a.price - b.price);

        return NextResponse.json({ quotes: formattedQuotes });

    } catch (error: unknown) {
        console.error('Error fetching quotes:', error);
        return NextResponse.json(
            { error: 'Failed to fetch quotes' },
            { status: 500 }
        );
    }
}
