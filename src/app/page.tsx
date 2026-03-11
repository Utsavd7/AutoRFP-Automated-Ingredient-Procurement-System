'use client';
import { useState } from 'react';
import { Loader2, ChefHat, UploadCloud, ChevronRight, TrendingUp, Search, MapPin, Mail } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function Home() {
  // ... existing Home component ...

  const [menuText, setMenuText] = useState('');
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [pricingData, setPricingData] = useState<any[]>([]);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [distributors, setDistributors] = useState<any[]>([]);
  const [distributorLocation, setDistributorLocation] = useState('');
  const [loadingDistributors, setLoadingDistributors] = useState(false);
  const [sendingRFPs, setSendingRFPs] = useState(false);
  const [sentRFPs, setSentRFPs] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  // Email Simulator State
  const [showEmailSimulator, setShowEmailSimulator] = useState(false);
  const [simulatedEmailBody, setSimulatedEmailBody] = useState('');
  const [simulatedEmailRfpId, setSimulatedEmailRfpId] = useState('');
  const [simulatingEmail, setSimulatingEmail] = useState(false);
  const [followUpEmail, setFollowUpEmail] = useState('');
  const [recommendation, setRecommendation] = useState<any>(null);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);
  const [conversationLogs, setConversationLogs] = useState<Record<string, any[]>>({});
  const [simulatingConversation, setSimulatingConversation] = useState(false);

  const [error, setError] = useState('');

  const handleParseMenu = async () => {
    if (!menuText.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuText }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to parse menu');

      setRecipes(data.recipes);

      // Calculate unique ingredients for the next step
      const uniqueIngredientsMap = new Map();
      data.recipes.forEach((recipe: any) => {
        recipe.ingredients.forEach((ing: any) => {
          if (!uniqueIngredientsMap.has(ing.name)) {
            uniqueIngredientsMap.set(ing.name, { ...ing });
          } else {
            // naively aggregate quantities if units match (simplified for demo)
            const existing = uniqueIngredientsMap.get(ing.name);
            if (existing.unit === ing.unit && typeof existing.quantity === 'number' && typeof ing.quantity === 'number') {
              existing.quantity += ing.quantity;
            }
          }
        });
      });
      setIngredients(Array.from(uniqueIngredientsMap.values()));

    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchPricing = async () => {
    if (ingredients.length === 0) return;
    setLoadingPricing(true);
    try {
      const response = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setPricingData(data.pricing);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoadingPricing(false);
    }
  };

  const handleFindDistributors = async () => {
    if (!distributorLocation.trim()) return;
    setLoadingDistributors(true);
    setError('');

    try {
      const response = await fetch('/api/distributors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: distributorLocation }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to find distributors');

      setDistributors(data.distributors);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoadingDistributors(false);
    }
  };

  const handleSendRFPs = async () => {
    if (distributors.length === 0 || ingredients.length === 0) return;
    setSendingRFPs(true);
    setError('');

    try {
      // Collect IDs of our found distributors
      const distributorIds = distributors.map((d) => d.id);

      // We stored menuId implicitly in the recipes, let's grab it from the first one
      const menuId = recipes[0]?.menuId || 'demo-menu-id';

      const response = await fetch('/api/send-rfp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributorIds,
          menuId,
          ingredients
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send RFPs');

      setSentRFPs(data.rfps);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setSendingRFPs(false);
    }
  };

  const handleFetchQuotes = async () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;

    setLoadingQuotes(true);
    setError('');

    try {
      const response = await fetch(`/api/quotes?menuId=${menuId}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to fetch quotes');

      setQuotes(data.quotes);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoadingQuotes(false);
    }
  };

  const handleSimulateEmail = async () => {
    if (!simulatedEmailRfpId || !simulatedEmailBody.trim()) return;
    setSimulatingEmail(true);
    setError('');

    try {
      const response = await fetch('/api/webhooks/inbound-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rfpId: simulatedEmailRfpId,
          emailBody: simulatedEmailBody,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to process email.');

      if (data.action === 'FOLLOW_UP_SENT') {
        // Agent detected incomplete quote — show the generated follow-up email
        setFollowUpEmail(data.followUpEmail);
        setSimulatedEmailBody('');
        setSimulatedEmailRfpId('');
      } else {
        // Quote was saved successfully — refresh dashboard
        setFollowUpEmail('');
        setSimulatedEmailBody('');
        setSimulatedEmailRfpId('');
        setShowEmailSimulator(false);
        await handleFetchQuotes();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setSimulatingEmail(false);
    }
  };

  const handleAutoConversation = async () => {
    if (sentRFPs.length === 0) return;
    setSimulatingConversation(true);
    setError('');
    const newLogs: Record<string, any[]> = {};

    try {
      // Run conversations for all SENT (not yet replied) RFPs
      const unrespondedRFPs = sentRFPs.filter(
        (rfp) => !quotes.some((q) => q.rfpId === rfp.id)
      );

      for (const rfp of unrespondedRFPs) {
        const response = await fetch('/api/simulate-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rfpId: rfp.id,
            ingredients,
            pricingData,
          }),
        });
        const data = await response.json();
        newLogs[rfp.id] = [
          { role: 'system', message: `Simulating conversation with ${rfp.distributorName}...` },
          ...(data.conversationLog || []),
          { role: 'system', message: data.message }
        ];
      }

      setConversationLogs(newLogs);
      // Refresh quotes dashboard after all conversations
      await handleFetchQuotes();
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setSimulatingConversation(false);
    }
  };

  const handleGetRecommendation = async () => {
    const menuId = recipes[0]?.menuId;
    if (!menuId) return;
    setLoadingRecommendation(true);
    setError('');
    try {
      const response = await fetch(`/api/recommend?menuId=${menuId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to get recommendation');
      setRecommendation(data.recommendation);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoadingRecommendation(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 p-8 font-sans selection:bg-indigo-500/30">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-neutral-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ChefHat className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">AutoRFP</h1>
              <p className="text-sm text-neutral-400 font-medium">Automated Ingredient Procurement Pipeline</p>
            </div>
          </div>
        </header>

        {/* Pipeline Step 1 */}
        <section className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-300">
              1
            </div>
            <h2 className="text-xl font-medium tracking-tight">Menu Analysis & Recipe Extraction</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Input Column */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col shadow-xl">
              <label htmlFor="menu" className="block text-sm font-medium text-neutral-300 mb-2">
                Paste Restaurant Menu (Text or URL)
              </label>
              <textarea
                id="menu"
                rows={10}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none shadow-inner"
                placeholder="e.g. Classic Cheeseburger - $12\nSpaghetti Bolognese - $16..."
                value={menuText}
                onChange={(e) => setMenuText(e.target.value)}
              />
              <button
                onClick={handleParseMenu}
                disabled={loading || !menuText.trim()}
                className={cn(
                  "mt-6 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all duration-200",
                  loading || !menuText.trim()
                    ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 active:scale-[0.98]"
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Parsing with AI...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-5 h-5" />
                    Extract Recipes
                  </>
                )}
              </button>

              {error && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Output Column - Recipes */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-xl flex flex-col h-[500px]">
              <h3 className="text-sm font-medium text-neutral-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                Parsed Menu
              </h3>

              <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                {recipes.length === 0 && !loading ? (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3">
                    <ChefHat className="w-12 h-12 opacity-20" />
                    <p className="text-sm text-center">Paste a menu and click extract to see structured recipes appear here.</p>
                  </div>
                ) : null}

                {recipes.map((recipe, idx) => (
                  <div key={idx} className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden group hover:border-neutral-700 transition-colors">
                    <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
                      <h4 className="font-medium text-neutral-100">{recipe.name}</h4>
                      <span className="text-xs font-medium px-2 py-1 bg-neutral-800 text-neutral-300 rounded-md">
                        {recipe.ingredients.length} items
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Output Column - Aggregate Ingredients */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-xl flex flex-col h-[500px] lg:col-span-2">
              <h3 className="text-sm font-medium text-neutral-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                Aggregated Ingredient List
              </h3>
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {ingredients.length === 0 && !loading ? (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3">
                    <p className="text-sm text-center">Ingredients will be aggregated here for procurement.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {ingredients.map((ing, idx) => (
                      <div key={idx} className="p-3 bg-neutral-950 border border-neutral-800 rounded-lg flex flex-col gap-1">
                        <span className="text-sm font-medium text-neutral-200">{ing.name}</span>
                        <span className="text-xs text-neutral-500 font-mono">{ing.quantity} {ing.unit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Pipeline Step 2 */}
        <section className="space-y-6 pt-12 border-t border-neutral-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-300">
                2
              </div>
              <h2 className="text-xl font-medium tracking-tight">Ingredient Pricing & Market Trends</h2>
            </div>
            <button
              onClick={handleFetchPricing}
              disabled={ingredients.length === 0 || loadingPricing}
              className={cn(
                "flex items-center gap-2 py-2 px-4 rounded-xl font-medium text-sm transition-all shadow-sm",
                ingredients.length === 0 || loadingPricing
                  ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 active:scale-[0.98]"
              )}
            >
              {loadingPricing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Fetching Market Data...</>
              ) : (
                <><TrendingUp className="w-4 h-4" /> Fetch Pricing Trends</>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pricingData.length === 0 && !loadingPricing && (
              <div className="col-span-full py-16 flex flex-col items-center justify-center bg-neutral-900 border border-neutral-800 rounded-2xl text-neutral-500">
                <TrendingUp className="w-12 h-12 mb-4 opacity-20" />
                <p>Extract a menu above, then fetch pricing data to see market trends.</p>
              </div>
            )}

            {pricingData.map((item, idx) => {
              // Calculate trend percentage (comparing current to previous month)
              const current = item.history[item.history.length - 1].price;
              const previous = item.history[item.history.length - 2]?.price || current;
              const percentChange = ((current - previous) / previous) * 100;
              const isUp = percentChange > 0;

              return (
                <div key={idx} className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl shadow-lg flex flex-col gap-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium text-neutral-200">{item.name}</h3>
                      <p className="text-xs text-neutral-500 mt-1">Source: USDA Simulated</p>
                    </div>
                    <span className="font-mono text-lg font-semibold text-neutral-100">
                      ${item.currentPrice.toFixed(2)}
                      <span className="text-xs text-neutral-500 ml-1 font-sans">{item.unit}</span>
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <span className={cn(
                      "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md",
                      isUp ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
                    )}>
                      <TrendingUp className={cn("w-3 h-3", !isUp && "rotate-180")} />
                      {Math.abs(percentChange).toFixed(1)}% vs last month
                    </span>
                  </div>

                  {/* Chart area */}
                  <div className="flex-1 mt-4 h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={item.history}>
                        <defs>
                          <linearGradient id={`gradient-${idx}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="date"
                          hide
                        />
                        <YAxis
                          domain={['dataMin - 0.5', 'dataMax + 0.5']}
                          hide
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px', fontSize: '12px' }}
                          labelFormatter={(label) => new Date(label).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Price']}
                        />
                        <Area
                          type="monotone"
                          dataKey="price"
                          stroke="#6366f1"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill={`url(#gradient-${idx})`}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Pipeline Step 3 */}
        <section className="space-y-6 pt-12 border-t border-neutral-800">
          <div className="flex items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-300">
              3
            </div>
            <h2 className="text-xl font-medium tracking-tight">Find Local Distributors</h2>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <MapPin className="h-5 w-5 text-neutral-500" />
                </div>
                <input
                  type="text"
                  value={distributorLocation}
                  onChange={(e) => setDistributorLocation(e.target.value)}
                  placeholder="Enter city or zip code (e.g., 'New York, NY')"
                  className="w-full pl-12 pr-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
                />
              </div>
              <button
                onClick={handleFindDistributors}
                disabled={loadingDistributors || !distributorLocation.trim()}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-medium transition-all shadow-sm w-full md:w-auto",
                  loadingDistributors || !distributorLocation.trim()
                    ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 active:scale-[0.98]"
                )}
              >
                {loadingDistributors ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Searching...</>
                ) : (
                  <><Search className="w-5 h-5" /> Find Suppliers</>
                )}
              </button>
            </div>

            {/* Distributors Results */}
            <div className="mt-8 space-y-4">
              {distributors.length === 0 && !loadingDistributors ? (
                <div className="py-12 flex flex-col items-center justify-center text-neutral-500 border border-neutral-800/50 rounded-xl border-dashed">
                  <MapPin className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm">Search for a location to find wholesale food distributors.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {distributors.map((dist, idx) => (
                    <div key={idx} className="bg-neutral-950 border border-neutral-800 p-5 rounded-xl hover:border-neutral-700 transition-colors group flex flex-col gap-3">
                      <div>
                        <h3 className="font-semibold text-neutral-200 text-lg group-hover:text-indigo-400 transition-colors">{dist.name}</h3>
                        <p className="text-sm text-neutral-500 mt-1 flex items-start gap-2">
                          <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                          {dist.location}
                        </p>
                      </div>
                      <div className="mt-auto pt-3 border-t border-neutral-800 flex items-center justify-between gap-2 overflow-hidden">
                        <div className="flex items-center gap-2 text-xs text-neutral-400 font-mono bg-neutral-900 px-2 py-1 rounded-md overflow-hidden" title={dist.email}>
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{dist.email}</span>
                        </div>
                        {sentRFPs.some((rfp) => rfp.distributorName === dist.name) && (
                          <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md shrink-0">
                            RFP Sent ✓
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Bar for Step 3 to Step 4 transition */}
            {distributors.length > 0 && (
              <div className="mt-6 pt-6 border-t border-neutral-800 flex justify-end">
                <button
                  onClick={handleSendRFPs}
                  disabled={sendingRFPs || sentRFPs.length > 0}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-medium transition-all shadow-sm w-full md:w-auto",
                    sendingRFPs || sentRFPs.length > 0
                      ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 active:scale-[0.98]"
                  )}
                >
                  {sendingRFPs ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Dispatching RFPs...</>
                  ) : sentRFPs.length > 0 ? (
                    <>RFPs Dispatched ✓</>
                  ) : (
                    <><Mail className="w-5 h-5" /> Send RFPs to {distributors.length} Vendors</>
                  )}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Pipeline Step 4 & 5 (Collect & Compare Quotes) */}
        {sentRFPs.length > 0 && (
          <section className="space-y-6 pt-12 border-t border-neutral-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20">
                  4
                </div>
                <div>
                  <h2 className="text-xl font-medium tracking-tight">Review Incoming Quotes</h2>
                  <p className="text-sm text-neutral-400 mt-1">Vendors are submitting pricing for Menu ID: {recipes[0]?.menuId?.substring(0, 8)}...</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAutoConversation}
                  disabled={simulatingConversation || quotes.length >= sentRFPs.length}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-medium text-sm transition-all shadow-sm",
                    simulatingConversation || quotes.length >= sentRFPs.length
                      ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 active:scale-[0.98]"
                  )}
                >
                  {simulatingConversation ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Simulating...</>
                  ) : (
                    <><Mail className="w-4 h-4" /> Auto-Simulate with Groq</>
                  )}
                </button>
                <button
                  onClick={() => setShowEmailSimulator(!showEmailSimulator)}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-medium text-sm transition-all shadow-sm",
                    showEmailSimulator ? "bg-neutral-700 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
                  )}
                >
                  Manual
                </button>
                <button
                  onClick={handleFetchQuotes}
                  disabled={loadingQuotes}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-medium text-sm transition-all shadow-sm",
                    loadingQuotes ? "bg-neutral-800 text-neutral-500" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
                  )}
                >
                  {loadingQuotes ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</> : <>Refresh Dashboard</>}
                </button>
              </div>
            </div>

            {/* Groq Conversation Logs */}
            {Object.keys(conversationLogs).length > 0 && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-5 animate-in fade-in duration-300">
                <h3 className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"></span>
                  Groq Conversation Logs
                </h3>
                {sentRFPs.map((rfp: any) => {
                  const logs = conversationLogs[rfp.id];
                  if (!logs) return null;
                  return (
                    <div key={rfp.id} className="space-y-2 border-t border-neutral-800 pt-4 first:border-0 first:pt-0">
                      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{rfp.distributorName}</p>
                      {logs.map((entry: any, i: number) => (
                        <div key={i} className={cn(
                          "text-xs rounded-xl px-4 py-3 font-mono whitespace-pre-wrap leading-relaxed",
                          entry.role === 'AutoRFP Agent'
                            ? "bg-indigo-950/50 border border-indigo-900/40 text-indigo-200"
                            : entry.role === 'system'
                              ? "text-neutral-500 italic px-1"
                              : "bg-neutral-950 border border-neutral-800 text-neutral-300"
                        )}>
                          {entry.role !== 'system' && (
                            <span className={cn("font-bold block mb-1.5", entry.role === 'AutoRFP Agent' ? "text-indigo-400" : "text-neutral-400")}>
                              {entry.role}:
                            </span>
                          )}
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inbound Email Simulator Block */}
            {showEmailSimulator && (
              <div className="bg-indigo-950/30 border border-indigo-900/50 rounded-2xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <h3 className="text-indigo-300 font-medium">Process Raw Email with AI Agent</h3>
                <p className="text-xs text-indigo-400/80">Test the incoming email parsing agent by pasting a fake reply from a vendor. The Groq AI agent will read the email context and extract the final quoted price automatically.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-indigo-300 uppercase">Select Target Vendor</label>
                    <select
                      className="w-full bg-neutral-900 border border-indigo-900/50 rounded-lg p-2.5 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={simulatedEmailRfpId}
                      onChange={(e) => setSimulatedEmailRfpId(e.target.value)}
                    >
                      <option value="">-- Choose Vendor --</option>
                      {sentRFPs.map(rfp => (
                        <option key={rfp.id} value={rfp.id}>{rfp.distributorName}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="text-xs font-semibold text-indigo-300 uppercase">Raw Email Body</label>
                  <textarea
                    className="w-full bg-neutral-900 border border-indigo-900/50 rounded-lg p-3 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[120px] font-mono"
                    placeholder="e.g., Hi there, thanks for reaching out. We can supply the requested ingredients. The total cost will be $540.50 including shipping limit. Let me know if you want to proceed."
                    value={simulatedEmailBody}
                    onChange={(e) => setSimulatedEmailBody(e.target.value)}
                  ></textarea>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSimulateEmail}
                    disabled={simulatingEmail || !simulatedEmailRfpId || !simulatedEmailBody.trim()}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2 px-6 rounded-xl font-medium text-sm transition-all shadow-sm",
                      simulatingEmail || !simulatedEmailRfpId || !simulatedEmailBody.trim()
                        ? "bg-indigo-900/40 text-indigo-500 cursor-not-allowed"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 active:scale-[0.98]"
                    )}
                  >
                    {simulatingEmail ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Abstracting Quote...</>
                    ) : (
                      <>Process Email with AI</>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
              {quotes.length === 0 && !loadingQuotes ? (
                <div className="py-12 flex flex-col items-center justify-center text-neutral-500 border border-neutral-800/50 rounded-xl border-dashed">
                  <div className="w-10 h-10 mb-3 rounded-full border-2 border-dashed border-neutral-600 animate-spin-slow flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-neutral-600 block"></span>
                  </div>
                  <p className="text-sm">Awaiting vendor responses. Check your inbox or click refresh.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
                    <div className="col-span-5">Distributor</div>
                    <div className="col-span-4">Notes</div>
                    <div className="col-span-3 text-right">Total Est. Quote</div>
                  </div>

                  {/* Quote Rows */}
                  <div className="space-y-3">
                    {quotes.map((quote, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "grid grid-cols-12 gap-4 p-4 rounded-xl items-center transition-colors border",
                          idx === 0
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-100 shadow-sm shadow-emerald-500/10" // Best Price Highlighting
                            : "bg-neutral-950 border-neutral-800 text-neutral-300"
                        )}
                      >
                        <div className="col-span-5 font-medium flex items-center gap-3">
                          {idx === 0 && (
                            <span title="Best Price Automatically Selected" className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-emerald-950 shrink-0">
                              ★
                            </span>
                          )}
                          <div className="truncate">
                            {quote.distributorName}
                            <div className="text-xs text-neutral-500 font-normal truncate mt-0.5">{quote.distributorLocation}</div>
                          </div>
                        </div>
                        <div className="col-span-4 text-sm text-neutral-400 italic truncate">
                          {quote.details || "No additional notes provided."}
                        </div>
                        <div className={cn(
                          "col-span-3 text-right font-mono font-semibold text-lg",
                          idx === 0 ? "text-emerald-400" : "text-neutral-100"
                        )}>
                          ${Number(quote.price).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Follow-up alert when agent detects incomplete quote */}
              {followUpEmail && (
                <div className="mt-4 bg-yellow-950/30 border border-yellow-800/50 rounded-xl p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center gap-2 text-yellow-400 font-semibold text-sm">
                    <span>⚡</span> AI Agent Detected Incomplete Quote — Follow-up Generated
                  </div>
                  <p className="text-xs text-yellow-400/70">The email was unclear or missing pricing. The agent wrote the following follow-up automatically (logged to your terminal in production):</p>
                  <pre className="bg-neutral-950 border border-yellow-900/30 rounded-lg p-4 text-xs text-yellow-200 font-mono whitespace-pre-wrap">{followUpEmail}</pre>
                  <button
                    onClick={() => setFollowUpEmail('')}
                    className="text-xs text-yellow-500 hover:text-yellow-300 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Final AI Recommendation Card */}
              {quotes.length > 0 && (
                <div className="mt-6 pt-6 border-t border-neutral-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-neutral-200">AI Final Recommendation</h3>
                    <button
                      onClick={handleGetRecommendation}
                      disabled={loadingRecommendation}
                      className={cn(
                        "flex items-center gap-2 py-2 px-4 rounded-xl font-medium text-sm transition-all",
                        loadingRecommendation
                          ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/20 active:scale-[0.98]"
                      )}
                    >
                      {loadingRecommendation ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                      ) : (
                        <>✦ Get Recommendation</>
                      )}
                    </button>
                  </div>

                  {recommendation ? (
                    <div className="bg-gradient-to-br from-indigo-950/50 to-neutral-900 border border-indigo-800/40 rounded-2xl p-6 space-y-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-lg shrink-0 shadow-lg shadow-indigo-500/20">
                          ✦
                        </div>
                        <div>
                          <p className="text-xs text-indigo-400 uppercase font-semibold tracking-wider mb-1">Recommended Distributor</p>
                          <h4 className="text-xl font-bold text-white">{recommendation.recommendedDistributor}</h4>
                        </div>
                      </div>
                      <p className="text-sm text-neutral-300 leading-relaxed">{recommendation.reasoning}</p>
                      {recommendation.potentialRisks && (
                        <div className="bg-yellow-950/30 border border-yellow-900/40 rounded-xl px-4 py-3 text-xs text-yellow-300">
                          <span className="font-semibold">⚠ Potential Risk: </span>{recommendation.potentialRisks}
                        </div>
                      )}
                      {recommendation.savings > 0 && (
                        <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg inline-block font-mono">
                          💰 Saves ${Number(recommendation.savings).toFixed(2)} vs most expensive quote
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-neutral-600 text-sm border border-neutral-800/50 border-dashed rounded-xl">
                      Click "Get Recommendation" for an AI-powered analysis across price, delivery terms, and reliability.
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

      </div >
    </main >
  );
}
