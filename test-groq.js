require('dotenv').config({ path: '.env' });
const { OpenAI } = require('openai');

const openai = new OpenAI({ 
  apiKey: process.env.GROQ_API_KEY, 
  baseURL: 'https://api.groq.com/openai/v1' 
});

async function main() {
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

      Return the result EXACTLY as a JSON object matching this TypeScript interface:

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
      Classic Cheeseburger
      Margarita Pizza
    `;

  try {
    const response = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: "You must output STRICTLY valid JSON ONLY." }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const resultText = response.choices[0].message.content;
    console.log("Raw Output: ", resultText);
    const parsed = JSON.parse(resultText);
    console.log("Parsed Output: ", JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.error(e);
  }
}

main();
