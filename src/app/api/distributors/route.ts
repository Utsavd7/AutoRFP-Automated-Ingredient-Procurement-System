import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Uses MOCK_EMAIL from .env if set, otherwise generates a safe demo address
function generateMockEmail(name: string) {
    if (process.env.MOCK_EMAIL) return process.env.MOCK_EMAIL;
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `quotes+${cleanName}@autorfp.demo`;
}

export async function POST(req: Request) {
    try {
        const { location } = await req.json();

        if (!location) {
            return NextResponse.json({ error: 'Please provide a location (e.g., "New York, NY").' }, { status: 400 });
        }

        const apiKey = process.env.GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
            console.warn('GOOGLE_MAPS_API_KEY is not set. Using fallback mock data.');
            // Return beautiful mock data for the demo
            const mockDistributors = [
                { name: 'Sysco Local Distribution', location: location, email: generateMockEmail('Sysco Local') },
                { name: 'US Foods Hub', location: location, email: generateMockEmail('US Foods') },
                { name: 'Gordon Food Service', location: location, email: generateMockEmail('Gordon Food') },
                { name: 'Apex Wholesale Grocers', location: location, email: generateMockEmail('Apex Wholesale') },
            ];

            const savedDistributors = [];
            for (const d of mockDistributors) {
                // Save mock data to DB if not exists
                let distributor = await prisma.distributor.findFirst({ where: { name: d.name, location } });
                if (!distributor) {
                    distributor = await prisma.distributor.create({ data: d });
                }
                savedDistributors.push(distributor);
            }

            return NextResponse.json({ distributors: savedDistributors });
        }

        // Call Google Places Text Search (New) API
        // We search for food wholesale distributors near the provided location
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const payload = {
            textQuery: `food wholesale distributor near ${location}`,
            maxResultCount: 5,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.id',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Failed to fetch from Google Places');
        }

        if (!data.places || data.places.length === 0) {
            return NextResponse.json({ error: 'No distributors found in that area.' }, { status: 404 });
        }

        const savedDistributors = [];

        for (const place of data.places) {
            const name = place.displayName?.text || 'Unknown Distributor';
            const address = place.formattedAddress || location;
            const email = generateMockEmail(name); // Routes to MOCK_EMAIL if set in .env

            // Check if already in DB
            let distributor = await prisma.distributor.findFirst({
                where: { name, location: address },
            });

            if (!distributor) {
                distributor = await prisma.distributor.create({
                    data: {
                        name,
                        location: address,
                        email,
                    },
                });
            }

            savedDistributors.push(distributor);
        }

        return NextResponse.json({ distributors: savedDistributors });

    } catch (error: any) {
        console.error('Error finding distributors:', error);
        return NextResponse.json({ error: error.message || 'Failed to find local distributors' }, { status: 500 });
    }
}
