import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { callOllama, callGroq, parseJSON } from '@/lib/llm';

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

        // Detect if the user input is a URL (it may arrive as either menuText or sourceUrl)
        const rawInput = menuText || sourceUrl || '';
        const isUrl = /^https?:\/\//i.test(rawInput.trim());

        let menuContent = rawInput;

        if (isUrl) {
            try {
                console.log(`Fetching menu content from URL: ${rawInput.trim()}`);
                const urlRes = await fetch(rawInput.trim(), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                    },
                    signal: AbortSignal.timeout(12000)
                });
                if (!urlRes.ok) throw new Error(`HTTP ${urlRes.status} from ${rawInput.trim()}`);
                const html = await urlRes.text();
                // Strip scripts, styles, and all HTML tags — keep human-readable text
                menuContent = html
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
                    .replace(/<header[\s\S]*?<\/header>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim()
                    .slice(0, 14000); // 14k chars fits comfortably in llama-3.3-70b context
                console.log(`Fetched ${menuContent.length} chars of menu text from URL`);
            } catch (fetchErr: any) {
                console.warn(`Failed to fetch URL: ${fetchErr.message}. Will use mock data.`);
                menuContent = '';
            }
        }

        const sysMsg = { role: 'system' as const, content: 'You are a JSON-only API. Output strictly valid JSON and nothing else.' };

        const buildPrompt = (content: string) => `
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
${content}
`;
        const groqMessages = [sysMsg, { role: 'user' as const, content: buildPrompt(menuContent) }];

        const insightPrompt = `You are a restaurant procurement assistant. Given the following menu text, write exactly 2 concise sentences for a buyer: identify the dominant protein sources and most cost-volatile ingredients, and flag any seasonal or price-risk items worth watching. Be specific and practical.

Menu:
${menuContent.slice(0, 2000)}`;

        const ollamaInsightMessages = [
            { role: 'system' as const, content: 'You are a concise procurement assistant. Reply in plain text, 2 sentences max.' },
            { role: 'user' as const, content: insightPrompt },
        ];

        // Run Groq (extraction) + Ollama (insight) in parallel — no sequential blocking
        const ollamaInsightPromise = Promise.race([
            callOllama(ollamaInsightMessages, false),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Ollama timeout')), 10000)),
        ]);

        let parsedData: { dishes: any[] } | null = null;
        let modelSource = 'Mock';
        let menuInsight: string | null = null;

        // Start both in parallel
        const [groqResult, ollamaResult] = await Promise.allSettled([
            (async () => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const text = await callGroq(groqMessages, true);
                        const data = parseJSON<{ dishes: any[] }>(text);
                        if (data?.dishes?.length) return { data, source: 'Groq (llama-3.3-70b)' };
                    } catch (err: any) {
                        console.warn(`parse-menu: Groq attempt ${attempt + 1} failed:`, err.message);
                    }
                }
                return null;
            })(),
            ollamaInsightPromise,
        ]);

        if (groqResult.status === 'fulfilled' && groqResult.value) {
            parsedData = groqResult.value.data;
            modelSource = groqResult.value.source;
            console.log('parse-menu: Groq succeeded');
        }

        if (ollamaResult.status === 'fulfilled' && ollamaResult.value?.trim()) {
            menuInsight = ollamaResult.value.trim();
            console.log('parse-menu: Ollama insight generated');
        } else {
            console.warn('parse-menu: Ollama insight skipped:', ollamaResult.status === 'rejected' ? ollamaResult.reason?.message : 'empty');
        }

        // Last resort: mock data
        if (!parsedData || !parsedData.dishes?.length) {
            parsedData = { dishes: MOCK_DISHES };
            modelSource = 'Mock';
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
            modelSource,
            menuInsight,
        });

    } catch (error: any) {
        console.error('Error in parse-menu route:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to parse menu' },
            { status: 500 }
        );
    }
}
