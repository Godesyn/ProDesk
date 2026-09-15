import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { uploadFile, type UploadProgress } from '../lib/storage';
import { StorageBucket } from '../lib/storage-buckets';
import { UploadProgressBar } from './upload-progress';

/**
 * Reusable "pick a file → upload to Supabase Storage → return its URL" button.
 * Routes through the unified upload service (compression + bucket auto-create +
 * video transcode). Use anywhere a form previously took a pasted file URL.
 */
export function UploadButton({
  bucket,
  pathPrefix,
  accept,
  label = 'Upload file',
  size = 'default',
  onUploaded,
}: {
  bucket: StorageBucket;
  pathPrefix: string;
  accept?: string;
  label?: string;
  size?: 'default' | 'sm';
  onUploaded: (url: string, fileName: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setProgress(null);
    try {
      const url = await uploadFile(bucket, pathPrefix, file, { onProgress: setProgress });
      onUploaded(url, file.name);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const busyLabel = progress?.phase === 'compressing' ? 'Compressing…' : 'Uploading…';

  return (
    <div className="flex flex-col gap-1.5">
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={onPick} />
      <Button type="button" variant="outline" size={size} disabled={busy} onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" /> {busy ? busyLabel : label}
      </Button>
      {busy && <UploadProgressBar progress={progress} />}
    </div>
  );
}
