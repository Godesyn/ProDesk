/**
 * ProposalBuilder — orchestrator (new design-package layout)
 *
 * Layout: .builder → TopBar + .panes → .build-pane (left) + .catalog-pane (right)
 * Sticky footer: MathFooter
 * Overlay: PreviewDrawer, SendDialog
 *
 * All tRPC queries, mutations, state, and business logic live here.
 * UI is delegated to components in src/components/builder/.
 *
 * ITEM-7: EngagementCard removed — payer permissions folded into MetadataCard via PaymentConfig
 * ITEM-3: Subscription fields expanded (subTerm, subAutoRenew, subSetupFee*)
 * ITEM-1: Deposit fields expanded (ppDepositPct, ppDepositLabel)
 * ITEM-10: dual_option payment model added
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCurrentUser, signOut } from "@shared/auth/auth-context";
import { useConfirm } from "@shared/components/ui/confirm-dialog";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
import {
  type Block, type PricingTableData, type PricingLineItem, type HeroData,
  createDefaultBlocks,
  applyBrandKitToBlocks, loadBrandKitFonts, type BrandKit,
} from "@/lib/blocks";
import type { BillingCycle } from "@server/modules/payments/payment-model-calc";
import {
  TopBar,
  LineItemsCard,
  MathFooter,
  CatalogPane,
  PreviewDrawer,
  MetadataCard,
  SendDialog,
  ContentCard,
} from "@/components/builder";
import type { LineItem, PaymentConfig } from "@/components/builder";
import "@/styles/builder.css";

// ============================================================
// Main component
// ============================================================
export default function ProposalBuilder() {
  const [, navigate] = useLocation();
  const confirm = useConfirm();
  const handleSignOut = async () => {
    if (await confirm({
      title: "Sign out?",
      description: "You’ll need to log in again to get back in.",
      confirmLabel: "Sign out",
      destructive: true,
    })) void signOut();
  };
  const [matchEdit, paramsEdit] = useRoute("/proposals/:id/edit");
  const [matchNew] = useRoute("/proposals/new");
  void matchNew;
  const editId = matchEdit ? paramsEdit?.id : undefined;

  const templateIdParam = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("template") || undefined
    : undefined;

  // ---- tRPC ----
  const trpc = useTRPC();
  const brandId = useBrandId();

  const { data: existing } = useQuery({
    ...trpc.payments.proposals.get.queryOptions({ id: editId! }),
    enabled: !!editId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const { data: clientsData } = useQuery({
    ...trpc.payments.clients.list.queryOptions({ brandId: brandId!, limit: 100 }),
    enabled: !!brandId,
  });
  const { data: accountData } = useQuery({
    ...trpc.payments.accounts.me.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: templatesData } = useQuery({
    ...trpc.payments.templates.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: productsData } = useQuery({
    ...trpc.payments.pricing.listProducts.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: addonsData } = useQuery({
    ...trpc.payments.pricing.listAddons.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: brandKitData } = useQuery({
    ...trpc.payments.accounts.getBrandKit.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: categoriesData } = useQuery({
    ...trpc.payments.categories.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });

  const createMutation = useMutation(trpc.payments.proposals.create.mutationOptions());
  const updateMutation = useMutation(trpc.payments.proposals.update.mutationOptions());
  const sendMutation = useMutation(trpc.payments.proposals.send.mutationOptions());

  // ---- Core form state ----
  const [title, setTitle] = useState("New Proposal");
  const [clientId, setClientId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | undefined>(templateIdParam);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([""]);

  // ---- Payment model ----
  const [paymentModel, setPaymentModel] = useState<PaymentConfig["paymentModel"]>("one-off");

  // ---- Subscription fields (ITEM-3) ----
  const [subCadence, setSubCadence] = useState("monthly");
  const [subTerm, setSubTerm] = useState("12m");
  const [subAutoRenew, setSubAutoRenew] = useState(true);
  const [subSetupFeeEnabled, setSubSetupFeeEnabled] = useState(false);
  const [subSetupFeeLabel, setSubSetupFeeLabel] = useState("Setup fee");
  const [subSetupFeeCents, setSubSetupFeeCents] = useState(0);
  // Legacy upfront fields kept for backwards-compat when loading old proposals
  const [subUpfrontType, setSubUpfrontType] = useState("none");
  const [subUpfrontCustom, setSubUpfrontCustom] = useState("");
  const [subUpfrontCustomName, setSubUpfrontCustomName] = useState("Setup fee");

  // ---- Payment plan fields (ITEM-1) ----
  const [ppDepositPct, setPpDepositPct] = useState(0);
  const [ppDepositLabel, setPpDepositLabel] = useState("Deposit");
  const [ppDeposit, setPpDeposit] = useState("30"); // legacy
  const [ppInstallments, setPpInstallments] = useState("3");
  const [ppInterval, setPpInterval] = useState("monthly");

  // ---- Dual option fields (ITEM-10) ----
  const [dualDiscountPct, setDualDiscountPct] = useState(0);
  const [dualDiscountLabel, setDualDiscountLabel] = useState("Upfront discount");

  // ---- Payer permissions — folded from EngagementCard (ITEM-7) ----
  const [allowPayerCancel, setAllowPayerCancel] = useState(true);
  const [allowPayerPause, setAllowPayerPause] = useState(false);
  const [allowPayerSkip, setAllowPayerSkip] = useState(false);
  const [allowPayerPayoutFull, setAllowPayerPayoutFull] = useState(false);
  const [maxPauseDaysPerYear, setMaxPauseDaysPerYear] = useState("60");
  const [maxSkipsPerYear, setMaxSkipsPerYear] = useState("2");
  const [commitmentPeriodMonths, setCommitmentPeriodMonths] = useState("6");

  // ---- Account-level defaults ----
  const [currency, setCurrency] = useState("AUD");
  const [defaultTaxRate, setDefaultTaxRate] = useState(10);

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [proposalId, setProposalId] = useState<string | undefined>(editId);
  const [proposalSlug, setProposalSlug] = useState<string | undefined>();
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  // Use a ref so initDone survives the navigate() remount that happens after first save
  const initDoneRef = useRef(false);
  const [initDone, _setInitDone] = useState(false);
  const setInitDone = (v: boolean) => { initDoneRef.current = v; _setInitDone(v); };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Canvas blocks for preview
  const [canvasBlocks, setCanvasBlocks] = useState<Block[]>([]);

  // ---- Derived ----
  const selectedClient = useMemo(() =>
    ((clientsData?.rows ?? []) as any[]).find((c: any) => c.id === clientId),
    [clientsData, clientId]
  );
  const brandKit = brandKitData as BrandKit | null | undefined;
  const previewBlocks = useMemo(() => {
    if (!brandKit) return canvasBlocks;
    return applyBrandKitToBlocks(canvasBlocks, brandKit);
  }, [canvasBlocks, brandKit]);

  // Composite PaymentConfig object for child components
  const paymentConfig: PaymentConfig = {
    paymentModel,
    subCadence, subTerm, subAutoRenew,
    subSetupFeeEnabled, subSetupFeeLabel, subSetupFeeCents,
    subUpfrontType, subUpfrontCustom, subUpfrontCustomName,
    ppDepositPct, ppDepositLabel, ppDeposit, ppInstallments, ppInterval,
    dualDiscountPct, dualDiscountLabel,
    allowPayerCancel, allowPayerPause, allowPayerSkip, allowPayerPayoutFull,
    maxPauseDaysPerYear, maxSkipsPerYear, commitmentPeriodMonths,
    currency, defaultTaxRate,
  };

  const subtotalCents = useMemo(() =>
    lineItems.filter(li => li.type !== "break")
      .reduce((s, li) => s + li.quantity * li.unitPriceCents, 0),
    [lineItems]
  );

  const issueCount = useMemo(() => {
    let n = 0;
    if (!clientId) n++;
    if (!title.trim()) n++;
    if (lineItems.filter(li => li.type !== "break").length === 0) n++;
    return n;
  }, [clientId, title, lineItems]);

  // ---- Load account defaults ----
  useEffect(() => {
    if (!accountData) return;
    const a = accountData as any;
    if (a.defaultCurrency ?? a.currency) setCurrency(a.defaultCurrency ?? a.currency);
    // P0-1: defaultTaxRate is stored as text in DB — coerce to number before use
    if (a.defaultTaxRate !== undefined) setDefaultTaxRate(parseFloat(a.defaultTaxRate) || 10);
  }, [accountData]);

  // ---- Load brand kit fonts ----
  useEffect(() => {
    if (brandKit) loadBrandKitFonts(brandKit);
  }, [brandKit?.headingFont, brandKit?.bodyFont]);

  // ---- Load existing proposal ----
  useEffect(() => {
    if (!existing || initDoneRef.current) return;
    const e = existing as any;
    setTitle(e.title ?? "New Proposal");
    setClientId(e.clientId ?? null);
    setTemplateId(e.templateId ?? undefined);
    setProposalSlug(e.slug);
    const s = e.structure ?? {};
    if (s.lineItems?.length) {
      setLineItems(s.lineItems.map((li: any) => ({
        id: li.id ?? crypto.randomUUID(),
        type: li.type ?? "custom",
        name: li.name ?? "",
        description: li.description,
        quantity: li.quantity ?? 1,
        unitPriceCents: li.unitPriceCents ?? 0,
        taxBehaviour: li.taxBehaviour ?? "inclusive",
        // P0-1: taxRate in JSONB may be stored as string — coerce to number
        taxRate: li.taxRate !== undefined ? (typeof li.taxRate === 'string' ? parseFloat(li.taxRate) || undefined : li.taxRate) : undefined,
        optional: li.optional,
        isQuantityEditable: li.isQuantityEditable,
        breakLabel: li.breakLabel,
        category: li.category,
        categoryCode: li.categoryCode,
      })));
    }
    if (s.recommendations?.length) setRecommendations(s.recommendations);

    // Payment model
    const pm = e.paymentModel;
    if (pm === "one_off" || pm === "one-off") setPaymentModel("one-off");
    else if (pm === "subscription") setPaymentModel("subscription");
    else if (pm === "payment_plan" || pm === "payment-plan") setPaymentModel("payment-plan");
    else if (pm === "dual_option" || pm === "dual-option") setPaymentModel("dual_option");

    const pc = e.paymentConfig ?? {};
    // Subscription
    if (pc.cadence) setSubCadence(pc.cadence);
    if (pc.term) setSubTerm(String(pc.term));
    if (pc.autoRenew !== undefined) setSubAutoRenew(pc.autoRenew);
    if (pc.setupFeeEnabled !== undefined) setSubSetupFeeEnabled(pc.setupFeeEnabled);
    if (pc.setupFeeLabel) setSubSetupFeeLabel(pc.setupFeeLabel);
    if (pc.setupFeeCents !== undefined) setSubSetupFeeCents(pc.setupFeeCents);
    // Legacy upfront fields
    if (pc.upfrontType) setSubUpfrontType(pc.upfrontType);
    if (pc.upfrontFeeLabel) setSubUpfrontCustomName(pc.upfrontFeeLabel);
    if (pc.upfrontFeeCents) setSubUpfrontCustom(String(Math.round(pc.upfrontFeeCents / 100)));
    // Payment plan
    if (pc.depositPct !== undefined) setPpDepositPct(pc.depositPct);
    if (pc.depositLabel) setPpDepositLabel(pc.depositLabel);
    if (pc.depositPct) setPpDeposit(String(pc.depositPct));
    if (pc.installments) setPpInstallments(String(pc.installments));
    if (pc.interval) setPpInterval(pc.interval);
    // Dual option
    if (pc.discountPct !== undefined) setDualDiscountPct(pc.discountPct);
    if (pc.discountLabel) setDualDiscountLabel(pc.discountLabel);
    // Payer permissions (from engagement fields on proposal row)
    if (e.allowPayerCancel !== undefined) setAllowPayerCancel(e.allowPayerCancel);
    if (e.allowPayerPause !== undefined) setAllowPayerPause(e.allowPayerPause);
    if (e.allowPayerSkip !== undefined) setAllowPayerSkip(e.allowPayerSkip);
    if (e.allowPayerPayoutFull !== undefined) setAllowPayerPayoutFull(e.allowPayerPayoutFull);
    if (e.maxPauseDaysPerYear !== undefined) setMaxPauseDaysPerYear(String(e.maxPauseDaysPerYear));
    if (e.maxSkipsPerYear !== undefined) setMaxSkipsPerYear(String(e.maxSkipsPerYear));
    if (e.commitmentPeriodMonths !== undefined) setCommitmentPeriodMonths(String(e.commitmentPeriodMonths));

    setInitDone(true);
  }, [existing, initDone]);

  // ---- Pre-populate line items from template ----
  const prevTemplateIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (proposalId) return;
    if (templateId === prevTemplateIdRef.current) return;
    prevTemplateIdRef.current = templateId;
    const tpl = ((templatesData ?? []) as any[]).find((t: any) => t.id === templateId);
    const items = tpl?.defaultLineItems;
    if (Array.isArray(items) && items.length > 0) {
      setLineItems(items.map((li: any) => ({
        id: li.id ?? crypto.randomUUID(),
        type: li.type ?? "custom",
        name: li.name ?? "",
        description: li.description,
        quantity: li.quantity ?? 1,
        unitPriceCents: li.unitPriceCents ?? 0,
        taxBehaviour: "inclusive" as const,
        optional: li.optional ?? false,
      })));
    }
  }, [templateId, templatesData, proposalId]);

  // ---- Build canvas blocks for preview ----
  useEffect(() => {
    const bizName = (accountData as any)?.businessName ?? "Your Business";
    const clientName = selectedClient?.name ?? "Client";
    const tpl = ((templatesData ?? []) as any[]).find((t: any) => t.id === templateId);
    let baseBlocks: Block[] = [];
    if (tpl?.structure?.blocks?.length) {
      baseBlocks = (tpl.structure.blocks as Block[]).map(b => ({ ...b, id: crypto.randomUUID() }));
    } else {
      baseBlocks = createDefaultBlocks({ businessName: bizName, currency });
    }
    baseBlocks = baseBlocks.map(b => {
      if (b.type === "hero") {
        // Preserve any user-edited copy fields (headline, subheadline, eyebrow, lede, etc.)
        // from the current canvasBlocks — only update the dynamic metaItems.
        const existingHero = canvasBlocks.find(cb => cb.type === "hero");
        const existingData = existingHero ? (existingHero.data as unknown as Record<string, unknown>) : {};
        return { ...b, data: { ...(b.data as HeroData), ...existingData, metaItems: [
          { label: "Prepared by", value: bizName },
          { label: "Client", value: clientName },
          { label: "Proposal", value: title },
          { label: "Valid until", value: "30 days" },
        ]}};
      }
      if (b.type === "pricing_table" && lineItems.filter(li => li.type !== "break").length > 0) {
        const pricingLines: PricingLineItem[] = lineItems
          .filter(li => li.type !== "break")
          .map(li => ({
            id: li.id, name: li.name, description: li.description ?? "",
            qty: li.quantity, unitCents: li.unitPriceCents,
            taxBehaviour: li.taxBehaviour, taxRate: li.taxRate,
            optional: li.optional ?? false, isQuantityEditable: li.isQuantityEditable ?? false,
          }));
        // P0-TOTAL: compute totals here so the builder preview and payer page both show correct values
        const activePricingLines = pricingLines.filter(li => !li.optional || li.selected !== false);
        const computedSubtotal = activePricingLines.reduce((s, li) => s + li.qty * li.unitCents, 0);
        const taxRate = (defaultTaxRate ?? 10) / 100;
        const computedTax = activePricingLines.some(li => li.taxBehaviour === "exclusive")
          ? Math.round(activePricingLines.filter(li => li.taxBehaviour === "exclusive").reduce((s, li) => s + li.qty * li.unitCents, 0) * taxRate)
          : 0;
        const computedTotal = computedSubtotal + computedTax;
        return { ...b, data: { ...(b.data as PricingTableData), lineItems: pricingLines, currency, subtotalCents: computedSubtotal, taxCents: computedTax, totalCents: computedTotal }};
      }
      return b;
    });
    setCanvasBlocks(baseBlocks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, templatesData, lineItems, title, selectedClient, accountData, currency]);

  // ---- Line item helpers ----
  const addLineItem = useCallback((item?: Partial<LineItem>) => {
    setLineItems(prev => [...prev, {
      id: crypto.randomUUID(), type: "custom", name: "", quantity: 1,
      unitPriceCents: 0, taxBehaviour: "inclusive",
      ...item,
    }]);
  }, []);

  const addSectionBreak = useCallback(() => {
    setLineItems(prev => [...prev, {
      id: crypto.randomUUID(), type: "break", name: "", quantity: 1,
      unitPriceCents: 0, taxBehaviour: "exempt", breakLabel: "New section",
    }]);
  }, []);

  const updateLineItem = useCallback((id: string, patch: Partial<LineItem>) => {
    setLineItems(prev => prev.map(li => li.id === id ? { ...li, ...patch } : li));
  }, []);

  const removeLineItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(li => li.id !== id));
  }, []);

  const duplicateLineItem = useCallback((id: string) => {
    setLineItems(prev => {
      const idx = prev.findIndex(li => li.id === id);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx + 1), { ...prev[idx], id: crypto.randomUUID() }, ...prev.slice(idx + 1)];
    });
  }, []);

  const moveLineItem = useCallback((id: string, dir: "up" | "down") => {
    setLineItems(prev => {
      const idx = prev.findIndex(li => li.id === id);
      if (idx === -1) return prev;
      const newIdx = dir === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  // ---- Payment config change handler (used by MetadataCard and MathFooter) ----
  const handlePaymentConfigChange = useCallback((patch: Partial<PaymentConfig>) => {
    if (patch.paymentModel !== undefined) setPaymentModel(patch.paymentModel as PaymentConfig["paymentModel"]);
    if (patch.subCadence !== undefined) setSubCadence(patch.subCadence);
    if (patch.subTerm !== undefined) setSubTerm(patch.subTerm);
    if (patch.subAutoRenew !== undefined) setSubAutoRenew(patch.subAutoRenew);
    if (patch.subSetupFeeEnabled !== undefined) setSubSetupFeeEnabled(patch.subSetupFeeEnabled);
    if (patch.subSetupFeeLabel !== undefined) setSubSetupFeeLabel(patch.subSetupFeeLabel);
    if (patch.subSetupFeeCents !== undefined) setSubSetupFeeCents(patch.subSetupFeeCents);
    if (patch.subUpfrontType !== undefined) setSubUpfrontType(patch.subUpfrontType);
    if (patch.subUpfrontCustom !== undefined) setSubUpfrontCustom(patch.subUpfrontCustom);
    if (patch.subUpfrontCustomName !== undefined) setSubUpfrontCustomName(patch.subUpfrontCustomName);
    if (patch.ppDepositPct !== undefined) setPpDepositPct(patch.ppDepositPct);
    if (patch.ppDepositLabel !== undefined) setPpDepositLabel(patch.ppDepositLabel);
    if (patch.ppDeposit !== undefined) setPpDeposit(patch.ppDeposit);
    if (patch.ppInstallments !== undefined) setPpInstallments(patch.ppInstallments);
    if (patch.ppInterval !== undefined) setPpInterval(patch.ppInterval);
    if (patch.dualDiscountPct !== undefined) setDualDiscountPct(patch.dualDiscountPct);
    if (patch.dualDiscountLabel !== undefined) setDualDiscountLabel(patch.dualDiscountLabel);
    if (patch.allowPayerCancel !== undefined) setAllowPayerCancel(patch.allowPayerCancel);
    if (patch.allowPayerPause !== undefined) setAllowPayerPause(patch.allowPayerPause);
    if (patch.allowPayerSkip !== undefined) setAllowPayerSkip(patch.allowPayerSkip);
    if (patch.allowPayerPayoutFull !== undefined) setAllowPayerPayoutFull(patch.allowPayerPayoutFull);
    if (patch.maxPauseDaysPerYear !== undefined) setMaxPauseDaysPerYear(patch.maxPauseDaysPerYear);
    if (patch.maxSkipsPerYear !== undefined) setMaxSkipsPerYear(patch.maxSkipsPerYear);
    if (patch.commitmentPeriodMonths !== undefined) setCommitmentPeriodMonths(patch.commitmentPeriodMonths);
    if (patch.currency !== undefined) setCurrency(patch.currency);
    if (patch.defaultTaxRate !== undefined) setDefaultTaxRate(patch.defaultTaxRate);
  }, []);

  // ---- Build payment config for save ----
  const buildPaymentConfig = useCallback(() => {
    if (paymentModel === "subscription") {
      // New fields (ITEM-3)
      if (subSetupFeeEnabled) {
        return {
          cadence: subCadence, term: subTerm, autoRenew: subAutoRenew,
          setupFeeEnabled: true, setupFeeLabel: subSetupFeeLabel, setupFeeCents: subSetupFeeCents,
          billingCycle: subCadence as BillingCycle,
        };
      }
      // Legacy upfront support
      const upfrontFeeCents = subUpfrontType === "custom"
        ? Math.round(parseFloat(subUpfrontCustom) * 100) || 0
        : subUpfrontType === "first"
          ? lineItems.filter(li => li.type !== "break").reduce((s, li) => s + li.quantity * li.unitPriceCents, 0)
          : 0;
      return {
        cadence: subCadence, term: subTerm, autoRenew: subAutoRenew,
        setupFeeEnabled: false,
        upfrontType: subUpfrontType, upfrontFeeCents, upfrontFeeLabel: subUpfrontCustomName,
        billingCycle: subCadence as BillingCycle,
      };
    }
    if (paymentModel === "payment-plan") {
      return {
        depositPct: ppDepositPct > 0 ? ppDepositPct : parseFloat(ppDeposit) || 0,
        depositLabel: ppDepositLabel,
        installments: parseInt(ppInstallments) || 3,
        interval: ppInterval,
        billingCycle: ppInterval as BillingCycle,
      };
    }
    if (paymentModel === "dual_option") {
      return {
        discountPct: dualDiscountPct,
        discountLabel: dualDiscountLabel,
        installments: parseInt(ppInstallments) || 3,
        interval: ppInterval,
        billingCycle: ppInterval as BillingCycle,
      };
    }
    return {};
  }, [
    paymentModel, subCadence, subTerm, subAutoRenew,
    subSetupFeeEnabled, subSetupFeeLabel, subSetupFeeCents,
    subUpfrontType, subUpfrontCustom, subUpfrontCustomName,
    ppDepositPct, ppDepositLabel, ppDeposit, ppInstallments, ppInterval,
    dualDiscountPct, dualDiscountLabel, lineItems,
  ]);

  // ---- AutoSave ----
  const saveRetryCount = useRef(0);
  const lastErrorToastAt = useRef(0);

  const autoSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    setSaved(false);
    const structure = {
      // P0-1: ensure taxRate is always a number (defaultTaxRate is coerced to number at load time)
      lineItems: lineItems.map((li, i) => ({ ...li, taxRate: typeof li.taxRate === 'number' ? li.taxRate : defaultTaxRate, sortOrder: i })),
      recommendations: recommendations.filter(r => r.trim()),
      blocks: canvasBlocks,
      sections: [], introCopy: "", nextStepsCopy: "",
    };
    const pc = buildPaymentConfig();
    const pmNorm = paymentModel === "one-off" ? "one_off"
      : paymentModel === "payment-plan" ? "payment_plan"
      : paymentModel === "dual_option" ? "dual_option"
      : paymentModel;

    // Payer permissions (ITEM-7 — folded from EngagementCard)
    const lifecycleFields = {
      commercialIntent: (paymentModel === "subscription" ? "ongoing_service" : "fixed_engagement") as "ongoing_service" | "fixed_engagement",
      allowPayerCancel,
      allowPayerPause,
      allowPayerPayoutFull,
      allowPayerSkip,
      allowPayerCardUpdate: true, // always allowed at system level
      commitmentPeriodMonths: parseInt(commitmentPeriodMonths) || null,
      maxSkipsPerYear: parseInt(maxSkipsPerYear) || 2,
      maxPauseDaysPerYear: parseInt(maxPauseDaysPerYear) || 60,
      maxDeferralsPerPlan: 2,
    };

    // Retry up to 3 times for transient failures
    const MAX_RETRIES = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (proposalId) {
          await updateMutation.mutateAsync({ id: proposalId, title, paymentModel: pmNorm as any, paymentConfig: pc, structure, ...lifecycleFields });
        } else {
          if (!clientId || !brandId) { setSaving(false); return; }
          const res = await createMutation.mutateAsync({ brandId, clientId, title, templateId });
          const newId = (res as any).id;
          const newSlug = (res as any).slug;
          setProposalId(newId);
          setProposalSlug(newSlug);
          navigate(`/proposals/${newId}/edit`, { replace: true });
          await updateMutation.mutateAsync({ id: newId, paymentModel: pmNorm as any, paymentConfig: pc, structure, ...lifecycleFields });
        }
        saveRetryCount.current = 0;
        setSaved(true);
        setSaving(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    }
    // All retries exhausted — classify the error and show a clean user-facing message.
    // Raw SQL, stack traces, and internal details go to the console only.
    const now = Date.now();
    const rawMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.error("[AutoSave] exhausted retries:", rawMsg);

    let displayMsg: string;
    // Class 1: Network / fetch failure
    if (/failed to fetch|network error|load failed|networkerror/i.test(rawMsg)) {
      displayMsg = "Network error — check your connection and try again.";
    }
    // Class 2: Postgres / Drizzle query error (raw SQL leaked)
    else if (/failed query|syntax error|column.*does not exist|relation.*does not exist|invalid input syntax|violates.*constraint/i.test(rawMsg)) {
      displayMsg = "Couldn't save this proposal. Please refresh the page. If this keeps happening, contact support.";
    }
    // Class 3: tRPC INTERNAL_SERVER_ERROR wrapping a DB error
    else if (/INTERNAL_SERVER_ERROR|internal server error/i.test(rawMsg)) {
      displayMsg = "Server error — please refresh and try again.";
    }
    // Class 4: Zod validation error (JSON array of issues)
    else {
      let stripped = rawMsg.replace(/^TRPCClientError:\s*/i, "").replace(/^Save failed:\s*/i, "");
      try {
        const zodIssues = JSON.parse(stripped) as Array<{ path: (string|number)[]; message: string }>;
        if (Array.isArray(zodIssues) && zodIssues[0]?.message) {
          const issue = zodIssues[0];
          const pathStr = issue.path.length > 0 ? ` (${issue.path.join(" → ")})` : "";
          displayMsg = `Validation error: ${issue.message}${pathStr}`;
        } else {
          displayMsg = stripped || "Save failed — please try again.";
        }
      } catch {
        // Class 5: Generic error — show if short enough to be meaningful
        displayMsg = stripped.length > 0 && stripped.length < 120 ? stripped : "Save failed — please try again.";
      }
    }

    if (now - lastErrorToastAt.current > 10_000) {
      lastErrorToastAt.current = now;
      toast.error(displayMsg, { position: "bottom-right", duration: 6000 });
    }
    setSaving(false);
  }, [
    title, clientId, brandId, templateId, lineItems, recommendations, canvasBlocks,
    paymentModel, buildPaymentConfig, proposalId, createMutation, updateMutation, navigate,
    defaultTaxRate,
    allowPayerCancel, allowPayerPause, allowPayerPayoutFull, allowPayerSkip,
    commitmentPeriodMonths, maxSkipsPerYear, maxPauseDaysPerYear,
  ]);

  // Debounced auto-save
  useEffect(() => {
    if (!title.trim()) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(), 1200);
    return () => clearTimeout(saveTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    title, clientId, templateId, lineItems, recommendations,
    paymentModel, subCadence, subTerm, subAutoRenew,
    subSetupFeeEnabled, subSetupFeeLabel, subSetupFeeCents,
    ppDepositPct, ppDepositLabel, ppInstallments, ppInterval,
    dualDiscountPct, dualDiscountLabel,
    allowPayerCancel, allowPayerPause, allowPayerSkip, allowPayerPayoutFull,
  ]);

  // ---- Send ----
  const handleSend = async (channel: "sms" | "email", recipient: string) => {
    if (!proposalId) { toast.error("Save the proposal first"); return; }
    if (!recipient.trim()) { toast.error("Recipient is required"); return; }
    setSending(true);
    try {
      await autoSave();
      await sendMutation.mutateAsync({
        id: proposalId,
        sendViaSms: channel === "sms",
        sendViaEmail: channel === "email",
        customMessage: undefined,
        origin: window.location.origin,
      });
      toast.success("Proposal sent!");
      setShowSendDialog(false);
    } catch (e: any) {
      toast.error(sanitizeError(e, "Send failed"));
    } finally {
      setSending(false);
    }
  };

  const { data: user } = useCurrentUser();
  const userName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : undefined;

  // ---- Render ----
  return (
    <div className="builder">
      {/* Top bar */}
      <TopBar
        title={title}
        onTitleChange={setTitle}
        saveState={{ saving, saved }}
        proposalSlug={proposalSlug}
        onBack={() => navigate("/proposals")}
        onPreview={() => setShowPreview(true)}
        onSaveDraft={() => autoSave()}
        wordmarkUrl="/logo-wordmark.svg"
        user={user ? { name: userName || undefined, email: user.email ?? undefined } : null}
        onLogout={() => void handleSignOut()}
      />

      {/* Two-pane layout */}
      <div className="panes">
        {/* ── Left: build pane ── */}
        <div className="build-pane">
          <div className="build-scroll">
          {/* Metadata card: title, client, payment model + payer permissions */}
          <MetadataCard
            title={title}
            onTitleChange={setTitle}
            clientId={clientId}
            clients={((clientsData?.rows ?? []) as any[]).map((c: any) => ({
              id: c.id, name: c.name, businessName: c.businessName, email: c.email, mobile: c.mobile,
            }))}
            onClientChange={id => setClientId(id)}
            paymentConfig={paymentConfig}
            onPaymentConfigChange={handlePaymentConfigChange}
            onAddClient={() => navigate("/clients?new=1")}
          />

          {/* PHASE2-31: Copy editing card */}
          <ContentCard
            blocks={canvasBlocks}
            onBlocksChange={setCanvasBlocks}
          />

          {/* Line items card */}
          <LineItemsCard
            items={lineItems}
            currency={currency}
            onUpdate={updateLineItem}
            onRemove={removeLineItem}
            onMoveUp={id => moveLineItem(id, "up")}
            onMoveDown={id => moveLineItem(id, "down")}
            onDuplicate={duplicateLineItem}
            onAddCustom={() => addLineItem()}
            onAddSection={addSectionBreak}
            categories={categoriesData?.map(c => ({ code: c.code, name: c.label, colourHex: c.colourHex })) ?? undefined}
          />
          </div>{/* end .build-scroll */}
        </div>

        {/* ── Right: catalog pane ── */}
        <CatalogPane
          products={((productsData ?? []) as any[]).map((p: any) => ({
            id: p.id, name: p.name, description: p.description,
            priceCents: p.priceCents, basePriceCents: p.basePriceCents,
            category: p.category, categoryCode: p.categoryCode,
          }))}
          addons={((addonsData ?? []) as any[]).map((p: any) => ({
            id: p.id, name: p.name, description: p.description,
            priceCents: p.priceCents, basePriceCents: p.basePriceCents,
            category: p.category, categoryCode: p.categoryCode,
          }))}
          onAddItem={addLineItem}
          onAddSection={addSectionBreak}
          onAddCustom={() => addLineItem()}
          currency={currency}
        />
      </div>

      {/* Sticky math footer */}
      <MathFooter
        subtotalCents={subtotalCents}
        currency={currency}
        paymentConfig={paymentConfig}
        onPaymentConfigChange={handlePaymentConfigChange}
        issueCount={issueCount}
        onSend={() => { autoSave().then(() => setShowSendDialog(true)); }}
        isSendDisabled={issueCount > 0 || saving}
      />

      {/* Preview drawer overlay */}
      <PreviewDrawer
        open={showPreview}
        onClose={() => setShowPreview(false)}
        proposalTitle={title}
        clientName={selectedClient?.name ?? ""}
        clientBusiness={selectedClient?.businessName ?? ""}
        lineItems={lineItems}
        paymentConfig={paymentConfig}
        proposalSlug={proposalSlug}
        blocks={previewBlocks.length > 0 ? previewBlocks : null}
        brandKit={brandKit ?? null}
        businessName={(accountData as any)?.businessName ?? ""}
      />

      {/* Send dialog */}
      <SendDialog
        open={showSendDialog}
        onClose={() => setShowSendDialog(false)}
        onSend={handleSend}
        defaultPhone={selectedClient?.mobile ?? selectedClient?.phone ?? ""}
        defaultEmail={selectedClient?.email ?? ""}
        proposalTitle={title}
        clientName={selectedClient?.name}
        isSending={sending}
      />
    </div>
  );
}
