# AutoRFP - Automated Ingredient Procurement System

AutoRFP is a Next.js web application designed to automate the painful process of restaurant ingredient procurement. Instead of manually breaking down menus, forecasting ingredient costs, finding local wholesale distributors, and emailing them for quotes—AutoRFP does it all in one beautifully designed pipeline.

## Features

This project implements a full end-to-end pipeline covering the following steps:

1. **AI Menu Parsing**: Provide text from a restaurant menu. AutoRFP uses Google's Gemini Flash 2.5 LLM to break the menu down into individual dishes and reverse-engineer the required ingredients and standard restaurant-sized quantities.
2. **Pricing Trends (USDA Simulation)**: Automatically retrieves (simulated) historical pricing trends for the extracted ingredients using realistic randomized market data over the past 6 months. Visualized smoothly with Recharts.
3. **Local Distributor Search**: Uses the Google Places API to dynamically find nearby wholesale food distributors based on a provided city/zip code (e.g., "Maspeth, NY" or "Brooklyn"). It falls back to beautifully mocked data if an API key is not present.
4. **Automated RFP Dispatch**: Generates a Request for Proposal (RFP) for the required ingredients and "sends" it safely to the found distributors (the email payload is logged to the Node console for safety).
5. **Vendor Quote Collection Dashboard**: AutoRFP includes a unique dynamic vendor portal (`/quote/[rfpId]`). When vendors submit their estimates through this link, the main dashboard natively pulls in the incoming quotes and automatically highlights the most cost-effective bid.

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React, Tailwind CSS, Recharts, Lucide Icons.
- **Backend**: Next.js API Routes (Serverless Functions)
- **Database**: SQLite (via Prisma ORM v5)
- **AI**: Google Generative AI SDK (`@google/genai`)

## Setup Instructions

1. **Clone the repository** and install dependencies:
   ```bash
   npm install
   ```

2. **Set up Environment Variables**:

   Copy the sample file and fill in your keys:
   ```bash
   cp .env.sample .env
   ```

   | Variable | Required | Used For |
   |---|---|---|
   | `GEMINI_API_KEY` | ✅ Yes | Menu parsing + AI email quote extraction |
   | `GOOGLE_MAPS_API_KEY` | ⚠️ Optional | Finding real local distributors (falls back to mock data if not set) |
   | `USDA_API_KEY` | ⚠️ Optional | Real ingredient market pricing (falls back to simulation if not set) |
   | `DATABASE_URL` | ✅ Yes | SQLite database (default value works as-is) |

   > 📄 See [`.env.sample`](.env.sample) for step-by-step instructions on how to obtain each API key.

3. **Initialize the Database**:
   Push the schema to the local SQLite database and generate the Prisma client:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Sample Menu for Testing

Paste this URL into the **"Paste Restaurant Menu (Text or URL)"** input to test the full pipeline end-to-end:

```
https://carminesnyc.com/menus/menus-c44-q420-dining
```

This is Carmine's NYC's dining menu — a large Italian-American menu with starters, pastas, mains and desserts, which is great for testing ingredient extraction across many dish categories.

## Project Architecture & Routing

- `src/app/page.tsx`: The main user-facing dashboard containing the 5-step pipeline UI.
- `src/app/quote/[rfpId]/page.tsx`: The external-facing vendor portal where distributors can submit their quotes for a specific RFP.
- `src/app/api/parse-menu/route.ts`: Calls the Gemini LLM to extract and structure recipes.
- `src/app/api/pricing/route.ts`: Generates simulated 6-month historical USDA pricing data.
- `src/app/api/distributors/route.ts`: Integrates with the Google Places `searchText` API to find local entities.
- `src/app/api/send-rfp/route.ts`: Generates the email payload and tracks the RFP status in the DB.
- `src/app/api/quote/[rfpId]/route.ts`: Handles GET requests for RFP details and POST requests for vendors submitting quotes.
- `src/app/api/quotes/route.ts`: Fetches all completed quotes for a specific menu context to display on the dashboard.
- `prisma/schema.prisma`: The database schema tracking Menus, Recipes, Ingredients, Pricing, Distributors, RFPs, and Quotes.

## Notes & Tradeoffs

- **Email Dispatching**: Real emails are not sent to prevent spamming actual businesses found via Google Maps. Instead, the `send-rfp` route mocks the email payload and handles the internal database state shifts, logging the "email" to the terminal.
- **USDA API**: The USDA API is notoriously difficult to get immediate access to and often lacks specific restaurant-grade ingredient data. A robust mathematical simulation is used to generate realistic market fluctuations over 6 months instead of returning hardcoded values.
- **Prisma Edge Compatibility**: Next.js Edge runtime compatibility issues with the latest Prisma client (v7) were circumvented by explicitly using stable version 5.
