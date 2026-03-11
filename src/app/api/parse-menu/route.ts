import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const openai = process.env.GROQ_API_KEY
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    : null;

const prisma = new PrismaClient();

const MOCK_DISHES = [
    {
        name: "Truffle Arancini (4pc)",
        ingredients: [
            { name: "Arborio Rice", quantity: 0.5, unit: "lbs" },
            { name: "Truffle Oil", quantity: 1, unit: "oz" },
            { name: "Mozzarella", quantity: 4, unit: "oz" },
            { name: "Breadcrumbs", quantity: 2, unit: "oz" }
        ]
    },
    {
        name: "Crispy Calamari Fritti",
        ingredients: [
            { name: "Fresh Squid", quantity: 0.75, unit: "lbs" },
            { name: "Flour", quantity: 4, unit: "oz" },
            { name: "Lemon", quantity: 1, unit: "piece" },
            { name: "Marinara Sauce", quantity: 4, unit: "oz" }
        ]
    },
    {
        name: "Classic Cheeseburger",
        ingredients: [
            { name: "Ground Beef", quantity: 20, unit: "lbs" },
            { name: "Hamburger Buns", quantity: 50, unit: "ct" },
            { name: "Cheddar Cheese Slices", quantity: 5, unit: "lbs" },
            { name: "Iceberg Lettuce", quantity: 10, unit: "heads" }
        ]
    },
    {
        name: "Margarita Pizza",
        ingredients: [
            { name: "Pizza Flour (Type 00)", quantity: 50, unit: "lbs" },
            { name: "San Marzano Tomatoes", quantity: 6, unit: "cans (#10)" },
            { name: "Fresh Mozzarella", quantity: 15, unit: "lbs" },
            { name: "Fresh Basil", quantity: 2, unit: "lbs" }
        ]
    },
    {
        name: "Caesar Salad",
        ingredients: [
            { name: "Romaine Hearts", quantity: 24, unit: "ct" },
            { name: "Parmesan Cheese", quantity: 10, unit: "lbs" },
            { name: "Anchovy Paste", quantity: 2, unit: "tubes" },
            { name: "Croutons", quantity: 5, unit: "lbs" }
        ]
    },
    {
        name: "Spaghetti Carbonara",
        ingredients: [
            { name: "Dry Spaghetti", quantity: 20, unit: "lbs" },
            { name: "Guanciale", quantity: 5, unit: "lbs" },
            { name: "Large Eggs", quantity: 15, unit: "doz" },
            { name: "Pecorino Romano", quantity: 8, unit: "lbs" }
        ]
    },
    {
        name: "Grilled Ribeye Steak",
        ingredients: [
            { name: "Bone-in Ribeye Steaks", quantity: 30, unit: "ct" },
            { name: "Unsalted Butter", quantity: 10, unit: "lbs" },
            { name: "Fresh Garlic", quantity: 3, unit: "lbs" },
            { name: "Fresh Thyme", quantity: 1, unit: "lb" }
        ]
    },
    {
        name: "Fish and Chips",
        ingredients: [
            { name: "Cod Fillets", quantity: 25, unit: "lbs" },
            { name: "Idaho Potatoes", quantity: 50, unit: "lbs" },
            { name: "All-Purpose Flour", quantity: 25, unit: "lbs" },
            { name: "Canola Oil", quantity: 35, unit: "lbs" }
        ]
    },
    {
        name: "Chicken Tikka Masala",
        ingredients: [
            { name: "Chicken Breast", quantity: 40, unit: "lbs" },
            { name: "Basmati Rice", quantity: 50, unit: "lbs" },
            { name: "Heavy Cream", quantity: 4, unit: "gallons" },
            { name: "Garam Masala", quantity: 2, unit: "lbs" }
        ]
    },
    {
        name: "Vegetable Stir Fry",
        ingredients: [
            { name: "Broccoli Florets", quantity: 15, unit: "lbs" },
            { name: "Bell Peppers", quantity: 10, unit: "lbs" },
            { name: "Soy Sauce", quantity: 2, unit: "gallons" },
            { name: "Fresh Ginger", quantity: 3, unit: "lbs" }
        ]
    },
    {
        name: "Classic Tiramisu",
        ingredients: [
            { name: "Mascarpone Cheese", quantity: 10, unit: "lbs" },
            { name: "Ladyfingers", quantity: 20, unit: "packs" },
            { name: "Espresso Beans", quantity: 5, unit: "lbs" },
            { name: "Cocoa Powder", quantity: 2, unit: "lbs" }
        ]
    },
    {
        name: "New York Cheesecake",
        ingredients: [
            { name: "Cream Cheese", quantity: 30, unit: "lbs" },
            { name: "Graham Cracker Crumbs", quantity: 10, unit: "lbs" },
            { name: "Granulated Sugar", quantity: 25, unit: "lbs" },
            { name: "Vanilla Extract", quantity: 32, unit: "oz" }
        ]
    }
];

