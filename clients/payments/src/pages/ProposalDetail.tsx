import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { useTRPC, apiUrl } from '@shared/lib/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatCents,
  formatDate,
  formatRelative,
  STATUS_LABELS,
} from '@/lib/types';
import {
  ArrowLeft,
  Edit2,
  Send,
  ExternalLink,
  Copy,
  CheckCircle2,
  Clock,
  DollarSign,
  AlertTriangle,
  RefreshCcw,
  Star,
  Download,
  MessageSquare,
  CheckCheck,
  X,
  Pause,
  Play,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { sanitizeError } from '@/lib/errorMessage';

// ── Per-proposal Sequences panel ──────────────────────────────────────────────
function SequencesPanel({ proposalId }: { proposalId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: runs, isLoading } = useQuery(
    trpc.payments.sequences.listRunsForProposal.queryOptions({ proposalId }),
  );

  const invalidateRuns = () =>
    qc.invalidateQueries({
      queryKey: trpc.payments.sequences.listRunsForProposal.queryKey({
        proposalId,
      }),
    });

  const pauseRun = useMutation({
    ...trpc.payments.sequences.pauseRun.mutationOptions(),
    onSuccess: () => {
      toast.success('Sequence paused');
      invalidateRuns();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const resumeRun = useMutation({
    ...trpc.payments.sequences.resumeRun.mutationOptions(),
    onSuccess: () => {
      toast.success('Sequence resumed');
      invalidateRuns();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const markInConversation = useMutation({
    ...trpc.payments.sequences.markInConversation.mutationOptions(),
    onSuccess: () => {
      toast.success('Marked as in conversation — sequences paused');
      invalidateRuns();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const { data: runLog } = useQuery({
    ...trpc.payments.sequences.getRunLog.queryOptions({
      runId: expandedRunId!,
    }),
    enabled: expandedRunId !== null,
  });

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--ink-40)',
    running: '#3b82f6',
    paused: '#f59e0b',
    completed: '#22c55e',
    cancelled: 'var(--ink-40)',
    in_conversation: '#8b5cf6',
  };

  if (isLoading) return null;
  if (!runs || runs.length === 0) return null;

  const hasActiveRuns = runs.some((r: any) =>
    ['pending', 'running'].includes(r.status),
  );

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-1)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          Communication Sequences
        </h3>
        {hasActiveRuns && (
          <button
            className="btn ghost sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
            }}
            onClick={() => markInConversation.mutate({ proposalId })}
            disabled={markInConversation.isPending}
          >
            <MessageCircle style={{ width: 12, height: 12 }} />
            Mark in conversation
          </button>
        )}
      </div>
      <div style={{ padding: '8px 0' }}>
        {runs.map((run: any) => (
          <div
            key={run.id}
            style={{ borderBottom: '1px solid var(--border-1)' }}
          >
            <div
              style={{
                padding: '10px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
              }}
              onClick={() =>
                setExpandedRunId(expandedRunId === run.id ? null : run.id)
              }
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: STATUS_COLORS[run.status] ?? 'var(--ink-40)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    textTransform: 'capitalize',
                  }}
                >
                  {run.sequenceType.replace('_', ' ')} sequence
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--ink-40)',
                    marginLeft: 8,
                  }}
                >
                  {run.status} · step {run.currentTouchpointIndex + 1}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {run.status === 'running' || run.status === 'pending' ? (
                  <button
                    className="btn ghost sm"
                    style={{ padding: '3px 8px', fontSize: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      pauseRun.mutate({ runId: run.id });
                    }}
                  >
                    <Pause style={{ width: 10, height: 10 }} />
                  </button>
                ) : run.status === 'paused' ? (
                  <button
                    className="btn ghost sm"
                    style={{ padding: '3px 8px', fontSize: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      resumeRun.mutate({ runId: run.id });
                    }}
                  >
                    <Play style={{ width: 10, height: 10 }} />
                  </button>
                ) : null}
              </div>
            </div>
            {expandedRunId === run.id && runLog && (
              <div
                style={{
                  padding: '0 20px 12px',
                  background: 'var(--bg-inset)',
                }}
              >
                {runLog.length === 0 ? (
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-40)',
                      margin: '8px 0',
                    }}
                  >
                    No messages sent yet.
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      paddingTop: 8,
                    }}
                  >
                    {runLog.map((log: any) => (
                      <div
                        key={log.id}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--ink-40)',
                            paddingTop: 2,
                            minWidth: 80,
                          }}
                        >
                          {log.sentAt
                            ? new Date(log.sentAt).toLocaleDateString()
                            : 'Pending'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--ink)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            {log.channel}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color:
                                log.status === 'sent'
                                  ? '#22c55e'
                                  : log.status === 'failed'
                                    ? '#ef4444'
                                    : 'var(--ink-40)',
                              marginLeft: 8,
                            }}
                          >
                            {log.status}
                          </span>
                          {log.errorMessage && (
                            <p
                              style={{
                                fontSize: 10,
                                color: '#ef4444',
                                margin: '2px 0 0',
                              }}
                            >
                              {log.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RefundModal({
  proposalId,
  totalCents,
  onClose,
}: {
  proposalId: string;
  totalCents: number;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String((totalCents / 100).toFixed(2)));
  const [reason, setReason] = useState('requested_by_customer');
  const trpc = useTRPC();
  const qc = useQueryClient();
  const refund = useMutation({
    ...trpc.payments.proposals.refund.mutationOptions(),
    onSuccess: () => {
      toast.success('Refund issued');
      qc.invalidateQueries({
        queryKey: trpc.payments.proposals.get.queryKey({ id: proposalId }),
      });
      onClose();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const amountCents = Math.round(parseFloat(amount) * 100);
  const isPartial = amountCents < totalCents;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-1)',
          borderRadius: 14,
          padding: 28,
          width: 420,
          maxWidth: '90vw',
        }}
      >
        <h3
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: 'var(--ink)',
            marginBottom: 4,
          }}
        >
          Issue Refund
        </h3>
        <p style={{ fontSize: 12, color: 'var(--ink-40)', marginBottom: 20 }}>
          Full amount: {formatCents(totalCents)}. Enter a lower amount for a
          partial refund.
        </p>
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            Amount (AUD)
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={(totalCents / 100).toFixed(2)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--border-1)',
              borderRadius: 8,
              background: 'var(--bg-inset)',
              color: 'var(--ink)',
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
            }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            Reason
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--border-1)',
              borderRadius: 8,
              background: 'var(--bg-inset)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
          >
            <option value="requested_by_customer">Requested by customer</option>
            <option value="duplicate">Duplicate charge</option>
            <option value="fraudulent">Fraudulent</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={
              refund.isPending || isNaN(amountCents) || amountCents <= 0
            }
            onClick={() =>
              refund.mutate({ id: proposalId, amountCents, reason })
            }
          >
            {refund.isPending
              ? 'Processing…'
              : isPartial
                ? 'Issue Partial Refund'
                : 'Issue Full Refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
function AnnotationsPanel({ proposalId }: { proposalId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: annotations = [] } = useQuery(
    trpc.payments.annotations.list.queryOptions({ proposalId }),
  );
  const invalidateList = () =>
    qc.invalidateQueries({
      queryKey: trpc.payments.annotations.list.queryKey({ proposalId }),
    });
  const resolveMut = useMutation({
    ...trpc.payments.annotations.resolve.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      toast.success('Marked resolved');
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const deleteMut = useMutation({
    ...trpc.payments.annotations.remove.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      toast.success('Deleted');
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  if ((annotations as any[]).length === 0) return null;
  const open = (annotations as any[]).filter((a: any) => !a.resolved);
  const resolved = (annotations as any[]).filter((a: any) => a.resolved);
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-1)',
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 16,
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-1)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MessageSquare size={14} color="var(--ink-60)" />
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          Payer Change Requests ({(annotations as any[]).length})
        </h3>
        {open.length > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 700,
              background: '#FEF2F2',
              color: '#DC2626',
              borderRadius: 20,
              padding: '2px 8px',
            }}
          >
            {open.length} open
          </span>
        )}
      </div>
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {open.map((a: any) => (
          <div
            key={a.id}
            style={{
              padding: '14px 16px',
              background: 'var(--bg-inset)',
              borderRadius: 8,
              borderLeft: '3px solid #DC2626',
            }}
          >
            {a.anchorText && (
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--ink-40)',
                  marginBottom: 4,
                  fontStyle: 'italic',
                }}
              >
                Re: "{a.anchorText.slice(0, 80)}
                {a.anchorText.length > 80 ? '…' : ''}"
              </p>
            )}
            <p style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 6 }}>
              {a.comment}
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--ink-40)' }}>
                {a.clientName ?? 'Anonymous'}
                {a.clientEmail ? ` · ${a.clientEmail}` : ''} ·{' '}
                {new Date(a.createdAt).toLocaleDateString()}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => resolveMut.mutate({ id: a.id })}
                  disabled={resolveMut.isPending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: '#ECFDF5',
                    color: '#059669',
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCheck size={11} /> Resolve
                </button>
                <button
                  onClick={() => deleteMut.mutate({ id: a.id })}
                  disabled={deleteMut.isPending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-card)',
                    color: 'var(--ink-40)',
                    border: '1px solid var(--border-1)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {resolved.length > 0 && (
          <details style={{ marginTop: 4 }}>
            <summary
              style={{
                fontSize: 11,
                color: 'var(--ink-40)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {resolved.length} resolved
            </summary>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {resolved.map((a: any) => (
                <div
                  key={a.id}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-inset)',
                    borderRadius: 8,
                    borderLeft: '3px solid #059669',
                    opacity: 0.7,
                  }}
                >
                  {a.anchorText && (
                    <p
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-40)',
                        marginBottom: 3,
                        fontStyle: 'italic',
                      }}
                    >
                      Re: "{a.anchorText.slice(0, 80)}
                      {a.anchorText.length > 80 ? '…' : ''}"
                    </p>
                  )}
                  <p style={{ fontSize: 12, color: 'var(--ink-60)' }}>
                    {a.comment}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function ProposalQAPanel({ proposalId }: { proposalId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: questions = [] } = useQuery(
    trpc.payments.proposals.getQuestions.queryOptions({ proposalId }),
  );
  const answerMut = useMutation({
    ...trpc.payments.proposals.answerQuestion.mutationOptions(),
    onSuccess: () => {
      toast.success('Answer saved');
      qc.invalidateQueries({
        queryKey: trpc.payments.proposals.getQuestions.queryKey({ proposalId }),
      });
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
  if ((questions as any[]).length === 0) return null;
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-1)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          Payer Questions ({(questions as any[]).length})
        </h3>
      </div>
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {(questions as any[]).map((q: any) => (
          <div
            key={q.id}
            style={{
              padding: '14px 16px',
              background: 'var(--bg-inset)',
              borderRadius: 8,
            }}
          >
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--ink)',
                marginBottom: 4,
              }}
            >
              Q: {q.question}
            </p>
            {q.clientName && (
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--ink-40)',
                  marginBottom: 8,
                }}
              >
                From: {q.clientName}
                {q.clientEmail ? ` (${q.clientEmail})` : ''}
              </p>
            )}
            {q.answer ? (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--ink-60)',
                  borderLeft: '3px solid var(--accent)',
                  paddingLeft: 10,
                }}
              >
                A: {q.answer}
              </p>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <input
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: '1px solid var(--border-1)',
                    borderRadius: 6,
                    background: 'var(--bg-card)',
                    color: 'var(--ink)',
                    fontSize: 13,
                  }}
                  placeholder="Type your answer…"
                  value={answerDraft[q.id] ?? ''}
                  onChange={(e) =>
                    setAnswerDraft((d) => ({ ...d, [q.id]: e.target.value }))
                  }
                />
                <button
                  onClick={() =>
                    answerMut.mutate({
                      questionId: q.id,
                      answer: answerDraft[q.id] ?? '',
                    })
                  }
                  disabled={!answerDraft[q.id]?.trim() || answerMut.isPending}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--ink)',
                    color: 'var(--bg)',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Reply
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Lifecycle Control Panel ──────────────────────────────────────────────────
function LifecyclePanel({ proposalId }: { proposalId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(
    trpc.payments.lifecycle.getProposalLifecycle.queryOptions({ proposalId }),
  );
  const decideMutation = useMutation({
    ...trpc.payments.lifecycle.decideRequest.mutationOptions(),
    onSuccess: () => {
      toast.success('Decision saved');
      qc.invalidateQueries({
        queryKey: trpc.payments.lifecycle.getProposalLifecycle.queryKey({
          proposalId,
        }),
      });
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const [expanded, setExpanded] = useState(false);

  if (isLoading || !data) return null;

  const { proposal: lp, permissions, events, pendingRequests } = data as any;
  const hasPending = pendingRequests.length > 0;

  const intentLabel: Record<string, string> = {
    ongoing_service: 'Ongoing Service',
    fixed_engagement: 'Fixed Engagement',
    hybrid: 'Hybrid',
  };

  const eventLabel: Record<string, string> = {
    cancel_requested: 'Cancel requested',
    pause_started: 'Plan paused',
    plan_resumed: 'Plan resumed',
    payout_full: 'Full payout',
    skip_requested: 'Skip requested',
    card_update: 'Card update',
    defer_requested: 'Deferral requested',
    defer_approved: 'Deferral approved',
    defer_rejected: 'Deferral rejected',
    vendor_override: 'Vendor override',
    payment_succeeded: 'Payment succeeded',
    payment_failed: 'Payment failed',
    payment_retried: 'Payment retried',
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: hasPending ? '1px solid #f59e0b' : '1px solid var(--border-1)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: expanded ? '1px solid var(--border-1)' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            Plan Lifecycle
          </h3>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--bg-inset)',
              color: 'var(--ink-60)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {intentLabel[lp.commercialIntent] ?? lp.commercialIntent}
          </span>
          {hasPending && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background: '#fef3c7',
                color: '#92400e',
              }}
            >
              {pendingRequests.length} pending
            </span>
          )}
        </div>
        <svg
          width={12}
          height={12}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{
            color: 'var(--ink-40)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms',
          }}
        >
          <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {expanded && (
        <div
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Permissions summary */}
          <div>
            <p
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--ink-40)',
                marginBottom: 8,
              }}
            >
              Payer Permissions
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { key: 'allowPayerCancel', label: 'Cancel' },
                { key: 'allowPayerPause', label: 'Pause' },
                { key: 'allowPayerPayoutFull', label: 'Payout Full' },
                { key: 'allowPayerSkip', label: 'Skip' },
                { key: 'allowPayerCardUpdate', label: 'Card Update' },
              ].map(({ key, label }) => (
                <span
                  key={key}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: permissions[key]
                      ? '#dcfce7'
                      : 'var(--bg-inset)',
                    color: permissions[key] ? '#166534' : 'var(--ink-40)',
                  }}
                >
                  {permissions[key] ? '✓' : '✗'} {label}
                </span>
              ))}
            </div>
            {permissions.inCommitmentPeriod && (
              <p
                style={{
                  fontSize: 11,
                  color: '#92400e',
                  marginTop: 6,
                  padding: '6px 10px',
                  background: '#fef3c7',
                  borderRadius: 6,
                }}
              >
                In commitment period until{' '}
                {permissions.commitmentEndsAt
                  ? new Date(permissions.commitmentEndsAt).toLocaleDateString(
                      'en-AU',
                    )
                  : '—'}
              </p>
            )}
          </div>

          {/* Pending requests */}
          {hasPending && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-40)',
                  marginBottom: 8,
                }}
              >
                Pending Requests
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingRequests.map((req: any) => (
                  <div
                    key={req.id}
                    style={{
                      padding: '12px 14px',
                      background: '#fef3c7',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#92400e',
                        }}
                      >
                        {req.requestType.replace(/_/g, ' ')}
                      </p>
                      {req.payload?.reason && (
                        <p
                          style={{
                            fontSize: 11,
                            color: '#78350f',
                            marginTop: 2,
                          }}
                        >
                          {req.payload.reason}
                        </p>
                      )}
                      <p
                        style={{ fontSize: 10, color: '#b45309', marginTop: 2 }}
                      >
                        {new Date(req.requestedAt).toLocaleDateString('en-AU')}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() =>
                          decideMutation.mutate({
                            requestId: req.id,
                            decision: 'approved',
                          })
                        }
                        disabled={decideMutation.isPending}
                        style={{
                          padding: '6px 12px',
                          background: '#166534',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          decideMutation.mutate({
                            requestId: req.id,
                            decision: 'rejected',
                          })
                        }
                        disabled={decideMutation.isPending}
                        style={{
                          padding: '6px 12px',
                          background: '#dc2626',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event log */}
          {events.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-40)',
                  marginBottom: 8,
                }}
              >
                Event Log
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {events.slice(0, 10).map((ev: any, i: number) => (
                  <div
                    key={ev.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom:
                        i < events.length - 1
                          ? '1px solid var(--border-1)'
                          : undefined,
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--ink-40)',
                        marginTop: 5,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--ink)',
                        }}
                      >
                        {eventLabel[ev.eventType] ?? ev.eventType}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-40)',
                          marginLeft: 8,
                        }}
                      >
                        by {ev.initiatedBy}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--ink-40)',
                        flexShrink: 0,
                      }}
                    >
                      {new Date(ev.occurredAt).toLocaleDateString('en-AU')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SC: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'var(--bg-inset)', text: 'var(--ink-40)' },
  sent: { bg: '#EFF6FF', text: '#2563EB' },
  viewed: { bg: '#F5F3FF', text: '#7C3AED' },
  engaged: { bg: '#FFF7ED', text: '#C2410C' },
  accepted: { bg: '#ECFDF5', text: '#059669' },
  paid: { bg: '#ECFDF5', text: '#059669' },
  disputed: { bg: '#FEF2F2', text: '#DC2626' },
  refunded: { bg: '#F1F5F9', text: '#475569' },
  partially_refunded: { bg: '#FFF7ED', text: '#C2410C' },
  expired: { bg: '#FEF2F2', text: '#DC2626' },
};

