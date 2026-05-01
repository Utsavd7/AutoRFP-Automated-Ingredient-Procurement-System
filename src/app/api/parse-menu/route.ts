import { NextResponse } from 'next/server';
import { callOllama, callGroq, groqClient, parseJSON } from '@/lib/llm';
import { prisma } from '@/lib/prisma';

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
    // Premium cuts — a proper restaurant ribeye or filet is 10–12 oz raw
    if (/\b(ribeye|filet|sirloin|short rib|brisket)\b/.test(lower)) return oz(12);
    if (/\b(steak|strip|chop)\b/.test(lower)) return oz(10);
    // Standard proteins — 6–8 oz raw per cover is industry standard
    if (/\b(salmon|lobster|scallop)\b/.test(lower)) return oz(8);
    if (/\b(beef|burger|patty|lamb|pork|duck|tuna|cod|halibut)\b/.test(lower)) return oz(7);
    if (/\b(chicken|turkey|shrimp|crab|fish)\b/.test(lower)) return oz(6);
    // Dry starches — 3–4 oz dry yields a full restaurant portion
    if (/\b(pasta|spaghetti|rigatoni|linguine|fettuccine|noodle)\b/.test(lower)) return oz(4);
    if (/\b(rice|risotto|grain|quinoa|couscous)\b/.test(lower)) return oz(3);
    if (/\b(pizza dough|dough)\b/.test(lower)) return oz(8);
    if (/\b(flour|breadcrumb|panko|bread crumb)\b/.test(lower)) return oz(3);
    // Produce
    if (/\b(potato|fries)\b/.test(lower)) return oz(8);
    if (/\b(lettuce|romaine|greens|spinach|arugula|kale|salad)\b/.test(lower)) return oz(3);
    if (/\b(tomato|mushroom|asparagus|zucchini|squash)\b/.test(lower)) return oz(4);
    if (/\b(vegetable|broccoli|carrot|pepper|corn|peas|beans|onion)\b/.test(lower)) return oz(4);
    // Dairy
    if (/\b(cream cheese|mascarpone|ricotta)\b/.test(lower)) return oz(3);
    if (/\b(mozzarella|cheddar|parmesan|pecorino|feta|goat cheese|cheese)\b/.test(lower)) return oz(2);
    if (/\b(heavy cream|cream|milk)\b/.test(lower)) return oz(3);
    if (/\b(butter)\b/.test(lower)) return oz(1);
    if (/\b(yogurt)\b/.test(lower)) return oz(2);
    // Liquids and sauces
    if (/\b(broth|stock|wine)\b/.test(lower)) return oz(4);
    if (/\b(marinara|tomato sauce|gravy|jus)\b/.test(lower)) return oz(3);
    if (/\b(dressing|vinaigrette|aioli|mayo|mayonnaise|pesto|sauce|glaze)\b/.test(lower)) return oz(1.5);
    if (/\b(olive oil|canola oil|oil)\b/.test(lower)) return oz(0.5);
    // Aromatics and herbs — small but present
    if (/\b(garlic|ginger|shallot)\b/.test(lower)) return oz(0.5);
    if (/\b(lemon|lime|citrus)\b/.test(lower)) return oz(1);
    if (/\b(herb|basil|parsley|cilantro|thyme|rosemary|oregano|chive|dill|mint)\b/.test(lower)) return oz(0.25);
    // Sweet/baking
    if (/\b(chocolate|cocoa)\b/.test(lower)) return oz(2);
    if (/\b(nuts|almond|walnut|pecan)\b/.test(lower)) return oz(1.5);
    if (/\b(fruit|berry|apple|banana)\b/.test(lower)) return oz(3);
    if (/\b(sugar|honey|syrup)\b/.test(lower)) return oz(1);

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
        const { menuText, sourceUrl, tenantId } = await req.json();

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
You are an expert executive chef and procurement specialist. Your job is to extract every dish from a menu and list ALL ingredients a kitchen must actually purchase to make it — including obvious ones AND hidden ones.