export async function POST(req: Request) {
    try {
        const { menuText, sourceUrl } = await req.json();

        if (!menuText && !sourceUrl) {
            return NextResponse.json(
                { error: 'Please provide menu text or a source URL.' },
                { status: 400 }
            );
        }

        // If the user gave a URL, fetch its content server-side (Groq cannot browse the web)
        let menuContent = menuText || '';
        if (sourceUrl && !menuText) {
            try {
                const urlRes = await fetch(sourceUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoRFP/1.0)' },
                    signal: AbortSignal.timeout(10000)
                });
                if (!urlRes.ok) throw new Error(`HTTP ${urlRes.status} from ${sourceUrl}`);
                const html = await urlRes.text();
                // Strip HTML tags, collapse whitespace, keep readable text
                menuContent = html
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim()
                    .slice(0, 12000); // cap at 12k chars to stay within token limit
                console.log(`Fetched ${menuContent.length} chars from ${sourceUrl}`);
            } catch (fetchErr: any) {
                console.warn(`Failed to fetch URL content: ${fetchErr.message}. Falling back to mock data.`);
                menuContent = '';
            }
        }

        const prompt = `
You are an expert culinary assistant and a JSON-only API.
Parse the following restaurant menu and extract every dish into a structured recipe format.

For each dish, provide:
1. The dish name.
2. A list of ingredients required to make it.
3. For each ingredient, a realistic quantity (Number) and unit (String) for a restaurant-scale portion.
   - Infer standard ingredients if not listed (e.g., "Burger" → bun, ground beef, lettuce, tomato, cheese).
   - Keep quantities practical (e.g., 0.25, 1, 2).

Output ONLY valid JSON matching this exact schema. No markdown, no explanation, just the JSON:
{
  "dishes": [
    {
      "name": "String",
      "ingredients": [
        { "name": "String", "quantity": Number, "unit": "String" }
      ]
    }
  ]
}

Menu:
${menuContent}
`;

        // Call Groq with up to 2 retries for JSON parsing stability
        let parsedData: { dishes: any[] } | null = null;
        const MAX_RETRIES = 2;

        if (openai) {
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const response = await openai.chat.completions.create({
                        model: 'llama-3.3-70b-versatile',
                        messages: [
                            { role: 'system', content: 'You are a JSON-only API. Output strictly valid JSON and nothing else.' },
                            { role: 'user', content: prompt }
                        ],
                        response_format: { type: 'json_object' }
                    });

                    let resultText = response.choices[0].message.content;
                    if (!resultText) throw new Error('Empty response from Groq');

                    // Strip markdown code fences if model injects them
                    resultText = resultText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
                    parsedData = JSON.parse(resultText);
                    break; // Success — exit retry loop
                } catch (attemptError: any) {
                    console.warn(`Groq attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, attemptError.message);
                    if (attempt === MAX_RETRIES) {
                        console.error('All Groq retries exhausted, falling back to mock data.');
                    }
                }
            }
        } else {
            console.warn('No GROQ_API_KEY found, falling back to mock data.');
        }

        // Use mock data if Groq failed or was unavailable
        if (!parsedData || !parsedData.dishes?.length) {
            parsedData = { dishes: MOCK_DISHES };
        }

        // Save to Database
        const newMenu = await prisma.menu.create({
            data: {
                text: menuText || 'Manual Text Input',
                sourceUrl: sourceUrl || 'Manual Input',
            },
        });

        const savedDishes = [];

        for (const dish of parsedData.dishes) {
            const savedRecipe = await prisma.recipe.create({
                data: {
                    name: dish.name,
                    menuId: newMenu.id,
                    ingredients: {
                        create: dish.ingredients.map((ing: any) => ({
                            name: ing.name,
                            quantity: Number(ing.quantity),
                            unit: ing.unit,
                        })),
                    },
                },
                include: {
                    ingredients: true,
                },
            });
            savedDishes.push(savedRecipe);
        }

        return NextResponse.json({
            success: true,
            menuId: newMenu.id,
            recipes: savedDishes,
        });

    } catch (error: any) {
        console.error('Error in parse-menu route:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to parse menu' },
            { status: 500 }
        );
    }
}