export default function ProposalDetail() {
  const [, params] = useRoute('/proposals/:id');
  const id = params?.id ?? '';
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [surveyEmailInput, setSurveyEmailInput] = useState('');
  const [showSurveyDialog, setShowSurveyDialog] = useState(false);
  const sendSurveyMutation = useMutation({
    ...trpc.payments.surveys.sendSurvey.mutationOptions(),
    onSuccess: () => {
      toast.success('Survey sent!');
      setShowSurveyDialog(false);
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const { data: proposal, isLoading } = useQuery({
    ...trpc.payments.proposals.get.queryOptions({ id }),
    enabled: !!id,
  });
  const sendMutation = useMutation({
    ...trpc.payments.proposals.send.mutationOptions(),
    onSuccess: () => {
      toast.success('Proposal sent!');
      qc.invalidateQueries({
        queryKey: trpc.payments.proposals.get.queryKey({ id }),
      });
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  // WS6 — turn a paid proposal into a Prodesk order (purchase + projects).
  const convertMutation = useMutation({
    ...trpc.payments.proposals.convertToOrder.mutationOptions(),
    onSuccess: (r) =>
      toast.success(
        r?.alreadyConverted
          ? 'This proposal is already a Prodesk order'
          : 'Converted to a Prodesk order — projects created',
      ),
    onError: (e) => toast.error(sanitizeError(e)),
  });

  if (isLoading)
    return (
      <div style={{ padding: 32, color: 'var(--ink-40)', fontSize: 13 }}>
        Loading…
      </div>
    );
  if (!proposal)
    return (
      <div style={{ padding: 32 }}>
        <p>Proposal not found</p>
      </div>
    );

  const sc = SC[proposal.status] ?? {
    bg: 'var(--bg-inset)',
    text: 'var(--ink-40)',
  };
  const publicUrl = `${window.location.origin}/p/${proposal.slug}`;
  const isDisputed = proposal.status === 'disputed';
  const isRefunded =
    proposal.status === 'refunded' || proposal.status === 'partially_refunded';

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      {showRefundModal && (
        <RefundModal
          proposalId={id}
          totalCents={proposal.totalCents ?? 0}
          onClose={() => setShowRefundModal(false)}
        />
      )}
      {showSurveyDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-1)',
              borderRadius: 14,
              padding: 28,
              width: 400,
              maxWidth: '90vw',
            }}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: 'var(--ink)',
                marginBottom: 4,
              }}
            >
              Send Satisfaction Survey
            </h3>
            <p
              style={{ fontSize: 12, color: 'var(--ink-40)', marginBottom: 20 }}
            >
              Send a quick NPS + star rating survey to the client.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-40)',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Payer Email
              </label>
              <input
                type="email"
                value={surveyEmailInput}
                onChange={(e) => setSurveyEmailInput(e.target.value)}
                placeholder="payer@example.com"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--border-1)',
                  borderRadius: 8,
                  background: 'var(--bg-inset)',
                  color: 'var(--ink)',
                  fontSize: 14,
                }}
              />
            </div>
            <div
              style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}
            >
              <button
                className="btn ghost"
                onClick={() => setShowSurveyDialog(false)}
              >
                Cancel
              </button>
              <button
                className="btn dark"
                disabled={!surveyEmailInput || sendSurveyMutation.isPending}
                onClick={() =>
                  sendSurveyMutation.mutate({
                    proposalId: id,
                    clientEmail: surveyEmailInput,
                  })
                }
              >
                {sendSurveyMutation.isPending ? 'Sending…' : 'Send Survey'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Link href="/proposals">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--ink-40)',
            cursor: 'pointer',
            marginBottom: 20,
          }}
        >
          <ArrowLeft size={13} /> Proposals
        </div>
      </Link>

      {/* Dispute banner */}
      {isDisputed && (
        <div
          style={{
            background: '#D24A2A',
            color: 'white',
            padding: '14px 18px',
            borderRadius: 12,
            display: 'grid',
            gridTemplateColumns: '36px 1fr auto',
            gap: 14,
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.18)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <AlertTriangle size={18} />
          </div>
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 700,
                opacity: 0.85,
              }}
            >
              DISPUTE OPENED
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              The client has disputed this charge via their card issuer. Submit
              evidence in Stripe to contest.
            </div>
          </div>
          <a
            href="https://dashboard.stripe.com/disputes"
            target="_blank"
            rel="noopener noreferrer"
          >
            <button
              className="btn"
              style={{
                background: 'white',
                color: '#D24A2A',
                borderColor: 'white',
                gap: 6,
              }}
            >
              Open in Stripe <ExternalLink size={12} />
            </button>
          </a>
        </div>
      )}

      {/* Refund banner */}
      {isRefunded && (
        <div
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-1)',
            padding: '14px 18px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <RefreshCcw size={16} color="var(--ink-40)" />
          <span style={{ fontSize: 13, color: 'var(--ink-60)' }}>
            {proposal.status === 'partially_refunded'
              ? 'A partial refund has been issued on this proposal.'
              : 'This proposal has been fully refunded.'}
          </span>
          {proposal.status === 'partially_refunded' && (
            <button
              className="btn sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => setShowRefundModal(true)}
            >
              Refund more
            </button>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--ink)',
              letterSpacing: '-0.03em',
            }}
          >
            {proposal.title}
          </h1>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 20,
                background: sc.bg,
                color: sc.text,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
              }}
            >
              {STATUS_LABELS[proposal.status] ?? proposal.status}
            </span>
            {proposal.sentAt && (
              <span style={{ fontSize: 11, color: 'var(--ink-40)' }}>
                Sent {formatRelative(proposal.sentAt)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            style={{ gap: 6 }}
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              toast.success('Link copied!');
            }}
          >
            <Copy size={13} /> Copy Link
          </button>
          <a
            href={`${apiUrl}/api/payments/proposals/${proposal.slug}/pdf`}
            download={`proposal-${proposal.slug}.pdf`}
          >
            <button className="btn" style={{ gap: 6 }}>
              <Download size={13} /> PDF
            </button>
          </a>
          {(proposal as any).signedPdfUrl && (
            <a
              href={(proposal as any).signedPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={`signed-proposal-${proposal.slug}.pdf`}
            >
              <button
                className="btn"
                style={{
                  gap: 6,
                  background: '#ECFDF5',
                  color: '#059669',
                  borderColor: '#A7F3D0',
                }}
              >
                <Download size={13} /> Signed PDF
              </button>
            </a>
          )}
          <a href={publicUrl} target="_blank" rel="noopener noreferrer">
            <button className="btn" style={{ gap: 6 }}>
              <ExternalLink size={13} /> Preview
            </button>
          </a>
          {proposal.status === 'draft' && (
            <button
              className="btn dark"
              style={{ gap: 6 }}
              disabled={sendMutation.isPending}
              onClick={() => sendMutation.mutate({ id, sendViaSms: true })}
            >
              <Send size={13} /> {sendMutation.isPending ? 'Sending…' : 'Send'}
            </button>
          )}
          {proposal.status === 'paid' && (
            <>
              <a
                href={`${apiUrl}/api/payments/proposals/${proposal.slug}/receipt`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <button
                  className="btn"
                  style={{
                    gap: 6,
                    background: '#F0FDF4',
                    color: '#15803D',
                    borderColor: '#BBF7D0',
                  }}
                >
                  <Download size={13} /> Receipt
                </button>
              </a>
              <button
                className="btn"
                style={{ gap: 6 }}
                onClick={() => setShowRefundModal(true)}
              >
                <RefreshCcw size={13} /> Refund
              </button>
            </>
          )}
          {(proposal.status === 'paid' || proposal.status === 'accepted') && (
            <button
              className="btn"
              style={{ gap: 6 }}
              onClick={() => {
                setSurveyEmailInput((proposal as any).clientEmail ?? '');
                setShowSurveyDialog(true);
              }}
            >
              <Star size={13} /> Send Survey
            </button>
          )}
          {(proposal.status === 'paid' || proposal.status === 'active') && (
            <button
              className="btn"
              style={{ gap: 6 }}
              disabled={convertMutation.isPending}
              onClick={() => convertMutation.mutate({ id })}
            >
              <CheckCheck size={13} />{' '}
              {convertMutation.isPending
                ? 'Converting…'
                : 'Convert to Prodesk order'}
            </button>
          )}
          <Link href={`/proposals/${id}/edit`}>
            <button className="btn" style={{ gap: 6 }}>
              <Edit2 size={13} /> Edit
            </button>
          </Link>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          {
            label: 'Total Value',
            value: formatCents(proposal.totalCents ?? 0),
            icon: DollarSign,
            color: '#059669',
          },
          {
            label: 'Status',
            value: STATUS_LABELS[proposal.status] ?? proposal.status,
            icon: CheckCircle2,
            color: '#2563EB',
          },
          {
            label: 'Expires',
            value: formatDate((proposal as any).expiresAt) ?? 'No expiry',
            icon: Clock,
            color: '#D97706',
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-1)',
              borderRadius: 10,
              padding: '14px 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <Icon size={13} color={color} />
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-40)',
                }}
              >
                {label}
              </span>
            </div>
            <p
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Analytics panel */}
      {proposal.status !== 'draft' && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-1)',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border-1)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 10L4.5 6L7 8.5L10.5 4L13 6"
                stroke="var(--ink-60)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
              Engagement Analytics
            </h3>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 0,
            }}
          >
            {(() => {
              const winScore = (proposal as any).winScore ?? 0;
              const winColor =
                winScore >= 70
                  ? '#22c55e'
                  : winScore >= 40
                    ? '#eab308'
                    : '#ef4444';
              const items = [
                {
                  label: 'Views',
                  value: String((proposal as any).viewCount ?? 0),
                  sub: (proposal as any).lastViewedAt
                    ? `Last: ${formatRelative((proposal as any).lastViewedAt)}`
                    : 'Not yet viewed',
                  color: 'var(--ink)',
                },
                {
                  label: 'Scroll depth',
                  value: `${(proposal as any).maxScrollDepth ?? 0}%`,
                  sub:
                    (proposal as any).maxScrollDepth >= 80
                      ? 'Read thoroughly'
                      : (proposal as any).maxScrollDepth >= 40
                        ? 'Partially read'
                        : 'Barely opened',
                  color: 'var(--ink)',
                },
                {
                  label: 'Engagement',
                  value: ['engaged', 'accepted', 'paid'].includes(
                    proposal.status,
                  )
                    ? 'Engaged'
                    : ['viewed'].includes(proposal.status)
                      ? 'Viewed'
                      : 'Sent',
                  sub: proposal.engagedAt
                    ? `Engaged ${formatRelative(proposal.engagedAt)}`
                    : proposal.viewedAt
                      ? `Viewed ${formatRelative(proposal.viewedAt)}`
                      : 'Awaiting open',
                  color: 'var(--ink)',
                },
                {
                  label: 'Win score',
                  value: `${winScore}`,
                  sub:
                    winScore >= 70
                      ? 'High probability'
                      : winScore >= 40
                        ? 'Moderate'
                        : 'Low',
                  color: winColor,
                },
              ];
              return items.map(({ label, value, sub, color }, i) => (
                <div
                  key={label}
                  style={{
                    padding: '14px 18px',
                    borderRight:
                      i < 3 ? '1px solid var(--border-1)' : undefined,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-40)',
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {value}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-40)',
                      marginTop: 2,
                    }}
                  >
                    {sub}
                  </div>
                </div>
              ));
            })()}
          </div>
          {/* Scroll depth bar */}
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--border-1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--ink-40)' }}>
                Scroll depth
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--ink-60)',
                }}
              >
                {(proposal as any).maxScrollDepth ?? 0}%
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--bg-inset)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 3,
                  background: `linear-gradient(90deg, #65F5C9, #4ade80)`,
                  width: `${(proposal as any).maxScrollDepth ?? 0}%`,
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-1)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-1)',
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            Line Items
          </h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--border-1)',
                background: 'var(--bg-inset)',
              }}
            >
              {['Item', 'Qty', 'Unit Price', 'Total'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 16px',
                    textAlign: 'left',
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-40)',
                    fontWeight: 500,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {((proposal as any).lineItems ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--ink-40)',
                  }}
                >
                  No line items
                </td>
              </tr>
            ) : (
              ((proposal as any).lineItems ?? []).map((li: any) => (
                <tr
                  key={li.id}
                  style={{ borderBottom: '1px solid var(--border-1)' }}
                >
                  <td style={{ padding: '10px 16px' }}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--ink)',
                      }}
                    >
                      {li.name}
                    </p>
                    {li.description && (
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-40)',
                          marginTop: 2,
                        }}
                      >
                        {li.description}
                      </p>
                    )}
                  </td>
                  <td
                    style={{
                      padding: '10px 16px',
                      fontSize: 12,
                      color: 'var(--ink-60)',
                    }}
                  >
                    {li.qty}
                  </td>
                  <td
                    style={{
                      padding: '10px 16px',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--ink-60)',
                    }}
                  >
                    {formatCents(li.unitCents)}
                  </td>
                  <td
                    style={{
                      padding: '10px 16px',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--ink)',
                    }}
                  >
                    {formatCents(li.qty * li.unitCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-1)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 24,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
            Total: {formatCents(proposal.totalCents ?? 0)}
          </span>
        </div>
      </div>

      <LifecyclePanel proposalId={proposal.id} />
      <SequencesPanel proposalId={proposal.id} />
      <ProposalQAPanel proposalId={proposal.id} />
      <AnnotationsPanel proposalId={proposal.id} />
    </div>
  );
}