For each dish:
1. Start with ingredients explicitly named in the menu description.
2. Then add ALL implicit/hidden procurement ingredients a chef knows are required:
   - Cooking fats: butter, oil, or lard used to cook the protein or sauté vegetables
   - Bases: stock, broth, or wine used in sauces or braises
   - Starches: pasta, rice, bread, or potato if the dish is served with them
   - Dairy: cream, milk, or cheese used in sauces or finishes
   - Aromatics: garlic, onion, or shallots used in the base
   - Acid: lemon juice or vinegar used to finish the dish
   - Binding/coating: flour, eggs, or breadcrumbs if the protein is pan-fried or breaded
3. Exclude only: salt, black pepper, water, and generic "seasoning" unless they are a named signature component.
4. Aim for 6-10 ingredients per entree, 4-7 per appetizer, 4-6 per dessert.

Output ONLY valid JSON. No markdown, no explanation:
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
You are an expert executive chef and procurement specialist. Return ONLY valid JSON.

The first extraction is incomplete. Add ALL missing procurement ingredients a kitchen must buy to make each dish, including hidden ones chefs know are needed.

Rules:
- Preserve every dish name from the current extraction.
- Add missing hidden ingredients: cooking fats (butter/oil), aromatics (garlic/onion/shallot), bases (stock/broth/wine), starches served alongside (rice/pasta/bread/potato), dairy finishes (cream/cheese), acid finishes (lemon/vinegar), coatings (flour/egg/breadcrumb if fried or breaded).
- Keep ingredients already correctly listed.
- Exclude only: salt, black pepper, water, generic "seasoning".
- Do not include packaging, labor, beverages, or equipment.
- Return ingredient names only — no quantities.
- Aim for 6-10 ingredients per entree, 4-7 per appetizer, 4-6 per dessert.

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

        const envKey = process.env.GROQ_API_KEY;
        console.log('parse-menu: GROQ_API_KEY present =', !!envKey, '| prefix =', envKey?.slice(0, 8));
        console.log('parse-menu: groqClient.value =', !!groqClient.value);

        // Start both in parallel
        const [groqResult, ollamaResult] = await Promise.allSettled([
            (async () => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const text = await callGroq(groqMessages, true);
                        console.log(`parse-menu: Groq raw response (attempt ${attempt + 1}):`, text?.slice(0, 200));
                        const data = parseJSON<{ dishes: any[] }>(text);
                        console.log(`parse-menu: parseJSON result dishes count:`, data?.dishes?.length ?? 'null');
                        const dishes = sanitizeDishes(data?.dishes);
                        if (dishes.length) return { data: { dishes }, source: 'Groq (llama-3.3-70b)' };
                        console.warn(`parse-menu: Groq attempt ${attempt + 1} — parsed but sanitizeDishes returned empty`);
                    } catch (err: any) {
                        console.warn(`parse-menu: Groq attempt ${attempt + 1} FULL ERROR:`, err.message, err.status, err.error);
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

        // Groq failed — try Ollama directly for extraction before falling to static data
        if (!parsedData || !parsedData.dishes?.length) {
            try {
                const fallbackContent = menuContent.trim() || 'Generate a realistic restaurant menu with 8 popular dishes covering appetizers, mains, and desserts.';
                const ollamaText = await callOllama(
                    [sysMsg, { role: 'user' as const, content: buildPrompt(fallbackContent) }],
                    true
                );
                const ollamaData = parseJSON<{ dishes: any[] }>(ollamaText);
                const ollamaDishes = sanitizeDishes(ollamaData?.dishes);
                if (ollamaDishes.length) {
                    parsedData = { dishes: ollamaDishes };
                    modelSource = 'Ollama (llama3.2) fallback';
                    console.log('parse-menu: Ollama fallback extraction succeeded');
                }
            } catch (ollamaErr: any) {
                console.warn('parse-menu: Ollama fallback also failed:', ollamaErr.message);
            }
        }

        // Absolute last resort: static dataset — only reached when both Groq and Ollama are unavailable
        if (!parsedData || !parsedData.dishes?.length) {
            parsedData = { dishes: sanitizeDishes(MOCK_DISHES) };
            modelSource = 'Static fallback (all AI providers unavailable)';
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
                tenantId: typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : null,
                text: menuText || 'Manual Text Input',
                sourceUrl: sourceUrl || 'Manual Input',
                workflowStatus: 'PARSED',
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
