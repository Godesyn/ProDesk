/**
 * Settings → Sequences
 *
 * Three-tab view: Cold Outreach | Engagement Follow-up | Missed Payment
 * Each tab shows:
 *   - Enable/disable toggle
 *   - Touchpoint list (day offset or view tier, SMS + email editors)
 *   - Add/remove touchpoints
 *   - AI rewrite modal per field
 *   - Rules panel (cooldown, max messages)
 *   - Tier gating (engagement requires Close; missed_payment requires Recover)
 */
import { useState } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles, Plus, Trash2, Lock, ChevronDown, ChevronUp, Mail, MessageSquare } from "lucide-react";
import { Link } from "wouter";

type SequenceType = "cold" | "engagement" | "missed_payment";

interface Touchpoint {
  dayOffset?: number;
  viewTier?: string;
  smsEnabled: boolean;
  smsBody: string;
  emailEnabled: boolean;
  emailSubject: string;
  emailBody: string;
  isActive: boolean;
}

interface Rules {
  cooldownHours?: number;
  maxMessagesPerProposal?: number;
  minHoursBetweenMessages?: number;
}

// ── Tier gate info ────────────────────────────────────────────────────────────
const TIER_REQUIREMENTS: Record<SequenceType, { minTier: string } | null> = {
  cold: null,
  engagement: { minTier: "close" },
  missed_payment: { minTier: "recover" },
};

const TIER_ORDER = ["send", "close", "recover"];

function tierMeetsRequirement(currentTier: string, minTier: string): boolean {
  return TIER_ORDER.indexOf(currentTier) >= TIER_ORDER.indexOf(minTier);
}

// ── Placeholder reference ─────────────────────────────────────────────────────
const PLACEHOLDERS = [
  "{{client_first_name}}", "{{client_name}}", "{{business_name}}",
  "{{proposal_title}}", "{{proposal_url}}", "{{portal_url}}", "{{sender_name}}",
];

