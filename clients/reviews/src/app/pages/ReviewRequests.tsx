/* Verdiict — Review requests. Email a customer their review link, and review the
 * brand-wide log of requests already sent. */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Send,
  Star,
} from 'lucide-react';
import { EmptyState, SkeletonRows } from '../components';
import type { PageProps, ReviewRequestRow } from '../lib';
import { useToast } from '../toast';

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="vbadge" style={{ color: 'var(--v-success)' }}>
        <CheckCircle2 size={11} />
        Completed
      </span>
    );
  }
  if (status === 'opened') {
    return (
      <span className="vbadge" style={{ color: 'var(--v-accent)' }}>
        <Mail size={11} />
        Opened
      </span>
    );
  }
  return (
    <span className="vbadge">
      <Clock size={11} />
      Sent
    </span>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="vrow" style={{ gap: 2, color: 'var(--v-ink)' }} aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={12}
          className={s <= n ? 'fill-current' : ''}
          style={{ opacity: s <= n ? 1 : 0.2 }}
        />
      ))}
    </span>
  );
}

/** The public review text (5★) or the private feedback (≤4★), whichever exists. */
function responseText(r: ReviewRequestRow): string | null {
  return r.responseReview || r.responseFeedback || null;
}

function fmtTime(iso: string | Date | number): string {
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? 'am' : 'pm';
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} ${ap}`;
}

export function ReviewRequests(props: PageProps) {
  const { brandId, canSendRequests } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();

  const [locationId, setLocationId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [showCustomMessage, setShowCustomMessage] = useState(false);

  const { data: locations } = useQuery(
    trpc.reviews.locations.list.queryOptions({ brandId }),
  );
  const { data: requests, isLoading } = useQuery(
    trpc.reviews.reviewRequests.listForBrand.queryOptions({ brandId }),
  );

  const locs = locations ?? [];

  // Default to the first location so the form works without an explicit pick.
  useEffect(() => {
    if (locs.length > 0 && !locs.some((l) => l.id === locationId)) {
      setLocationId(locs[0].id);
    }
  }, [locs, locationId]);

  const send = useMutation({
    ...trpc.reviews.reviewRequests.send.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: trpc.reviews.reviewRequests.listForBrand.queryKey(),
      });
      setCustomerName('');
      setCustomerEmail('');
      setCustomMessage('');
      toast('Review request sent.');
    },
    onError: (err) => toast(err.message || "Couldn't send the request."),
  });

  // Group the history by calendar day so each day gets one header.
  const grouped = useMemo(() => {
    const groups: Array<[string, ReviewRequestRow[]]> = [];
    const byKey = new Map<string, ReviewRequestRow[]>();
    for (const r of requests ?? []) {
      const key = new Date(r.sentAt).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = [];
        byKey.set(key, bucket);
        groups.push([key, bucket]);
      }
      bucket.push(r);
    }
    return groups;
  }, [requests]);

  function locationName(id: string): string {
    return locs.find((l) => l.id === id)?.name ?? '—';
  }

  function submit() {
    if (!locationId || !customerName.trim() || !customerEmail.trim()) return;
    send.mutate({
      locationId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customMessage: customMessage.trim() || null,
    });
  }

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Review requests</h1>
          <p>Email a customer a personal link to leave a review.</p>
        </div>
      </div>

      {canSendRequests && (
      <div className="vcard" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Send a request</h3>
        {locs.length === 1 ? (
          <div className="vrow vmuted" style={{ gap: 8, fontSize: 14, marginBottom: 14 }}>
            <MapPin size={14} />
            <span>
              Sending for <strong style={{ color: 'var(--v-ink)' }}>{locs[0].name}</strong>
            </span>
          </div>
        ) : (
          <div className="vfield">
            <label className="vlabel">Location</label>
            <select
              className="vselect"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locs.length === 0 ? <option value="">No locations yet</option> : null}
              {locs.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="vgrid cols-2">
          <div className="vfield">
            <label className="vlabel">Customer name</label>
            <input
              className="vinput"
              value={customerName}
              placeholder="Jane Smith"
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <div className="vfield">
            <label className="vlabel">Customer email</label>
            <input
              className="vinput"
              type="email"
              value={customerEmail}
              placeholder="jane@example.com"
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="vfield">
          <button
            type="button"
            className="vbtn vbtn-quiet vbtn-sm"
            onClick={() => setShowCustomMessage((v) => !v)}
          >
            {showCustomMessage ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showCustomMessage ? 'Hide custom message' : 'Add a custom message (optional)'}
          </button>
          {showCustomMessage ? (
            <div style={{ marginTop: 8 }}>
              <textarea
                className="vtextarea"
                value={customMessage}
                maxLength={500}
                placeholder="Thanks for visiting — we'd love your feedback!"
                onChange={(e) => setCustomMessage(e.target.value)}
              />
              <div className="vhint" style={{ textAlign: 'right' }}>
                {customMessage.length}/500
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="vbtn vbtn-primary"
            disabled={
              !locationId ||
              !customerName.trim() ||
              !customerEmail.trim() ||
              send.isPending
            }
            onClick={submit}
          >
            {send.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            Send request
          </button>
        </div>
      </div>
      )}

      {isLoading ? (
        <SkeletonRows />
      ) : !requests || requests.length === 0 ? (
        <EmptyState
          title="No requests sent yet"
          body={
            canSendRequests
              ? 'Send your first review request using the form above.'
              : 'Review requests sent for this brand will appear here.'
          }
        />
      ) : (
        <>
          {grouped.map(([date, items]) => (
            <div key={date} style={{ marginBottom: 20 }}>
              <div className="veyebrow" style={{ marginBottom: 8 }}>
                {date}
              </div>
              <table className="vtable">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Email</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Rating</th>
                    <th>Review</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const text = responseText(r);
                    return (
                    <tr key={r.id}>
                      <td>{r.customerName}</td>
                      <td>{r.customerEmail}</td>
                      <td>{locationName(r.locationId)}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>
                        {r.responseStars != null ? (
                          <Stars n={r.responseStars} />
                        ) : (
                          <span className="vmuted">—</span>
                        )}
                      </td>
                      <td>
                        {text ? (
                          <span
                            title={text}
                            style={{
                              display: 'inline-block',
                              maxWidth: 280,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              verticalAlign: 'bottom',
                            }}
                          >
                            {text}
                          </span>
                        ) : (
                          <span className="vmuted">—</span>
                        )}
                      </td>
                      <td>{fmtTime(r.sentAt)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          <div className="vhint">Up to 50 review requests per location per day.</div>
        </>
      )}
    </>
  );
}
