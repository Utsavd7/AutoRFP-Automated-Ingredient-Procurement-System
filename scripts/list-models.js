const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function run() {
    try {
        // Since @google/generative-ai doesn't have a direct listModels, 
        // I will try a few likely variations or use the REST API via fetch
        console.log("Checking gemini-1.5-flash and gemini-2.0-flash...");
    } catch (error) {
        console.error(error);
    }
}
run();
