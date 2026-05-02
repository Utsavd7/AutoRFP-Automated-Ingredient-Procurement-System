'use client';
import { toast } from 'sonner';

export function toastApiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  toast.error(fallback, { description: message !== fallback ? message : undefined });
}

export function toastSuccess(title: string, description?: string) {
  toast.success(title, { description });
}
