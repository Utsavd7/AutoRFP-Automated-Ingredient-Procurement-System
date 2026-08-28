'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Building2,
  CheckCircle,
  Hash,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Settings,
} from 'lucide-react';

import type { RestaurantAccount } from '@/lib/tenant';

export default function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pin, setPin] = useState('');
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const loadAccount = (nextAccount: RestaurantAccount) => {
    setAccount(nextAccount);
    setName(nextAccount.name);
    setEmail(nextAccount.email);
    setAddressLine(nextAccount.addressLine ?? nextAccount.location);
    setCity(nextAccount.city ?? '');
    setState(nextAccount.state ?? '');
    setPin(nextAccount.pin ?? '');
    setPhone(nextAccount.phone ?? '');
  };

  useEffect(() => {
    let active = true;

    fetch('/api/account')
      .then(async res => {
        if (!res.ok) throw new Error('Unable to load account settings.');
        return await res.json() as { account?: RestaurantAccount };
      })
      .then(({ account: loadedAccount }) => {
        if (!active || !loadedAccount) return;
        loadAccount(loadedAccount);
      })
      .catch(() => {
        if (active) setSaveError('Unable to load account settings.');
      });

    return () => {
      active = false;
    };
  }, []);

  const valid = Boolean(
    name.trim() &&
    email.includes('@') &&
    addressLine.trim() &&
    city.trim() &&
    state.trim() &&
    pin.trim() &&
    phone.trim(),
  );

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;

    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const res = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          addressLine,
          city,
          state,
          pin,
          phone,
        }),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.error || 'Unable to save account settings.');
      }
      const { account: updated } = await res.json() as {
        account?: RestaurantAccount;
      };
      if (!updated) throw new Error('Account update was not accepted.');

      loadAccount(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Unable to save account settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    if (!confirm('Sign out of this restaurant workspace?')) return;
    await signOut({ redirect: false });
    router.push('/');
  };

  const inputClass =
    'w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/40';

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-[28px] font-black tracking-tight text-[#EEEEEE]">Settings</h1>
        <p className="mt-1 text-[13px] text-[#8A8F98]">
          Manage the restaurant and contact details saved to this workspace.
        </p>
      </div>

      <div className="linear-panel overflow-hidden rounded-xl border border-white/[0.06]">
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-white/[0.01] px-6 py-4">
          <Settings className="h-4 w-4 text-[#8A8F98]" />
          <span className="text-[12px] font-bold uppercase tracking-wider text-[#EEEEEE]">Account</span>
          {account && (
            <span className="ml-auto text-[10px] font-mono text-[#8A8F98]">
              {account.tenantId}
            </span>
          )}
        </div>
        <form onSubmit={handleSave} className="space-y-4 p-6">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
            <Building2 className="mr-1.5 inline h-3 w-3" />Restaurant name
            <input value={name} onChange={event => setName(event.target.value)} className={`${inputClass} mt-1.5`} />
          </label>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
            <Mail className="mr-1.5 inline h-3 w-3" />Work email
            <input type="email" value={email} onChange={event => setEmail(event.target.value)} className={`${inputClass} mt-1.5`} />
          </label>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
            <MapPin className="mr-1.5 inline h-3 w-3" />Address
            <input value={addressLine} onChange={event => setAddressLine(event.target.value)} className={`${inputClass} mt-1.5`} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
              City
              <input value={city} onChange={event => setCity(event.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
              State
              <input value={state} onChange={event => setState(event.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
              <Hash className="mr-1.5 inline h-3 w-3" />PIN
              <input inputMode="numeric" value={pin} onChange={event => setPin(event.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-[#8A8F98]">
              <Phone className="mr-1.5 inline h-3 w-3" />Phone
              <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
          </div>

          {saveError && <p className="text-[12px] font-semibold text-red-300">{saveError}</p>}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!valid || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : saved ? <><CheckCircle className="h-3.5 w-3.5" />Saved</> : 'Save changes'}
            </button>
            {saved && <span className="text-[12px] font-bold text-emerald-400">Changes saved successfully</span>}
          </div>
        </form>
      </div>

      <div className="linear-panel overflow-hidden rounded-xl border border-red-500/15">
        <div className="flex items-center gap-2.5 border-b border-red-500/10 bg-red-500/[0.02] px-6 py-4">
          <LogOut className="h-4 w-4 text-red-400/70" />
          <span className="text-[12px] font-bold uppercase tracking-wider text-red-400/80">Session</span>
        </div>
        <div className="flex items-center justify-between gap-4 p-6">
          <div>
            <p className="text-[13px] font-bold text-[#EEEEEE]">Sign out</p>
            <p className="mt-0.5 text-[12px] text-[#8A8F98]">Ends the current authenticated session.</p>
          </div>
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 px-4 py-2 text-[12px] font-bold text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
