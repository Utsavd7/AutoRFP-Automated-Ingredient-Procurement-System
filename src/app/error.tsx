'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-black text-[#EEEEEE] flex items-center justify-center px-6">
      <div className="linear-panel max-w-md w-full rounded-2xl border border-red-500/20 p-8 text-center">
        <AlertTriangle className="w-9 h-9 text-red-400 mx-auto" />
        <h1 className="text-[22px] font-black mt-5">Something went wrong</h1>
        <p className="text-[13px] text-[#8A8F98] leading-relaxed mt-2">
          The demo hit an unexpected UI error. Your local data is still intact.
        </p>
        <button onClick={reset} className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-bold rounded-lg">
          <RotateCcw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
