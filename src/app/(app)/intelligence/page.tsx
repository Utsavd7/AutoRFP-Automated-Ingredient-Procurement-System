import Link from 'next/link';
import { ArrowRight, BrainCircuit } from 'lucide-react';

export default function IntelligencePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-6 py-12">
      <section className="linear-panel w-full rounded-2xl border border-white/[0.06] p-8 sm:p-12">
        <BrainCircuit className="h-7 w-7 text-violet-300" />
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-violet-300">
          Coming in the launch workflow
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-[#EEEEEE]">
          Procurement intelligence
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#8A8F98]">
          Verified reporting will appear here once the launch procurement data
          needed to support it is available.
        </p>
        <Link
          href="/procurement"
          className="mt-7 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          Create a menu draft
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
