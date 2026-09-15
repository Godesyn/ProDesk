import { uploadFile, extensionOf } from '../../lib/storage';
import { StorageBucket } from '../../lib/storage-buckets';

/** Upload a brand-scoped file (logo, document, SPOT media); returns its public URL. */
export function uploadBrandFile(brandId: string, folder: string, input: File): Promise<string> {
  return uploadFile(StorageBucket.Brands, `brands/${brandId}/${folder}`, input);
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
export function fileTypeOf(name: string): string {
  const ext = extensionOf(name);
  return IMAGE_EXT.includes(ext) ? 'image' : ext || 'file';
}
