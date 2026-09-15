import { supabase } from './supabase';
import { compressImage } from './image';
import { compressVideo } from './video-compress';
import { trpcVanilla } from './trpc';
import { StorageBucket } from './storage-buckets';

// Generous on purpose: `kindOf` decides whether something gets an inline
// preview or a file card, and a photo straight off an iPhone (.heic) or a
// screen recording (.m4v) landing in the "document" bucket is a picture the
// recipient has to download to see. Anything genuinely unknown still falls
// through to 'document', which renders and downloads correctly — the list only
// ever ADDS previews, it never gates what can be sent.
const IMAGE_EXT = [
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'svg', 'avif',
  'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif',
];
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'avi', 'mkv', 'ogv', '3gp', 'mpeg', 'mpg'];

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export type UploadKind = 'image' | 'video' | 'document';
export function kindOf(name: string): UploadKind {
  const ext = extensionOf(name);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'document';
}

/** Phase of an in-flight upload, for progress UI. */
export type UploadPhase = 'compressing' | 'uploading' | 'done';
export interface UploadProgress {
  phase: UploadPhase;
  /** 0→1. Determinate during `compressing`; 0 (indeterminate) during `uploading`; 1 when `done`. */
  progress: number;
}

interface UploadOptions {
  /** Overwrite an existing object at the same path. */
  upsert?: boolean;
  /** Use `path` verbatim instead of appending a unique `uuid_filename`. */
  exactPath?: boolean;
  /** Skip image/video compression (e.g. for assets that must keep their exact bytes). */
  noCompress?: boolean;
  /** Progress callback for compression + upload phases (drives the progress UI). */
  onProgress?: (p: UploadProgress) => void;
}

/**
 * The single entry point for every client upload. Compresses images and videos,
 * uploads to Supabase Storage, and — if the bucket doesn't exist yet — asks the
 * server to create it (the client can't) and retries once. Enqueues server-side
 * video transcoding (faststart + thumbnail) for video files. Reports compression
 * and upload progress via `opts.onProgress`. Returns the object's public URL.
 */
export async function uploadFile(bucket: StorageBucket, pathPrefix: string, input: File, opts: UploadOptions = {}): Promise<string> {
  const kind = kindOf(input.name);
  let file: File;
  if (opts.noCompress) {
    file = input;
  } else if (kind === 'video') {
    // Client-side compression — the slow part — reports determinate progress.
    opts.onProgress?.({ phase: 'compressing', progress: 0 });
    file = await compressVideo(input, (progress) => opts.onProgress?.({ phase: 'compressing', progress }));
  } else if (kind === 'image') {
    file = await compressImage(input);
  } else {
    file = input;
  }

  // Supabase's JS SDK exposes no upload-progress events, so the upload phase is
  // indeterminate (progress 0) — the UI shows a spinner / "Uploading…" for it.
  opts.onProgress?.({ phase: 'uploading', progress: 0 });
  const path = opts.exactPath ? pathPrefix : `${pathPrefix.replace(/\/$/, '')}/${crypto.randomUUID()}_${file.name}`;
  const store = () => supabase.storage.from(bucket);

  const doUpload = () => store().upload(path, file, { upsert: opts.upsert ?? false, contentType: file.type || undefined });
  let { error } = await doUpload();
  if (error && /bucket not found|not.*found|does not exist/i.test(error.message)) {
    // Bucket missing — have the server create it (secret key), then retry once.
    await trpcVanilla().media.ensureBucket.mutate({ bucket }).catch(() => {});
    ({ error } = await doUpload());
  }
  if (error) throw new Error(error.message);

  // Kick off server-side faststart optimization + thumbnail for videos.
  if (kindOf(file.name) === 'video') {
    trpcVanilla().media.enqueueVideoTranscode.mutate({ bucket, path }).catch(() => {});
  }

  opts.onProgress?.({ phase: 'done', progress: 1 });
  return store().getPublicUrl(path).data.publicUrl;
}
