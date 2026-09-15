import { useQuery } from '@tanstack/react-query';
import { Copy, Gift, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { formatDate, initialsOf } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';

/** Agency affiliate — ports agency_affiliate_screen.dart (link + referred brands). */
export function AgencyAffiliatePage() {
  const trpc = useTRPC();
  const { agencyId } = useActiveContext();
  const referred = useQuery({ ...trpc.agencies.referredBrands.queryOptions({ agencyId: agencyId! }), enabled: !!agencyId });

  const link = agencyId ? `${window.location.origin}/signup?ref=${agencyId}` : '';

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => toast.success('Affiliate link copied'));
  }

  const brands = referred.data ?? [];

  return (
    <div>
      <PageHeader title="Affiliate" description="Refer brands and earn affiliate commission." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle>Your affiliate link</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-accent/12 text-accent"><Gift className="h-5 w-5" /></div>
            <Input readOnly value={link} className="flex-1 font-mono text-sm" />
            <Button variant="outline" disabled={!link} onClick={copy}><Copy className="h-4 w-4" /> Copy</Button>
          </CardContent>
        </Card>

        <Card className="p-0">
          <div className="border-b border-[color:var(--color-border-default)] px-5 py-4 font-semibold text-ink-100">Referred brands</div>
          {referred.isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : brands.length === 0 ? (
            <EmptyState icon={Users} title="No referrals yet" description="Share your link to start earning." />
          ) : (
            <ul className="divide-y divide-[color:var(--color-border-default)]">
              {brands.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar className="h-8 w-8">
                    {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                    <AvatarFallback>{initialsOf(b.businessName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink-100">{b.businessName}</div>
                    {b.email && <div className="truncate text-xs text-ink-40">{b.email}</div>}
                  </div>
                  <span className="text-xs text-ink-40">{formatDate(b.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
