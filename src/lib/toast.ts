'use client';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export type AppToast = {
  id: string;
  title: string;
  message?: string;
  tone: ToastTone;
};

export function showToast(input: Omit<AppToast, 'id'>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('autorfp:toast', {
    detail: {
      ...input,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  }));
}

export function toastApiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  showToast({ tone: 'error', title: fallback, message });
}
