'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { LayoutDashboard, PlusCircle, Clock, Settings, BrainCircuit, Zap, ChefHat } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ITEMS = [
  { label: 'Dashboard',        href: '/dashboard',    icon: LayoutDashboard, group: 'Navigate' },
  { label: 'New Procurement',  href: '/procurement',  icon: PlusCircle,      group: 'Navigate' },
  { label: 'Intelligence',     href: '/intelligence', icon: BrainCircuit,    group: 'Navigate' },
  { label: 'History',          href: '/history',      icon: Clock,           group: 'Navigate' },
  { label: 'Settings',         href: '/settings',     icon: Settings,        group: 'Navigate' },
  { label: 'Run AI Pipeline',  href: '/procurement',  icon: Zap,             group: 'Actions'  },
  { label: 'View Quotes',      href: '/history',      icon: ChefHat,         group: 'Actions'  },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const toggle = useCallback(() => setOpen(o => !o), []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [toggle]);

  const run = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] cmdk-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[520px] mx-4"
          >
            <Command
              className="rounded-xl border border-white/10 bg-[#0d0d0d] shadow-[0_24px_80px_rgba(0,0,0,0.7)] overflow-hidden"
              label="Command palette"
            >
              <div className="flex items-center gap-3 px-4 border-b border-white/[0.07]">
                <svg className="w-4 h-4 text-[#8A8F98] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <Command.Input
                  placeholder="Search pages and actions…"
                  className="flex-1 py-4 bg-transparent text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/60 focus:outline-none"
                  autoFocus
                />
                <kbd className="shrink-0 text-[10px] font-bold text-[#8A8F98] bg-white/[0.05] border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
              </div>
              <Command.List className="max-h-[320px] overflow-y-auto p-2">
                <Command.Empty className="py-10 text-center text-[13px] text-[#8A8F98]">No results found.</Command.Empty>
                {['Navigate', 'Actions'].map(group => (
                  <Command.Group key={group} heading={group} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-[#8A8F98] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest">
                    {ITEMS.filter(i => i.group === group).map(item => (
                      <Command.Item
                        key={item.href + item.label}
                        value={item.label}
                        onSelect={() => run(item.href)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] text-[#8A8F98] cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-[#EEEEEE] transition-colors"
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {item.label}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
              <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center gap-4 text-[10px] font-bold text-[#8A8F98] uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><kbd className="bg-white/[0.05] border border-white/10 rounded px-1 py-0.5">↑↓</kbd> navigate</span>
                <span className="flex items-center gap-1.5"><kbd className="bg-white/[0.05] border border-white/10 rounded px-1 py-0.5">↵</kbd> open</span>
                <span className="ml-auto flex items-center gap-1.5"><kbd className="bg-white/[0.05] border border-white/10 rounded px-1 py-0.5">⌘K</kbd> toggle</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
