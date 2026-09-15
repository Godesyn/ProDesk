import { uploadFile, extensionOf, type UploadProgress } from '../../lib/storage';
import { StorageBucket } from '../../lib/storage-buckets';

/** Deliverable types are image|document; videos are stored as documents. */
export type UploadKind = 'image' | 'document';
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
export function kindOf(name: string): UploadKind {
  return IMAGE_EXT.includes(extensionOf(name)) ? 'image' : 'document';
}
export { extensionOf };

/** Upload a project file via the unified upload service; returns its public URL. */
export function uploadProjectFile(
  projectId: string,
  folder: string,
  input: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<string> {
  return uploadFile(StorageBucket.Projects, `projects/${projectId}/${folder}`, input, { onProgress });
}
