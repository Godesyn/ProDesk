/**
 * SavedSignaturesPanel — Save, load, and manage signature workspaces
 * Design: Warm Craft Studio
 */

import { useState } from 'react';
import { Save, Trash2, FolderOpen, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  loadSavedSignatures,
  saveSignature,
  deleteSavedSignature,
  renameSavedSignature,
  type SignatureData,
  type SavedSignature,
} from '@/lib/signatureTypes';
import type { HistoryEnvelope } from '@/hooks/useUndoRedoState';
import { toast } from 'sonner';
import { useConfirm } from '@shared/components/ui/confirm-dialog';

interface SavedSignaturesPanelProps {
  current: SignatureData;
  /** Called when the user wants to switch to a workspace. Provides the envelope (or flat data for legacy entries). */
  onLoad: (
    data: SignatureData,
    envelope?: HistoryEnvelope<SignatureData>,
  ) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called to set the active workspace ID. */
  onLoadPresetId: (id: string | null) => void;
  /** The currently active workspace ID. */
  lastLoadedPresetId: string | null;
  /** Get the current undo/redo envelope so "Save as new" can copy the stack. */
  getEnvelope: () => HistoryEnvelope<SignatureData>;
}

export function SavedSignaturesPanel({
  current,
  onLoad,
  open,
  onOpenChange,
  onLoadPresetId,
  lastLoadedPresetId,
  getEnvelope,
}: SavedSignaturesPanelProps) {
  const [saveName, setSaveName] = useState('');
  const [saved, setSaved] = useState<SavedSignature[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const confirm = useConfirm();

  const refresh = () => setSaved(loadSavedSignatures());

  const handleOpen = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (isOpen) {
      refresh();
      setEditingId(null);
    }
  };

  const handleSave = () => {
    const name =
      saveName.trim() || `Signature ${new Date().toLocaleDateString()}`;
    // Copy the current undo/redo stack into the new workspace
    const envelope = getEnvelope();
    const entry = saveSignature(name, current, envelope);
    onLoadPresetId(entry.id);
    setSaveName('');
    refresh();
    toast.success(`"${name}" saved successfully`);
  };

  const handleLoad = (sig: SavedSignature) => {
    // Load with the workspace's envelope if available, otherwise just the flat data
    onLoad(sig.data, sig.envelope);
    onLoadPresetId(sig.id);
    onOpenChange(false);
    toast.success(`Loaded "${sig.name}"`);
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Saved State',
      description: `Are you sure you want to delete the saved signature "${name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    deleteSavedSignature(id);
    if (id === lastLoadedPresetId) {
      onLoadPresetId(null);
    }
    refresh();
    toast.info(`"${name}" deleted`);
  };

  const handleRename = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      renameSavedSignature(id, trimmed);
      refresh();
      toast.success(`Signature renamed to "${trimmed}"`);
    }
    setEditingId(null);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <FolderOpen className="w-3.5 h-3.5" />
          Saved
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Saved Signatures</DialogTitle>
        </DialogHeader>

        {/* Save current */}
        <div className="flex gap-2 pt-1">
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name this signature…"
            className="h-8 text-sm bg-white"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <Button
            size="sm"
            className="h-8 gap-1.5 flex-shrink-0 bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold text-xs px-3"
            onClick={handleSave}
          >
            <Save className="w-3.5 h-3.5" />
            Save as new
          </Button>
        </div>

        {/* Saved list */}
        <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar mt-2">
          {saved.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No saved signatures yet
            </div>
          ) : (
            saved.map((sig) => (
              <div
                key={sig.id}
                className={`flex items-center justify-between p-3 rounded-sm border transition-colors ${
                  sig.id === lastLoadedPresetId
                    ? 'border-accent/50 bg-accent/5'
                    : 'border-border bg-muted/40 hover:bg-muted/70'
                }`}
              >
                <div className="flex-1 min-w-0 pr-2">
                  {editingId === sig.id ? (
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleRename(sig.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(sig.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="h-7 text-xs py-0.5 px-2 bg-white"
                      autoFocus
                    />
                  ) : (
                    <div
                      className="text-sm font-medium text-foreground truncate cursor-pointer hover:underline decoration-dashed"
                      onClick={() => {
                        setEditingId(sig.id);
                        setEditingName(sig.name);
                      }}
                      title="Click to rename"
                    >
                      {sig.id === lastLoadedPresetId && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-1.5 translate-y-[-1px]" />
                      )}
                      {sig.name}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {formatDate(sig.savedAt)} · {sig.data.template}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {sig.id !== lastLoadedPresetId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2"
                      onClick={() => handleLoad(sig)}
                    >
                      Open
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(sig.id, sig.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
