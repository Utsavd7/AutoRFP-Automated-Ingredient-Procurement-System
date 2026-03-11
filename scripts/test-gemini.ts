const { GoogleGenAI } = require('@google/genai');
const dotenv = require('dotenv');
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is missing in .env');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function testModel(modelName: string) {
    console.log(`Testing model: ${modelName}...`);
    try {
        const result = await ai.models.generateContent({
            model: modelName,
            contents: 'Say "API behaves correctly"'
        });
        console.log(`✅ ${modelName} Success: "${result.text}"`);
    } catch (error: any) {
        console.error(`❌ ${modelName} Failed: ${error.message}`);
    }
}

async function run() {
    await testModel('gemini-2.0-flash');
    await testModel('gemini-1.5-flash');
}

run();
