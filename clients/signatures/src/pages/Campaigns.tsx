import { useSignaturesContext } from '@/app/context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/lib/trpc';
import { format } from 'date-fns';
import { CalendarRange, Edit2, ImagePlus, Link2, Megaphone, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { LazyImage } from '@shared/components/ui/lazy-image';

export default function CampaignsPage() {
  const utils = trpc.useUtils();

  // The brand comes from the side-panel context selector — the one place a brand
  // is chosen in this app. This page used to carry its own brand chips (plus an
  // "All brands" aggregate); they're gone, because two competing brand pickers on
  // one screen is exactly the confusion the context selector exists to remove.
  const { brandId: selectedBrandId, activeBrand } = useSignaturesContext();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [managingBanners, setManagingBanners] = useState<{ campaignId: string; brandId: string } | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  const { data: campaignRows, isLoading: campaignsLoading } =
    trpc.signatures.campaigns.list.useQuery(
      { brandId: selectedBrandId! },
      { enabled: !!selectedBrandId },
    );
  const campaigns = ((campaignRows as any[]) ?? [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // The active brand's default signature department — campaigns hang off it.
  const { data: signatureBrand } = trpc.signatures.brands.get.useQuery(
    { brandId: selectedBrandId! },
    { enabled: !!selectedBrandId }
  );

  const createMutation = trpc.signatures.campaigns.create.useMutation({
    onSuccess: () => {
      utils.signatures.campaigns.list.invalidate();
      setShowCreateDialog(false);
      toast.success('Campaign created');
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.signatures.campaigns.update.useMutation({
    onSuccess: () => {
      utils.signatures.campaigns.list.invalidate();
      setShowCreateDialog(false);
      setEditingCampaignId(null);
      toast.success('Campaign updated');
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.signatures.campaigns.delete.useMutation({
    onSuccess: () => {
      utils.signatures.campaigns.list.invalidate();
      toast.success('Campaign deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    name: '',
    linkUrl: '',
    startsAt: '',
    endsAt: '',
    isActive: true,
    rotationMode: 'sequential' as 'sequential' | 'random',
    memberId: undefined as string | undefined,
  });

  const resetForm = () => setForm({
    name: '', linkUrl: '', startsAt: '', endsAt: '',
    isActive: true, rotationMode: 'sequential', memberId: undefined,
  });

  const handleEditClick = (c: any) => {
    setEditingCampaignId(c.id);
    setForm({
      name: c.name,
      linkUrl: c.linkUrl || '',
      startsAt: c.startsAt ? format(new Date(c.startsAt), 'yyyy-MM-dd') : '',
      endsAt: c.endsAt ? format(new Date(c.endsAt), 'yyyy-MM-dd') : '',
      isActive: c.isActive,
      rotationMode: c.rotationMode,
      memberId: c.memberId || undefined,
    });
    setShowCreateDialog(true);
  };

  const handleSave = () => {
    if (editingCampaignId) {
      updateMutation.mutate({
        id: editingCampaignId,
        data: {
          name: form.name,
          linkUrl: form.linkUrl || null,
          startsAt: form.startsAt ? new Date(form.startsAt) : null,
          endsAt: form.endsAt ? new Date(form.endsAt) : null,
          isActive: form.isActive,
          rotationMode: form.rotationMode,
          memberId: form.memberId || null,
        },
      });
    } else {
      if (!signatureBrand) return;
      createMutation.mutate({
        signatureBrandId: signatureBrand.id,
        name: form.name,
        linkUrl: form.linkUrl || undefined,
        startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
        isActive: form.isActive,
        rotationMode: form.rotationMode,
        memberId: form.memberId,
      });
    }
  };

  const toggleActive = (id: string, current: boolean) => {
    updateMutation.mutate({ id, data: { isActive: !current } });
  };

  const isActive = (c: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }) => {
    if (!c.isActive) return false;
    const now = new Date();
    if (c.startsAt && new Date(c.startsAt) > now) return false;
    if (c.endsAt && new Date(c.endsAt) < now) return false;
    return true;
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary shrink-0" />
            Campaigns
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Schedule promotional banners in{' '}
            {activeBrand ? <span className="font-medium text-foreground">{activeBrand.businessName}</span> : 'your brand'}
            &rsquo;s email signatures.
          </p>
        </div>
        {selectedBrandId && (
          <Button 
            onClick={() => { resetForm(); setEditingCampaignId(null); setShowCreateDialog(true); }} 
            className="w-full sm:w-auto gap-2 bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold shrink-0"
          >
            <Plus className="w-4 h-4" /> New Campaign
          </Button>
        )}
      </div>

      {!selectedBrandId ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">No brand selected</CardTitle>
            <CardDescription>
              Pick a brand from the switcher in the side panel to manage its campaigns.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : campaignsLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CalendarRange className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No campaigns yet. Create your first one!</p>
              </CardContent>
            </Card>
          ) : (
            campaigns.map(c => (
              <Card key={c.id} className={`border ${isActive(c) ? 'border-primary/60 bg-primary/5' : ''} transition-all duration-200 hover:shadow-sm`}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm sm:text-base text-foreground break-words">{c.name}</span>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={isActive(c) ? 'default' : 'secondary'} className="text-[10px] sm:text-xs px-2 py-0.5">
                            {isActive(c) ? 'Active' : 'Inactive'}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] sm:text-xs capitalize px-2 py-0.5">{c.rotationMode}</Badge>
                          {c.memberId && <Badge variant="outline" className="text-[10px] sm:text-xs px-2 py-0.5">Member-specific</Badge>}
                        </div>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
                        {c.linkUrl && (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <Link2 className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                            <a href={c.linkUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                              {c.linkUrl}
                            </a>
                          </span>
                        )}
                        <span className="flex items-center gap-1.5">
                          <CalendarRange className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                          <span>
                            {c.startsAt || c.endsAt ? (
                              <>
                                {c.startsAt ? format(new Date(c.startsAt), 'dd MMM yyyy') : 'Start'}
                                <span className="mx-1">→</span>
                                {c.endsAt ? format(new Date(c.endsAt), 'dd MMM yyyy') : 'End'}
                              </>
                            ) : (
                              'No date restriction'
                            )}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Actions container */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-border/40 w-full sm:w-auto shrink-0">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.isActive}
                          onCheckedChange={() => toggleActive(c.id, c.isActive)}
                          id={`active-toggle-${c.id}`}
                          title="Toggle active"
                        />
                        <label htmlFor={`active-toggle-${c.id}`} className="text-xs font-medium text-muted-foreground sm:hidden cursor-pointer">
                          Active
                        </label>
                      </div>

                      <div className="flex items-center gap-1.5 ml-auto">
                        <Button
                          variant="outline" size="sm" className="h-8 text-xs gap-1.5 px-2.5"
                          onClick={() => handleEditClick(c)}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Button>
                        <Button
                          variant="outline" size="sm" className="h-8 text-xs gap-1.5 px-2.5"
                          onClick={() => setManagingBanners({ campaignId: c.id, brandId: c.brandId })}
                        >
                          <ImagePlus className="w-3.5 h-3.5" />
                          <span>Banners</span>
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => deleteMutation.mutate({ id: c.id })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  {c.banners && c.banners.length > 0 && (
                    <div className="mt-4 pt-3.5 border-t border-border/40">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Banners ({c.banners.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {c.banners.map((b: any) => (
                          <div key={b.id} className="relative rounded border border-border/60 w-20 h-10 sm:w-24 sm:h-12 bg-muted overflow-hidden flex-shrink-0 group">
                            <LazyImage
                              src={b.imageUrl}
                              alt="Banner Preview"
                              wrapperClassName="w-full h-full"
                              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Create / Edit Campaign Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) setEditingCampaignId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCampaignId ? 'Edit Campaign' : 'New Campaign'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Campaign Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Summer Sale 2025" className="h-9" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Click URL (optional)</Label>
              <Input value={form.linkUrl} onChange={e => setForm(p => ({ ...p, linkUrl: e.target.value }))}
                placeholder="https://yoursite.com/campaign" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Start Date</Label>
                <Input type="date" value={form.startsAt} onChange={e => setForm(p => ({ ...p, startsAt: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">End Date</Label>
                <Input type="date" value={form.endsAt} onChange={e => setForm(p => ({ ...p, endsAt: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Banner Rotation</Label>
              <Select value={form.rotationMode} onValueChange={v => setForm(p => ({ ...p, rotationMode: v as 'sequential' | 'random' }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sequential (round-robin)</SelectItem>
                  <SelectItem value="random">Random</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Active immediately</Label>
              <Switch checked={form.isActive} onCheckedChange={v => setForm(p => ({ ...p, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingCampaignId(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || createMutation.isPending || updateMutation.isPending} className="bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold">
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : editingCampaignId
                ? 'Save Changes'
                : 'Create Campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Banner Manager Dialog */}
      {managingBanners && (
        <BannerManagerDialog
          campaignId={managingBanners.campaignId}
          brandId={managingBanners.brandId}
          onClose={() => setManagingBanners(null)}
        />
      )}
    </div>
  );
}

function BannerManagerDialog({ campaignId, brandId, onClose }: { campaignId: string; brandId: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: banners = [] } = trpc.signatures.campaigns.getBanners.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );

  const uploadMutation = trpc.signatures.upload.file.useMutation({
    onSuccess: async (result) => {
      await addBannerMutation.mutateAsync({
        campaignId,
        imageKey: result.key,
        imageUrl: result.url,
        sortOrder: banners.length,
      });
    },
    onError: (e) => { toast.error(e.message); setUploading(false); },
  });

  const addBannerMutation = trpc.signatures.campaigns.addBanner.useMutation({
    onSuccess: () => {
      utils.signatures.campaigns.getBanners.invalidate({ campaignId });
      setUploading(false);
      toast.success('Banner added');
    },
    onError: (e) => { toast.error(e.message); setUploading(false); },
  });

  const deleteBannerMutation = trpc.signatures.campaigns.deleteBanner.useMutation({
    onSuccess: () => utils.signatures.campaigns.getBanners.invalidate({ campaignId }),
    onError: (e) => toast.error(e.message),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2MB'); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string).split(',')[1];
      uploadMutation.mutate({ brandId, filename: file.name, contentType: file.type, base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4" /> Campaign Banners
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Upload multiple banner images. They will be shown in rotation (sequential or random) each time the signature is generated.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {banners.map((b, i) => (
              <div key={b.id} className="relative group rounded-lg overflow-hidden border border-border bg-muted">
                <LazyImage
                  src={b.imageUrl}
                  alt={`Banner ${i + 1}`}
                  wrapperClassName="w-full h-24"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-[#0E0E0C]/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Button
                    variant="destructive" size="icon" className="h-8 w-8"
                    onClick={() => deleteBannerMutation.mutate({ id: b.id })}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="absolute bottom-1 left-1 bg-[#0E0E0C]/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                  #{i + 1}
                </div>
              </div>
            ))}

            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <Upload className="w-5 h-5" />
              <span className="text-xs">{uploading ? 'Uploading...' : 'Add Banner'}</span>
            </button>
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

          {banners.length === 0 && (
            <p className="text-xs text-center text-muted-foreground py-4">No banners yet. Upload your first one above.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose} className="bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
