import { IndianRupee } from 'lucide-react';

export default function QuoteSubmissionPage() {
  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-neutral-50">
      <div className="mx-auto max-w-xl pt-24">
        <div className="rounded-2xl border border-white/10 bg-neutral-900 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10">
            <IndianRupee className="h-6 w-6 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Supplier quote portal unavailable
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            Secure supplier quote collection is being enabled in the launch
            workflow. No quote can be viewed or submitted from this link yet.
          </p>
        </div>
      </div>
    </main>
  );
}
