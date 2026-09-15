import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import ffmpeg from 'fluent-ffmpeg';
import { supabaseAdmin } from '../../lib/supabase.js';

const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];

// Point fluent-ffmpeg at the bundled static binary (@ffmpeg-installer/ffmpeg
// ships a prebuilt binary per platform). Loaded via createRequire since the
// package has no ESM types. If it's missing (e.g. unsupported platform),
// transcode falls back to the system ffmpeg on PATH.
let ffmpegReady = true;
try {
  const req = createRequire(import.meta.url);
  const installer = req('@ffmpeg-installer/ffmpeg') as { path: string };
  ffmpeg.setFfmpegPath(installer.path);
} catch (e) {
  console.warn('[video] @ffmpeg-installer/ffmpeg not found — relying on system ffmpeg:', (e as Error).message);
  ffmpegReady = false;
}

/**
 * Optimize an uploaded video in Supabase Storage: apply `faststart` (move the
 * moov atom to the front for streaming) and generate a thumbnail, then re-upload
 * both. Ports functions/src/modules/system/process_video.ts. Idempotent + best-
 * effort — failures are logged, never thrown.
 */
export async function transcodeVideo(opts: { bucket: string; path: string }): Promise<{ optimized: boolean }> {
  const ext = path.extname(opts.path).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) return { optimized: false };
  void ffmpegReady;

  const store = supabaseAdmin.storage.from(opts.bucket);
  const fileName = path.basename(opts.path);
  const tmpIn = path.join(os.tmpdir(), `pd_${crypto.randomUUID()}_${fileName}`);
  const tmpOut = path.join(os.tmpdir(), `pd_opt_${crypto.randomUUID()}_${fileName}`);
  const tmpThumb = path.join(os.tmpdir(), `pd_thumb_${crypto.randomUUID()}.jpg`);

  try {
    const { data, error } = await store.download(opts.path);
    if (error || !data) throw new Error(error?.message ?? 'download failed');
    fs.writeFileSync(tmpIn, Buffer.from(await data.arrayBuffer()));

    // faststart re-mux (no re-encode → fast, lossless).
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn).outputOptions(['-c copy', '-movflags faststart']).save(tmpOut).on('end', () => resolve()).on('error', (err) => reject(err));
    });

    // First-frame thumbnail (best-effort).
    await new Promise<void>((resolve) => {
      ffmpeg(tmpIn)
        .seekInput('00:00:00')
        .outputOptions(['-vframes 1', '-vf', "crop='min(iw,ih*4/3)':'min(ih,iw*4/3)'"])
        .output(tmpThumb)
        .on('end', () => resolve())
        .on('error', () => resolve())
        .run();
    });

    await store.upload(opts.path, fs.readFileSync(tmpOut), { upsert: true, contentType: `video/${ext.slice(1)}` });
    if (fs.existsSync(tmpThumb)) {
      const thumbPath = opts.path.replace(/\.[^.]+$/, '') + '_thumbnail.jpg';
      await store.upload(thumbPath, fs.readFileSync(tmpThumb), { upsert: true, contentType: 'image/jpeg' });
    }
    return { optimized: true };
  } catch (err) {
    console.error('[video] transcode failed for', opts.path, (err as Error).message);
    return { optimized: false };
  } finally {
    for (const f of [tmpIn, tmpOut, tmpThumb]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
