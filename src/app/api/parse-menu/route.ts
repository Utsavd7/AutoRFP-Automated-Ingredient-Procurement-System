import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';

const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

const prisma = new PrismaClient();

export async function POST(req: Request) {
    try {
        const { menuText, sourceUrl } = await req.json();

        if (!ai) {
            return NextResponse.json(
                { error: 'Gemini API key is missing. Please add GEMINI_API_KEY to your .env file.' },
                { status: 500 }
            );
        }

        if (!menuText && !sourceUrl) {
            return NextResponse.json(
                { error: 'Please provide menu text or a source URL.' },
                { status: 400 }
            );
        }

        // Prepare prompt for Gemini
        const prompt = `
      You are an expert culinary assistant. I will provide you with a restaurant menu (either as text or a URL).
      Your task is to parse this menu and extract every dish into a structured recipe format.

      For each dish, provide:
      1. The name of the dish.
      2. A list of ingredients required to make it.
      3. For each ingredient, estimate a realistic quantity and unit needed for a standard restaurant-sized portion of that dish.
         - If the menu mentions specific ingredients, use them.
         - If the menu only says "Burger", infer standard ingredients (bun, beef patty, lettuce, tomato, cheese).
         - Keep quantities practical (e.g., 0.25 lbs, 1 piece, 2 oz).

      Return the result EXACTLY as a JSON object matching this TypeScript interface, with no additional markdown formatting or text outside the JSON:

      {
        "dishes": [
          {
            "name": "String",
            "ingredients": [
              {
                "name": "String",
                "quantity": Number,
                "unit": "String"
              }
            ]
          }
        ]
      }

      Here is the menu:
      ${menuText || sourceUrl}
    `;

        // Call Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
            }
        });

        const resultText = response.text;

        if (!resultText) {
            throw new Error("No response from Gemini");
        }

        const parsedData = JSON.parse(resultText);

        // Save to Database
        const newMenu = await prisma.menu.create({
            data: {
                text: menuText,
                sourceUrl: sourceUrl,
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
                            quantity: ing.quantity,
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
        console.error('Error parsing menu:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to parse menu' },
            { status: 500 }
        );
    }
}
