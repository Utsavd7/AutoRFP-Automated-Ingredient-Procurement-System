'use client';

import { useState, useEffect, use } from 'react';
import { Loader2, DollarSign, Send, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// Ensure the page takes standard param signature for NextJS App Router
export default function QuoteSubmissionPage({ params }: { params: Promise<{ rfpId: string }> }) {
    // Use React.use() to unwrap params per newer Next.js patterns
    const unwrappedParams = use(params);
    const rfpId = unwrappedParams.rfpId;

    const [loading, setLoading] = useState(true);
    const [rfpData, setRfpData] = useState<any>(null);
    const [error, setError] = useState('');

    const [totalQuote, setTotalQuote] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        // Fetch RFP details to display what ingredients they are quoting on
        const fetchRFP = async () => {
            try {
                const response = await fetch(`/api/quote/${rfpId}`);
                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Failed to load RFP');
                if (data.rfp.status === 'REPLIED') {
                    setSubmitted(true);
                }
                setRfpData(data.rfp);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchRFP();
    }, [rfpId]);

    const handleSubmitQuote = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!totalQuote) return;

        setSubmitting(true);
        setError('');

        try {
            const response = await fetch(`/api/quote/${rfpId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    price: parseFloat(totalQuote),
                    details: notes
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to submit quote');

            setSubmitted(true);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        );
    }

    if (error && !rfpData) {
        return (
            <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-2xl max-w-md w-full text-center">
                    <h2 className="font-semibold text-lg mb-2">Error Loading RFP</h2>
                    <p className="text-sm">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-neutral-950 text-neutral-50 p-6 font-sans selection:bg-indigo-500/30">
            <div className="max-w-2xl mx-auto space-y-8 pt-12">

                <header className="text-center space-y-4">
                    <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-2xl mb-2">
                        <DollarSign className="w-8 h-8 text-indigo-400" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Submit Your Quote</h1>
                    <p className="text-neutral-400">
                        {rfpData?.distributor.name}, provide your best pricing for the requested ingredients.
                    </p>
                </header>

                {submitted ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-12 text-center flex flex-col items-center space-y-4">
                        <CheckCircle className="w-16 h-16 text-emerald-500" />
                        <h2 className="text-2xl font-semibold text-emerald-400">Quote Submitted Successfully!</h2>
                        <p className="text-neutral-300">Thank you for submitting your wholesale pricing. The restaurant will be in touch shortly.</p>
                    </div>
                ) : (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl">
                        <form onSubmit={handleSubmitQuote} className="space-y-6">

                            <div className="space-y-4">
                                <h3 className="font-medium text-neutral-200 border-b border-neutral-800 pb-2">Requested Items</h3>
                                <ul className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                                    {/* Flatten ingredients from recipes for display */}
                                    {rfpData?.menu.recipes.map((r: any) => r.ingredients).flat().map((ing: any, idx: number) => (
                                        <li key={idx} className="flex justify-between items-center text-sm p-3 bg-neutral-950 rounded-xl">
                                            <span className="font-medium text-neutral-300">{ing.name}</span>
                                            <span className="text-neutral-500 bg-neutral-900 px-2 py-1 rounded-md">{ing.quantity} {ing.unit}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="pt-6 border-t border-neutral-800 space-y-4">
                                <div>
                                    <label htmlFor="price" className="block text-sm font-medium text-neutral-300 mb-2">
                                        Total Estimated Quote (USD) *
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <span className="text-neutral-500 font-medium">$</span>
                                        </div>
                                        <input
                                            type="number"
                                            id="price"
                                            required
                                            min="0"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={totalQuote}
                                            onChange={(e) => setTotalQuote(e.target.value)}
                                            className="w-full pl-8 pr-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="notes" className="block text-sm font-medium text-neutral-300 mb-2">
                                        Additional Details / Terms (Optional)
                                    </label>
                                    <textarea
                                        id="notes"
                                        rows={4}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="E.g., Delivery guaranteed by Tuesday. Price valid for 14 days."
                                        className="w-full p-4 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={submitting || !totalQuote}
                                className={cn(
                                    "w-full flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-medium transition-all shadow-lg text-lg",
                                    submitting || !totalQuote
                                        ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                                        : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/25 active:scale-[0.98]"
                                )}
                            >
                                {submitting ? (
                                    <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</>
                                ) : (
                                    <><Send className="w-5 h-5" /> Submit Official Quote</>
                                )}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </main>
    );
}
