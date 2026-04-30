'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="linear-panel rounded-2xl border border-red-500/20 p-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-[22px] font-black text-[#EEEEEE]">This workspace view failed to load</h1>
            <p className="text-[13px] text-[#8A8F98] leading-relaxed mt-2">
              The app caught the error so the demo does not blank out. Retry the view or continue from the sidebar.
            </p>
            <button onClick={reset} className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-bold rounded-lg">
              <RotateCcw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
