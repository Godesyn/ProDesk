/**
 * Supabase Storage bucket names — the single source of truth. All client
 * uploads reference this enum so bucket names live in exactly one place.
 */
export enum StorageBucket {
  Projects = 'project-files',
  Brands = 'brand-files',
  Chat = 'chat-files',
  Resources = 'resources',
  Uploads = 'uploads',
}

/** Every bucket the app uses — handy for provisioning/checks. */
export const ALL_BUCKETS: StorageBucket[] = Object.values(StorageBucket);
