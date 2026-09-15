/**
 * Client-side video compression before upload — the web counterpart of the
 * Flutter `UploadUtils.compressVideo` step (which runs FFmpeg on web and reports
 * a 0→1 progress stream). Uses ffmpeg.wasm (single-threaded core, so no
 * cross-origin-isolation / SharedArrayBuffer requirement), lazily loaded so it
 * never weighs down the initial bundle.
 *
 * Mirrors the Flutter encode settings: H.264 `-preset ultrafast -crf 24`, scaled
 * to a max 720p-ish width, with faststart for progressive playback.
 *
 * BEST-EFFORT: every failure path (core won't load, codec missing, timeout, no
 * size win) falls back to the original file, exactly like Flutter returns the
 * original bytes on mobile. Compression must never block an upload.
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg';

// Single-threaded core (no SharedArrayBuffer / COOP-COEP needed). Loaded as blob
// URLs via @ffmpeg/util so the worker has no cross-origin issues.
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

/** Don't spin up the (heavy) wasm runtime for clips that are already small. */
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;
/** Hard ceiling — if an encode runs longer than this, bail and upload raw. */
const COMPRESS_TIMEOUT_MS = 4 * 60 * 1000;

let ffmpegPromise: Promise<FFmpeg | null> | null = null;

/** Lazily load + initialise a shared FFmpeg instance. Returns null on failure. */
async function getFFmpeg(): Promise<FFmpeg | null> {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ff = new FFmpeg();
      await ff.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ff;
    } catch (e) {
      console.warn('[video-compress] ffmpeg unavailable; videos will upload uncompressed', e);
      ffmpegPromise = null; // allow a later retry
      return null;
    }
  })();
  return ffmpegPromise;
}

// ffmpeg.wasm runs one exec at a time on the shared instance — serialise so
// concurrent uploads don't trample each other's virtual filesystem.
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

/**
 * Compress a video file. Reports progress (0→1) via [onProgress]. Returns a new
 * (smaller) `File` on success, or the original `File` on any failure / no win.
 */
export async function compressVideo(file: File, onProgress?: (progress: number) => void): Promise<File> {
  if (file.size < SKIP_BELOW_BYTES) return file;

  const ff = await getFFmpeg();
  if (!ff) return file;

  return withLock(async () => {
    const { fetchFile } = await import('@ffmpeg/util');
    const inName = `in_${crypto.randomUUID()}.${(file.name.split('.').pop() || 'mp4').toLowerCase()}`;
    const outName = `out_${crypto.randomUUID()}.mp4`;
    const onProg = ({ progress }: { progress: number }) => onProgress?.(Math.min(0.99, Math.max(0, progress)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    try {
      ff.on('progress', onProg);
      await ff.writeFile(inName, await fetchFile(file));

      const exec = ff.exec([
        '-i', inName,
        // Cap width at 1280 (≈720p), keep aspect, force even dims for H.264.
        '-vf', "scale='min(1280,iw)':-2",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outName,
      ]);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('compression timed out'));
        }, COMPRESS_TIMEOUT_MS);
      });
      await Promise.race([exec, timeout]);

      const data = (await ff.readFile(outName)) as Uint8Array;
      if (!data || data.byteLength === 0 || data.byteLength >= file.size) return file; // no win → keep original

      onProgress?.(1);
      const name = file.name.replace(/\.[^.]+$/, '') + '.mp4';
      // Copy into a fresh (non-shared) ArrayBuffer so it's a valid BlobPart.
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      return new File([bytes], name, { type: 'video/mp4' });
    } catch (e) {
      console.warn('[video-compress] failed; uploading original', e);
      // A timed-out instance may be wedged — drop it so the next call reloads.
      if (timedOut) {
        try {
          ff.terminate();
        } catch {
          /* ignore */
        }
        ffmpegPromise = null;
      }
      return file;
    } finally {
      if (timer) clearTimeout(timer);
      try {
        ff.off('progress', onProg);
      } catch {
        /* ignore */
      }
      if (!timedOut) {
        await ff.deleteFile(inName).catch(() => {});
        await ff.deleteFile(outName).catch(() => {});
      }
    }
  });
}
