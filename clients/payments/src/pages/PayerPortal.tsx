/**
 * Payer Portal — /portal/:token
 *
 * Token-gated page for payers to view their plan and take lifecycle actions.
 * The session token is read from the URL param (magic-link style).
 *
 * Supports all 7 lifecycle scenarios:
 *  1. Cancel plan
 *  2. Pause plan
 *  3. Resume plan
 *  4. Pay out in full
 *  5. Skip installment
 *  6. Update card
 *  7. Request deferral
 */
import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Clock,
  CreditCard,
  Pause,
  Play,
  SkipForward,
  XCircle,
  DollarSign,
  CalendarClock,
  Info,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    accepted: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    draft: "bg-gray-100 text-gray-700",
    sent: "bg-yellow-100 text-yellow-800",
    expired: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${map[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Action Button ───────────────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  description,
  variant = "outline",
  onClick,
  disabled,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  variant?: "outline" | "destructive" | "default";
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
        variant === "destructive"
          ? "border-red-200 hover:bg-red-50 hover:border-red-300"
          : variant === "default"
          ? "border-[#D9F542] bg-[#D9F542]/10 hover:bg-[#D9F542]/20"
          : "border-border hover:bg-muted/50"
      }`}
    >
      <span
        className={`mt-0.5 shrink-0 ${
          variant === "destructive" ? "text-red-500" : "text-foreground"
        }`}
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </span>
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}

// ─── Deferral Dialog ─────────────────────────────────────────────────────────

function DeferralDialog({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Payment Deferral</DialogTitle>
          <DialogDescription>
            Your payment schedule will remain unchanged while your request is reviewed. If approved,
            the deferred installment will be moved to the end of your payment plan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="deferral-reason">Reason for deferral (optional)</Label>
          <Textarea
            id="deferral-reason"
            placeholder="e.g. Temporary cash flow issue, waiting on a client payment..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(reason)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Confirm Action Dialog ───────────────────────────────────────────────────

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  loading: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PayerPortal() {
  const trpc = useTRPC();
  const params = useParams<{ token: string }>();
  const sessionToken = params.token;

  // We need a proposalId — get it from the portal data query
  const [proposalId, setProposalId] = useState<string | null>(null);

  // First, get the portal data from the existing clientPortal router to find the proposal
  const portalDataQuery = useQuery({
    ...trpc.payments.clientPortal.getPortalData.queryOptions({ sessionToken }),
    enabled: !!sessionToken,
    retry: false,
  });

  // Once we have portal data, pick the most relevant proposal (active/accepted)
  useEffect(() => {
    if (portalDataQuery.data) {
      const proposals = portalDataQuery.data.proposals ?? [];
      const active = proposals.find(
        (p: any) =>
          p.status === "active" || p.status === "accepted" || p.status === "paid"
      );
      if (active) setProposalId(active.id);
      else if (proposals.length > 0) setProposalId(proposals[0].id);
    }
  }, [portalDataQuery.data]);

  // Once we have a proposalId, get lifecycle permissions
  const permissionsQuery = useQuery({
    ...trpc.payments.lifecycle.getPortalPermissions.queryOptions({ sessionToken, proposalId: proposalId! }),
    enabled: !!sessionToken && !!proposalId,
    retry: false,
  });

  // Mutations
  const payerActionMutation = useMutation({
    ...trpc.payments.lifecycle.payerAction.mutationOptions(),
    onSuccess: () => {
      permissionsQuery.refetch();
      portalDataQuery.refetch();
    },
  });
  const submitRequestMutation = useMutation({
    ...trpc.payments.lifecycle.submitPayerRequest.mutationOptions(),
    onSuccess: () => {
      permissionsQuery.refetch();
    },
  });

  // Dialog state
  const [activeDialog, setActiveDialog] = useState<
    "cancel" | "pause" | "resume" | "payout_full" | "skip" | "update_card" | "defer" | null
  >(null);

  const handleAction = async (
    action: "cancel" | "pause" | "resume" | "payout_full" | "skip_installment" | "update_card"
  ) => {
    if (!proposalId) return;
    try {
      await payerActionMutation.mutateAsync({
        sessionToken,
        proposalId,
        action,
      });
      toast.success(
        action === "cancel"
          ? "Cancellation confirmed."
          : action === "pause"
          ? "Plan paused."
          : action === "resume"
          ? "Plan resumed."
          : action === "payout_full"
          ? "Full payout initiated."
          : action === "skip_installment"
          ? "Installment skipped."
          : "Card update request sent."
      );
      setActiveDialog(null);
    } catch (err: any) {
      toast.error(sanitizeError(err, "Something went wrong"));
    }
  };

  const handleDeferral = async (reason: string) => {
    if (!proposalId) return;
    try {
      await submitRequestMutation.mutateAsync({
        sessionToken,
        proposalId,
        requestType: "defer",
        payload: { reason },
      });
      toast.success("Deferral request submitted. Your payment schedule is unchanged while it's reviewed.");
      setActiveDialog(null);
    } catch (err: any) {
      toast.error(sanitizeError(err, "Something went wrong"));
    }
  };

  // ── Loading / error states ──────────────────────────────────────────────

  if (!sessionToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Invalid link</AlertTitle>
          <AlertDescription>This portal link is invalid or has expired.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (portalDataQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (portalDataQuery.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Session expired</AlertTitle>
          <AlertDescription>
            Your portal session has expired. Please request a new login link.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const portalData = portalDataQuery.data;
  const permissions = permissionsQuery.data?.permissions;
  const proposalStatus = permissionsQuery.data?.proposalStatus;
  const proposalTitle = permissionsQuery.data?.proposalTitle;
  const pendingRequests = permissionsQuery.data?.pendingRequests ?? [];
  const hasPendingDeferral = pendingRequests.some((r: any) => r.requestType === "defer");

  const isActive = proposalStatus === "active" || proposalStatus === "accepted";
  const isPaused = (portalData?.proposals as any[])?.find((p: any) => p.id === proposalId)?.sequencesPaused as boolean | undefined;

  return (
    <div className="min-h-screen bg-[#F9F9F7]">
      {/* Header */}
      <header className="bg-[#0E0E0C] text-white px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-[#D9F542]/70 uppercase tracking-widest font-medium mb-0.5">
            {portalData?.account?.businessName ?? "EziQuotes"}
          </p>
          <h1 className="text-lg font-semibold">Your Plan Portal</h1>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{portalData?.client?.name}</p>
          <p className="text-xs text-white/50">{portalData?.client?.email}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Commitment period warning */}
        {permissions?.inCommitmentPeriod && permissions.commitmentEndsAt && (
          <Alert className="border-amber-200 bg-amber-50">
            <Clock className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800">Commitment period active</AlertTitle>
            <AlertDescription className="text-amber-700">
              You are in a commitment period until{" "}
              <strong>
                {new Date(permissions.commitmentEndsAt).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              . Some actions are restricted until this period ends.
            </AlertDescription>
          </Alert>
        )}

        {/* Pending deferral notice */}
        {hasPendingDeferral && (
          <Alert className="border-blue-200 bg-blue-50">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-800">Deferral request pending</AlertTitle>
            <AlertDescription className="text-blue-700">
              Your deferral request is being reviewed. Your payment schedule continues as normal
              until a decision is made.
            </AlertDescription>
          </Alert>
        )}

        {/* Plan summary */}
        <SectionCard title="Plan Summary">
          {proposalId && proposalTitle ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{proposalTitle}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                    {permissionsQuery.data?.commercialIntent?.replace(/_/g, " ") ?? "—"}
                  </p>
                </div>
                {proposalStatus && <StatusBadge status={proposalStatus} />}
              </div>
              {permissionsQuery.data?.commitmentPeriodMonths && (
                <p className="text-xs text-muted-foreground">
                  Commitment period: {permissionsQuery.data.commitmentPeriodMonths} months
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading plan details…</p>
          )}
        </SectionCard>

        {/* Available actions */}
        {isActive && permissions && (
          <SectionCard title="Manage Your Plan">
            <div className="space-y-2">
              {/* Resume (if paused) */}
              {isPaused && (
                <ActionButton
                  icon={<Play className="h-5 w-5" />}
                  label="Resume Plan"
                  description="Re-activate your plan and resume scheduled payments."
                  variant="default"
                  onClick={() => setActiveDialog("resume")}
                  loading={payerActionMutation.isPending && activeDialog === "resume"}
                />
              )}

              {/* Pause (if not paused and allowed) */}
              {!isPaused && permissions.allowPayerPause && (
                <ActionButton
                  icon={<Pause className="h-5 w-5" />}
                  label="Pause Plan"
                  description={`Temporarily pause your plan (up to ${permissions.maxPauseDaysPerYear} days/year).`}
                  onClick={() => setActiveDialog("pause")}
                  loading={payerActionMutation.isPending && activeDialog === "pause"}
                />
              )}

              {/* Skip installment */}
              {permissions.allowPayerSkip && (
                <ActionButton
                  icon={<SkipForward className="h-5 w-5" />}
                  label="Skip Next Installment"
                  description={`Skip your next payment (up to ${permissions.maxSkipsPerYear} skips/year).`}
                  onClick={() => setActiveDialog("skip")}
                  loading={payerActionMutation.isPending && activeDialog === "skip"}
                />
              )}

              {/* Request deferral */}
              {!hasPendingDeferral && (
                <ActionButton
                  icon={<CalendarClock className="h-5 w-5" />}
                  label="Request Payment Deferral"
                  description="Ask to move a payment to the end of your plan. Requires vendor approval."
                  onClick={() => setActiveDialog("defer")}
                  loading={submitRequestMutation.isPending}
                />
              )}

              {/* Pay out in full */}
              {permissions.allowPayerPayoutFull && (
                <ActionButton
                  icon={<DollarSign className="h-5 w-5" />}
                  label="Pay Out in Full"
                  description="Settle your remaining balance in a single payment."
                  variant="default"
                  onClick={() => setActiveDialog("payout_full")}
                  loading={payerActionMutation.isPending && activeDialog === "payout_full"}
                />
              )}

              {/* Update card */}
              {permissions.allowPayerCardUpdate && (
                <ActionButton
                  icon={<CreditCard className="h-5 w-5" />}
                  label="Update Payment Card"
                  description="Change the card used for your scheduled payments."
                  onClick={() => setActiveDialog("update_card")}
                  loading={payerActionMutation.isPending && activeDialog === "update_card"}
                />
              )}

              {/* Cancel */}
              {permissions.allowPayerCancel && (
                <>
                  <Separator className="my-3" />
                  <ActionButton
                    icon={<XCircle className="h-5 w-5" />}
                    label="Cancel Plan"
                    description="Permanently cancel your plan. This cannot be undone."
                    variant="destructive"
                    onClick={() => setActiveDialog("cancel")}
                    loading={payerActionMutation.isPending && activeDialog === "cancel"}
                  />
                </>
              )}

              {/* Restricted message during commitment period */}
              {permissions.inCommitmentPeriod && (
                <Alert className="mt-3 border-amber-200 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-700 text-xs">
                    Cancel and pause are unavailable during your commitment period.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </SectionCard>
        )}

        {/* Proposals list (fallback if no active proposal) */}
        {!isActive && (
          <SectionCard title="Your Proposals">
            {(portalData?.proposals ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals found.</p>
            ) : (
              <div className="space-y-3">
                {(portalData?.proposals ?? []).map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{p.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString("en-AU")}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {/* Recent payments */}
        {(portalData?.recentPayments ?? []).length > 0 && (
          <SectionCard title="Recent Payments">
            <div className="space-y-2">
              {(portalData?.recentPayments ?? []).slice(0, 5).map((pay: any) => (
                <div key={pay.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {new Date(pay.createdAt).toLocaleDateString("en-AU")}
                  </span>
                  <span className="font-medium">
                    {new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: pay.currency ?? "AUD",
                    }).format((pay.amountCents ?? 0) / 100)}
                  </span>
                  <StatusBadge status={pay.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {/* ── Dialogs ── */}

      {/* Deferral */}
      <DeferralDialog
        open={activeDialog === "defer"}
        onClose={() => setActiveDialog(null)}
        onSubmit={handleDeferral}
        loading={submitRequestMutation.isPending}
      />

      {/* Cancel */}
      <ConfirmDialog
        open={activeDialog === "cancel"}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => handleAction("cancel")}
        title="Cancel Your Plan"
        description="Are you sure you want to cancel? This action is permanent and cannot be undone. Any outstanding payments may still be due."
        confirmLabel="Yes, Cancel Plan"
        destructive
        loading={payerActionMutation.isPending}
      />

      {/* Pause */}
      <ConfirmDialog
        open={activeDialog === "pause"}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => handleAction("pause")}
        title="Pause Your Plan"
        description="Your plan and scheduled payments will be paused. You can resume at any time."
        confirmLabel="Pause Plan"
        loading={payerActionMutation.isPending}
      />

      {/* Resume */}
      <ConfirmDialog
        open={activeDialog === "resume"}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => handleAction("resume")}
        title="Resume Your Plan"
        description="Your plan will be re-activated and scheduled payments will resume."
        confirmLabel="Resume Plan"
        loading={payerActionMutation.isPending}
      />

      {/* Pay out in full */}
      <ConfirmDialog
        open={activeDialog === "payout_full"}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => handleAction("payout_full")}
        title="Pay Out in Full"
        description="You will be charged your remaining balance in a single payment. This will close out your plan."
        confirmLabel="Confirm Full Payout"
        loading={payerActionMutation.isPending}
      />

      {/* Skip installment */}
      <ConfirmDialog
        open={activeDialog === "skip"}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => handleAction("skip_installment")}
        title="Skip Next Installment"
        description="Your next scheduled payment will be skipped. This counts toward your annual skip limit."
        confirmLabel="Skip Installment"
        loading={payerActionMutation.isPending}
      />

      {/* Update card */}
      <ConfirmDialog
        open={activeDialog === "update_card"}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => handleAction("update_card")}
        title="Update Payment Card"
        description="A request will be sent to update your payment method. You'll receive instructions via email."
        confirmLabel="Request Card Update"
        loading={payerActionMutation.isPending}
      />
    </div>
  );
}
