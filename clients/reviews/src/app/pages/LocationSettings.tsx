/* Verdiict — Location settings. Edits a location's details, its per-platform
 * review URLs, its win-tags, and the destructive delete (soft, 7-day grace). */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { uploadBrandFile } from '@shared/pages/brand/storage';
import { LazyImage } from '@shared/components/ui/lazy-image';
import {
  CheckCircle2,
  ChevronLeft,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Upload,
  X,
} from 'lucide-react';
import { Modal, SkeletonRows } from '../components';
import { MAX_SLUG_CHANGES, PLATFORMS, reviewLink } from '../lib';
import type { PageProps } from '../lib';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';

export function LocationSettings(props: PageProps) {
  const { brandId, params, canEdit, go } = props;
  const id = params.id!;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: loc, isLoading } = useQuery(trpc.reviews.locations.get.queryOptions({ id }));

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [badReviewEmail, setBadReviewEmail] = useState('');
  const [platformUrls, setPlatformUrls] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seed the form once per location — later refetches (save invalidations,
  // window-focus) must not clobber whatever the user is currently typing.
  const seededId = useRef<string | null>(null);
  useEffect(() => {
    if (!loc || seededId.current === loc.id) return;
    seededId.current = loc.id;
    setName(loc.name);
    setSlug(loc.slug);
    setRedirectUrl(loc.redirectUrl ?? '');
    setBadReviewEmail(loc.badReviewEmail ?? '');
    setTags(loc.tags.map((t) => t.label));
    const urls: Record<string, string> = {};
    for (const p of loc.platforms) urls[p.platform] = p.url;
    setPlatformUrls(urls);
  }, [loc]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: trpc.reviews.locations.get.queryKey({ id }) });

  const update = useMutation({
    ...trpc.reviews.locations.update.mutationOptions(),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() });
      toast('Details saved.');
    },
    onError: (err) => toast(err.message || "Couldn't save details."),
  });

  const updatePlatform = useMutation({
    ...trpc.reviews.locations.updatePlatform.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Platform saved.');
    },
    onError: (err) => toast(err.message || "Couldn't save the platform."),
  });

  const updateTags = useMutation({
    ...trpc.reviews.locations.updateTags.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Win tags saved.');
    },
    onError: (err) => toast(err.message || "Couldn't save win tags."),
  });

  // Logo persistence is separate from the Details save so it gets its own toasts.
  const updateLogo = useMutation({
    ...trpc.reviews.locations.update.mutationOptions(),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() });
    },
  });

  const softDelete = useMutation({
    ...trpc.reviews.locations.softDelete.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.list.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.reviews.locations.listDeleted.queryKey() });
      toast('Location moved to trash.');
      go('locations');
    },
    onError: (err) => toast(err.message || "Couldn't delete the location."),
  });

  // Mirror of the server's slugifyName so what the user sees is what gets saved.
  function normalizeSlug(v: string) {
    return v
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
  }

  function saveDetails() {
    update.mutate({
      id,
      name: name.trim(),
      slug: slug.trim(),
      redirectUrl: redirectUrl.trim() || null,
      badReviewEmail: badReviewEmail.trim() || null,
    });
  }

  function savePlatform(platform: (typeof PLATFORMS)[number]['slug']) {
    updatePlatform.mutate({ locationId: id, platform, url: (platformUrls[platform] ?? '').trim() });
  }

  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('Logo must be under 2MB.');
      return;
    }
    setUploadingLogo(true);
    try {
      const url = await uploadBrandFile(brandId, 'reviews-logos', file);
      await updateLogo.mutateAsync({ id, logoUrl: url });
      toast('Logo updated.');
    } catch {
      toast('Logo upload failed. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function removeLogo() {
    try {
      await updateLogo.mutateAsync({ id, logoUrl: null });
      toast('Logo removed.');
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Couldn't remove the logo.");
    }
  }

  async function copyReviewLink() {
    if (!loc) return;
    await navigator.clipboard.writeText(reviewLink(loc.slug));
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    toast('Review link copied.');
  }

  function addTag() {
    const t = newTag.trim();
    if (!t) return;
    if (tags.includes(t)) {
      toast('Tag already exists.');
      return;
    }
    const prev = tags;
    const next = [...tags, t];
    setTags(next);
    setNewTag('');
    // Roll the optimistic list back if the save fails (toast comes from the mutation).
    updateTags.mutate({ locationId: id, tags: next }, { onError: () => setTags(prev) });
  }

  function removeTag(tag: string) {
    const prev = tags;
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    updateTags.mutate({ locationId: id, tags: next }, { onError: () => setTags(prev) });
  }

  async function openDelete() {
    const ok = await confirm({
      title: 'Delete this location?',
      description:
        'This moves the location to trash for 7 days before it is permanently removed. Its review page will go offline immediately.',
      destructive: true,
      confirmLabel: 'Continue',
    });
    if (!ok) return;
    setConfirmName('');
    setShowDelete(true);
  }

  function confirmDelete() {
    softDelete.mutate({ id, confirmName: confirmName.trim() });
  }

  const slugChangesLeft = loc
    ? Math.max(0, MAX_SLUG_CHANGES - loc.slugChangeCount)
    : 0;

  if (isLoading || !loc) {
    return (
      <>
        <div className="vpagehead">
          <div>
            <h1>Location settings</h1>
            <p>Loading…</p>
          </div>
        </div>
        <SkeletonRows />
      </>
    );
  }

  return (
    <>
      <div className="vpagehead">
        <div>
          <button
            className="vbtn vbtn-quiet vbtn-sm"
            style={{ marginBottom: 8 }}
            onClick={() => go('locations')}
          >
            <ChevronLeft size={14} />
            Locations
          </button>
          <h1>{loc.name}</h1>
          <div className="vrow" style={{ gap: 8, marginTop: 6 }}>
            <span className="vmuted mono" style={{ fontSize: 13 }}>
              /r/{loc.slug}
            </span>
            <button
              className="vbtn vbtn-quiet vbtn-sm"
              onClick={copyReviewLink}
              aria-label="Copy review link"
            >
              {copiedLink ? <CheckCircle2 size={14} color="var(--v-success)" /> : <Copy size={14} />}
            </button>
            <a
              className="vbtn vbtn-quiet vbtn-sm"
              href={reviewLink(loc.slug)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open public review page"
            >
              <ExternalLink size={14} />
            </a>
          </div>
          <p>Manage this location's review page, platforms and win tags.</p>
          {!canEdit ? (
            <span className="vhint" style={{ display: 'block' }}>
              You have view-only access.
            </span>
          ) : null}
        </div>
      </div>

      <div className="vcard" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Business logo</h3>
        <p className="vmuted" style={{ marginTop: 0 }}>
          Shown at the top of your public review page.
        </p>
        <div className="vrow" style={{ gap: 14, alignItems: 'center' }}>
          {loc.logoUrl ? (
            <LazyImage
              src={loc.logoUrl}
              alt="Logo"
              style={{
                height: 56,
                maxWidth: 140,
                border: '1px solid var(--v-line)',
                borderRadius: 'var(--v-radius-sm)',
                background: '#fff',
                padding: 4,
              }}
              imgClassName="object-contain"
            />
          ) : (
            <div
              style={{
                height: 56,
                width: 56,
                borderRadius: 'var(--v-radius-sm)',
                border: '1px dashed var(--v-line)',
                background: 'var(--v-paper-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Upload size={18} style={{ opacity: 0.4 }} />
            </div>
          )}
          {canEdit ? (
            <div>
              <div className="vrow" style={{ gap: 8 }}>
                <button
                  className="vbtn vbtn-sm"
                  disabled={uploadingLogo}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingLogo ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      Upload logo
                    </>
                  )}
                </button>
                {loc.logoUrl ? (
                  <button
                    className="vbtn vbtn-quiet vbtn-sm"
                    disabled={uploadingLogo || updateLogo.isPending}
                    onClick={removeLogo}
                  >
                    <X size={14} />
                    Remove
                  </button>
                ) : null}
              </div>
              <span className="vhint" style={{ display: 'block' }}>
                PNG, SVG, or WebP · Max 2MB
              </span>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/svg+xml,image/webp,image/jpeg"
            style={{ display: 'none' }}
            onChange={handleLogoUpload}
          />
        </div>
      </div>

      <div className="vcard" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Details</h3>
        <div className="vfield">
          <label className="vlabel">Location name</label>
          <input className="vinput" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="vfield">
          <label className="vlabel">Review link</label>
          <div className="vrow" style={{ gap: 6, alignItems: 'center' }}>
            <span className="vmuted mono" style={{ fontSize: 13 }}>
              /r/
            </span>
            <input
              className="vinput mono"
              style={{ flex: 1 }}
              value={slug}
              disabled={slugChangesLeft <= 0 && slug === loc.slug}
              onChange={(e) => setSlug(normalizeSlug(e.target.value))}
            />
          </div>
          <span className="vhint">
            {slugChangesLeft > 0 ? (
              <>
                Old links and QR codes keep working — they carry over to the new link. You
                can change this {slugChangesLeft} more{' '}
                {slugChangesLeft === 1 ? 'time' : 'times'}.
              </>
            ) : (
              <>This location has used all {MAX_SLUG_CHANGES} link changes.</>
            )}
          </span>
        </div>
        <div className="vfield">
          <label className="vlabel">Redirect URL</label>
          <input
            className="vinput"
            value={redirectUrl}
            placeholder="https://yourbusiness.com"
            onChange={(e) => setRedirectUrl(e.target.value)}
          />
          <span className="vhint">Where the "Back to website" button sends visitors.</span>
        </div>
        <div className="vfield">
          <label className="vlabel">Private feedback email</label>
          <input
            className="vinput"
            value={badReviewEmail}
            placeholder="alerts@yourbusiness.com"
            onChange={(e) => setBadReviewEmail(e.target.value)}
          />
          <span className="vhint">Where 4-star-and-under feedback is sent privately.</span>
        </div>
        {canEdit ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="vbtn vbtn-primary"
              disabled={!name.trim() || slug.trim().length < 3 || update.isPending}
              onClick={saveDetails}
            >
              {update.isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Saving…
                </>
              ) : (
                'Save details'
              )}
            </button>
          </div>
        ) : null}
      </div>

      <div className="vcard" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Review platforms</h3>
        <p className="vmuted" style={{ marginTop: 0 }}>
          Paste the direct "write a review" link for each platform you use.
        </p>
        {PLATFORMS.map((p) => (
          <div className="vfield" key={p.slug}>
            <label className="vlabel">{p.label}</label>
            <div className="vrow" style={{ gap: 8 }}>
              <input
                className="vinput"
                style={{ flex: 1 }}
                value={platformUrls[p.slug] ?? ''}
                placeholder={p.placeholder}
                onChange={(e) =>
                  setPlatformUrls((prev) => ({ ...prev, [p.slug]: e.target.value }))
                }
              />
              {canEdit ? (
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  disabled={updatePlatform.isPending}
                  onClick={() => savePlatform(p.slug)}
                >
                  Save
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="vcard" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Win tags</h3>
        <p className="vmuted" style={{ marginTop: 0 }}>
          What customers can praise. These feed the AI-written review.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {tags.length === 0 ? (
            <span className="vmuted">No tags yet.</span>
          ) : (
            tags.map((tag) => (
              <span key={tag} className="vchip">
                {tag}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                    style={{
                      background: 'none',
                      border: 0,
                      cursor: 'pointer',
                      marginLeft: 6,
                      display: 'inline-flex',
                    }}
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </span>
            ))
          )}
        </div>
        {canEdit ? (
          <div className="vrow" style={{ gap: 8 }}>
            <input
              className="vinput"
              style={{ flex: 1 }}
              value={newTag}
              placeholder="Add a win tag…"
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
            />
            <button
              className="vbtn vbtn-quiet vbtn-sm"
              disabled={!newTag.trim() || updateTags.isPending}
              onClick={addTag}
            >
              {updateTags.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="vcard">
          <h3 style={{ marginTop: 0 }}>Danger zone</h3>
          <div className="vrow-between">
            <span className="vmuted">
              Delete this location. It can be restored from trash within 7 days.
            </span>
            <button className="vbtn vbtn-danger" onClick={openDelete}>
              Delete location
            </button>
          </div>
        </div>
      ) : null}

      {showDelete ? (
        <Modal title="Confirm delete" onClose={() => setShowDelete(false)} width={420}>
          <p className="vmuted" style={{ marginTop: 0 }}>
            Type the location name <strong>{loc.name}</strong> to confirm.
          </p>
          <div className="vfield">
            <input
              className="vinput"
              value={confirmName}
              autoFocus
              placeholder={loc.name}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="vbtn vbtn-quiet" onClick={() => setShowDelete(false)}>
              Cancel
            </button>
            <button
              className="vbtn vbtn-danger"
              disabled={
                confirmName.trim().toLowerCase() !== loc.name.trim().toLowerCase() ||
                softDelete.isPending
              }
              onClick={confirmDelete}
            >
              Delete location
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
