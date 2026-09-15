import { ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { UploadButton } from '../upload-button';
import { StorageBucket } from '../../lib/storage-buckets';
import { Field } from '../../pages/agency/form-bits';
import { SectionHeader, InputLabel } from './section-header';

/**
 * Cover-image + promotional-video block (ports `MediaAssetsSection`). Stores a
 * cover `imageUrl` and a `videoUrl` (pasted YouTube link or uploaded file).
 */
export function MediaAssetsSection({
  pathPrefix,
  imageUrl,
  videoUrl,
  videoError,
  onImage,
  onRemoveImage,
  onVideoUrl,
}: {
  pathPrefix: string;
  imageUrl: string;
  videoUrl: string;
  videoError?: string | null;
  onImage: (url: string) => void;
  onRemoveImage: () => void;
  onVideoUrl: (url: string) => void;
}) {
  const hasImage = !!imageUrl;
  return (
    <div>
      <SectionHeader title="Media Assets" />
      <InputLabel label="Cover Image" required />
      <div
        className="flex h-[200px] w-full items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-paper bg-cover bg-center"
        style={hasImage ? { backgroundImage: `url(${imageUrl})` } : undefined}
      >
        {!hasImage && (
          <div className="flex flex-col items-center text-ink-40">
            <ImageIcon className="h-12 w-12" />
            <span className="mt-2 text-sm">No image selected</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1">
          <UploadButton
            bucket={StorageBucket.Uploads}
            pathPrefix={`${pathPrefix}/images`}
            accept="image/*"
            label={hasImage ? 'Change Image' : 'Upload Image'}
            onUploaded={(url) => onImage(url)}
          />
        </div>
        {hasImage && (
          <Button type="button" size="icon" variant="ghost" onClick={onRemoveImage} aria-label="Remove image">
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        )}
      </div>

      <div className="mt-6 flex items-end gap-3">
        <div className="flex-[2]">
          <Field label="Promotional Video URL" error={videoError}>
            <Input value={videoUrl} placeholder="https://youtube.com/..." onChange={(e) => onVideoUrl(e.target.value)} />
          </Field>
        </div>
        <div className="flex-1">
          <UploadButton
            bucket={StorageBucket.Uploads}
            pathPrefix={`${pathPrefix}/videos`}
            accept="video/*"
            label="Upload Video File"
            onUploaded={(url) => onVideoUrl(url)}
          />
        </div>
      </div>
    </div>
  );
}
