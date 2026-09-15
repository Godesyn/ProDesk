import { z } from 'zod';

/** Standard offset-based pagination input for list endpoints. */
export const paginationInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  search: z.string().trim().optional(),
});

export type PaginationInput = z.infer<typeof paginationInput>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function page<T>(items: T[], total: number, input: { limit: number; offset: number }): Page<T> {
  return {
    items,
    total,
    limit: input.limit,
    offset: input.offset,
    hasMore: input.offset + items.length < total,
  };
}
