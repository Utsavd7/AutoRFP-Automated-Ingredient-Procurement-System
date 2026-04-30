'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Settings, Building2, Mail, MapPin, LogOut, CheckCircle,
  Cpu, Database, Zap, Globe, Target, Utensils, Users
} from 'lucide-react';
import {
  ACCOUNT_KEY,
  accountFromForm,
  parseSuppliers,
  readAccount,
  saveAccount,
  supplierListToText,
  type RestaurantAccount,
} from '@/lib/tenant';

export default function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<RestaurantAccount | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [preferredSuppliers, setPreferredSuppliers] = useState('');
  const [monthlyBudgetTarget, setMonthlyBudgetTarget] = useState('');
  const [savingsTargetPct, setSavingsTargetPct] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const acc = readAccount();
    if (!acc) return;
    setAccount(acc);
    setName(acc.name);
    setEmail(acc.email);
    setLocation(acc.location);
    setCuisineType(acc.cuisineType);
    setPreferredSuppliers(supplierListToText(acc.preferredSuppliers));
    setMonthlyBudgetTarget(acc.monthlyBudgetTarget?.toString() ?? '');
    setSavingsTargetPct(acc.savingsTargetPct?.toString() ?? '');
  }, []);

  const valid = name.trim() && email.includes('@') && location.trim() && cuisineType.trim();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const next = accountFromForm({
      name,
      email,
      location,
      cuisineType,
      preferredSuppliers: parseSuppliers(preferredSuppliers),
      monthlyBudgetTarget: monthlyBudgetTarget ? Number(monthlyBudgetTarget) : null,
      savingsTargetPct: savingsTargetPct ? Number(savingsTargetPct) : null,
    });
    const preserved = account ? { ...next, tenantId: account.tenantId, createdAt: account.createdAt } : next;
    saveAccount(preserved);
    setAccount(preserved);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleSignOut = async () => {
    if (!confirm('Sign out of this restaurant workspace? Tenant history stays isolated and available for the next sign-in.')) return;
    await signOut({ redirect: false });
    localStorage.removeItem(ACCOUNT_KEY);
    router.push('/');
  };

  const inputCls = 'w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-lg text-[14px] text-[#EEEEEE] placeholder:text-[#8A8F98]/40 focus:outline-none focus:ring-1 focus:ring-violet-500/40 focus:border-violet-500/40 transition-all';

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

      <div>
        <h1 className="text-[28px] font-black text-[#EEEEEE] tracking-tight">Settings</h1>
        <p className="text-[13px] text-[#8A8F98] mt-1">Manage restaurant profile, tenant identity, and procurement targets</p>
      </div>

      {/* Account */}
      <div className="linear-panel rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/[0.06] bg-white/[0.01]">
          <Settings className="w-4 h-4 text-[#8A8F98]" />
          <span className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">Account</span>
          {account && <span className="ml-auto text-[10px] font-mono text-[#8A8F98]">{account.tenantId}</span>}
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
              <Building2 className="inline w-3 h-3 mr-1.5" />Restaurant Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. The Oak Room"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
              <Mail className="inline w-3 h-3 mr-1.5" />Work Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@restaurant.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
              <MapPin className="inline w-3 h-3 mr-1.5" />Location
            </label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. New York, NY"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
              <Utensils className="inline w-3 h-3 mr-1.5" />Cuisine Type
            </label>
            <input
              type="text"
              value={cuisineType}
              onChange={e => setCuisineType(e.target.value)}
              placeholder="e.g. Modern American"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
              <Users className="inline w-3 h-3 mr-1.5" />Preferred Suppliers
            </label>
            <input
              type="text"
              value={preferredSuppliers}
              onChange={e => setPreferredSuppliers(e.target.value)}
              placeholder="US Foods, Sysco, Baldor"
              className={inputCls}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
                <Database className="inline w-3 h-3 mr-1.5" />Monthly Budget Target
              </label>
              <input
                type="number"
                min="0"
                value={monthlyBudgetTarget}
                onChange={e => setMonthlyBudgetTarget(e.target.value)}
                placeholder="45000"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#8A8F98] uppercase tracking-widest mb-1.5">
                <Target className="inline w-3 h-3 mr-1.5" />Savings Target %
              </label>
              <input
                type="number"
                min="0"
                max="80"
                value={savingsTargetPct}
                onChange={e => setSavingsTargetPct(e.target.value)}
                placeholder="Target %"
                className={inputCls}
              />
            </div>
          </div>
          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={!valid}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[13px] rounded-lg transition-all"
            >
              {saved ? <><CheckCircle className="w-3.5 h-3.5" />Saved</> : 'Save Changes'}
            </button>
            {saved && <span className="text-[12px] font-bold text-emerald-400">Changes saved successfully</span>}
          </div>
        </form>
      </div>

      {/* Integrations */}
      <div className="linear-panel rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/[0.06] bg-white/[0.01]">
          <Cpu className="w-4 h-4 text-[#8A8F98]" />
          <span className="text-[12px] font-bold text-[#EEEEEE] uppercase tracking-wider">AI & Data Integrations</span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {[
            {
              icon: Cpu,
              name: 'Ollama',
              desc: 'Local LLM inference · llama3.2 · nomic-embed-text',
              status: 'local',
            },
            {
              icon: Zap,
              name: 'Groq',
              desc: 'Cloud LLM · llama-3.3-70b-versatile · requires GROQ_API_KEY',
              status: 'cloud',
            },
            {
              icon: Globe,
              name: 'Market Data',
              desc: 'CME · CBOT · ICE futures · BLS retail price API',
              status: 'live',
            },
            {
              icon: Database,
              name: 'ChromaDB',
              desc: 'Local vector store · tenant-scoped RAG procurement memory',
              status: 'local',
            },
          ].map((item) => (
            <div key={item.name} className="flex items-center gap-4 px-6 py-4">
              <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0">
                <item.icon className="w-4 h-4 text-[#8A8F98]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#EEEEEE]">{item.name}</p>
                <p className="text-[11px] text-[#8A8F98] mt-0.5">{item.desc}</p>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${
                item.status === 'live'  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                item.status === 'cloud' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                'text-[#8A8F98] bg-white/[0.04] border-white/[0.08]'
              }`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="linear-panel rounded-xl border border-red-500/15 overflow-hidden">
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-red-500/10 bg-red-500/[0.02]">
          <LogOut className="w-4 h-4 text-red-400/70" />
          <span className="text-[12px] font-bold text-red-400/80 uppercase tracking-wider">Danger Zone</span>
        </div>
        <div className="p-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-bold text-[#EEEEEE]">Sign out</p>
            <p className="text-[12px] text-[#8A8F98] mt-0.5">Ends the current session. Tenant history remains isolated by workspace.</p>
          </div>
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 border border-red-500/20 hover:border-red-500/40 hover:bg-red-500/10 text-red-400 hover:text-red-300 font-bold text-[12px] rounded-lg transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
