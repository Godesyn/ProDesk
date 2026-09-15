import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AppFileViewer } from './app-file-viewer';
import type { AppFileType } from '../../lib/file-utils';

/**
 * App-wide imperative file previewer — the React equivalent of the Flutter
 * static helpers `AppFileViewer.show(...)` / `AppFileViewer.showMemoryPdf(...)`.
 * Mount one `<FileViewerProvider>` near the app root and any component can open
 * the full-screen viewer with a single call:
 *
 *   const { openFile } = useFileViewer();
 *   openFile({ url, title: fileName });          // by URL (auto-detects type)
 *   openMemoryPdf({ data: bytes, title: 'Invoice' }); // in-memory PDF bytes
 */
export interface OpenFileInput {
  url: string;
  title: string;
  /** Override auto-detection (matches the Flutter `fileType` param). */
  fileType?: AppFileType;
  /** When provided, the viewer header name becomes click-to-rename; the callback
   *  persists the new name (e.g. files.rename). Omit for read-only viewing. */
  onRename?: (name: string) => void | Promise<void>;
}

export interface OpenMemoryPdfInput {
  data: Uint8Array | Blob;
  title: string;
}

interface FileViewerContextValue {
  openFile: (input: OpenFileInput) => void;
  openMemoryPdf: (input: OpenMemoryPdfInput) => void;
  close: () => void;
}

interface ViewerState {
  url: string;
  title: string;
  fileType?: AppFileType;
  memoryPdf?: Uint8Array | Blob | null;
  onRename?: (name: string) => void | Promise<void>;
}

const FileViewerContext = createContext<FileViewerContextValue | null>(null);

export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState | null>(null);

  const openFile = useCallback((input: OpenFileInput) => {
    setState({ url: input.url, title: input.title, fileType: input.fileType, memoryPdf: null, onRename: input.onRename });
  }, []);

  const openMemoryPdf = useCallback((input: OpenMemoryPdfInput) => {
    setState({ url: '', title: input.title, fileType: 'pdf', memoryPdf: input.data });
  }, []);

  const close = useCallback(() => setState(null), []);

  const value = useMemo<FileViewerContextValue>(
    () => ({ openFile, openMemoryPdf, close }),
    [openFile, openMemoryPdf, close],
  );

  return (
    <FileViewerContext.Provider value={value}>
      {children}
      <AppFileViewer
        open={state != null}
        url={state?.url ?? ''}
        title={state?.title ?? ''}
        fileType={state?.fileType}
        memoryPdf={state?.memoryPdf}
        onRename={state?.onRename}
        onClose={close}
      />
    </FileViewerContext.Provider>
  );
}

export function useFileViewer(): FileViewerContextValue {
  const ctx = useContext(FileViewerContext);
  if (!ctx) throw new Error('useFileViewer must be used within a FileViewerProvider');
  return ctx;
}
