'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import type { AppToast } from '@/lib/toast';

const toneClass = {
  error: 'border-red-500/25 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-100',
  success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100',
  info: 'border-blue-500/25 bg-blue-500/10 text-blue-100',
};

const icons = {
  error: AlertTriangle,
  warning: AlertTriangle,
  success: CheckCircle,
  info: Info,
};

export function ToastViewport() {
  const [toasts, setToasts] = useState<AppToast[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const toast = (event as CustomEvent<AppToast>).detail;
      setToasts(prev => [toast, ...prev].slice(0, 4));
      window.setTimeout(() => setToasts(prev => prev.filter(item => item.id !== toast.id)), 5200);
    };
    window.addEventListener('autorfp:toast', onToast);
    return () => window.removeEventListener('autorfp:toast', onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-[100] w-[min(380px,calc(100vw-2rem))] space-y-3">
      {toasts.map(toast => {
        const Icon = icons[toast.tone];
        return (
          <div key={toast.id} className={`rounded-xl border p-4 shadow-2xl backdrop-blur-xl ${toneClass[toast.tone]}`}>
            <div className="flex items-start gap-3">
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-[#EEEEEE]">{toast.title}</p>
                {toast.message && <p className="text-[12px] text-[#C8CBD2] leading-relaxed mt-1">{toast.message}</p>}
              </div>
              <button
                onClick={() => setToasts(prev => prev.filter(item => item.id !== toast.id))}
                className="text-white/50 hover:text-white transition-colors"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
