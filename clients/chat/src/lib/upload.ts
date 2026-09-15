import { uploadFile, kindOf, type UploadProgress } from '@shared/lib/storage';
import { StorageBucket } from '@shared/lib/storage-buckets';
import { rememberAspect } from '@shared/lib/media-size';

/**
 * Attachments.
 *
 * A thin layer over the shared uploader, which self-heals a missing bucket and
 * reports progress. What this adds is the two things a messenger needs and a
 * generic uploader doesn't: a name for pasted blobs, and a per-file progress
 * record the composer tray can render.
 *
 * NOTHING IS RE-ENCODED. The shared uploader's default is to downscale images to
 * 1600px and re-encode them as WebP at quality 0.82, and to run videos through
 * ffmpeg.wasm at 720p/CRF 24. That is the right default for an avatar or a
 * project thumbnail and the wrong one for a conversation: what people send each
 * other here is evidence — a screenshot someone has to read text off, a photo of
 * a document, a design at the resolution it was exported at — and a messenger
 * that silently degrades it is destroying the only copy the recipient will ever
 * see. So every chat upload passes `noCompress`, and the bytes that arrive are
 * the bytes that were sent.
 *
 * The server-side video step still runs and is deliberately kept: it is an
 * `-c copy` faststart REMUX (see modules/media/transcode.ts), which moves the
 * moov atom so a long clip starts playing before it has finished downloading. It
 * copies the streams rather than re-encoding them, so it costs nothing in
 * quality.
 */

export type Attachment = {
  /** Local id, so the tray can track a file before it has a URL. */
  id: string;
  file: File;
  kind: 'image' | 'video' | 'document';
  /** Object URL for the local preview. Revoked when the attachment is dropped. */
  previewUrl: string | null;
  phase: 'queued' | 'uploading' | 'done' | 'failed';
  percent: number;
  url: string | null;
  error: string | null;
};

/**
 * Files larger than this are refused before anything is sent.
 *
 * Higher than it was, because originals are bigger than re-encodes: a 12MP phone
 * photo is ~5MB and a minute of 4K is well past what a 720p transcode would have
 * produced. The ceiling exists so a mis-drag of a disk image fails immediately
 * and locally instead of after a five-minute upload.
 */
export const MAX_ATTACHMENT_BYTES = 250 * 1024 * 1024;

/**
 * A pasted image arrives as a blob named `image.png` or with no name at all, so
 * every screenshot in a thread would be called the same thing. Stamp it instead.
 */
export function nameForPaste(file: File): File {
  if (file.name && file.name !== 'image.png' && file.name !== 'blob') return file;
  const ext = file.type.split('/')[1]?.split('+')[0] || 'png';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([file], `pasted-${stamp}.${ext}`, { type: file.type });
}

export function toAttachment(file: File): Attachment {
  // By MIME type first, extension second. A file dragged out of a camera roll or
  // a screenshot tool routinely arrives with an unhelpful name and a correct
  // type, and a photo classified as a "document" gets a file card instead of a
  // picture. Extension is the fallback for the reverse case — a download with no
  // type at all, which is most of what a browser hands over on Windows.
  const kind = kindFor(file);
  return {
    id: crypto.randomUUID(),
    file,
    kind,
    // Video gets a local preview too: the tray can then show the actual first
    // frame of the clip you just attached rather than a paperclip.
    previewUrl: kind === 'document' ? null : URL.createObjectURL(file),
    phase: 'queued',
    percent: 0,
    url: null,
    error: null,
  };
}

/** Image / video / everything else, from the MIME type where there is one. */
export function kindFor(file: File): 'image' | 'video' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return kindOf(file.name) as 'image' | 'video' | 'document';
}

export function releaseAttachment(attachment: Attachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

/**
 * Upload one attachment into the chat bucket under its thread.
 *
 * The path prefix is the raw threadId, matching what the workspace chat already
 * writes, so both surfaces share one object layout: `chat-files/<threadId>/…`.
 */
export async function uploadAttachment(
  threadId: string,
  attachment: Attachment,
  onProgress: (patch: Partial<Attachment>) => void,
): Promise<string> {
  if (attachment.file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('That file is too large to send.');
  }
  onProgress({ phase: 'uploading', percent: 0 });
  const url = await uploadFile(StorageBucket.Chat, threadId, attachment.file, {
    // The whole point — see this module's header. Without it the uploader
    // re-encodes images to WebP at 1600px and videos to 720p.
    noCompress: true,
    onProgress: (p: UploadProgress) => {
      // There is no compression phase left to report, so everything that isn't
      // 'done' is the upload. `progress` is 0..1; the tray renders a percentage.
      onProgress({ phase: 'uploading', percent: Math.round((p.progress ?? 0) * 100) });
    },
  });
  onProgress({ phase: 'done', percent: 100, url });
  // The sender's copy is already decoded in this tab, so hand its shape to the
  // transcript before the sent message renders — that is the difference between
  // a bubble that appears at its final height and one that grows into it and
  // pushes the conversation around. Best-effort by design.
  if (attachment.previewUrl && attachment.kind !== 'document') {
    void measureAspect(attachment.previewUrl, attachment.kind).then((ratio) => {
      if (ratio) rememberAspect(url, ratio);
    });
  }
  return url;
}

/** Width ÷ height of a local object URL, or null if it cannot be read. */
function measureAspect(objectUrl: string, kind: 'image' | 'video'): Promise<number | null> {
  return new Promise((resolve) => {
    // Two-second ceiling: this is an optimisation, and one that must never keep
    // an element (or a listener) alive behind a file the browser cannot decode.
    const done = (ratio: number | null) => {
      clearTimeout(timer);
      resolve(ratio);
    };
    const timer = setTimeout(() => done(null), 2_000);

    if (kind === 'image') {
      const img = new Image();
      img.onload = () => done(img.naturalWidth / img.naturalHeight || null);
      img.onerror = () => done(null);
      img.src = objectUrl;
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(video.videoWidth / video.videoHeight || null);
    video.onerror = () => done(null);
    video.src = objectUrl;
  });
}

/** The message `type` a given attachment should be sent as. */
export function messageTypeFor(attachment: Attachment): 'image' | 'video' | 'document' {
  return attachment.kind;
}
