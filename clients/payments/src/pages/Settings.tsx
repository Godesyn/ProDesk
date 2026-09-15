import { useState, useEffect, useRef } from 'react';
import { useTRPC, apiUrl } from '@shared/lib/trpc';
import { useBrandId } from '@/lib/payments-trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { ColorPicker as SharedColorPicker } from '@shared/components/ui/color-picker';
import { toast } from 'sonner';
import { isProd } from '@/lib/env';
import { sanitizeError } from '@/lib/errorMessage';
import { LazyImage } from '@shared/components/ui/lazy-image';
import { useRoute, useLocation } from 'wouter';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import SequencesSettings from './SequencesSettings';

type Tab =
  | 'profile'
  | 'stripe'
  | 'integrations'
  | 'notifications'
  | 'email_templates'
  | 'billing'
  | 'sequences'
  | 'security'
  | 'audit'
  | 'currency'
  | 'categories'
  | 'team';

const INTEGRATION_LIST = [
  {
    n: 'Pipedrive',
    sub: 'CRM · two-way deal sync · stage automation',
    st: 'Coming soon',
    color: '#0F0F0F',
  },
  {
    n: 'HubSpot',
    sub: 'CRM · one-way contact sync',
    st: 'Coming soon',
    color: '#FF7A59',
  },
  {
    n: 'Zapier',
    sub: 'Trigger workflows on any platform event',
    st: 'Coming soon',
    color: '#FF4A00',
  },
  {
    n: 'Custom webhook',
    sub: '7 events · POST · signed',
    st: 'Coming soon',
    color: '#0E0E0C',
  },
];

const NOTIF_EVENTS = [
  { name: 'Proposal viewed', email: true, sms: false, inapp: true },
  { name: 'Proposal accepted', email: true, sms: true, inapp: true },
  { name: 'Payment received', email: true, sms: true, inapp: true },
  { name: 'Payment failed', email: true, sms: true, inapp: true },
  { name: 'Proposal expired (48h)', email: true, sms: false, inapp: true },
  { name: 'Payer added', email: false, sms: false, inapp: true },
  { name: 'Team member joined', email: true, sms: false, inapp: true },
  { name: 'Weekly summary', email: true, sms: false, inapp: false },
];

// AUDIT_EVENTS removed — using real data from trpc.payments.accounts.recentActivity

// The export's SecurityTab ran its own TOTP enrolment (totp.* router). 2FA and
// sessions are owned by the Prodesk platform account now — this tab explains
// that and links to the shared profile page.
function SecurityTab() {
  const [, navigate] = useLocation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Two-factor authentication</h3>
          <span className="meta">MANAGED BY PRODESK</span>
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <p
            style={{
              fontSize: 14,
              color: 'var(--ink-60)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Account security — including two-factor authentication, your
            password, and sign-in methods — is managed in your Prodesk platform
            account, shared across every Prodesk service you use.
          </p>
          <button
            className="btn primary"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => navigate('/profile')}
          >
            Manage account security →
          </button>
        </div>
      </div>

      {/* ── Sessions panel ── */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Active sessions</h3>
          <span className="meta">PRODESK AUTH</span>
        </div>
        <div className="pnl-body">
          <p
            style={{
              fontSize: 14,
              color: 'var(--ink-60)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Your sessions are managed by your Prodesk account. Sign out from any
            device using the Sign out button in the top-right menu.
          </p>
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-40)',
              marginTop: 8,
              marginBottom: 0,
            }}
          >
            Session tokens are refreshed automatically while you are active.
          </p>
        </div>
      </div>
    </div>
  );
}

