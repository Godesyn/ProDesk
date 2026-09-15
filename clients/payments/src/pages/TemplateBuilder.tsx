/**
 * TemplateBuilder — True WYSIWYG modular template editor
 *
 * Layout: [TopBar] [Canvas (flex-1)] [BlockPalette (right panel, collapsible)]
 *
 * Features:
 *   - Drag blocks from palette onto canvas to insert at exact position
 *   - 5 pre-designed themes that actually transform all block styles
 *   - Auto-save on block changes (debounced 1.5s)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useTRPC } from '@shared/lib/trpc';
import { useBrandId } from '@/lib/payments-trpc';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ProposalCanvas } from '@/components/ProposalCanvas';
import { BlockPalette } from '@/components/BlockPalette';
import { ProposalRenderer } from '@/components/ProposalRenderer';
import {
  type Block,
  type BlockType,
  createDefaultBlocks,
  applyThemeToBlocks,
  applyBrandKitToBlocks,
  loadBrandKitFonts,
  loadThemeFonts,
  DEFAULT_BLOCK_DATA,
  type BrandKit,
} from '@/lib/blocks';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { MergeFieldToolbar } from '@/components/MergeFieldToolbar';

function DragGhost({ label }: { label: string }) {
  return (
    <div
      style={{
        background: 'rgba(101,245,201,0.15)',
        border: '1px solid #65F5C9',
        borderRadius: 10,
        padding: '10px 18px',
        fontSize: 13,
        fontWeight: 600,
        color: '#65F5C9',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      + {label}
    </div>
  );
}

export default function TemplateBuilder() {
  const [, params] = useRoute('/templates/:id/edit');
  const [, paramsNew] = useRoute('/templates/new');
  const [, navigate] = useLocation();
  const rawId = params?.id;
  const id = rawId && rawId !== 'new' ? rawId : null;
  const isNew = !id || !!paramsNew;

  const trpc = useTRPC();
  const brandId = useBrandId();

  const [name, setName] = useState('New template');
  const [editingName, setEditingName] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTheme, setActiveTheme] = useState('midnight');
  const [draggingType, setDraggingType] = useState<BlockType | null>(null);
  const [draggingLabel, setDraggingLabel] = useState('');
  const [defaultLineItems, setDefaultLineItems] = useState<
    Array<{
      id: string;
      name: string;
      description?: string;
      quantity: number;
      unitPriceCents: number;
      optional?: boolean;
    }>
  >([]);
  const nameRef = useRef<HTMLInputElement>(null);
  // PHASE2-15: Preview panel state
  const [showPreview, setShowPreview] = useState(false);

  // Load existing template
  const { data: template, isLoading } = useQuery({
    ...trpc.payments.templates.get.queryOptions({ id: id! }),
    enabled: !!id,
  });

  useEffect(() => {
    if (template) {
      setName(template.name ?? 'Untitled template');
      const raw = template.structure as unknown as {
        blocks?: Block[];
        theme?: string;
      } | null;
      if (raw?.blocks && Array.isArray(raw.blocks) && raw.blocks.length > 0) {
        setBlocks(raw.blocks);
      } else {
        setBlocks(createDefaultBlocks());
      }
      if (raw?.theme) setActiveTheme(raw.theme);
      const rawItems = (template as any).defaultLineItems;
      if (Array.isArray(rawItems)) setDefaultLineItems(rawItems);
    } else if (isNew) {
      setBlocks(createDefaultBlocks());
    }
  }, [template, isNew]);

  useEffect(() => {
    loadThemeFonts(activeTheme);
  }, [activeTheme]);

  // Save mutations
  const createMut = useMutation(
    trpc.payments.templates.create.mutationOptions(),
  );
  const { data: brandKitData } = useQuery({
    ...trpc.payments.accounts.getBrandKit.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const brandKit: BrandKit | null = (brandKitData as any) ?? null;
  const updateMut = useMutation(
    trpc.payments.templates.update.mutationOptions(),
  );

  const handleSave = useCallback(
    async (blocksOverride?: Block[]) => {
      if (saving) return;
      setSaving(true);
      try {
        const structure = {
          blocks: blocksOverride ?? blocks,
          theme: activeTheme,
        };
        if (isNew) {
          if (!brandId) throw new Error('No active brand');
          const result = await createMut.mutateAsync({
            brandId,
            name,
            structure,
          });
          toast.success('Template saved');
          if (result?.id) navigate(`/templates/${result.id}/edit`);
        } else {
          await updateMut.mutateAsync({
            id: id!,
            name,
            structure,
            defaultLineItems,
          });
          toast.success('Template saved');
        }
        setSaved(true);
      } catch {
        toast.error('Failed to save template');
      } finally {
        setSaving(false);
      }
    },
    [
      saving,
      blocks,
      isNew,
      name,
      id,
      activeTheme,
      brandId,
      createMut,
      updateMut,
      navigate,
      defaultLineItems,
    ],
  );

  // Auto-save on blocks change (debounced)
  const autoSaveTimer = useRef<number | undefined>(undefined);
  const handleBlocksChange = useCallback(
    (newBlocks: Block[]) => {
      setBlocks(newBlocks);
      setSaved(false);
      clearTimeout(autoSaveTimer.current);
      if (!isNew) {
        autoSaveTimer.current = window.setTimeout(() => {
          const structure = { blocks: newBlocks, theme: activeTheme };
          updateMut
            .mutateAsync({ id: id!, name, structure })
            .then(() => setSaved(true))
            .catch(() => {});
        }, 1500);
      }
    },
    [isNew, id, name, activeTheme, updateMut],
  );

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as {
      blockType?: BlockType;
      label?: string;
    };
    if (data?.blockType) {
      setDraggingType(data.blockType);
      setDraggingLabel(data.label ?? data.blockType);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingType(null);
      setDraggingLabel('');
      const { active, over } = event;
      if (!over) return;
      const dragData = active.data.current as { blockType?: BlockType };
      const dropData = over.data.current as { insertAfterIndex?: number };
      if (!dragData?.blockType) return;
      const def = DEFAULT_BLOCK_DATA[dragData.blockType];
      const newBlock: Block = {
        id: crypto.randomUUID(),
        type: dragData.blockType,
        data: def?.data ?? {},
        styles: def?.styles ?? {},
      };
      const themed = applyThemeToBlocks([newBlock], activeTheme)[0];
      const insertIdx = dropData?.insertAfterIndex ?? blocks.length - 1;
      const newBlocks = [...blocks];
      newBlocks.splice(insertIdx + 1, 0, themed);
      handleBlocksChange(newBlocks);
    },
    [blocks, activeTheme, handleBlocksChange],
  );

  const handlePaletteAdd = useCallback(
    (blockType: BlockType) => {
      const def = DEFAULT_BLOCK_DATA[blockType];
      const newBlock: Block = {
        id: crypto.randomUUID(),
        type: blockType,
        data: def?.data ?? {},
        styles: def?.styles ?? {},
      };
      const themed = applyThemeToBlocks([newBlock], activeTheme)[0];
      const newBlocks = [...blocks];
      const lastIdx = newBlocks.length - 1;
      if (newBlocks[lastIdx]?.type === 'accept_pay') {
        newBlocks.splice(lastIdx, 0, themed);
      } else {
        newBlocks.push(themed);
      }
      handleBlocksChange(newBlocks);
    },
    [blocks, activeTheme, handleBlocksChange],
  );

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: '#000' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: '#65F5C9', borderTopColor: 'transparent' }}
          />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Loading template…
          </span>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="fixed inset-0 flex flex-col"
        style={{ background: '#000', zIndex: 50 }}
      >
        {/* Top bar */}
        <div
          className="flex items-center gap-4 px-5 flex-shrink-0"
          style={{
            height: 56,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.95)',
            backdropFilter: 'blur(20px)',
            zIndex: 100,
          }}
        >
          <div className="flex items-center gap-2 mr-2">
            <img
              src="/logo-wordmark.svg"
              alt="Prodesk"
              style={{
                height: 24,
                width: 'auto',
                objectFit: 'contain',
                filter: 'brightness(0) invert(1)',
              }}
            />
          </div>
          <div
            className="flex items-center gap-2 text-[13px]"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            <button
              onClick={() => navigate('/templates')}
              className="hover:text-white transition-colors"
            >
              Templates
            </button>
            <span>/</span>
            {editingName ? (
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setEditingName(false);
                }}
                className="bg-transparent outline-none text-white font-medium border-b border-white/30"
                style={{ minWidth: 120, width: `${name.length + 2}ch` }}
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setEditingName(true);
                  setTimeout(() => nameRef.current?.select(), 10);
                }}
                className="flex items-center gap-2 text-white font-medium hover:opacity-70 transition-opacity group"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="opacity-0 group-hover:opacity-60 transition-opacity"
                >
                  <path
                    d="M8 1l3 3-7 7H1V8l7-7z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    fill="none"
                    strokeLinejoin="round"
                  />
                </svg>
                {name}
              </button>
            )}
          </div>
          <div className="flex-1" />
          {/* Merge fields */}
          <MergeFieldToolbar
            onInsert={(key) => {
              navigator.clipboard
                .writeText(key)
                .then(() =>
                  toast.success(`Copied ${key} — paste into any text block`),
                );
            }}
            className="border-white/20 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
          />
          {/* Brand kit auto-apply button */}
          {brandKit && (
            <button
              onClick={() => {
                loadBrandKitFonts(brandKit);
                const branded = applyBrandKitToBlocks(blocks, brandKit);
                setBlocks(branded);
                setActiveTheme('brand');
                setSaved(false);
                toast.success('Brand kit applied to all blocks');
              }}
              title="Apply your brand kit colours and fonts to all blocks"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontWeight: 600,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle
                  cx="6.5"
                  cy="6.5"
                  r="5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <circle cx="6.5" cy="6.5" r="2" fill="currentColor" />
              </svg>
              Apply Brand Kit
            </button>
          )}
          <div
            className="text-[12px]"
            style={{
              color: saved ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)',
            }}
          >
            {saving
              ? 'Saving…'
              : saved
                ? 'All changes saved'
                : 'Unsaved changes'}
          </div>
          {/* PHASE2-15: Preview toggle button */}
          <button
            onClick={() => setShowPreview((p) => !p)}
            title={showPreview ? 'Back to editor' : 'Preview as client'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: showPreview
                ? '1px solid rgba(101,245,201,0.5)'
                : '1px solid rgba(255,255,255,0.12)',
              background: showPreview
                ? 'rgba(101,245,201,0.12)'
                : 'rgba(255,255,255,0.05)',
              cursor: 'pointer',
              color: showPreview ? '#65F5C9' : 'rgba(255,255,255,0.7)',
              fontSize: 12,
              fontWeight: 600,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <g stroke="currentColor" strokeWidth="1.5" fill="none">
                <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
                <circle cx="8" cy="8" r="2" />
              </g>
            </svg>
            {showPreview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-[7px] rounded-lg text-[13px] font-medium transition-all hover:opacity-80 active:scale-95 disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2 2h7l2 2v7H2V2zM4 2v3h5V2M4 7h5v4"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
                strokeLinejoin="round"
              />
            </svg>
            Save
          </button>
          {!isNew && (
            <button
              onClick={() => navigate(`/proposals/new?template=${id}`)}
              className="flex items-center gap-2 px-4 py-[7px] rounded-lg text-[13px] font-bold transition-all hover:opacity-90 active:scale-95"
              style={{ background: '#65F5C9', color: '#000' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1v10M1 6h10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              Use template
            </button>
          )}
        </div>

        {/* Body: canvas (flex-1) + palette (fixed-width right column) */}
        <div className="flex flex-1 overflow-hidden">
          {showPreview ? (
            /* PHASE2-15: ProposalRenderer preview panel */
            <div
              className="flex-1 overflow-y-auto"
              style={{ background: '#0a0a0a', minWidth: 0 }}
            >
              <ProposalRenderer
                blocks={blocks}
                brandKit={brandKit}
                mergeCtx={{
                  clientName: 'Jane Smith',
                  businessName: 'Your Business',
                  proposalTitle: name,
                  totalCents: null,
                  subtotalCents: null,
                  taxCents: null,
                  currency: null,
                  proposalDate: null,
                  expiryDate: null,
                  proposalNumber: null,
                  senderName: null,
                  senderEmail: null,
                  clientEmail: null,
                }}
                enforceCanonical={false}
                previewMode={true}
              />
            </div>
          ) : (
            <div
              className="flex-1 overflow-y-auto"
              style={{ background: '#000', minWidth: 0 }}
            >
              <ProposalCanvas
                blocks={blocks}
                onChange={handleBlocksChange}
                isEditing={true}
              />
            </div>
          )}
          {!showPreview && (
            <BlockPalette
              onAddBlock={handlePaletteAdd}
              defaultLineItems={defaultLineItems}
              onDefaultLineItemsChange={(items) => {
                setDefaultLineItems(items);
                setSaved(false);
                if (!isNew) {
                  updateMut
                    .mutateAsync({
                      id: id!,
                      name,
                      structure: { blocks, theme: activeTheme },
                      defaultLineItems: items,
                    })
                    .then(() => setSaved(true))
                    .catch(() => {});
                }
              }}
            />
          )}
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {draggingType && <DragGhost label={draggingLabel} />}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
