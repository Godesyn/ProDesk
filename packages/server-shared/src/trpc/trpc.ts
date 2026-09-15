import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const zodError = error.cause instanceof ZodError ? error.cause.flatten() : null;
    // tRPC's default `shape.message` for an input-validation error is the raw
    // stringified ZodError (it renders as JSON in the UI). Replace it with the
    // first human-readable form/field issue so clients can display it directly,
    // while still exposing the structured `zodError` for field-level handling.
    let message = shape.message;
    if (zodError) {
      const firstField = Object.values(zodError.fieldErrors).flat().find((m): m is string => !!m);
      message = zodError.formErrors[0] ?? firstField ?? message;
    }
    return {
      ...shape,
      message,
      data: { ...shape.data, zodError },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

/**
 * Requires only a valid Supabase session. The app `users` row may not exist
 * yet — use this for provisioning endpoints (e.g. ensureUser) that run right
 * after sign-up, before the row is created.
 */
const hasSession = middleware(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export const sessionProcedure = t.procedure.use(hasSession);

/** Requires a valid Supabase session AND an existing app user row. */
const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.auth || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(isAuthed);

/** Restrict to platform admins. */
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});
