import { Paperclip } from 'lucide-react';
import { UploadButton } from '../upload-button';
import { StorageBucket } from '../../lib/storage-buckets';
import { InputLabel } from './section-header';

/**
 * Digital File Asset block (ports `ServiceDigitalProductSection`). Required for
 * digital-product services; stores digitalProductFileUrl/Name.
 */
export function DigitalFileAssetSection({
  pathPrefix,
  fileName,
  onUploaded,
}: {
  pathPrefix: string;
  fileName: string;
  onUploaded: (url: string, name: string) => void;
}) {
  return (
    <div>
      <InputLabel label="Digital File Asset" required />
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-inset/40 p-4">
        <Paperclip className="h-5 w-5 text-accent" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink-100">{fileName || 'No file selected'}</div>
          {!fileName && <div className="text-xs text-ink-60">Upload the file to be delivered automatically.</div>}
        </div>
        <UploadButton
          bucket={StorageBucket.Uploads}
          pathPrefix={pathPrefix}
          label="Browse"
          size="sm"
          onUploaded={onUploaded}
        />
      </div>
    </div>
  );
}
