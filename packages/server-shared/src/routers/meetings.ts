import { z } from 'zod';
import { eq, count, desc } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { meetings, users, services } from '../db/schema.js';
import { paginationInput, page } from '../lib/pagination.js';
import {
  buildAuthUrl,
  exchangeCode,
  calendarConfigured,
  getValidAccessToken,
  queryFreeBusy,
  insertMeetingEvent,
  revokeToken,
} from '../modules/calendar/google.js';

interface ServiceStaff {
  userId: string;
  name?: string;
  workingDays?: number[];
  startTime?: string;
  endTime?: string;
  timezone?: string;
}

const DEFAULT_REDIRECT = (origin: string) =>
  `${origin}/profile?calendar_callback=true`;

export const meetingsRouter = router({
  /** Meetings for an agency, brand, or the current user as assignee. */
  list: protectedProcedure
    .input(
      paginationInput.extend({
        agencyId: z.string().uuid().optional(),
        brandId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = input.agencyId
        ? eq(meetings.agencyId, input.agencyId)
        : input.brandId
          ? eq(meetings.brandId, input.brandId)
          : eq(meetings.assigneeUserId, ctx.user.id);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select()
          .from(meetings)
          .where(scope)
          .orderBy(desc(meetings.startTime))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(meetings).where(scope),
      ]);
      return page(rows, total, input);
    }),

  /* ── Google Calendar linking ───────────────────────────────────────────── */

  /** Whether Google Calendar OAuth is available + the consent URL to open. */
  calendarAuthUrl: protectedProcedure
    .input(z.object({ redirectUri: z.string().optional() }).optional())
    .query(({ ctx, input }) => {
      if (!calendarConfigured())
        return { configured: false, url: null as string | null };
      const redirect =
        input?.redirectUri ?? DEFAULT_REDIRECT(ctx.clientOrigin);
      return { configured: true, url: buildAuthUrl(redirect) };
    }),

  /** Exchange the OAuth code and store the tokens (linkGoogleCalendar). */
  linkCalendar: protectedProcedure
    .input(z.object({ code: z.string(), redirectUri: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const redirect = input.redirectUri ?? DEFAULT_REDIRECT(ctx.clientOrigin);
      const tokens = await exchangeCode(input.code, redirect);
      if (!tokens.refreshToken) {
        // Google only returns a refresh token on first consent; force re-consent.
        throw new Error(
          'No refresh token returned — revoke Prodesk access in your Google account and try again.',
        );
      }
      const [updated] = await ctx.db
        .update(users)
        .set({ googleCalendarLinked: true, googleCalendarToken: tokens })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /** Unlink Google Calendar and revoke the token. */
  unlinkCalendar: protectedProcedure.mutation(async ({ ctx }) => {
    const refresh = ctx.user.googleCalendarToken?.refreshToken;
    if (refresh) await revokeToken(refresh);
    const [updated] = await ctx.db
      .update(users)
      .set({ googleCalendarLinked: false, googleCalendarToken: null })
      .where(eq(users.id, ctx.user.id))
      .returning();
    return updated;
  }),

  /** Legacy flag toggle (kept for compatibility — prefer linkCalendar/unlinkCalendar). */
  setCalendarLinked: protectedProcedure
    .input(z.object({ linked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ googleCalendarLinked: input.linked })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /**
   * Available 30-min meeting slots for a service across its assigned staff,
   * intersecting each staff member's working hours with their Google freebusy.
   * Ports get_available_slots.ts.
   */
  availableSlots: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().uuid(),
        startDate: z.string(),
        endDate: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const service = (
        await ctx.db
          .select()
          .from(services)
          .where(eq(services.id, input.serviceId))
          .limit(1)
      )[0];
      if (!service) return { slots: [] as Slot[] };
      const staff = (service.assignedStaff ?? []) as ServiceStaff[];
      if (!staff.length || !calendarConfigured())
        return { slots: [] as Slot[] };

      const durationMin = 30;
      const now = new Date();
      const all: Slot[] = [];
      for (const s of staff) {
        try {
          const token = await getValidAccessToken(s.userId, ctx.db);
          if (!token) continue;
          const busy = await queryFreeBusy(
            token,
            new Date(`${input.startDate}T00:00:00`).toISOString(),
            new Date(`${input.endDate}T23:59:59`).toISOString(),
            s.timezone ?? 'UTC',
          );
          for (const slot of generateSlots(
            input.startDate,
            input.endDate,
            s,
            durationMin,
            now,
          )) {
            const sStart = new Date(slot.isoStart);
            const sEnd = new Date(`${slot.date}T${slot.endTime}:00`);
            const isBusy = busy.some(
              (b) => sStart < new Date(b.end) && sEnd > new Date(b.start),
            );
            if (!isBusy)
              all.push({
                ...slot,
                assigneeUserId: s.userId,
                assigneeName: s.name,
              });
          }
        } catch {
          /* skip staff we can't read */
        }
      }
      const unique = new Map<string, Slot>();
      for (const s of all)
        if (!unique.has(s.isoStart)) unique.set(s.isoStart, s);
      return {
        slots: [...unique.values()].sort((a, b) =>
          a.isoStart.localeCompare(b.isoStart),
        ),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().uuid().optional(),
        agencyId: z.string().uuid(),
        brandId: z.string().uuid(),
        assigneeUserId: z.string().uuid(),
        startTime: z.date(),
        endTime: z.date(),
        serviceName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve display names so the meeting record carries them (mirrors
      // create_meeting.ts which denormalizes assigneeName + brandUserName).
      const assignee = (
        await ctx.db
          .select()
          .from(users)
          .where(eq(users.id, input.assigneeUserId))
          .limit(1)
      )[0];
      const assigneeName = assignee
        ? [assignee.firstName, assignee.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Meeting Host'
        : 'Meeting Host';
      const brandUserName =
        [ctx.user.firstName, ctx.user.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || ctx.user.email;

      // Create the Google Calendar event + Meet link on the assignee's calendar.
      let googleEventId: string | null = null;
      let meetUrl: string | null = null;
      if (calendarConfigured()) {
        try {
          const token = await getValidAccessToken(input.assigneeUserId, ctx.db);
          if (token) {
            const ev = await insertMeetingEvent(token, {
              summary: `Meeting: ${input.serviceName ?? 'Prodesk service'}`,
              description: `Booked via Prodesk by ${brandUserName} (${ctx.user.email}).`,
              startIso: input.startTime.toISOString(),
              endIso: input.endTime.toISOString(),
              timeZone: 'UTC',
              attendeeEmail: ctx.user.email,
              attendeeName: brandUserName || undefined,
            });
            googleEventId = ev.eventId;
            meetUrl = ev.meetUrl;
          }
        } catch (err) {
          console.error(
            '[meetings] calendar event creation failed',
            (err as Error).message,
          );
        }
      }
      const [m] = await ctx.db
        .insert(meetings)
        .values({
          ...input,
          brandUserId: ctx.user.id,
          brandUserEmail: ctx.user.email,
          brandUserName,
          assigneeName,
          status: 'scheduled',
          googleEventId,
          meetUrl,
        })
        .returning();
      return m;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db
        .update(meetings)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(meetings.id, input.id))
        .returning();
      return m;
    }),
});

export interface Slot {
  date: string;
  startTime: string;
  endTime: string;
  isoStart: string;
  assigneeUserId?: string;
  assigneeName?: string;
}

/** Generate working-hour slots for a staff member across a date range. */
function generateSlots(
  startDate: string,
  endDate: string,
  staff: ServiceStaff,
  durationMin: number,
  now: Date,
): Slot[] {
  const slots: Slot[] = [];
  const workingDays = staff.workingDays ?? [1, 2, 3, 4, 5];
  const [startH, startM] = (staff.startTime ?? '09:00').split(':').map(Number);
  const [endH, endM] = (staff.endTime ?? '17:00').split(':').map(Number);
  const end = new Date(endDate);
  for (let d = new Date(startDate); d <= end; d.setDate(d.getDate() + 1)) {
    const isoDay = d.getDay() === 0 ? 7 : d.getDay();
    if (!workingDays.includes(isoDay)) continue;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let h = startH;
    let m = startM;
    while (h < endH || (h === endH && m < endM)) {
      let eh = h;
      let em = m + durationMin;
      while (em >= 60) {
        eh++;
        em -= 60;
      }
      if (eh > endH || (eh === endH && em > endM)) break;
      const startStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const endStr = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      const isoStart = `${dateStr}T${startStr}:00`;
      if (new Date(isoStart) > now)
        slots.push({
          date: dateStr,
          startTime: startStr,
          endTime: endStr,
          isoStart,
        });
      m += durationMin;
      while (m >= 60) {
        h++;
        m -= 60;
      }
    }
  }
  return slots;
}
