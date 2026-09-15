/* Verdiict — Embeds home. Two sections: per-location embeds (each links to the
 * theme designer) and multi-location collections (with a create modal). Surfaces
 * the account-wide unlock state for both. */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Plus, Code2, LayoutGrid } from 'lucide-react';
import { EmptyState, Modal, SkeletonRows } from '../components';
import { API_BASE, num, reviewLink } from '../lib';
import type { PageProps } from '../lib';
import { useToast } from '../toast';

export function EmbedHome(props: PageProps) {
  const { brandId, go } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>([]);

  const { data: locations, isLoading } = useQuery(
    trpc.reviews.locations.list.queryOptions({ brandId }),
  );
  const { data: collections } = useQuery(
    trpc.reviews.collections.list.queryOptions({ brandId }),
  );

  const create = useMutation({
    ...trpc.reviews.collections.create.mutationOptions(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: trpc.reviews.collections.list.queryKey() });
      setCreating(false);
      setName('');
      setLocationIds([]);
      toast('Collection created.');
      go('collection', { id: res.id });
    },
    onError: (err) => toast(err.message || "Couldn't create the collection."),
  });

  function toggleLocation(id: string) {
    setLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat([id]),
    );
  }

  function submitCreate() {
    if (!name.trim() || locationIds.length === 0) return;
    create.mutate({ brandId, name: name.trim(), locationIds });
  }

  const accountReviews = collections?.accountReviews ?? 0;
  const embedUnlocked = accountReviews >= 10;

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Embeds</h1>
          <p>Drop your live reviews onto any website with a single snippet.</p>
        </div>
      </div>

      <section style={{ marginBottom: 32 }}>
        <div className="vrow-between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Location embeds</h2>
        </div>

        {!embedUnlocked ? (
          <div className="vbanner" style={{ marginBottom: 14 }}>
            <span>
              Pick a location to start designing now — the install code unlocks at 10
              reviews account-wide.
            </span>
            <span className="mono vmuted" style={{ whiteSpace: 'nowrap', marginLeft: 'auto' }}>
              {num(accountReviews)} / 10
            </span>
          </div>
        ) : null}

        {isLoading ? (
          <SkeletonRows />
        ) : !locations || locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            body="Create a location before designing an embed."
            cta="Go to locations"
            onCta={() => go('locations')}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {locations.map((loc) => (
              <div key={loc.id} className="vcard vrow-between">
                <div style={{ minWidth: 0 }}>
                  <div className="vrow" style={{ gap: 10 }}>
                    <h3 style={{ margin: 0 }}>{loc.name}</h3>
                    <span className="vbadge">{loc.industry}</span>
                  </div>
                  <div className="vmuted mono" style={{ fontSize: 12, marginTop: 4 }}>
                    {reviewLink(loc.slug)}
                  </div>
                </div>
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  onClick={() => go('embedDetail', { id: loc.id })}
                >
                  <Code2 size={14} />
                  Design embed
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="vrow-between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Collections</h2>
          <button className="vbtn vbtn-primary vbtn-sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            New collection
          </button>
        </div>

        {!collections || collections.items.length === 0 ? (
          <EmptyState
            title="No collections yet"
            body="Bundle several locations into one combined review wall."
            cta="New collection"
            onCta={() => setCreating(true)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {collections.items.map((col) => (
              <div key={col.id} className="vcard vrow-between">
                <div style={{ minWidth: 0 }}>
                  <div className="vrow" style={{ gap: 10 }}>
                    <LayoutGrid size={16} />
                    <h3 style={{ margin: 0 }}>{col.name}</h3>
                  </div>
                  <div className="vmuted mono" style={{ fontSize: 12, marginTop: 4 }}>
                    {`${API_BASE}/embed/col/${col.slug}`}
                  </div>
                </div>
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  onClick={() => go('collection', { id: col.id })}
                >
                  <Code2 size={14} />
                  Design
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {creating ? (
        <Modal title="New collection" onClose={() => setCreating(false)} width={460}>
          <div className="vfield">
            <label className="vlabel">Collection name</label>
            <input
              className="vinput"
              value={name}
              autoFocus
              placeholder="All locations"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="vfield">
            <label className="vlabel">Locations</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(locations ?? []).map((loc) => (
                <label key={loc.id} className="vrow" style={{ gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={locationIds.includes(loc.id)}
                    onChange={() => toggleLocation(loc.id)}
                  />
                  <span>{loc.name}</span>
                </label>
              ))}
            </div>
            <div className="vhint">Pick at least one location to include.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="vbtn vbtn-quiet" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              className="vbtn vbtn-primary"
              disabled={!name.trim() || locationIds.length === 0 || create.isPending}
              onClick={submitCreate}
            >
              Create collection
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
