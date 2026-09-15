/**
 * BrandTemplatesPanel — Company brand presets
 * Apply a saved brand kit (colors, logo, font) to the current signature
 * Design: Warm Craft Studio
 */

import { useState, useRef } from 'react';
import { Palette, Plus, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ColorPicker } from '@shared/components/ui/color-picker';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  loadBrandTemplates,
  saveBrandTemplate,
  deleteBrandTemplate,
  PRESET_BRANDS,
  FONT_OPTIONS,
  type BrandTemplate,
  type SignatureData,
} from '@/lib/signatureTypes';
import { toast } from 'sonner';

interface BrandTemplatesPanelProps {
  current: SignatureData;
  onApply: (partial: Partial<SignatureData>) => void;
}

export function BrandTemplatesPanel({
  current,
  onApply,
}: BrandTemplatesPanelProps) {
  const [open, setOpen] = useState(false);
  const [brands, setBrands] = useState<BrandTemplate[]>([]);
  const [creating, setCreating] = useState(false);
  const [newBrand, setNewBrand] = useState<Omit<BrandTemplate, 'id'>>({
    name: '',
    primaryColor: current.primaryColor,
    secondaryColor: current.secondaryColor,
    fontFamily: current.fontFamily,
    logoUrl: current.logoUrl,
    logoWidth: current.logoWidth,
    disclaimer: current.disclaimer,
  });
  const logoInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setBrands(loadBrandTemplates());

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      refresh();
      setCreating(false);
    }
  };

  const handleApply = (brand: BrandTemplate) => {
    onApply({
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      fontFamily: brand.fontFamily,
      logoUrl: brand.logoUrl || current.logoUrl,
      logoWidth: brand.logoWidth,
      showLogo: brand.logoUrl ? true : current.showLogo,
      disclaimer: brand.disclaimer || current.disclaimer,
    });
    setOpen(false);
    toast.success(`Brand "${brand.name}" applied`);
  };

  const handleSaveBrand = () => {
    if (!newBrand.name.trim()) {
      toast.error('Please enter a brand name');
      return;
    }
    saveBrandTemplate(newBrand);
    refresh();
    setCreating(false);
    toast.success(`Brand "${newBrand.name}" saved`);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error('Logo too large (max 500KB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) =>
      setNewBrand((b) => ({ ...b, logoUrl: ev.target?.result as string }));
    reader.readAsDataURL(file);
  };

  const isPreset = (id: string) => PRESET_BRANDS.some((b) => b.id === id);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Palette className="w-3.5 h-3.5" />
          Palette
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Color Palette</DialogTitle>
        </DialogHeader>

        {!creating ? (
          <>
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
              {brands.map((brand) => (
                <div
                  key={brand.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/40 hover:bg-muted/70 transition-colors"
                >
                  {/* Color swatches */}
                  <div className="flex gap-1 flex-shrink-0">
                    <div
                      className="w-5 h-5 rounded-full border border-white shadow-sm"
                      style={{ backgroundColor: brand.primaryColor }}
                    />
                    <div
                      className="w-5 h-5 rounded-full border border-white shadow-sm"
                      style={{ backgroundColor: brand.secondaryColor }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {brand.name}
                    </div>
                    <div
                      className="text-xs text-muted-foreground truncate"
                      style={{ fontFamily: brand.fontFamily }}
                    >
                      {brand.fontFamily.split(',')[0].replace(/'/g, '')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1 px-2 bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold"
                      onClick={() => handleApply(brand)}
                    >
                      <Check className="w-3 h-3" /> Apply
                    </Button>
                    {!isPreset(brand.id) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => {
                          deleteBrandTemplate(brand.id);
                          refresh();
                          toast.info('Brand deleted');
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 mt-1"
              onClick={() => {
                setNewBrand({
                  name: '',
                  primaryColor: current.primaryColor,
                  secondaryColor: current.secondaryColor,
                  fontFamily: current.fontFamily,
                  logoUrl: current.logoUrl,
                  logoWidth: current.logoWidth,
                  disclaimer: current.disclaimer,
                });
                setCreating(true);
              }}
            >
              <Plus className="w-4 h-4" /> Save Current as New
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Brand Name *
              </Label>
              <Input
                value={newBrand.name}
                onChange={(e) =>
                  setNewBrand((b) => ({ ...b, name: e.target.value }))
                }
                placeholder="e.g. Acme Corp"
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Primary Color
                </Label>
                <ColorPicker
                  value={newBrand.primaryColor}
                  onChange={(v) =>
                    setNewBrand((b) => ({ ...b, primaryColor: v }))
                  }
                  ariaLabel="Primary Color"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Secondary Color
                </Label>
                <ColorPicker
                  value={newBrand.secondaryColor}
                  onChange={(v) =>
                    setNewBrand((b) => ({ ...b, secondaryColor: v }))
                  }
                  ariaLabel="Secondary Color"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Font
              </Label>
              <Select
                value={newBrand.fontFamily}
                onValueChange={(v) =>
                  setNewBrand((b) => ({ ...b, fontFamily: v }))
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Brand Logo (optional)
              </Label>
              <div className="flex items-center gap-2">
                {newBrand.logoUrl && (
                  <img
                    src={newBrand.logoUrl}
                    alt="Logo"
                    className="h-8 object-contain border border-border rounded bg-white p-1"
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs flex-1"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {newBrand.logoUrl ? 'Change Logo' : 'Upload Logo'}
                </Button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 gap-1.5 bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold"
                onClick={handleSaveBrand}
              >
                <Check className="w-3.5 h-3.5" /> Save Brand
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
