import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { callOllama, callGroq, parseJSON } from '@/lib/llm';

const prisma = new PrismaClient();

type ParsedIngredient = {
    name: string;
    quantity: number;
    unit: string;
};

type ParsedDish = {
    name: string;
    ingredients: ParsedIngredient[];
};

const DROP_INGREDIENTS = new Set([
    'salt',
    'black pepper',
    'pepper',
    'water',
    'ice',
]);

function normalizeIngredientName(name: string) {
    return name
        .replace(/\s+/g, ' ')
        .replace(/\b(fresh|chopped|diced|minced|sliced|grated|shaved|toasted|roasted|grilled)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function portionDefaultForIngredient(name: string): ParsedIngredient {
    const lower = name.toLowerCase();

    const count = (quantity: number, unit = 'ct') => ({ name, quantity, unit });
    const oz = (quantity: number) => ({ name, quantity, unit: 'oz' });
    const lb = (quantity: number) => ({ name, quantity, unit: 'lb' });

    if (/\b(bun|roll|bagel|english muffin|tortilla|pita|flatbread)\b/.test(lower)) return count(1);
    if (/\b(egg|eggs)\b/.test(lower)) return count(2);
    if (/\b(ribeye|steak|filet|sirloin|short rib|brisket)\b/.test(lower)) return oz(8);
    if (/\b(beef|burger|patty|lamb|pork|chicken|turkey|duck|salmon|tuna|cod|fish|shrimp|scallop|lobster|crab)\b/.test(lower)) return oz(6);
    if (/\b(pasta|spaghetti|rigatoni|linguine|fettuccine|noodle|rice|risotto|grain|quinoa|couscous)\b/.test(lower)) return oz(4);
    if (/\b(flour|dough|pizza dough|breadcrumb|panko|bread crumb)\b/.test(lower)) return oz(4);
    if (/\b(lettuce|romaine|greens|spinach|arugula|kale|salad)\b/.test(lower)) return oz(3);
    if (/\b(potato|fries|vegetable|broccoli|carrot|tomato|onion|pepper|mushroom|asparagus|zucchini|squash|corn|peas|beans)\b/.test(lower)) return oz(4);
    if (/\b(cheese|cheddar|mozzarella|parmesan|pecorino|ricotta|cream cheese|mascarpone|feta|goat cheese)\b/.test(lower)) return oz(1.5);
    if (/\b(butter|oil|olive oil|canola oil|aioli|mayo|mayonnaise|dressing|vinaigrette|sauce|pesto|marinara|gravy|jus|glaze)\b/.test(lower)) return oz(1);
    if (/\b(cream|milk|yogurt|broth|stock|wine)\b/.test(lower)) return oz(2);
    if (/\b(herb|basil|parsley|cilantro|thyme|rosemary|oregano|chive|dill|mint|garlic|ginger|shallot|lemon|lime)\b/.test(lower)) return oz(0.25);
    if (/\b(sugar|honey|syrup|chocolate|cocoa|nuts|almond|walnut|pecan|fruit|berry|apple|banana|citrus)\b/.test(lower)) return oz(2);

    return oz(2);
}

function sanitizeDishes(dishes: any[] = []): ParsedDish[] {
    return dishes
        .filter(dish => typeof dish?.name === 'string' && dish.name.trim())
        .map(dish => {
            const seen = new Set<string>();
            const ingredients = (Array.isArray(dish.ingredients) ? dish.ingredients : [])
                .filter((ing: any) => typeof ing?.name === 'string' && ing.name.trim())
                .map((ing: any) => normalizeIngredientName(ing.name))
                .filter((name: string) => name && !DROP_INGREDIENTS.has(name.toLowerCase()))
                .filter((name: string) => {
                    const key = name.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .map(portionDefaultForIngredient);

            return { name: dish.name.trim(), ingredients };
        });
}

function needsIngredientEnrichment(dishes: ParsedDish[]) {
    return dishes.some(dish => dish.ingredients.length < 3);
}

const MOCK_DISHES = [
    {
        name: "Truffle Arancini (4pc)",
        ingredients: [
            { name: "Arborio Rice" },
            { name: "Truffle Oil" },
            { name: "Mozzarella" },
            { name: "Breadcrumbs" }
        ]
    },
    {
        name: "Crispy Calamari Fritti",
        ingredients: [
            { name: "Squid" },
            { name: "Flour" },
            { name: "Lemon" },
            { name: "Marinara Sauce" }
        ]
    },
    {
        name: "Classic Cheeseburger",
        ingredients: [
            { name: "Ground Beef" },
            { name: "Hamburger Bun" },
            { name: "Cheddar Cheese" },
            { name: "Iceberg Lettuce" },
            { name: "Tomato" }
        ]
    },
    {
        name: "Margarita Pizza",
        ingredients: [
            { name: "Pizza Dough" },
            { name: "San Marzano Tomatoes" },
            { name: "Mozzarella" },
            { name: "Basil" },
            { name: "Olive Oil" }
        ]
    },
    {
        name: "Caesar Salad",
        ingredients: [
            { name: "Romaine Hearts" },
            { name: "Parmesan Cheese" },
            { name: "Caesar Dressing" },
            { name: "Croutons" }
        ]
    },
    {
        name: "Spaghetti Carbonara",
        ingredients: [
            { name: "Spaghetti" },
            { name: "Guanciale" },
            { name: "Eggs" },
            { name: "Pecorino Romano" }
        ]
    },
    {
        name: "Grilled Ribeye Steak",
        ingredients: [
            { name: "Ribeye Steak" },
            { name: "Butter" },
            { name: "Garlic" },
            { name: "Thyme" }
        ]
    },
    {
        name: "Fish and Chips",
        ingredients: [
            { name: "Cod Fillets" },
            { name: "Potatoes" },
            { name: "Flour" },
            { name: "Canola Oil" }
        ]
    },
    {
        name: "Chicken Tikka Masala",
        ingredients: [
            { name: "Chicken Breast" },
            { name: "Basmati Rice" },
            { name: "Heavy Cream" },
            { name: "Garam Masala" },
            { name: "Tomato Sauce" }
        ]
    },
    {
        name: "Vegetable Stir Fry",
        ingredients: [
            { name: "Broccoli" },
            { name: "Bell Peppers" },
            { name: "Soy Sauce" },
            { name: "Ginger" },
            { name: "Rice" }
        ]
    },
    {
        name: "Classic Tiramisu",
        ingredients: [
            { name: "Mascarpone Cheese" },
            { name: "Ladyfingers" },
            { name: "Espresso" },
            { name: "Cocoa Powder" }
        ]
    },
    {
        name: "New York Cheesecake",
        ingredients: [
            { name: "Cream Cheese" },
            { name: "Graham Cracker Crumbs" },
            { name: "Sugar" },
            { name: "Vanilla Extract" }
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
2. A complete list of ingredients required to make it.
3. For each ingredient, provide ONLY the ingredient name. Quantity/unit may be omitted because the app assigns deterministic portion defaults.
   - First use ingredients explicitly named in the menu item title or description.
   - If the menu only gives a dish name or incomplete description, infer only the missing CORE ingredients with culinary knowledge.
   - Include proteins, starches, buns/breads/pasta, main produce, dairy, signature sauces, and important fats/oils.
   - Exclude salt, pepper, water, generic seasoning blends, tiny garnish, and optional micro-ingredients unless explicitly named as a signature component.
   - Aim for 4-8 procurement-relevant ingredients per entree, 3-6 per appetizer or dessert, unless the menu description clearly requires more.

Output ONLY valid JSON matching this exact schema. No markdown, no explanation, just the JSON:
{
  "dishes": [
    {
      "name": "String",
      "ingredients": [
        { "name": "String" }
      ]
    }
  ]
}

Menu:
${content}
`;

        const buildEnrichmentPrompt = (content: string, currentDishes: ParsedDish[]) => `
You are an expert chef and procurement analyst. Return ONLY valid JSON.

The first extraction may be incomplete. Enrich every dish so each has the full ingredient list needed for one plated guest portion.

Rules:
- Preserve every dish name from the current extraction.
- Use the menu title and description as the source of truth when they mention ingredients.
- If an ingredient is not listed but required to make the dish, infer only core procurement-relevant ingredients with Groq culinary knowledge.
- Include proteins, starches, breads/pasta, main produce, dairy, signature sauces, and important fats/oils.
- Exclude salt, pepper, water, generic seasoning blends, tiny garnish, and optional micro-ingredients unless explicitly named as a signature component.
- Do not include packaging, labor, beverages, or equipment.
- Do not invent quantities. Return ingredient names only.
- Aim for 4-8 procurement-relevant ingredients per entree, 3-6 per appetizer or dessert, unless the description clearly requires more.

Current extraction:
${JSON.stringify({ dishes: currentDishes }, null, 2)}

Original menu text:
${content}

Return ONLY this JSON:
{
  "dishes": [
    {
      "name": "String",
      "ingredients": [
        { "name": "String" }
      ]
    }
  ]
}
`;
        const groqMessages = [sysMsg, { role: 'user' as const, content: buildPrompt(menuContent) }];

        const insightPrompt = `You are a restaurant procurement assistant. Given the following menu text, write exactly 2 concise sentences for a buyer: identify the dominant protein sources and most cost-volatile ingredients, and flag any seasonal or price-risk items worth watching. Be specific and practical.

Menu:
${menuContent.slice(0, 2000)}`;

        const ollamaInsightMessages = [
            { role: 'system' as const, content: 'You are a concise procurement assistant. Reply in plain text, 2 sentences max.' },
            { role: 'user' as const, content: insightPrompt },
        ];

        // Run Groq extraction and local-first insight in parallel. If Ollama is unavailable,
        // callOllama falls back to Groq so the pipeline keeps moving during demos.
        const ollamaInsightPromise = Promise.race([
            callOllama(ollamaInsightMessages, false),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error('AI insight timeout')), 16000)),
        ]);

        let parsedData: { dishes: ParsedDish[] } | null = null;
        let modelSource = 'Mock';
        let menuInsight: string | null = null;

        // Start both in parallel
        const [groqResult, ollamaResult] = await Promise.allSettled([
            (async () => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const text = await callGroq(groqMessages, true);
                        const data = parseJSON<{ dishes: any[] }>(text);
                        const dishes = sanitizeDishes(data?.dishes);
                        if (dishes.length) return { data: { dishes }, source: 'Groq (llama-3.3-70b)' };
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
            console.log('parse-menu: AI insight generated');
        } else {
            console.warn('parse-menu: AI insight skipped:', ollamaResult.status === 'rejected' ? ollamaResult.reason?.message : 'empty');
        }

        // Last resort: mock data
        if (!parsedData || !parsedData.dishes?.length) {
            parsedData = { dishes: sanitizeDishes(MOCK_DISHES) };
            modelSource = 'Mock';
        }

        if (parsedData.dishes.length && modelSource !== 'Mock' && needsIngredientEnrichment(parsedData.dishes)) {
            try {
                const enrichmentMessages = [sysMsg, { role: 'user' as const, content: buildEnrichmentPrompt(menuContent, parsedData.dishes) }];
                const enrichedText = await callGroq(enrichmentMessages, true);
                const enriched = parseJSON<{ dishes: any[] }>(enrichedText);
                const enrichedDishes = sanitizeDishes(enriched?.dishes);
                if (enrichedDishes.length >= parsedData.dishes.length && !needsIngredientEnrichment(enrichedDishes)) {
                    parsedData = { dishes: enrichedDishes };
                    modelSource = `${modelSource} + ingredient enrichment`;
                    console.log('parse-menu: Groq ingredient enrichment succeeded');
                }
            } catch (err: any) {
                console.warn('parse-menu: ingredient enrichment skipped:', err.message);
            }
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
