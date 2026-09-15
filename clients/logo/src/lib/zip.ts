/**
 * A minimal ZIP writer for the browser.
 *
 * Hand-rolled rather than pulled from a package because the whole job is one
 * container format plus a checksum: the actual compression is `CompressionStream`,
 * which every browser this app supports ships natively. That keeps a
 * download-a-folder-of-logos feature from adding a dependency to the bundle.
 *
 * Store-only (method 0) is the fallback when `CompressionStream` is missing. The
 * archive is still valid — PNGs are internally deflated already, so the only cost
 * is on the SVG text.
 *
 * Deliberately not zip64: a logo suite is a few megabytes, and the 4 GB / 65,535
 * entry limits of the classic format are unreachable here.
 */

export interface ZipEntry {
  /** Path inside the archive — forward slashes make folders (`svg/mark.svg`). */
  path: string;
  data: Uint8Array;
}

/* ── CRC-32 (IEEE 802.3), the checksum every zip entry carries ───────────── */

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── DEFLATE via the platform ────────────────────────────────────────────── */

type CompressionStreamCtor = new (format: 'deflate-raw') => TransformStream<
  Uint8Array,
  Uint8Array
>;

/**
 * Read off `globalThis` rather than relying on the ambient DOM types: the API is
 * newer than some of the lib definitions in play, and a feature this optional
 * shouldn't be a typecheck problem.
 */
const CompressionStreamCtor = (globalThis as { CompressionStream?: CompressionStreamCtor })
  .CompressionStream;

/** Raw-deflate `data`, or null when the platform can't (caller then stores it). */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (!CompressionStreamCtor) return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(
      new CompressionStreamCtor('deflate-raw'),
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/* ── the container ───────────────────────────────────────────────────────── */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 11 — the entry names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** MS-DOS date/time, the only timestamp the classic header has room for. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Build the archive. Parts are collected as separate buffers and handed to one
 * `Blob` at the end — concatenating megabytes of `Uint8Array` by hand would copy
 * the whole archive again for no gain.
 */
export async function zipBlob(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const stamp = dosStamp(new Date());
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const deflated = await deflateRaw(entry.data);
    // Storing wins whenever deflate didn't actually help (tiny or already-packed
    // payloads), and it keeps the archive smaller than "compressed" would.
    const useDeflate = !!deflated && deflated.length < entry.data.length;
    const body = useDeflate ? deflated! : entry.data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_SIG, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, FLAG_UTF8, true);
    local.setUint16(8, method, true);
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length
    parts.push(local.buffer, name, body as BlobPart);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, CENTRAL_SIG, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, FLAG_UTF8, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, stamp.time, true);
    dir.setUint16(14, stamp.date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, entry.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true); // extra
    dir.setUint16(32, 0, true); // comment
    dir.setUint16(34, 0, true); // disk number
    dir.setUint16(36, 0, true); // internal attrs
    dir.setUint32(38, 0, true); // external attrs
    dir.setUint32(42, offset, true); // offset of the local header
    central.push(dir.buffer, name);

    offset += 30 + name.length + body.length;
  }

  const centralSize = central.reduce(
    (n, p) => n + (p instanceof ArrayBuffer ? p.byteLength : (p as Uint8Array).length),
    0,
  );
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, EOCD_SIG, true);
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // disk with the central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true); // archive comment length

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
