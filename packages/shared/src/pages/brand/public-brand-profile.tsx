import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Globe, ChevronDown } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { cn, initialsOf } from '../../lib/utils';
import { Card } from '../../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { SpotComponentView, type SpotQuestion } from './spot-view';

interface PublicSection {
  id: string;
  templateName: string;
  answers: unknown;
  questions: SpotQuestion[];
}
interface PublicBrand {
  id: string;
  businessName: string;
  logoUrl: string | null;
  website: string | null;
}

/* ── shared chrome ────────────────────────────────────────────────────────── */

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center text-ink-40">
      Loading…
    </div>
  );
}

function NotFound({ label = 'Info Hub not found' }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center text-ink-60">
      <div>
        <Globe className="mx-auto mb-3 h-10 w-10 text-ink-20" />
        <p className="font-medium text-ink-80">{label}</p>
        <p className="text-sm">No public information available.</p>
      </div>
    </div>
  );
}

function Banner({ brand }: { brand: PublicBrand }) {
  return (
    <div className="border-b border-[color:var(--color-border-default)] bg-card">
      <div className="mx-auto flex max-w-[860px] items-center gap-3 px-4 py-6 md:gap-4 md:px-6 md:py-10">
        <Avatar className="h-12 w-12 animate-in fade-in zoom-in-95 duration-500 md:h-16 md:w-16">
          {brand.logoUrl && <AvatarImage src={brand.logoUrl} />}
          <AvatarFallback>{initialsOf(brand.businessName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 animate-in fade-in slide-in-from-left-2 duration-500">
          <h1 className="text-h3 text-ink-100 md:text-h2">{brand.businessName}</h1>
          {brand.website && (
            <a
              href={brand.website}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm text-accent underline"
            >
              {brand.website}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  index = 0,
  collapsible = true,
}: {
  section: PublicSection;
  index?: number;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both overflow-hidden p-0"
      style={{
        animationDelay: `${Math.min(index, 10) * 70}ms`,
        animationDuration: '420ms',
      }}
    >
      <button
        type="button"
        onClick={() => collapsible && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-3 p-4 text-left md:p-6',
          collapsible && 'hover:bg-inset/50',
        )}
        aria-expanded={open}
      >
        <h2 className="min-w-0 text-base font-semibold text-ink-100">
          {section.templateName}
        </h2>
        {collapsible && (
          <ChevronDown
            className={cn(
              'h-5 w-5 shrink-0 text-ink-40 transition-transform',
              !open && '-rotate-90',
            )}
          />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 md:px-6 md:pb-6">
          <SpotComponentView
            component={section}
            questions={section.questions}
            hideTitle
          />
        </div>
      )}
    </Card>
  );
}

function Footer() {
  return (
    <p className="py-10 text-center text-xs text-ink-30">Powered by Prodesk</p>
  );
}

/* ── full public profile (/public/brand/:id) ─────────────────────────────── */

export function PublicBrandProfilePage() {
  const trpc = useTRPC();
  const [, params] = useRoute('/public/brand/:id');
  const id = params?.id;
  const q = useQuery({
    ...trpc.spot.publicProfile.queryOptions({ brandId: id! }),
    enabled: !!id,
  });

  if (!id || q.isLoading) return q.isLoading ? <Loading /> : null;
  if (!q.data) return <NotFound />;

  const { brand, sections } = q.data;
  return (
    <div className="min-h-screen bg-paper">
      <Banner brand={brand} />
      <div className="mx-auto max-w-[860px] px-4 py-6 md:px-6 md:py-8">
        {sections.length === 0 ? (
          <p className="py-16 text-center text-ink-40">
            No public information available.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {sections.map((s, i) => (
              <SectionCard key={s.id} section={s as PublicSection} index={i} />
            ))}
          </div>
        )}
        <Footer />
      </div>
    </div>
  );
}

/* ── single shared section (/public/brand/form/:componentId) ──────────────── */

export function PublicBrandFormPage() {
  const trpc = useTRPC();
  const [, params] = useRoute('/public/brand/form/:componentId');
  const componentId = params?.componentId;
  const q = useQuery({
    ...trpc.spot.publicComponent.queryOptions({ componentId: componentId! }),
    enabled: !!componentId,
  });

  if (!componentId || q.isLoading) return q.isLoading ? <Loading /> : null;
  if (!q.data || !q.data.brand) return <NotFound label="Section not found" />;

  const { brand, section } = q.data;
  return (
    <div className="min-h-screen bg-paper">
      <Banner brand={brand} />
      <div className="mx-auto max-w-[860px] px-4 py-6 md:px-6 md:py-8">
        <SectionCard section={section as PublicSection} collapsible={false} />
        <Footer />
      </div>
    </div>
  );
}
