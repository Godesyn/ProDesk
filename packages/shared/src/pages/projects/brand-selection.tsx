/**
 * BrandSelection — search existing brands or add a brand-new client inline
 * (ports the Flutter BrandSelectionWidget). A freshly-added brand is returned
 * with `isNew: true`; the caller persists it via brands.createReferral.
 *
 * Shared by the New Project / internal-purchase wizard and the proposal builder.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, X, ArrowLeft } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Field } from '../agency/form-bits';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar';
import { initialsOf } from '../../lib/utils';

/** A picked brand: an existing brand (id) or a freshly-created referral. */
export interface PickedBrand {
  id?: string;
  businessName: string;
  email?: string | null;
  logoUrl?: string | null;
  /** True when this brand was created (not yet persisted) — needs createReferral on submit. */
  isNew?: boolean;
}

export function BrandSelection({ agencyId, brand, onChange, emailRequired }: { agencyId: string; brand: PickedBrand | null; onChange: (b: PickedBrand | null) => void; emailRequired: boolean }) {
  const trpc = useTRPC();
  const [mode, setMode] = useState<'idle' | 'search' | 'add'>('idle');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const results = useQuery({
    ...trpc.brands.searchByName.queryOptions({ agencyId, query }),
    enabled: query.trim().length >= 2,
  });

  if (brand) {
    return (
      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-accent/30 bg-accent/5 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            {brand.logoUrl && <AvatarImage src={brand.logoUrl} />}
            <AvatarFallback>{initialsOf(brand.businessName)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-ink-100">{brand.businessName}</span>
            {brand.email && <span className="text-xs text-ink-40">{brand.email}</span>}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => { onChange(null); setMode('idle'); }}><X className="h-4 w-4" /></Button>
      </div>
    );
  }

  if (mode === 'add') {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-3">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => setMode('search')}><ArrowLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-semibold text-ink-100">Add New Brand</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Business Name" error={err}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme Co" />
          </Field>
          <Field label={emailRequired ? 'Email' : 'Email (Optional)'}>
            <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="hello@acme.com" />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setMode('search')}>Cancel</Button>
          <Button
            variant="accent"
            onClick={() => {
              const name = newName.trim();
              const email = newEmail.trim();
              if (!name) return setErr('Required');
              if (emailRequired && !email) return setErr('Email is required');
              if (email && !email.includes('@')) return setErr('Invalid email');
              setErr(null);
              onChange({ businessName: name, email: email || null, isNew: true });
              setMode('idle');
            }}
          >
            Select
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'search') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-3">
          <Search className="h-4 w-4 text-ink-40" />
          <input
            autoFocus
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-40"
            placeholder="Search by business name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" onClick={() => { setMode('idle'); setQuery(''); }}><X className="h-4 w-4 text-ink-40" /></button>
        </div>
        {query.trim().length >= 2 && (results.data?.length ?? 0) > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)]">
            {results.data!.map((b) => (
              <button
                key={b.id}
                type="button"
                className="flex w-full items-center gap-3 border-b border-[color:var(--color-border-hairline)] px-3 py-2 text-left last:border-b-0 hover:bg-inset"
                onClick={() => { onChange({ id: b.id, businessName: b.businessName, email: b.email, logoUrl: b.logoUrl }); setMode('idle'); setQuery(''); }}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                  <AvatarFallback>{initialsOf(b.businessName)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm text-ink-100">{b.businessName}</span>
                  {b.email && <span className="text-xs text-ink-40">{b.email}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" className="self-start" onClick={() => { setNewName(query); setMode('add'); }}><Plus className="h-3.5 w-3.5" /> New Brand</Button>
      </div>
    );
  }

  return (
    <Button variant="outline" className="self-start" onClick={() => setMode('search')}><Search className="h-4 w-4" /> Search for Brand</Button>
  );
}
