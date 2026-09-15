import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { PRODESK_ORIGINS } from '../../lib/origins';

/**
 * Affiliate program — ports `ProfileAffiliateCard`. Builds a referral link and
 * copies it to the clipboard. Agency-referred users get a note that referrals
 * are attributed to their agency.
 */
export function AffiliateCard({
  userId,
  referredByAgencyId,
}: {
  userId: string;
  referredByAgencyId?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : `https://${PRODESK_ORIGINS.app}`;
  const link = `${origin}/signup?ref_user_id=${userId}`;

  function copy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Affiliate Program</CardTitle>
        <CardDescription>
          Share your link — earn when people you refer sign up.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input readOnly value={link} className="font-mono text-xs" />
          <Button variant="outline" onClick={copy}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        {referredByAgencyId && (
          <p className="text-xs text-ink-60">
            Note: you were referred by an agency, so your own referrals may be
            attributed to that agency.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