// ── AI Rewrite Modal ──────────────────────────────────────────────────────────
function AIRewriteModal({
  open,
  onClose,
  channel,
  currentBody,
  sequenceType,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  channel: "sms" | "email";
  currentBody: string;
  sequenceType: SequenceType;
  onAccept: (text: string) => void;
}) {
  const [tone, setTone] = useState<"professional" | "friendly" | "urgent" | "concise">("professional");
  const [result, setResult] = useState("");
  const trpc = useTRPC();
  const rewrite = useMutation({
    ...trpc.payments.sequences.aiRewriteTouchpoint.mutationOptions(),
    onSuccess: (data) => setResult(data.rewritten),
    onError: () => toast.error("AI rewrite failed"),
  });

  const handleGenerate = () => {
    setResult("");
    rewrite.mutate({ channel, currentBody, tone, sequenceType });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            AI Rewrite — {channel === "sms" ? "SMS" : "Email"} body
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Original</Label>
            <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{currentBody || "(empty)"}</div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm">Tone</Label>
            <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="concise">Concise</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleGenerate} disabled={rewrite.isPending} className="shrink-0">
              {rewrite.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              Generate
            </Button>
          </div>
          {result && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Rewritten</Label>
              <Textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                rows={4}
                className="text-sm"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onAccept(result); onClose(); }} disabled={!result}>
            Use this
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Touchpoint editor ─────────────────────────────────────────────────────────
function TouchpointEditor({
  tp,
  index,
  sequenceType,
  onChange,
  onRemove,
}: {
  tp: Touchpoint;
  index: number;
  sequenceType: SequenceType;
  onChange: (updated: Touchpoint) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [aiModal, setAiModal] = useState<{ open: boolean; field: "smsBody" | "emailBody" } | null>(null);

  const update = (patch: Partial<Touchpoint>) => onChange({ ...tp, ...patch });

  return (
    <Card className="border border-border/60">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              checked={tp.isActive}
              onCheckedChange={(v) => update({ isActive: v })}
              className="scale-90"
            />
            <span className="text-sm font-medium">
              {sequenceType === "engagement"
                ? `Touchpoint ${index + 1} — ${tp.viewTier === "hot" ? "Hot (3+ views)" : "Warm (1+ view)"}`
                : `Touchpoint ${index + 1} — Day ${tp.dayOffset ?? 0}`}
            </span>
            {!tp.isActive && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 px-4 pb-4 space-y-4">
          {/* Timing */}
          {sequenceType === "engagement" ? (
            <div className="flex items-center gap-3">
              <Label className="w-24 text-sm shrink-0">View tier</Label>
              <Select value={tp.viewTier ?? "warm"} onValueChange={(v) => update({ viewTier: v })}>
                <SelectTrigger className="h-8 text-sm max-w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warm">Warm (1+ views)</SelectItem>
                  <SelectItem value="hot">Hot (3+ views)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Label className="w-24 text-sm shrink-0">Send on day</Label>
              <Input
                type="number"
                min={1}
                value={tp.dayOffset ?? 1}
                onChange={(e) => update({ dayOffset: parseInt(e.target.value) || 1 })}
                className="h-8 text-sm max-w-[100px]"
              />
              <span className="text-xs text-muted-foreground">after proposal sent</span>
            </div>
          )}

          <Separator />

          {/* SMS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">SMS</Label>
                <Switch checked={tp.smsEnabled} onCheckedChange={(v) => update({ smsEnabled: v })} className="scale-75" />
              </div>
              {tp.smsEnabled && (
                <Button variant="ghost" size="sm" className="h-6 text-xs text-violet-500 hover:text-violet-600 px-2"
                  onClick={() => setAiModal({ open: true, field: "smsBody" })}>
                  <Sparkles className="h-3 w-3 mr-1" /> AI rewrite
                </Button>
              )}
            </div>
            {tp.smsEnabled && (
              <Textarea
                value={tp.smsBody}
                onChange={(e) => update({ smsBody: e.target.value })}
                rows={3}
                placeholder="SMS message body... Use {{client_first_name}}, {{proposal_url}}"
                className="text-sm font-mono"
              />
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">Email</Label>
                <Switch checked={tp.emailEnabled} onCheckedChange={(v) => update({ emailEnabled: v })} className="scale-75" />
              </div>
              {tp.emailEnabled && (
                <Button variant="ghost" size="sm" className="h-6 text-xs text-violet-500 hover:text-violet-600 px-2"
                  onClick={() => setAiModal({ open: true, field: "emailBody" })}>
                  <Sparkles className="h-3 w-3 mr-1" /> AI rewrite
                </Button>
              )}
            </div>
            {tp.emailEnabled && (
              <div className="space-y-2">
                <Input
                  value={tp.emailSubject}
                  onChange={(e) => update({ emailSubject: e.target.value })}
                  placeholder="Subject line..."
                  className="h-8 text-sm"
                />
                <Textarea
                  value={tp.emailBody}
                  onChange={(e) => update({ emailBody: e.target.value })}
                  rows={4}
                  placeholder="Email body... Use {{client_first_name}}, {{proposal_url}}"
                  className="text-sm font-mono"
                />
              </div>
            )}
          </div>

          {/* Placeholder reference */}
          <div className="flex flex-wrap gap-1">
            {PLACEHOLDERS.map(p => (
              <code key={p} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{p}</code>
            ))}
          </div>
        </CardContent>
      )}

      {aiModal && (
        <AIRewriteModal
          open={aiModal.open}
          onClose={() => setAiModal(null)}
          channel={aiModal.field === "smsBody" ? "sms" : "email"}
          currentBody={aiModal.field === "smsBody" ? tp.smsBody : tp.emailBody}
          sequenceType={sequenceType}
          onAccept={(text) => update({ [aiModal.field]: text })}
        />
      )}
    </Card>
  );
}

// ── Sequence tab ──────────────────────────────────────────────────────────────
function SequenceTab({ type, currentTier, allTiers }: { type: SequenceType; currentTier: string; allTiers?: Record<string, { rate: number }> }) {
  const req = TIER_REQUIREMENTS[type];
  const locked = req ? !tierMeetsRequirement(currentTier, req.minTier) : false;
  const tierLabel = req ? `${req.minTier.charAt(0).toUpperCase() + req.minTier.slice(1)} tier (${allTiers?.[req.minTier]?.rate ?? "?"}%) or above` : "";

  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data, isLoading } = useQuery({
    ...trpc.payments.sequences.getDefinition.queryOptions({ brandId: brandId!, type }),
    enabled: !locked && !!brandId,
  });
  const [touchpoints, setTouchpoints] = useState<Touchpoint[] | null>(null);
  const [isActive, setIsActive] = useState<boolean | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [dirty, setDirty] = useState(false);

  // Sync from server
  const effectiveTouchpoints = touchpoints ?? ((data?.touchpoints as Touchpoint[]) ?? []);
  const effectiveIsActive = isActive ?? (data?.isActive ?? true);
  const effectiveRules = rules ?? ((data?.rules as Rules) ?? {});

  const update = useMutation({
    ...trpc.payments.sequences.updateDefinition.mutationOptions(),
    onSuccess: () => {
      toast.success("Sequence saved");
      setDirty(false);
    },
    onError: () => toast.error("Failed to save"),
  });

  const handleSave = () => {
    update.mutate({
      brandId: brandId!,
      type,
      isActive: effectiveIsActive,
      touchpoints: effectiveTouchpoints,
      rules: effectiveRules,
    });
  };

  const addTouchpoint = () => {
    const newTp: Touchpoint = type === "engagement"
      ? { viewTier: "warm", smsEnabled: true, smsBody: "", emailEnabled: false, emailSubject: "", emailBody: "", isActive: true }
      : { dayOffset: (effectiveTouchpoints.length + 1) * 2, smsEnabled: true, smsBody: "", emailEnabled: true, emailSubject: "", emailBody: "", isActive: true };
    setTouchpoints([...effectiveTouchpoints, newTp]);
    setDirty(true);
  };

  if (locked && req) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium text-base">Requires {tierLabel}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Upgrade your plan to unlock {type === "engagement" ? "engagement follow-up" : "missed payment"} sequences.
          </p>
        </div>
        <Button asChild variant="default" size="sm">
          <Link href="/settings/billing">Upgrade plan</Link>
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="font-medium text-sm">Enable this sequence</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {type === "cold" && "Automatically follow up on proposals that haven't been viewed or accepted."}
            {type === "engagement" && "Follow up when a client views your proposal but doesn't accept."}
            {type === "missed_payment" && "Notify clients when their payment fails and prompt them to update their card."}
          </p>
        </div>
        <Switch
          checked={effectiveIsActive}
          onCheckedChange={(v) => { setIsActive(v); setDirty(true); }}
        />
      </div>

      {/* Touchpoints */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Touchpoints</h3>
          <Button variant="outline" size="sm" onClick={addTouchpoint} className="h-7 text-xs gap-1">
            <Plus className="h-3 w-3" /> Add touchpoint
          </Button>
        </div>
        {effectiveTouchpoints.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No touchpoints yet. Add one to get started.
          </div>
        )}
        {effectiveTouchpoints.map((tp, i) => (
          <TouchpointEditor
            key={i}
            tp={tp}
            index={i}
            sequenceType={type}
            onChange={(updated) => {
              const next = [...effectiveTouchpoints];
              next[i] = updated;
              setTouchpoints(next);
              setDirty(true);
            }}
            onRemove={() => {
              setTouchpoints(effectiveTouchpoints.filter((_, j) => j !== i));
              setDirty(true);
            }}
          />
        ))}
      </div>

      {/* Rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Sending rules</CardTitle>
          <CardDescription className="text-xs">Control how often messages are sent per proposal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Cooldown (hours)</Label>
              <Input
                type="number"
                min={1}
                value={effectiveRules.cooldownHours ?? 24}
                onChange={(e) => { setRules({ ...effectiveRules, cooldownHours: parseInt(e.target.value) || 24 }); setDirty(true); }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max messages / proposal</Label>
              <Input
                type="number"
                min={1}
                value={effectiveRules.maxMessagesPerProposal ?? 5}
                onChange={(e) => { setRules({ ...effectiveRules, maxMessagesPerProposal: parseInt(e.target.value) || 5 }); setDirty(true); }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Min hours between msgs</Label>
              <Input
                type="number"
                min={1}
                value={effectiveRules.minHoursBetweenMessages ?? 4}
                onChange={(e) => { setRules({ ...effectiveRules, minHoursBetweenMessages: parseInt(e.target.value) || 4 }); setDirty(true); }}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || update.isPending || !brandId} className="gap-2">
          {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SequencesSettings() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: tierData } = useQuery({
    ...trpc.payments.billing.getTierInfo.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const currentTier = (tierData?.tier as string) ?? "close";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Communication Sequences</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Automate follow-up messages for proposals, engagement, and missed payments.
          Your current plan is <strong>{currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}</strong>.
        </p>
      </div>

      <Tabs defaultValue="cold">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="cold">Cold Outreach</TabsTrigger>
          <TabsTrigger value="engagement">
            Engagement
            {!tierMeetsRequirement(currentTier, "close") && <Lock className="h-3 w-3 ml-1.5 text-muted-foreground" />}
          </TabsTrigger>
          <TabsTrigger value="missed_payment">
            Missed Payment
            {!tierMeetsRequirement(currentTier, "recover") && <Lock className="h-3 w-3 ml-1.5 text-muted-foreground" />}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cold" className="mt-6">
          <SequenceTab type="cold" currentTier={currentTier} allTiers={tierData?.allTiers as Record<string, { rate: number }> | undefined} />
        </TabsContent>
        <TabsContent value="engagement" className="mt-6">
          <SequenceTab type="engagement" currentTier={currentTier} allTiers={tierData?.allTiers as Record<string, { rate: number }> | undefined} />
        </TabsContent>
        <TabsContent value="missed_payment" className="mt-6">
          <SequenceTab type="missed_payment" currentTier={currentTier} allTiers={tierData?.allTiers as Record<string, { rate: number }> | undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