function AuditTab() {
  const [filter, setFilter] = useState('');
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: activity } = useQuery({
    ...trpc.payments.accounts.recentActivity.queryOptions({
      brandId: brandId!,
      limit: 50,
    }),
    enabled: !!brandId,
  });
  const events = (activity ?? []).filter(
    (e: any) =>
      !filter ||
      (e.action ?? '').toLowerCase().includes(filter.toLowerCase()) ||
      (e.detail ?? '').toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Audit log</h3>
          <span className="meta">ACCOUNT EVENTS</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <input
              placeholder="Filter events…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                fontSize: 12,
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-1)',
                background: 'var(--bg-inset)',
                color: 'var(--ink)',
                width: 180,
              }}
            />
            {!isProd && (
              <button
                className="btn ghost sm"
                onClick={() => toast.info('Export CSV coming soon')}
              >
                Export CSV
              </button>
            )}
          </div>
        </div>
        <div className="pnl-body" style={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    style={{
                      textAlign: 'center',
                      padding: 32,
                      color: 'var(--ink-40)',
                    }}
                  >
                    No activity recorded yet
                  </td>
                </tr>
              )}
              {events.map((e: any, i: number) => (
                <tr key={i}>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {e.occurredAt
                      ? new Date(e.occurredAt).toLocaleString()
                      : '—'}
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.08em',
                        background:
                          (e.action ?? '').includes('sent') ||
                          (e.action ?? '').includes('accepted') ||
                          (e.action ?? '').includes('captured')
                            ? 'rgba(217,245,66,0.15)'
                            : 'var(--bg-inset)',
                        color:
                          (e.action ?? '').includes('sent') ||
                          (e.action ?? '').includes('accepted') ||
                          (e.action ?? '').includes('captured')
                            ? 'var(--ink)'
                            : 'var(--ink-60)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {e.action ?? e.eventType ?? '—'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-60)', fontSize: 12 }}>
                    {e.detail ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CurrencyTab() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: account, refetch: refetchAccount } = useQuery({
    ...trpc.payments.accounts.me.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const updateAccount = useMutation(
    trpc.payments.accounts.update.mutationOptions(),
  );
  const { data: fxRates } = useQuery(
    trpc.payments.accounts.getFxRates.queryOptions(),
  );

  const [defaultCurrency, setDefaultCurrency] = useState('AUD');
  const [taxLabel, setTaxLabel] = useState('GST');
  const [defaultTaxRate, setDefaultTaxRate] = useState('10');
  const [taxBehaviourDefault, setTaxBehaviourDefault] = useState<
    'inclusive' | 'exclusive' | 'exempt'
  >('inclusive');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) {
      setDefaultCurrency((account as any).defaultCurrency ?? 'AUD');
      setTaxLabel((account as any).taxLabel ?? 'GST');
      setDefaultTaxRate(String((account as any).defaultTaxRate ?? '10'));
      setTaxBehaviourDefault(
        (account as any).taxBehaviourDefault ?? 'inclusive',
      );
    }
  }, [account]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAccount.mutateAsync({
        brandId: brandId!,
        defaultCurrency,
        taxLabel,
        defaultTaxRate: parseFloat(defaultTaxRate) || 10,
        taxBehaviourDefault,
      } as any);
      toast.success('Currency & tax settings saved');
      refetchAccount();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const CURRENCY_META: Record<string, { name: string; flag: string }> = {
    AUD: { name: 'Australian Dollar', flag: '🇦🇺' },
    USD: { name: 'US Dollar', flag: '🇺🇸' },
    GBP: { name: 'British Pound', flag: '🇬🇧' },
    EUR: { name: 'Euro', flag: '🇪🇺' },
    NZD: { name: 'New Zealand Dollar', flag: '🇳🇿' },
    CAD: { name: 'Canadian Dollar', flag: '🇨🇦' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Default currency */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Default currency</h3>
          <span className="meta">USED ON NEW PROPOSALS</span>
        </div>
        <div className="pnl-body">
          <div className="fld-row">
            <div className="fld">
              <label>Currency</label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--paper)',
                  border: '1px solid var(--border-1)',
                  borderRadius: 6,
                  color: 'var(--ink)',
                }}
              >
                {Object.entries(CURRENCY_META).map(([code, meta]) => (
                  <option key={code} value={code}>
                    {meta.flag} {code} — {meta.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flex: 0.5 }}>
              <label>Selected</label>
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-inset)',
                  borderRadius: 6,
                  fontSize: 20,
                }}
              >
                {CURRENCY_META[defaultCurrency]?.flag ?? ''} {defaultCurrency}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live FX rates */}
      {fxRates && (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Live exchange rates</h3>
            <span className="meta">BASE: AUD · REFRESHED HOURLY</span>
          </div>
          <div
            className="pnl-body"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            {Object.entries(fxRates as Record<string, number>).map(
              ([code, rate]) => (
                <div
                  key={code}
                  style={{
                    padding: 12,
                    background: 'var(--paper)',
                    borderRadius: 8,
                    border: '1px solid var(--border-1)',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span style={{ fontSize: 20 }}>
                      {CURRENCY_META[code]?.flag ?? ''}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {code}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--ink-60)',
                        }}
                      >
                        {Number(rate).toFixed(4)} {code} per AUD
                      </div>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Tax settings */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Tax settings</h3>
          <span className="meta">APPLIED TO NEW PROPOSALS</span>
        </div>
        <div className="pnl-body">
          <div className="fld-row">
            <div className="fld">
              <label>Tax label</label>
              <input
                value={taxLabel}
                onChange={(e) => setTaxLabel(e.target.value)}
                placeholder="e.g. GST, VAT, Tax"
              />
              <div
                style={{ fontSize: 11, color: 'var(--ink-60)', marginTop: 4 }}
              >
                Shown on proposals and invoices.
              </div>
            </div>
            <div className="fld">
              <label>Tax rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={defaultTaxRate}
                onChange={(e) => setDefaultTaxRate(e.target.value)}
                placeholder="10"
              />
            </div>
            <div className="fld">
              <label>Tax behaviour</label>
              <select
                value={taxBehaviourDefault}
                onChange={(e) => setTaxBehaviourDefault(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--paper)',
                  border: '1px solid var(--border-1)',
                  borderRadius: 6,
                  color: 'var(--ink)',
                }}
              >
                <option value="inclusive">
                  Inclusive — prices include tax
                </option>
                <option value="exclusive">Exclusive — tax added on top</option>
                <option value="exempt">Exempt — no tax applied</option>
              </select>
            </div>
          </div>
          {taxBehaviourDefault !== 'exempt' && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'var(--bg-inset)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--ink-60)',
              }}
            >
              Example: A $1,000 item{' '}
              {taxBehaviourDefault === 'inclusive'
                ? `includes ${taxLabel} of $${((1000 * parseFloat(defaultTaxRate || '0')) / (100 + parseFloat(defaultTaxRate || '0'))).toFixed(2)}`
                : `has ${taxLabel} of $${((1000 * parseFloat(defaultTaxRate || '0')) / 100).toFixed(2)} added`}
              . Total{' '}
              {taxBehaviourDefault === 'inclusive'
                ? '$1,000'
                : `$${(1000 + (1000 * parseFloat(defaultTaxRate || '0')) / 100).toFixed(2)}`}
              .
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

const EMAIL_TEMPLATE_DEFAULTS: Record<
  string,
  { label: string; subject: string; bodyHtml: string }
> = {
  nudge: {
    label: 'Chase nudge',
    subject: 'Following up on your proposal from {{business_name}}',
    bodyHtml:
      '<p>Hi {{payer_name}},</p><p>Just following up on the proposal we sent you. Let us know if you have any questions!</p><p>View it here: {{proposal_url}}</p><p>Best,<br/>{{sender_name}}</p>',
  },
  proposal_sent: {
    label: 'Proposal sent',
    subject: '{{business_name}} has sent you a proposal',
    bodyHtml:
      '<p>Hi {{payer_name}},</p><p>Please review and accept your proposal here: {{proposal_url}}</p><p>Best,<br/>{{sender_name}}</p>',
  },
  payment_receipt: {
    label: 'Payment receipt',
    subject: 'Payment received — {{business_name}}',
    bodyHtml:
      '<p>Hi {{payer_name}},</p><p>Thank you for your payment. Your receipt is attached.</p><p>Best,<br/>{{sender_name}}</p>',
  },
  payment_notification: {
    label: 'Payment notification (owner)',
    subject: 'New payment received from {{payer_name}}',
    bodyHtml:
      '<p>A new payment has been received from {{payer_name}} for {{proposal_title}}.</p>',
  },
  portal_link: {
    label: 'Payer portal link',
    subject: 'Your client portal — {{business_name}}',
    bodyHtml:
      '<p>Hi {{payer_name}},</p><p>Access your client portal here: {{portal_url}}</p><p>Best,<br/>{{sender_name}}</p>',
  },
};

function EmailTemplatesTab() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: templates = [] } = useQuery({
    ...trpc.payments.accounts.getEmailTemplates.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const updateMut = useMutation({
    ...trpc.payments.accounts.updateEmailTemplate.mutationOptions(),
    onSuccess: () => toast.success('Template saved'),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const handleEdit = (type: string) => {
    const existing = (templates as any[]).find((t: any) => t.type === type);
    const defaults = EMAIL_TEMPLATE_DEFAULTS[type];
    setSubject(existing?.subject ?? defaults?.subject ?? '');
    setBodyHtml(existing?.bodyHtml ?? defaults?.bodyHtml ?? '');
    setEditing(type);
  };
  const handleSave = () => {
    if (!editing || !brandId) return;
    updateMut.mutate({ brandId, type: editing as any, subject, bodyHtml });
    setEditing(null);
  };
  const TOKENS = [
    '{{payer_name}}',
    '{{business_name}}',
    '{{sender_name}}',
    '{{proposal_url}}',
    '{{proposal_title}}',
    '{{portal_url}}',
  ];
  return (
    <>
      {editing ? (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Edit: {EMAIL_TEMPLATE_DEFAULTS[editing]?.label}</h3>
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <div
            className="pnl-body"
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div className="fld">
              <label>Subject line</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>
            <div className="fld">
              <label>Body (HTML)</label>
              <textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={10}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  resize: 'vertical',
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-60)' }}>
              <strong>Available tokens:</strong> {TOKENS.join(' ')}
            </div>
            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}
            >
              <button className="btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={handleSave}
                disabled={updateMut.isPending}
              >
                {updateMut.isPending ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Email templates</h3>
            <span className="meta">
              {Object.keys(EMAIL_TEMPLATE_DEFAULTS).length} TEMPLATES
            </span>
          </div>
          <div className="pnl-body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(EMAIL_TEMPLATE_DEFAULTS).map(([type, def]) => {
                  const existing = (templates as any[]).find(
                    (t: any) => t.type === type,
                  );
                  return (
                    <tr key={type}>
                      <td style={{ fontWeight: 600 }}>{def.label}</td>
                      <td
                        style={{
                          fontSize: 12,
                          color: 'var(--ink-60)',
                          maxWidth: 240,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {existing?.subject ?? def.subject}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: existing?.isCustom
                              ? 'var(--volt)'
                              : 'var(--ink-40)',
                          }}
                        >
                          {existing?.isCustom ? 'CUSTOM' : 'DEFAULT'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn ghost"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => handleEdit(type)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function IntegrationsTabContent() {
  const trpc = useTRPC();
  const brandId = useBrandId();

  // ── Accounting (Xero) ────────────────────────────────────────────────────────────────
  const { data: acctStatus, refetch: refetchAcct } = useQuery({
    ...trpc.payments.accounts.getAccountingStatus.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const disconnectXero = useMutation({
    ...trpc.payments.accounts.disconnectXero.mutationOptions(),
    onSuccess: () => {
      toast.success('Xero disconnected');
      refetchAcct();
    },
  });

  const handleConnectXero = () => {
    if (!acctStatus?.accountId) {
      toast.error('Account not ready, please try again');
      return;
    }
    window.location.href = `${apiUrl}/api/payments/xero/connect?origin=${encodeURIComponent(window.location.origin)}&accountId=${acctStatus.accountId}`;
  };

  // ── Pipedrive CRM ────────────────────────────────────────────────────────────────
  const { data: pdStatus, refetch: refetchPd } = useQuery({
    ...trpc.payments.integrations.pipedrive.status.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const pdConfigureMut = useMutation({
    ...trpc.payments.integrations.pipedrive.configure.mutationOptions(),
    onSuccess: () => {
      toast.success('Pipedrive settings saved');
      refetchPd();
    },
  });
  const { data: pdPipelines = [] } = useQuery({
    ...trpc.payments.integrations.pipedrive.getPipelines.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId && pdStatus?.connected === true,
  });
  const [pdPipelineId, setPdPipelineId] = useState<number | ''>('');
  const selectedPipelineId =
    pdPipelineId !== '' ? pdPipelineId : (pdStatus?.pipelineId ?? '');
  const { data: pdStages = [] } = useQuery({
    ...trpc.payments.integrations.pipedrive.getStages.queryOptions({
      brandId: brandId!,
      pipelineId: selectedPipelineId as number,
    }),
    enabled: !!brandId && !!selectedPipelineId,
  });
  const [pdStageId, setPdStageId] = useState<number | ''>('');
  const [pdWonStageId, setPdWonStageId] = useState<number | ''>('');

  // Read URL params for OAuth callback feedback
  const urlParams = new URLSearchParams(window.location.search);
  const pdResult = urlParams.get('pipedrive');
  useState(() => {
    if (pdResult === 'connected')
      toast.success('Pipedrive connected successfully!');
    if (pdResult === 'error')
      toast.error('Pipedrive connection failed. Please try again.');
    if (pdResult === 'disconnected') toast.info('Pipedrive disconnected.');
    if (pdResult === 'denied') toast.warning('Pipedrive access was denied.');
  });

  const handleConnectPipedrive = () => {
    if (!pdStatus?.accountId) return;
    window.location.href = `${apiUrl}/api/payments/pipedrive/connect?origin=${encodeURIComponent(window.location.origin)}&accountId=${pdStatus.accountId}`;
  };

  const handleDisconnectPipedrive = () => {
    if (!pdStatus?.accountId) return;
    window.location.href = `${apiUrl}/api/payments/pipedrive/disconnect?origin=${encodeURIComponent(window.location.origin)}&accountId=${pdStatus.accountId}`;
  };

  const handleSavePdConfig = () => {
    pdConfigureMut.mutate({
      brandId: brandId!,
      ...(pdPipelineId !== '' ? { pipelineId: pdPipelineId } : {}),
      ...(pdStageId !== '' ? { stageId: pdStageId } : {}),
      ...(pdWonStageId !== '' ? { wonStageId: pdWonStageId } : {}),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Accounting ── */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Accounting</h3>
          <span className="meta">
            Auto-create invoices on proposal acceptance
          </span>
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '52px 1fr auto',
              gap: 14,
              alignItems: 'center',
              padding: '14px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                background: '#1AB4D7',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: 20,
              }}
            >
              X
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Xero</div>
              <div
                style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 2 }}
              >
                Auto-create draft invoices when a proposal is accepted
              </div>
              {acctStatus?.xero && (
                <div
                  style={{ fontSize: 11, color: 'var(--volt)', marginTop: 4 }}
                >
                  Connected ·{' '}
                  {new Date(acctStatus.xero.connectedAt).toLocaleDateString()}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {acctStatus?.xero ? (
                <button
                  className="btn sm"
                  style={{ color: 'var(--red)' }}
                  onClick={() => disconnectXero.mutate({ brandId: brandId! })}
                  disabled={disconnectXero.isPending || !brandId}
                >
                  Disconnect
                </button>
              ) : (
                <button className="btn sm primary" onClick={handleConnectXero}>
                  Connect Xero
                </button>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '52px 1fr auto',
              gap: 14,
              alignItems: 'center',
              padding: '14px 0',
              opacity: 0.55,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                background: '#6B3FA0',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: 20,
              }}
            >
              M
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>MYOB</div>
              <div
                style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 2 }}
              >
                Auto-create service invoices when a proposal is accepted
              </div>
            </div>
            {!isProd && (
              <div>
                <span className="st pending">
                  <span className="d" />
                  Coming soon
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CRM ── */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>CRM</h3>
          <span className="meta">Two-way deal sync</span>
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          {/* Pipedrive row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '52px 1fr auto',
              gap: 14,
              alignItems: 'flex-start',
              padding: '14px 0',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                background: '#0F0F0F',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: 20,
              }}
            >
              P
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Pipedrive</div>
                <div
                  style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 2 }}
                >
                  CRM · two-way deal sync · stage automation
                </div>
                {pdStatus?.connected && pdStatus.connectedAt && (
                  <div
                    style={{ fontSize: 11, color: 'var(--volt)', marginTop: 4 }}
                  >
                    Connected ·{' '}
                    {new Date(pdStatus.connectedAt).toLocaleDateString()} ·{' '}
                    {pdStatus.apiDomain}
                  </div>
                )}
                {!pdStatus?.oauthConfigured && (
                  <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4 }}>
                    ⚠️ Add PIPEDRIVE_CLIENT_ID and PIPEDRIVE_CLIENT_SECRET in
                    the backend environment to enable OAuth
                  </div>
                )}
              </div>

              {/* Pipeline / stage mapping — only shown when connected */}
              {pdStatus?.connected && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr auto',
                    gap: 8,
                    alignItems: 'flex-end',
                  }}
                >
                  <div className="fld" style={{ margin: 0 }}>
                    <label style={{ fontSize: 11 }}>Pipeline</label>
                    <select
                      value={selectedPipelineId}
                      onChange={(e) => setPdPipelineId(Number(e.target.value))}
                      style={{ fontSize: 12 }}
                    >
                      <option value="">Select pipeline…</option>
                      {(pdPipelines as any[]).map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="fld" style={{ margin: 0 }}>
                    <label style={{ fontSize: 11 }}>New deal stage</label>
                    <select
                      value={
                        pdStageId !== '' ? pdStageId : (pdStatus.stageId ?? '')
                      }
                      onChange={(e) => setPdStageId(Number(e.target.value))}
                      style={{ fontSize: 12 }}
                      disabled={!selectedPipelineId}
                    >
                      <option value="">Select stage…</option>
                      {(pdStages as any[]).map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="fld" style={{ margin: 0 }}>
                    <label style={{ fontSize: 11 }}>
                      Won stage (on accept)
                    </label>
                    <select
                      value={
                        pdWonStageId !== ''
                          ? pdWonStageId
                          : (pdStatus.wonStageId ?? '')
                      }
                      onChange={(e) => setPdWonStageId(Number(e.target.value))}
                      style={{ fontSize: 12 }}
                      disabled={!selectedPipelineId}
                    >
                      <option value="">Select stage…</option>
                      {(pdStages as any[]).map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn sm primary"
                    onClick={handleSavePdConfig}
                    disabled={pdConfigureMut.isPending}
                  >
                    {pdConfigureMut.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
              {pdStatus?.connected ? (
                <button
                  className="btn sm"
                  style={{ color: '#EF4444' }}
                  onClick={handleDisconnectPipedrive}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="btn sm primary"
                  onClick={handleConnectPipedrive}
                  disabled={!pdStatus?.oauthConfigured}
                  title={
                    !pdStatus?.oauthConfigured
                      ? 'Add PIPEDRIVE_CLIENT_ID and PIPEDRIVE_CLIENT_SECRET first'
                      : undefined
                  }
                >
                  Connect Pipedrive
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Other integrations ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {INTEGRATION_LIST.filter((it) => it.n !== 'Pipedrive').map((it, i) => (
          <div
            key={i}
            className="pnl"
            style={{
              padding: 18,
              display: 'grid',
              gridTemplateColumns: '52px 1fr auto',
              gap: 14,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                background: it.color,
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: 20,
              }}
            >
              {it.n.charAt(0)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{it.n}</div>
              <div
                style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 2 }}
              >
                {it.sub}
              </div>
            </div>
            {!isProd && (
              <span className="st pending">
                <span className="d" />
                Coming soon
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoriesTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandId = useBrandId();
  const invalidateList = () =>
    qc.invalidateQueries({
      queryKey: trpc.payments.categories.list.queryKey(),
    });
  const { data: cats = [], isLoading } = useQuery({
    ...trpc.payments.categories.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const createMut = useMutation({
    ...trpc.payments.categories.create.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      setNewLabel('');
      setNewCode('');
      setNewColour('#3B82F6');
      toast.success('Category created');
    },
  });
  const updateMut = useMutation({
    ...trpc.payments.categories.update.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      setEditId(null);
      toast.success('Saved');
    },
  });
  const archiveMut = useMutation({
    ...trpc.payments.categories.archive.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      toast.success('Category archived');
    },
  });

  const [newLabel, setNewLabel] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newColour, setNewColour] = useState('#3B82F6');
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColour, setEditColour] = useState('');

  const startEdit = (cat: any) => {
    setEditId(cat.id);
    setEditLabel(cat.label);
    setEditColour(cat.colourHex);
  };
  const saveEdit = () => {
    if (editId == null) return;
    updateMut.mutate({ id: editId, label: editLabel, colourHex: editColour });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Line item categories</h3>
          <span className="meta">ACCOUNT-WIDE</span>
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <p
            style={{ fontSize: 13, color: 'var(--ink-60)', margin: '0 0 8px' }}
          >
            Categories appear as a dropdown on each line item in the proposal
            builder. Rename or recolour defaults; archive any you don't need.
          </p>
          {isLoading && (
            <div style={{ color: 'var(--ink-40)', fontSize: 13 }}>Loading…</div>
          )}
          {(cats as any[]).map((cat: any) => (
            <div
              key={cat.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: 'var(--bg-inset)',
                borderRadius: 8,
                border: '1px solid var(--border-1)',
              }}
            >
              {editId === cat.id ? (
                <>
                  <SharedColorPicker
                    value={editColour}
                    onChange={setEditColour}
                    ariaLabel="Category colour"
                  />
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    style={{
                      flex: 1,
                      fontSize: 13,
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-1)',
                      background: 'var(--bg-inset)',
                      color: 'var(--ink)',
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                  />
                  <button
                    className="btn primary sm"
                    onClick={saveEdit}
                    disabled={updateMut.isPending}
                  >
                    Save
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => setEditId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: cat.colourHex,
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                    {cat.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-40)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {cat.code}
                  </span>
                  {cat.isDefault && (
                    <span
                      style={{
                        fontSize: 10,
                        background: 'rgba(217,245,66,0.15)',
                        color: 'var(--volt)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 700,
                      }}
                    >
                      DEFAULT
                    </span>
                  )}
                  <button
                    className="btn ghost sm"
                    onClick={() => startEdit(cat)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn ghost sm"
                    style={{ color: '#EF4444' }}
                    onClick={() => archiveMut.mutate({ id: cat.id })}
                    disabled={archiveMut.isPending}
                  >
                    Archive
                  </button>
                </>
              )}
            </div>
          ))}
          {(cats as any[]).length === 0 && !isLoading && (
            <div
              style={{
                fontSize: 13,
                color: 'var(--ink-40)',
                textAlign: 'center',
                padding: 20,
              }}
            >
              No categories yet. Add one below or click "Restore defaults".
            </div>
          )}
        </div>
      </div>

      <div className="pnl">
        <div className="pnl-hd">
          <h3>Add category</h3>
        </div>
        <div
          className="pnl-body"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div className="fld" style={{ flex: '0 0 auto' }}>
            <label>Colour</label>
            <SharedColorPicker
              value={newColour}
              onChange={setNewColour}
              ariaLabel="Category colour"
            />
          </div>
          <div className="fld" style={{ flex: '1 1 120px' }}>
            <label>Code (slug)</label>
            <input
              placeholder="e.g. strategy"
              value={newCode}
              onChange={(e) =>
                setNewCode(
                  e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                )
              }
            />
          </div>
          <div className="fld" style={{ flex: '2 1 160px' }}>
            <label>Label</label>
            <input
              placeholder="e.g. Strategy"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <button
            className="btn primary"
            style={{ marginBottom: 2 }}
            disabled={
              !newLabel.trim() ||
              !newCode.trim() ||
              createMut.isPending ||
              !brandId
            }
            onClick={() =>
              createMut.mutate({
                brandId: brandId!,
                code: newCode,
                label: newLabel,
                colourHex: newColour,
              })
            }
          >
            {createMut.isPending ? 'Adding…' : 'Add category'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Brand staff are ONE team shared across every Prodesk frontend. This tab lists
// ALL the brand's teammates — including people invited from another tool (Links,
// Reviews, …) who don't yet have Payments access — and lets a manager grant/revoke
// this tool's access + switch role (Payments Editor / Payments Viewer) without
// leaving the app. Other brand permissions stay managed in Prodesk. Mirrors
// clients/links' SettingsTeam; see docs/permissions.md "Cross-frontend team".
type PayRole = 'editor' | 'viewer';
const TEAM_EMAIL_RE = /.+@.+\..+/;

/** A staff member's Payments role from their permission list (null = no access). */
function payRole(perms: readonly string[]): PayRole | null {
  if (perms.includes('payments')) return 'editor';
  if (perms.includes('paymentsViewer')) return 'viewer';
  return null;
}
/** Set/replace the Payments permission, preserving any non-Payments permissions. */
function withPayRole(perms: readonly string[], role: PayRole): string[] {
  return [
    ...withoutPay(perms),
    role === 'editor' ? 'payments' : 'paymentsViewer',
  ];
}
/** Strip the Payments permissions, keeping everything else (revokes access only). */
function withoutPay(perms: readonly string[]): string[] {
  return perms.filter((p) => p !== 'payments' && p !== 'paymentsViewer');
}

const teamSelectStyle = {
  padding: '5px 8px',
  background: 'var(--paper)',
  border: '1px solid var(--border-1)',
  borderRadius: 6,
  color: 'var(--ink)',
  fontSize: 13,
};

function TeamTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandId = useBrandId();
  const { data: user } = useCurrentUser();

  const isOwner = user?.role === 'brandOwner';
  const canManage =
    isOwner || (user?.permissions ?? []).includes('staffManagement');

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PayRole>('editor');
  // Two-step removal in ONE dialog: `managing` opens it; `confirmRemove` swaps
  // its contents from the "Remove access / Remove team member" choice to the
  // whole-suite confirmation (keeps a single overlay mounted).
  const [managing, setManaging] = useState<{
    id: string;
    email: string;
    permissions: readonly string[];
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const list = useQuery({
    ...trpc.staff.list.queryOptions({
      orgType: 'brand',
      orgId: brandId!,
      limit: 100,
      offset: 0,
    }),
    enabled: canManage && !!brandId,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: trpc.staff.list.queryKey() });

  const invite = useMutation({
    ...trpc.staff.invite.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast.success('Invite sent to ' + email.trim());
      setInviting(false);
      setEmail('');
      setRole('editor');
    },
    onError: (e: any) => toast.error(sanitizeError(e, 'Failed to send invite')),
  });
  const updatePermissions = useMutation({
    ...trpc.staff.updatePermissions.mutationOptions(),
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(sanitizeError(e, 'Failed to update access')),
  });
  const remove = useMutation({
    ...trpc.staff.remove.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast.success('Removed.');
    },
    onError: (e: any) => toast.error(sanitizeError(e, 'Failed to remove')),
  });

  // Show EVERY current teammate (not just those with Payments access). Removed rows
  // are soft-deleted (status→'removed') but keep their permissions array, so exclude
  // them explicitly.
  const members = (list.data?.items ?? []).filter(
    (m) => m.status !== 'removed',
  );
  const setPermissions = (id: string, permissions: string[]) =>
    updatePermissions.mutate({ id, permissions: permissions as never });
  const closeManage = () => {
    setManaging(null);
    setConfirmRemove(false);
  };

  if (!canManage) {
    return (
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Team access</h3>
          <span className="meta">MANAGED BY OWNERS</span>
        </div>
        <div className="pnl-body">
          <p
            style={{
              fontSize: 14,
              color: 'var(--ink-60)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            You need the Team Management permission to invite or manage
            teammates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Team access</h3>
          <button
            className="btn primary sm"
            onClick={() => setInviting((v) => !v)}
          >
            {inviting ? 'Cancel' : 'Invite teammate'}
          </button>
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <p
            style={{
              fontSize: 14,
              color: 'var(--ink-60)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Grant Payments access to anyone here — editors create and send
            proposals, take payments and issue refunds; viewers can see
            proposals, payers and analytics but can&rsquo;t change anything.
          </p>

          {inviting && (
            <div
              className="fld-row"
              style={{ alignItems: 'flex-end', gap: 10 }}
            >
              <div className="fld" style={{ flex: 1 }}>
                <label>Email</label>
                <input
                  value={email}
                  autoFocus
                  placeholder="name@business.com.au"
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--paper)',
                    border: '1px solid var(--border-1)',
                    borderRadius: 6,
                    color: 'var(--ink)',
                  }}
                />
              </div>
              <div className="fld" style={{ flex: 0.5 }}>
                <label>Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as PayRole)}
                  style={{
                    ...teamSelectStyle,
                    width: '100%',
                    padding: '8px 10px',
                  }}
                >
                  <option value="editor">Payments Editor</option>
                  <option value="viewer">Payments Viewer</option>
                </select>
              </div>
              <button
                className="btn primary"
                disabled={
                  !TEAM_EMAIL_RE.test(email) || invite.isPending || !brandId
                }
                onClick={() =>
                  invite.mutate({
                    orgType: 'brand',
                    orgId: brandId!,
                    email: email.trim(),
                    permissions: [
                      role === 'editor' ? 'payments' : 'paymentsViewer',
                    ] as never,
                  })
                }
              >
                {invite.isPending ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="pnl">
        <div className="pnl-hd">
          <h3>Teammates</h3>
          <span className="meta">ONE TEAM ACROSS PRODESK</span>
        </div>
        <div className="pnl-body" style={{ padding: 0 }}>
          {list.isLoading ? (
            <div style={{ padding: 16, color: 'var(--ink-60)' }}>Loading…</div>
          ) : members.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--ink-60)' }}>
              No teammates yet. Invite someone to share the payments workspace.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Payments access</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const r = payRole(m.permissions);
                  const name = [m.firstName, m.lastName]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>
                        {name || (
                          <span style={{ color: 'var(--ink-60)' }}>
                            Invited
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--ink-60)' }}>{m.email}</td>
                      <td>
                        {r ? (
                          <select
                            value={r}
                            disabled={updatePermissions.isPending}
                            onChange={(e) =>
                              setPermissions(
                                m.id,
                                withPayRole(
                                  m.permissions,
                                  e.target.value as PayRole,
                                ),
                              )
                            }
                            style={teamSelectStyle}
                          >
                            <option value="editor">Payments Editor</option>
                            <option value="viewer">Payments Viewer</option>
                          </select>
                        ) : (
                          <button
                            className="btn ghost sm"
                            disabled={updatePermissions.isPending}
                            onClick={() =>
                              setPermissions(
                                m.id,
                                withPayRole(m.permissions, 'editor'),
                              )
                            }
                          >
                            Grant access
                          </button>
                        )}
                      </td>
                      <td style={{ color: 'var(--ink-60)', fontSize: 13 }}>
                        {m.status === 'active' ? 'Active' : 'Invite sent'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r ? (
                          <button
                            className="btn ghost sm"
                            style={{ color: 'var(--danger, #d33)' }}
                            disabled={updatePermissions.isPending}
                            onClick={() =>
                              setManaging({
                                id: m.id,
                                email: m.email,
                                permissions: m.permissions,
                              })
                            }
                          >
                            Remove access
                          </button>
                        ) : (
                          <button
                            className="btn ghost sm"
                            style={{ color: 'var(--danger, #d33)' }}
                            disabled={remove.isPending}
                            onClick={() => {
                              setManaging({
                                id: m.id,
                                email: m.email,
                                permissions: m.permissions,
                              });
                              setConfirmRemove(true);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog
        open={!!managing}
        onOpenChange={(o) => {
          if (!o) closeManage();
        }}
      >
        <DialogContent className="max-w-md">
          {confirmRemove ? (
            <>
              <DialogHeader>
                <DialogTitle>Remove team member?</DialogTitle>
              </DialogHeader>
              <p style={{ fontSize: 14, color: 'var(--ink-60)', margin: 0 }}>
                {managing?.email} will be removed from this brand — you&rsquo;ll
                be removing their access to all of the Prodesk suite, not just
                Payments.
              </p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 6,
                }}
              >
                <button className="btn ghost" onClick={closeManage}>
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ background: 'var(--danger, #d33)', color: '#fff' }}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (managing) remove.mutate({ id: managing.id });
                    closeManage();
                  }}
                >
                  Remove team member
                </button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Remove access</DialogTitle>
              </DialogHeader>
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--ink-60)',
                  margin: '0 0 4px',
                }}
              >
                {managing?.email} — choose what to remove.
              </p>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <button
                  type="button"
                  disabled={updatePermissions.isPending}
                  style={{
                    textAlign: 'left',
                    padding: '10px 14px',
                    border: '1px solid var(--border-1)',
                    borderRadius: 8,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    if (managing)
                      setPermissions(
                        managing.id,
                        withoutPay(managing.permissions),
                      );
                    closeManage();
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    Remove Payments access
                  </div>
                  <div style={{ color: 'var(--ink-60)', fontSize: 12 }}>
                    Stays on the team — loses this app only
                  </div>
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  style={{
                    textAlign: 'left',
                    padding: '10px 14px',
                    border: '1px solid var(--danger, #d33)',
                    borderRadius: 8,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => setConfirmRemove(true)}
                >
                  <div
                    style={{ fontWeight: 600, color: 'var(--danger, #d33)' }}
                  >
                    Remove team member
                  </div>
                  <div style={{ color: 'var(--ink-60)', fontSize: 12 }}>
                    Removes them from the whole Prodesk suite
                  </div>
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// BRAND KIT PREVIEW PANEL
// Shows a mini proposal preview using the account's brand colours
// ============================================================
function contrastRatioHex(hex1: string, hex2: string): number {
  function lum(hex: string) {
    const c = hex.replace('#', '');
    if (c.length < 6) return 0;
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    const toL = (v: number) =>
      v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return 0.2126 * toL(r) + 0.7152 * toL(g) + 0.0722 * toL(b);
  }
  const l1 = lum(hex1),
    l2 = lum(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function BrandKitPreviewPanel() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: brandKit } = useQuery({
    ...trpc.payments.accounts.getBrandKit.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const updateBrandKit = useMutation(
    trpc.payments.accounts.updateBrandKit.mutationOptions(),
  );

  const bg = (brandKit as any)?.backgroundColor ?? '#0A0A0A';
  const accent =
    (brandKit as any)?.accentColor ??
    (brandKit as any)?.primaryColor ??
    '#65F5C9';
  const accent2 = (brandKit as any)?.accentColor2 ?? '#FFFFFF';
  const text = (brandKit as any)?.textColor ?? '#FFFFFF';
  const headingFont = (brandKit as any)?.headingFont ?? 'Inter';
  const bodyFont = (brandKit as any)?.bodyFont ?? 'Inter';

  const [localBg, setLocalBg] = useState(bg);
  const [localAccent, setLocalAccent] = useState(accent);
  const [localAccent2, setLocalAccent2] = useState(accent2);
  const [localText, setLocalText] = useState(text);
  // Explicit role colours
  const [localDark, setLocalDark] = useState(
    (brandKit as any)?.darkColor ?? '#0A0A0A',
  );
  const [localLight, setLocalLight] = useState(
    (brandKit as any)?.lightColor ?? '#F4F1E8',
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalBg((brandKit as any)?.backgroundColor ?? '#0A0A0A');
    setLocalAccent(
      (brandKit as any)?.accentColor ??
        (brandKit as any)?.primaryColor ??
        '#65F5C9',
    );
    setLocalAccent2((brandKit as any)?.accentColor2 ?? '#FFFFFF');
    setLocalText((brandKit as any)?.textColor ?? '#FFFFFF');
    setLocalDark((brandKit as any)?.darkColor ?? '#0A0A0A');
    setLocalLight((brandKit as any)?.lightColor ?? '#F4F1E8');
  }, [brandKit]);

  // Smart contrast warning: accent on light bg
  const accentOnLightContrast = contrastRatioHex(localAccent, localLight);
  const showContrastWarning = accentOnLightContrast < 3.0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateBrandKit.mutateAsync({
        brandId: brandId!,
        backgroundColor: localBg,
        accentColor: localAccent,
        accentColor2: localAccent2,
        textColor: localText,
        darkColor: localDark,
        lightColor: localLight,
      } as any);
      toast.success('Brand kit colours saved');
    } catch {
      toast.error('Failed to save brand kit');
    } finally {
      setSaving(false);
    }
  };

  function ColorPicker({
    label,
    value,
    set,
    hint,
  }: {
    label: string;
    value: string;
    set: (v: string) => void;
    hint?: string;
  }) {
    return (
      <div className="fld">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {hint && (
            <span
              style={{ fontSize: 10, color: 'var(--ink-40)', fontWeight: 400 }}
            >
              {hint}
            </span>
          )}
        </label>
        <SharedColorPicker value={value} onChange={set} ariaLabel={label} />
      </div>
    );
  }

  return (
    <div className="pnl">
      <div className="pnl-hd">
        <h3>Brand Kit</h3>
        <span className="meta">COLOURS APPLIED TO PROPOSALS</span>
      </div>
      <div className="pnl-body">
        {/* Role-based colour pickers */}
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
              marginBottom: 10,
            }}
          >
            Section Roles
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <ColorPicker
              label="◼ Dark"
              value={localDark}
              set={setLocalDark}
              hint="Deep sections"
            />
            <ColorPicker
              label="◻ Light"
              value={localLight}
              set={setLocalLight}
              hint="Open sections"
            />
            <ColorPicker
              label="◈ Accent"
              value={localAccent}
              set={setLocalAccent}
              hint="CTA / stat sections"
            />
          </div>
          {showContrastWarning && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.25)',
                marginBottom: 8,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                style={{ flexShrink: 0, marginTop: 1 }}
              >
                <path
                  d="M7 1L13 12H1L7 1Z"
                  stroke="#FBBF24"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 5v3"
                  stroke="#FBBF24"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <circle cx="7" cy="10" r="0.7" fill="#FBBF24" />
              </svg>
              <div style={{ fontSize: 12, color: '#92610a', lineHeight: 1.5 }}>
                <strong>Low contrast warning:</strong> Your accent colour (
                {localAccent}) has a contrast ratio of{' '}
                {accentOnLightContrast.toFixed(1)}:1 on the light background (
                {localLight}). Small text may be hard to read. Consider using
                your dark colour ({localDark}) for body text on light sections —
                the Apply Brand Kit button handles this automatically.
              </div>
            </div>
          )}
        </div>

        {/* Legacy colour pickers */}
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
              marginBottom: 10,
            }}
          >
            Legacy Colours
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <ColorPicker label="Background" value={localBg} set={setLocalBg} />
            <ColorPicker label="Text" value={localText} set={setLocalText} />
            <ColorPicker
              label="Accent 2 (Tertiary)"
              value={localAccent2}
              set={setLocalAccent2}
            />
          </div>
        </div>

        {/* Mini proposal preview */}
        <div
          style={{
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border-1)',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              background: 'var(--bg-inset)',
              padding: '8px 12px',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em',
              color: 'var(--ink-60)',
            }}
          >
            PROPOSAL PREVIEW
          </div>
          <div
            style={{
              background: localBg,
              padding: '32px 28px',
              fontFamily: headingFont,
            }}
          >
            {/* Hero preview */}
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: localAccent,
                  marginBottom: 8,
                  fontFamily: bodyFont,
                }}
              >
                YOUR BUSINESS · PROPOSAL
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: localText,
                  lineHeight: 1.1,
                  marginBottom: 8,
                }}
              >
                Proposal for Client
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: localText + '99',
                  lineHeight: 1.5,
                  maxWidth: 320,
                  fontFamily: bodyFont,
                }}
              >
                A tailored solution designed specifically for your needs and
                goals.
              </div>
              <div
                style={{
                  marginTop: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 999,
                  background: localAccent,
                  color: '#000',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                View Proposal
              </div>
            </div>
            {/* Pricing preview */}
            <div
              style={{
                borderTop: `1px solid ${localAccent}30`,
                paddingTop: 20,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: localAccent,
                  marginBottom: 12,
                  fontFamily: bodyFont,
                }}
              >
                INVESTMENT
              </div>
              {['Service A', 'Service B', 'Service C'].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: `1px solid ${localAccent}18`,
                    fontSize: 13,
                    color: localText + 'cc',
                    fontFamily: bodyFont,
                  }}
                >
                  <span>{item}</span>
                  <span style={{ color: localText, fontWeight: 600 }}>
                    ${(1200 + i * 800).toLocaleString()}
                  </span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  fontSize: 18,
                  fontWeight: 700,
                  color: localAccent,
                }}
              >
                <span style={{ color: localText }}>Total</span>
                <span>$4,800</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save brand colours'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stripe Connect Panel — real status + resume onboarding flow
// ---------------------------------------------------------------------------
function StripeConnectPanel() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const confirm = useConfirm();
  const { data: connectStatus, refetch: refetchStatus } = useQuery({
    ...trpc.payments.integrations.stripe.status.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  // connectUrl derives the return origin from ctx.clientOrigin server-side —
  // the export's `origin` input is gone.
  const { data: connectUrlData } = useQuery({
    ...trpc.payments.integrations.stripe.connectUrl.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const disconnect = useMutation({
    ...trpc.payments.integrations.stripe.disconnect.mutationOptions(),
    onSuccess: () => {
      toast.success('Stripe disconnected');
      refetchStatus();
    },
    onError: (e) => toast.error(sanitizeError(e, 'Failed to disconnect')),
  });

  const handleConnect = () => {
    const url = connectUrlData?.url;
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.info(connectUrlData?.message ?? 'Loading Stripe Connect URL…');
    }
  };

  const isConnected = connectStatus?.connected;
  const isIncomplete =
    connectStatus?.status === 'incomplete' ||
    connectStatus?.status === 'pending';
  const acctId = connectStatus?.stripeAccountId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Status banner */}
      <div
        className="connect-box"
        style={{
          borderColor: isConnected
            ? 'var(--volt)'
            : isIncomplete
              ? '#F59E0B'
              : 'var(--border-1)',
        }}
      >
        <div
          className="logo-mark"
          style={{
            background: isConnected
              ? '#064E3B'
              : isIncomplete
                ? '#78350F'
                : '#1a1a1a',
          }}
        >
          S
        </div>
        <div className="body">
          {isConnected ? (
            <>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                Stripe Connected
                <span className="st connected">
                  <span className="d" />
                  active
                </span>
              </h3>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--ink-60)',
                }}
              >
                {acctId
                  ? `${acctId.slice(0, 8)}·····${acctId.slice(-4)}`
                  : 'Account connected'}
              </p>
              <div className="bullets">
                <span>✓ PAYMENTS ENABLED</span>
                <span>
                  ✓ {connectStatus?.platformFeePercent ?? '—'}% PLATFORM FEE
                </span>
                <span>✓ CONNECT EXPRESS</span>
              </div>
            </>
          ) : isIncomplete ? (
            <>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                Onboarding Incomplete
                <span
                  className="st"
                  style={{
                    background: 'rgba(245,158,11,0.15)',
                    color: '#F59E0B',
                  }}
                >
                  <span className="d" style={{ background: '#F59E0B' }} />
                  pending
                </span>
              </h3>
              <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
                Your Stripe account setup is incomplete. Resume onboarding to
                start accepting payments.
              </p>
            </>
          ) : (
            <>
              <h3>Not connected</h3>
              <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
                Connect a Stripe account to accept payments from your clients.
                Your platform fee is based on your plan — see the Billing tab
                for your current rate.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Platform fee info */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}
      >
        {[
          {
            k: 'PLATFORM FEE',
            v:
              connectStatus?.platformFeePercent != null
                ? `${connectStatus.platformFeePercent}%`
                : 'Based on plan',
            sub: 'See Billing tab for your rate',
          },
          {
            k: 'PAYOUT SCHEDULE',
            v: '24-hour rolling',
            sub: 'AEST · skips weekends',
          },
          {
            k: 'METHODS ACCEPTED',
            v: 'Card · Apple · Google · BECS',
            sub: 'Configure in Stripe',
          },
        ].map((r, i) => (
          <div key={i} className="pnl" style={{ padding: 18 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.12em',
                color: 'var(--ink-60)',
              }}
            >
              {r.k}
            </div>
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 16 }}>
              {r.v}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 4 }}>
              {r.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!isConnected ? (
          <button className="btn primary" onClick={handleConnect}>
            {isIncomplete ? 'Resume Stripe onboarding →' : 'Connect Stripe →'}
          </button>
        ) : (
          <>
            <button
              className="btn ghost"
              onClick={() =>
                window.open('https://dashboard.stripe.com', '_blank')
              }
            >
              Open Stripe dashboard ↗
            </button>
            <button className="btn" onClick={handleConnect}>
              Update onboarding
            </button>
            <button
              className="btn"
              style={{ color: 'var(--red)' }}
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Disconnect Stripe?',
                    description:
                      'You will not be able to accept payments until you reconnect.',
                    confirmLabel: 'Disconnect',
                    destructive: true,
                  })
                ) {
                  disconnect.mutate({ brandId: brandId! });
                }
              }}
              disabled={disconnect.isPending || !brandId}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </>
        )}
      </div>

      {/* Onboarding steps when not connected */}
      {!isConnected && (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>How it works</h3>
          </div>
          <div
            className="pnl-body"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {[
              {
                n: 1,
                t: 'Click "Connect Stripe"',
                d: "You'll be redirected to Stripe to create or connect an Express account.",
              },
              {
                n: 2,
                t: 'Complete Stripe onboarding',
                d: 'Verify your identity, add your bank account, and confirm your business details.',
              },
              {
                n: 3,
                t: 'Start accepting payments',
                d: 'EziQuotes will automatically route payments to your Stripe account. Your fee rate is based on your plan — see the Billing tab.',
              },
            ].map((step) => (
              <div
                key={step.n}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--volt)',
                    color: 'var(--ink)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {step.n}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{step.t}</div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--ink-60)',
                      marginTop: 2,
                    }}
                  >
                    {step.d}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Billing Tab — Tier selection and fee summary
// ---------------------------------------------------------------------------
function BillingTab() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const {
    data: tierInfo,
    isLoading: tierLoading,
    refetch: refetchTier,
  } = useQuery({
    ...trpc.payments.billing.getTierInfo.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: waitlistStatus, refetch: refetchWaitlist } = useQuery({
    ...trpc.payments.billing.getWaitlistStatus.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const { data: billing } = useQuery({
    ...trpc.payments.accounts.billingSummary.queryOptions({
      brandId: brandId!,
    }),
    enabled: !!brandId,
  });
  const changeTier = useMutation({
    ...trpc.payments.billing.changeTier.mutationOptions(),
    onSuccess: (r: any) => {
      toast.success(`Switched to ${r.toTier} tier (${r.newRatePercent}% fee)`);
      refetchTier();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const joinWaitlist = useMutation({
    ...trpc.payments.billing.joinRecoverWaitlist.mutationOptions(),
    onSuccess: () => {
      toast.success("You're on the Recover waitlist!");
      refetchWaitlist();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const leaveWaitlist = useMutation({
    ...trpc.payments.billing.leaveRecoverWaitlist.mutationOptions(),
    onSuccess: () => {
      toast.success('Removed from waitlist');
      refetchWaitlist();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });

  const currentTier = tierInfo?.tier ?? 'close';
  const allTiers = (tierInfo?.allTiers ?? {}) as Record<
    string,
    {
      name: string;
      tagline: string;
      rate: number;
      features: string[];
      comingSoon?: boolean;
    }
  >;

  const TIER_ORDER = ['send', 'close', 'recover'] as const;

  const TIER_COLORS: Record<string, string> = {
    send: '#6B7280',
    close: 'var(--volt)',
    recover: '#A78BFA',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats row */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}
      >
        {[
          {
            k: 'APP FEES THIS MONTH',
            v: billing
              ? `$${((billing.feeThisMonthCents ?? 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—',
            sub: tierInfo
              ? `${tierInfo.ratePercent}% of processed volume`
              : 'Loading...',
          },
          {
            k: 'VOLUME PROCESSED',
            v: billing
              ? `$${((billing.volumeThisMonthCents ?? 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—',
            sub: new Date().toLocaleString('en-AU', {
              month: 'long',
              year: 'numeric',
            }),
          },
          {
            k: 'TRANSACTIONS',
            v: billing ? String(billing.totalPayments ?? 0) : '—',
            sub: 'Successful payments this month',
          },
        ].map((r, i) => (
          <div key={i} className="pnl" style={{ padding: 18 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.12em',
                color: 'var(--ink-60)',
              }}
            >
              {r.k}
            </div>
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 20 }}>
              {r.v}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 4 }}>
              {r.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Tier selection */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>Your plan</h3>
          {tierLoading ? (
            <span className="meta">LOADING...</span>
          ) : (
            <span className="meta" style={{ color: TIER_COLORS[currentTier] }}>
              {currentTier.toUpperCase()} · {tierInfo?.ratePercent}% FEE
            </span>
          )}
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <p
            style={{
              fontSize: 13,
              color: 'var(--ink-60)',
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            EziQuotes charges a usage-based platform fee — no monthly
            subscription. Your fee rate is locked at the time each proposal is
            created.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            {TIER_ORDER.map((tier) => {
              const meta = allTiers[tier];
              if (!meta) return null;
              const isActive = currentTier === tier;
              const isRecover = tier === 'recover';
              const onWaitlist = waitlistStatus?.onWaitlist && isRecover;
              return (
                <div
                  key={tier}
                  style={{
                    border: isActive
                      ? `2px solid ${TIER_COLORS[tier]}`
                      : '1px solid var(--border-1)',
                    borderRadius: 10,
                    padding: 16,
                    background: isActive
                      ? `${TIER_COLORS[tier]}0D`
                      : 'var(--card)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    position: 'relative',
                    opacity: isRecover ? 0.85 : 1,
                  }}
                >
                  {isActive && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: TIER_COLORS[tier],
                        background: `${TIER_COLORS[tier]}1A`,
                        padding: '2px 8px',
                        borderRadius: 20,
                      }}
                    >
                      CURRENT
                    </div>
                  )}
                  {isRecover && !isActive && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: '#A78BFA',
                        background: '#A78BFA1A',
                        padding: '2px 8px',
                        borderRadius: 20,
                      }}
                    >
                      WAITLIST
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {meta.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-60)' }}>
                    {meta.tagline}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 22,
                      fontWeight: 700,
                      color: TIER_COLORS[tier],
                    }}
                  >
                    {meta.rate}%
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-40)',
                      marginTop: -6,
                    }}
                  >
                    platform fee
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      flex: 1,
                    }}
                  >
                    {meta.features.map((f: string, i: number) => (
                      <li
                        key={i}
                        style={{
                          fontSize: 12,
                          color: 'var(--ink-80)',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            color: TIER_COLORS[tier],
                            marginTop: 1,
                            flexShrink: 0,
                          }}
                        >
                          ✓
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <div style={{ marginTop: 8 }}>
                    {isActive ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--ink-40)',
                          textAlign: 'center',
                        }}
                      >
                        Active plan
                      </div>
                    ) : isRecover ? (
                      onWaitlist ? (
                        <button
                          className="btn ghost sm"
                          style={{ width: '100%', fontSize: 12 }}
                          onClick={() =>
                            leaveWaitlist.mutate({ brandId: brandId! })
                          }
                          disabled={leaveWaitlist.isPending || !brandId}
                        >
                          {leaveWaitlist.isPending
                            ? 'Leaving...'
                            : 'Leave waitlist'}
                        </button>
                      ) : (
                        <button
                          className="btn sm"
                          style={{
                            width: '100%',
                            fontSize: 12,
                            background: '#A78BFA',
                            color: '#fff',
                            border: 'none',
                          }}
                          onClick={() =>
                            joinWaitlist.mutate({
                              brandId: brandId!,
                              source: 'settings',
                            })
                          }
                          disabled={joinWaitlist.isPending || !brandId}
                        >
                          {joinWaitlist.isPending
                            ? 'Joining...'
                            : 'Join waitlist'}
                        </button>
                      )
                    ) : (
                      <button
                        className="btn sm"
                        style={{
                          width: '100%',
                          fontSize: 12,
                          background: isActive
                            ? 'transparent'
                            : TIER_COLORS[tier],
                          color: isActive
                            ? TIER_COLORS[tier]
                            : tier === 'close'
                              ? '#000'
                              : '#fff',
                          border: isActive
                            ? `1px solid ${TIER_COLORS[tier]}`
                            : 'none',
                        }}
                        onClick={() =>
                          changeTier.mutate({
                            brandId: brandId!,
                            tier,
                            initiatedVia: 'settings',
                          })
                        }
                        disabled={changeTier.isPending || !brandId}
                      >
                        {changeTier.isPending
                          ? 'Switching...'
                          : tier === 'send'
                            ? 'Downgrade to Send'
                            : 'Upgrade to Close'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {waitlistStatus?.onWaitlist && (
            <div
              style={{
                padding: 12,
                background: 'rgba(167,139,250,0.08)',
                borderRadius: 8,
                border: '1px solid rgba(167,139,250,0.2)',
                fontSize: 13,
                color: 'var(--ink-80)',
              }}
            >
              🟣 You're on the Recover waitlist. We'll notify you when it opens
              for your account.
            </div>
          )}
        </div>
      </div>

      {/* Fee explanation */}
      <div className="pnl">
        <div className="pnl-hd">
          <h3>How fees work</h3>
        </div>
        <div
          className="pnl-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <p
            style={{
              fontSize: 14,
              color: 'var(--ink-60)',
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Your platform fee rate is{' '}
            <strong>locked at proposal creation time</strong>. If you change
            tiers, existing proposals keep their original rate. New proposals
            use your current tier rate.
          </p>
          <p
            style={{
              fontSize: 13,
              color: 'var(--ink-60)',
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Fees are applied automatically as a Stripe{' '}
            <code>application_fee_amount</code> on each charge — no invoices, no
            monthly billing. You only pay when your clients pay.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const [, matchParams] = useRoute('/settings/:tab');
  const [, navigate] = useLocation();
  const urlTab = (matchParams as any)?.tab as Tab | undefined;
  const validTabs: Tab[] = [
    'profile',
    'stripe',
    'integrations',
    'notifications',
    'email_templates',
    'billing',
    'sequences',
    'security',
    'audit',
    'currency',
    'categories',
    'team',
  ];
  const [tab, setTab] = useState<Tab>(
    urlTab && validTabs.includes(urlTab) ? urlTab : 'profile',
  );
  const handleTabChange = (t: Tab) => {
    setTab(t);
    navigate(`/settings/${t}`, { replace: true });
  };

  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: user } = useCurrentUser();
  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const { data: accountData, refetch: refetchAccount } = useQuery({
    ...trpc.payments.accounts.me.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const updateProfile = useMutation(
    trpc.payments.accounts.update.mutationOptions(),
  );
  const getAssetUploadUrl = useMutation(
    trpc.payments.accounts.getAssetUploadUrl.mutationOptions(),
  );
  const recordAsset = useMutation(
    trpc.payments.accounts.recordAssetUpload.mutationOptions(),
  );
  const updateBrandKit = useMutation(
    trpc.payments.accounts.updateBrandKit.mutationOptions(),
  );

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoChaseEnabled, setAutoChaseEnabled] = useState(false);
  const [chaseDelayDays, setChaseDelayDays] = useState(3);
  const [chaseSaving, setChaseSaving] = useState(false);
  const updateAutoChase = useMutation(
    trpc.payments.accounts.updateAutoChase.mutationOptions(),
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Populate from real account data
  useEffect(() => {
    if (accountData) {
      setBusinessName(accountData.businessName ?? '');
      setAbn(accountData.abn ?? '');
      setAutoChaseEnabled(accountData.autoChaseEnabled ?? false);
      setChaseDelayDays(accountData.chaseDelayDays ?? 3);
    }
  }, [accountData]);

  const handleSaveAutoChase = async () => {
    setChaseSaving(true);
    try {
      await updateAutoChase.mutateAsync({
        brandId: brandId!,
        autoChaseEnabled,
        chaseDelayDays,
      });
      toast.success(
        autoChaseEnabled
          ? 'Auto-chase enabled — runs daily at 9am UTC'
          : 'Auto-chase disabled',
      );
      refetchAccount();
    } catch (err: any) {
      toast.error(sanitizeError(err, 'Failed to save'));
    } finally {
      setChaseSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateProfile.mutateAsync({ brandId: brandId!, businessName, abn });
      toast.success('Profile saved');
      refetchAccount();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Asset upload — the export POSTed base64 to /api/assets/upload; the platform
  // backend hands back a Supabase signed upload URL instead, so we PUT the raw
  // file there and store the resulting public URL on the brand kit.
  const handleLogoUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be under 2MB');
      return;
    }
    setUploading(true);
    try {
      const { key, uploadUrl, publicUrl } = await getAssetUploadUrl.mutateAsync(
        {
          brandId: brandId!,
          filename: file.name,
          contentType: file.type,
          assetType: 'logo_light',
        },
      );
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Upload failed');
      await updateBrandKit.mutateAsync({
        brandId: brandId!,
        logoLightUrl: publicUrl,
      });
      setLogoUrl(publicUrl);
      // Mirror into the brand's Document Locker — the bytes went browser→storage,
      // so this confirm is how the server learns the upload landed.
      recordAsset.mutate({
        brandId: brandId!,
        key,
        publicUrl,
        filename: file.name,
        assetType: 'logo_light',
        size: file.size,
      });
      toast.success('Logo uploaded');
    } catch (err: any) {
      toast.error(sanitizeError(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const TABS: { id: Tab; label: string; sub: string }[] = [
    {
      id: 'profile',
      label: 'Profile & business',
      sub: 'Name, ABN, timezone, logo',
    },
    {
      id: 'stripe',
      label: 'Stripe Connect',
      sub: 'Payout account · payments setup',
    },
    {
      id: 'integrations',
      label: 'Integrations',
      sub: 'Zapier, webhooks · more coming soon',
    },
    {
      id: 'notifications',
      label: 'Notifications',
      sub: 'Proposal events · in-app, email, SMS',
    },
    {
      id: 'email_templates',
      label: 'Email templates',
      sub: 'Customise nudge & notification emails',
    },
    {
      id: 'billing',
      label: 'Billing',
      sub: 'App fees · volume processed this month',
    },
    {
      id: 'sequences',
      label: 'Sequences',
      sub: 'Cold, engagement & missed payment automations',
    },
    { id: 'security', label: 'Security', sub: 'Sessions · account security' },
    { id: 'audit', label: 'Audit log', sub: 'All account events · exportable' },
    {
      id: 'currency',
      label: 'Currency',
      sub: 'Default currency · exchange rates',
    },
    {
      id: 'categories',
      label: 'Line item categories',
      sub: 'Customise labels · colours · order',
    },
    {
      id: 'team',
      label: 'Team access',
      sub: 'Invite team members · role-based',
    },
  ];

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">SETTINGS</span>
          <h1>Settings.</h1>
          <span className="sub">Everything that makes EziQuotes yours.</span>
        </div>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14 }}
      >
        {/* Sidebar nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {TABS.map((t) => (
            <div
              key={t.id}
              className="pnl"
              style={{
                padding: '12px 14px',
                cursor: 'pointer',
                border:
                  tab === t.id
                    ? '1px solid var(--ink)'
                    : '1px solid var(--border-1)',
                background: tab === t.id ? 'var(--ink)' : 'var(--card)',
              }}
              onClick={() => handleTabChange(t.id)}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: tab === t.id ? 'var(--volt)' : 'var(--ink)',
                }}
              >
                {t.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color:
                    tab === t.id ? 'rgba(255,255,255,0.6)' : 'var(--ink-60)',
                  marginTop: 2,
                }}
              >
                {t.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'profile' && (
            <>
              {/* Personal profile — owned by the Prodesk platform account. The
                  export uploaded avatars to Firebase + auth.updateProfile; both
                  are replaced by the shared /profile page. */}
              <div className="pnl">
                <div className="pnl-hd">
                  <h3>Your profile</h3>
                  <span className="meta">
                    MANAGED BY PRODESK · SYNCED ACROSS SERVICES
                  </span>
                </div>
                <div
                  className="pnl-body"
                  style={{ display: 'flex', gap: 18, alignItems: 'center' }}
                >
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: '50%',
                      background: 'var(--volt)',
                      color: '#000',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 800,
                      fontSize: 26,
                    }}
                  >
                    {(userName || user?.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {userName || user?.email || '—'}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--ink-60)',
                        marginTop: 2,
                      }}
                    >
                      {user?.email ?? ''}
                    </div>
                    <button
                      className="btn ghost sm"
                      style={{ marginTop: 8 }}
                      onClick={() => navigate('/profile')}
                    >
                      Edit name, photo & contact details →
                    </button>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-60)',
                        marginTop: 6,
                      }}
                    >
                      Your name, photo, email and password live on your Prodesk
                      account, shared across services.
                    </div>
                  </div>
                </div>
              </div>
              <div className="pnl">
                <div className="pnl-hd">
                  <h3>Business details</h3>
                </div>
                <div
                  className="pnl-body"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 14,
                  }}
                >
                  <div className="fld">
                    <label>Display name</label>
                    <input
                      value={userName}
                      disabled
                      title="Managed in your Prodesk profile"
                    />
                  </div>
                  <div className="fld">
                    <label>Business name</label>
                    <input
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                  </div>
                  <div className="fld">
                    <label>ABN</label>
                    <input
                      value={abn}
                      onChange={(e) => setAbn(e.target.value)}
                    />
                  </div>
                  <div className="fld">
                    <label>Timezone</label>
                    <select defaultValue="Australia/Sydney">
                      <option>Australia/Sydney</option>
                      <option>Australia/Melbourne</option>
                      <option>Australia/Brisbane</option>
                    </select>
                  </div>
                  <div className="fld">
                    <label>Email</label>
                    <input
                      value={user?.email ?? ''}
                      disabled
                      title="Managed in your Prodesk profile"
                    />
                  </div>
                  <div
                    className="fld"
                    style={{ display: 'flex', alignItems: 'flex-end' }}
                  >
                    <button
                      className="btn ghost sm"
                      onClick={() => navigate('/profile')}
                    >
                      Change personal details in profile →
                    </button>
                  </div>
                </div>
              </div>
              <div className="pnl">
                <div className="pnl-hd">
                  <h3>Logo</h3>
                  <span className="meta">SHOWN ON PROPOSALS</span>
                </div>
                <div
                  className="pnl-body"
                  style={{ display: 'flex', gap: 14, alignItems: 'center' }}
                >
                  {logoUrl ? (
                    <LazyImage
                      src={logoUrl}
                      alt="Logo"
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 12,
                        border: '1px solid var(--border-1)',
                      }}
                      imgClassName="object-contain"
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 12,
                        background: '#0F766E',
                        color: 'white',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 800,
                        fontSize: 22,
                      }}
                    >
                      {(businessName || accountData?.businessName || '?')
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLogoUpload(f);
                      }}
                    />
                    <button
                      className="btn ghost sm"
                      disabled={uploading || !brandId}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? 'Uploading…' : 'Upload logo'}
                    </button>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-60)',
                        marginTop: 6,
                      }}
                    >
                      PNG, SVG, JPG · max 2MB · displayed at 64×64px
                    </div>
                  </div>
                </div>
              </div>
              {/* Brand Kit Preview */}
              <BrandKitPreviewPanel />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn primary"
                  onClick={handleSaveProfile}
                  disabled={saving || !brandId}
                >
                  {saving ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </>
          )}

          {tab === 'stripe' && <StripeConnectPanel />}

          {tab === 'integrations' && <IntegrationsTabContent />}

          {tab === 'notifications' && (
            <>
              <div className="pnl">
                <div className="pnl-hd">
                  <h3>Chase automation</h3>
                  <span
                    className="meta"
                    style={{
                      color: autoChaseEnabled ? 'var(--volt)' : undefined,
                    }}
                  >
                    {autoChaseEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <div
                  className="pnl-body"
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                >
                  <p
                    style={{ fontSize: 13, color: 'var(--ink-60)', margin: 0 }}
                  >
                    Automatically send a follow-up nudge to clients who haven't
                    responded to a sent proposal after the configured delay.
                    Requires Twilio SMS credentials to be configured.
                  </p>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 14 }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={autoChaseEnabled}
                        onChange={(e) => setAutoChaseEnabled(e.target.checked)}
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                      />
                      Enable automated chase sequences
                    </label>
                  </div>
                  <div className="fld" style={{ maxWidth: 220 }}>
                    <label>Chase delay (days after send)</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={chaseDelayDays}
                      onChange={(e) =>
                        setChaseDelayDays(parseInt(e.target.value) || 3)
                      }
                      disabled={!autoChaseEnabled}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-60)' }}>
                    Nudges run daily at 9am UTC. Only proposals in "sent" status
                    are targeted. Each proposal is nudged once per cycle.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn primary"
                      onClick={handleSaveAutoChase}
                      disabled={chaseSaving || !brandId}
                    >
                      {chaseSaving ? 'Saving…' : 'Save chase settings'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="pnl">
                <div className="pnl-hd">
                  <h3>Notification events</h3>
                  <span className="meta">8 EVENTS</span>
                </div>
                <div className="pnl-body" style={{ padding: 0 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th style={{ textAlign: 'center' }}>In-app</th>
                        <th style={{ textAlign: 'center' }}>Email</th>
                        <th style={{ textAlign: 'center' }}>SMS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {NOTIF_EVENTS.map((e, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{e.name}</td>
                          {[e.inapp, e.email, e.sms].map((on, j) => (
                            <td key={j} style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                defaultChecked={on}
                                onChange={() => toast.success('Saved')}
                                style={{
                                  width: 16,
                                  height: 16,
                                  cursor: 'pointer',
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* The export defined EmailTemplatesTab (and its sidebar entry) but
              never mounted it — clicking the tab showed an empty pane. Wired
              here since the brief keeps email templates. */}
          {tab === 'email_templates' && <EmailTemplatesTab />}

          {tab === 'billing' && <BillingTab />}

          {tab === 'sequences' && (
            <div style={{ padding: '4px 0' }}>
              <SequencesSettings />
            </div>
          )}

          {tab === 'security' && <SecurityTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'currency' && <CurrencyTab />}
          {tab === 'categories' && <CategoriesTab />}
          {tab === 'team' && <TeamTab />}
        </div>
      </div>
    </div>
  );
}
