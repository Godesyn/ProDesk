import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Palette, BookOpen, FileBox, LayoutTemplate, Share2, ChevronRight, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Field } from '../agency/form-bits';
import { normalizeUrl } from '../../lib/url';

const LINKS = [
  { to: '/brand-guidelines', icon: Palette, title: 'Brand Guidelines', desc: 'Colors, logos, typography, voice.' },
  { to: '/info-hub', icon: LayoutTemplate, title: 'Info Hub Forms', desc: 'Sections shown on your profile.' },
  { to: '/documents', icon: FileBox, title: 'Document Locker', desc: 'Files, folders and assets.' },
  { to: '/resources', icon: BookOpen, title: 'Resources & Templates', desc: 'Curated platform & agency resources.' },
];

/**
 * Brand profile settings hub — Update Brand Profile form (Business Info) plus
 * quick links into the brand sub-screens. Ports update_brand_profile_screen.dart.
 */
export function BrandProfilePage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { brandId, activeBrand, loading } = useActiveContext();

  const [businessName, setBusinessName] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [industry, setIndustry] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [abn, setAbn] = useState('');
  const initFor = useRef<string | null>(null);

  useEffect(() => {
    if (activeBrand && initFor.current !== activeBrand.id) {
      setBusinessName(activeBrand.businessName ?? '');
      setWebsite(activeBrand.website ?? '');
      setPhone(activeBrand.phone ?? '');
      setContactName(activeBrand.contactName ?? '');
      setIndustry(activeBrand.industry ?? '');
      setEmail(activeBrand.email ?? '');
      setAddress(activeBrand.address ?? '');
      setAbn(activeBrand.abn ?? '');
      initFor.current = activeBrand.id;
    }
  }, [activeBrand]);

  // Business name is unique across the shared brand+agency namespace, so check
  // availability live as it's typed (like the create-brand form) and block save
  // on a collision — excludeBrandId keeps the brand's own current name from
  // reading as taken, and we only check once the name actually changes.
  const trimmedName = businessName.trim();
  const nameChanged =
    !!activeBrand && trimmedName.toLowerCase() !== (activeBrand.businessName ?? '').trim().toLowerCase();
  const debouncedName = useDebounced(trimmedName, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName, excludeBrandId: brandId ?? undefined }),
    enabled: !!nameChanged && debouncedName.length > 1,
  });
  const showNameStatus = !!nameChanged && debouncedName.length > 1;
  const nameTaken = !!nameChanged && !!nameCheck.data && !nameCheck.data.available;

  const save = useMutation({
    ...trpc.brands.update.mutationOptions(),
    onSuccess: () => { toast.success('Profile updated'); qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() }); },
    onError: (e) => toastError(e),
  });

  const shareProfile = () => {
    if (!brandId) return;
    navigator.clipboard.writeText(`${window.location.origin}/public/brand/${brandId}`).then(
      () => toast.success('Profile link copied'),
      () => toast.error('Copy failed'),
    );
  };

  if (loading) return <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (!brandId) return <EmptyState icon={Palette} title="No brand selected" description="Create a brand profile first." />;

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader
        title="Brand Profile"
        description="Manage your business information and brand assets."
        action={<Button variant="outline" onClick={shareProfile}><Share2 className="h-4 w-4" /> Share Profile</Button>}
      />

      <Card className="mb-6 p-4 md:p-6">
        <h3 className="mb-4 text-sm font-semibold text-ink-100">Business Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business Name" htmlFor="bn" error={nameTaken ? (nameCheck.data?.reason ?? 'This business name is already taken') : null}>
            <div className="relative">
              <Input id="bn" className="pr-9" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              {showNameStatus && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {nameCheck.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-ink-40" />
                  ) : nameCheck.data?.available ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : nameCheck.data ? (
                    <X className="h-4 w-4 text-danger" />
                  ) : null}
                </span>
              )}
            </div>
          </Field>
          <Field label="Contact Name" htmlFor="cn"><Input id="cn" value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
          <Field label="Email" htmlFor="em"><Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Business Phone" htmlFor="ph"><Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Website" htmlFor="ws"><Input id="ws" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" /></Field>
          <Field label="Industry" htmlFor="ind"><Input id="ind" value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
          <Field label="Business Address" htmlFor="addr" hint="Shown on tax invoices."><Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, suburb, state, postcode" /></Field>
          <Field label="ABN" htmlFor="abn" hint="Shown on tax invoices."><Input id="abn" value={abn} onChange={(e) => setAbn(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="accent"
            disabled={!businessName.trim() || nameTaken || (showNameStatus && nameCheck.isFetching) || save.isPending}
            onClick={() => {
              // Bare domains (e.g. "acme.com") get an https:// scheme prepended
              // before saving — mirrors Flutter AppValidator.normalizeUrl.
              const normalizedWebsite = normalizeUrl(website);
              setWebsite(normalizedWebsite);
              save.mutate({ brandId, businessName: businessName.trim(), website: normalizedWebsite, phone, contactName, industry, email, address, abn });
            }}
          >
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to}>
            <Card className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-inset/40">
              <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] bg-accent/12 text-accent"><l.icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink-100">{l.title}</div>
                <div className="truncate text-xs text-ink-40">{l.desc}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-ink-40" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Debounce a fast-changing value so we don't fire an availability query per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
