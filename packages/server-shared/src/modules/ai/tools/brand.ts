/**
 * Brand workspace tools: profile, policies, Info Hub, documents, tasks, team, support, and new-brand creation.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { brands, files, spotComponents, tasks } from '../../../db/schema.js';
import { checkBusinessNameAvailable } from '../../../lib/business-name.js';
import { obj, BRAND_STAFF_PERMISSIONS, listBrandMembers, SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, EMAIL_RE, PROFILE_REQUESTABLE_FIELDS, CREATE_ANYWAY_PROP, findSimilarByName, similarExistsResult } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function brandTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'get_brand_policies',
        description: [
          "List THIS brand's policies (the named policy documents on its Company Info profile — e.g. \"Refund Policy\", \"Shipping Policy\"). Takes no arguments. Read this before set_brand_policy so you edit the right one and never clobber the others.",
          'Returns { count, policies } where policies is an array of { id (pass as policyId to set_brand_policy to EDIT this policy), title, body } in stored order. Empty if the brand has no policies yet.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const [b] = await db.select({ policies: brands.policies }).from(brands).where(eq(brands.id, brandId)).limit(1);
        const policies = (b?.policies ?? []).map((p) => ({ id: p.id, title: p.title, body: p.body }));
        return { count: policies.length, policies };
      },
    },
    {
      def: {
        name: 'list_info_hub_sections',
        description: [
          "List THIS brand's Info Hub sections (the components that make up its brand profile) and how complete each is. Takes no arguments. Capped at 50 rows, in display order.",
          'Returns { count, sections } where sections is an array of:',
          '- id: section UUID.',
          '- name: the section / template name (e.g. "Brand Guidelines").',
          '- answeredFields: INTEGER count of how many questions in that section currently have an answer. This is a completeness signal only — it is NOT the total number of questions, and a section can have 0 answeredFields while still existing.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const rows = await db
          .select({ id: spotComponents.id, name: spotComponents.templateName, answers: spotComponents.answers })
          .from(spotComponents)
          .where(eq(spotComponents.brandId, brandId))
          .orderBy(spotComponents.order)
          .limit(50);
        return {
          count: rows.length,
          sections: rows.map((r) => ({
            id: r.id,
            name: r.name,
            answeredFields: r.answers ? Object.keys(r.answers as Record<string, unknown>).length : 0,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_info_hub_section',
        description: [
          'Get the actual answers stored in ONE of this brand\'s Info Hub sections (use after list_info_hub_sections to read the content, not just the completeness count).',
          'Returns { error } if the sectionId does not belong to this brand. Otherwise returns:',
          '- id: section UUID.',
          '- name: the section / template name.',
          '- answers: an OBJECT mapping field name → the brand\'s answer (values may be strings, arrays, or nested objects depending on the field). Empty object if nothing has been filled in. Treat missing fields as "unknown", never invent values.',
        ].join('\n'),
        input_schema: obj(
          { sectionId: { type: 'string', description: 'The section\'s id (the `id` field from list_info_hub_sections). Must belong to this brand.' } },
          ['sectionId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const sectionId = String(input.sectionId ?? '');
        const s = (
          await db
            .select({ id: spotComponents.id, name: spotComponents.templateName, answers: spotComponents.answers })
            .from(spotComponents)
            .where(and(eq(spotComponents.id, sectionId), eq(spotComponents.brandId, brandId)))
            .limit(1)
        )[0];
        if (!s) return { error: 'That Info Hub section does not belong to this brand.' };
        return { id: s.id, name: s.name, answers: s.answers ?? {} };
      },
    },
    {
      def: {
        name: 'list_documents',
        description: [
          "List THIS brand's documents/files in the document locker. Takes no arguments. Capped at 50 rows, newest first.",
          'Returns { count, documents } where documents is an array of:',
          '- id: file UUID.',
          '- name: the file name as shown to the user.',
          '- type: free-text file type — may be a MIME type or extension (e.g. "pdf", "image/png") or null. Do not assume a fixed set of values.',
          '- category: free-text grouping label (may be null). Not an enum.',
          '- url: a URL to the file. Share it only if the user asks; do not assume its contents.',
        ].join('\n'),
        input_schema: obj({
          category: { type: 'string', description: 'Optional case-insensitive substring filter on the document CATEGORY. Omit to include all categories.' },
          type: { type: 'string', description: 'Optional case-insensitive substring filter on the document TYPE (e.g. "pdf", "image"). Omit to include all types.' },
        }),
      },
      run: async (input: Record<string, unknown>) => {
        const category = typeof input.category === 'string' ? input.category.trim() : '';
        const type = typeof input.type === 'string' ? input.type.trim() : '';
        const filters = [eq(files.brandId, brandId), isNull(files.deletedAt)];
        if (category) filters.push(sql`${files.category} ilike ${'%' + category + '%'}`);
        if (type) filters.push(sql`${files.type} ilike ${'%' + type + '%'}`);
        const rows = await db
          .select({ id: files.id, name: files.name, type: files.type, category: files.category, url: files.url })
          .from(files)
          .where(and(...filters))
          .orderBy(desc(files.uploadedAt))
          .limit(50);
        return { count: rows.length, documents: rows };
      },
    },
    {
      def: {
        name: 'list_tasks',
        description: [
          "List THIS brand's open action items (its to-do / inbox tasks — things needing the brand's attention). Takes no arguments. Capped at 50 rows, newest first.",
          'Returns { count, tasks } where tasks is an array of:',
          '- id: task UUID.',
          '- title: short task title.',
          '- description: free-text detail (may be null).',
          '- category: "inbox" (new/unsorted) or "todo" (accepted to-do). Completed/archived tasks are excluded.',
          '- createdAt: ISO timestamp.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const rows = await db
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            category: tasks.category,
            createdAt: tasks.createdAt,
          })
          .from(tasks)
          .where(and(eq(tasks.organizationId, brandId), inArray(tasks.category, ['inbox', 'todo'])))
          .orderBy(desc(tasks.createdAt))
          .limit(50);
        return { count: rows.length, tasks: rows };
      },
    },
    {
      def: {
        name: 'list_staff',
        description: [
          "List THIS brand's team members (the owner plus active staff with a user account). Takes no arguments. Use this to find who a task can be assigned to.",
          'Returns { count, staff } where staff is an array of:',
          '- id: the team member\'s USER id. Pass this as assigneeId to create_brand_task to assign a task to them.',
          '- name: their display name (falls back to email if no name is set).',
          '- email: their email address.',
          '- role: "owner" (the brand owner) or "staff".',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const members = await listBrandMembers(db, brandId);
        return { count: members.length, staff: members };
      },
    },
    {
      def: {
        name: 'create_brand_task',
        description: [
          "Propose creating a to-do task for this brand's team (e.g. a reminder to follow up). This surfaces a confirm card; the task is only created when the USER clicks confirm. Good to pair with request_agency_connection — e.g. a reminder to message the agency once they connect.",
          'DUPLICATE GUARD: if the brand already has a SIMILAR open task, the tool returns { status: "similar_exists", similar } instead of proposing anything — do NOT create; tell the user the matching task already exists and ask whether they still want another one (then re-call with createAnyway: true).',
          'Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is created yet. Never tell the user the task exists yet. On failure returns { error } (e.g. the assigneeId is not a member of this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            title: { type: 'string', description: 'Short task title, 50 characters or fewer (required). Write it in your own words as a clear, actionable reminder.' },
            description: { type: 'string', description: 'Optional longer detail for the task body, in plain text.' },
            assigneeId: { type: 'string', description: 'Optional USER id of the team member to assign (the `id` field from list_staff). Omit to assign it to the current user.' },
            ...CREATE_ANYWAY_PROP,
          },
          ['title'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const title = String(input.title ?? '').trim();
        const description = typeof input.description === 'string' ? input.description.trim() : '';
        const assigneeId = typeof input.assigneeId === 'string' && input.assigneeId ? input.assigneeId : '';
        if (!title) return { error: 'A task title is required.' };
        if (title.length > 50) return { error: 'The task title must be 50 characters or fewer.' };
        // Unless the user already confirmed, surface a SIMILAR open task (inbox/todo)
        // so the model can ask before creating a likely-duplicate reminder.
        if (input.createAnyway !== true) {
          const openTasks = await db
            .select({ id: tasks.id, name: tasks.title })
            .from(tasks)
            .where(and(eq(tasks.organizationId, brandId), inArray(tasks.category, ['inbox', 'todo'])))
            .limit(200);
          const similar = findSimilarByName(title, openTasks);
          if (similar.length) {
            return similarExistsResult('open task', similar, 'If the user does not want a duplicate, simply do not create it.');
          }
        }
        let assigneeName: string | null = null;
        if (assigneeId) {
          const member = (await listBrandMembers(db, brandId)).find((m) => m.id === assigneeId);
          if (!member) return { error: 'That assignee is not a member of this brand.' };
          assigneeName = member.name;
        }
        pendingActions.push({
          kind: 'create_task',
          toolUseId,
          payload: { title, description: description || null, assigneeId: assigneeId || null, assigneeName },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_brand_profile',
        description: [
          "Propose updating one or more fields on this brand's own profile (e.g. tone of voice, USP, target audience, contact details). Calling this tool is what surfaces the confirm card — the card cannot appear any other way, so never tell the user a card is up unless you are calling this tool in the same turn. The change is only applied when the USER clicks confirm. Provide ONLY the fields you want to change — omitted fields are left untouched. The brand's current profile is already in your context (the \"The brand you assist\" section), so check it first. Aim to fill the profile out, not just the one field named: it is good to also propose values for EMPTY positioning/voice fields (targetAudience, usp, brandValues, keyMessaging, competitors, toneOfVoice), inferred from what you know about the brand — the user reviews and edits this card before it saves. Two rules hold, though: never overwrite a field that already has a value with a guess (only fill empties or change what the user asked to change), and never fabricate verifiable facts (legalName, abn, address, email, phone, yearFounded, website) — leave those blank unless the user supplied them. When you include `address` (the registered address), the confirm card shows a Google Places search field so the user can find and pick the exact address, and on confirm that address is ALSO filed as one of the brand's Company Info locations (deduped automatically) — so you never need a separate step to add it as a location; just propose the address the user gave (or leave it for them to search) and tell them it'll be saved to their locations too.",
          "COLLECTING FACTS YOU CAN'T KNOW: when you need the user to supply verifiable details you can't infer (the facts named above are the usual ones), do NOT list them out as questions in your chat reply. Instead pass their keys in `requestFields` — the confirm card then renders each as a blank, properly-typed, validated input (email checked as an email, website/phone/address formatted for their kind, address wired to Google Places) that the user simply fills in and confirms. This is clearer and faster for the user than typed-out prose answers, gives inline validation, and every requested field is OPTIONAL — they fill what they have and leave the rest. Combine both halves in ONE call: draft the soft positioning/voice fields in the value args above AND list the facts you need in `requestFields`, so a single card both proposes your draft and gathers what only they can provide. Only fall back to a plain chat question when the answer is genuinely open-ended (a judgement call, a preference, a 'which of these did you mean') rather than a fillable field. Don't put a field in both a value arg and `requestFields`; a requested key that already has a real value is dropped.",
          'Validation rules you MUST respect, or the call returns { error }: at least one field OR requestFields entry is required; `businessName` cannot be set to an empty value; `email` must be a valid email address (or an empty string to clear it); `colors` and `typography` must be lists of strings. Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is changed yet. Never tell the user the profile was updated until they confirm.',
        ].join('\n'),
        input_schema: obj(
          {
            businessName: { type: 'string', description: 'Trading / business name. Cannot be empty if provided.' },
            legalName: { type: 'string', description: 'Registered legal entity name.' },
            email: { type: 'string', description: 'Contact email. Must be a valid email address, or an empty string to clear it.' },
            contactName: { type: 'string', description: 'Primary contact person.' },
            website: { type: 'string', description: 'Website URL.' },
            phone: { type: 'string', description: 'Contact phone number.' },
            address: { type: 'string', description: 'Registered business address. The confirm card lets the user refine it with Google Places, and on confirm it is also saved as a Company Info location.' },
            abn: { type: 'string', description: 'Australian Business Number.' },
            industry: { type: 'string', description: 'Industry / sector.' },
            yearFounded: { type: 'string', description: 'Year the business was founded (as text, e.g. "2019").' },
            targetAudience: { type: 'string', description: 'Description of the target audience / ideal customer.' },
            competitors: { type: 'string', description: 'Key competitors.' },
            usp: { type: 'string', description: 'Unique selling proposition.' },
            brandValues: { type: 'string', description: 'Brand values.' },
            toneOfVoice: { type: 'string', description: 'Brand tone of voice.' },
            keyMessaging: { type: 'string', description: 'Key messaging / positioning statements.' },
            colors: { type: 'array', items: { type: 'string' }, description: 'Brand colours (e.g. hex codes). Replaces the existing list — include any existing colours you want to keep.' },
            typography: { type: 'array', items: { type: 'string' }, description: 'Brand typefaces. Replaces the existing list — include any existing fonts you want to keep.' },
            requestFields: {
              type: 'array',
              items: { type: 'string', enum: [...PROFILE_REQUESTABLE_FIELDS] },
              description: 'Keys of fields you want the user to fill in on the card as blank, validated inputs — use for verifiable details you cannot infer (legalName, abn, address, email, phone, yearFounded, website, contactName, businessName, industry) instead of asking for them in chat prose. Each requested field is rendered empty and OPTIONAL. Do not also pass a value for the same key.',
            },
          },
          [],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        // Mirror the validations on the brands.update mutation so the model gets
        // immediate feedback and never proposes a change the confirm step rejects.
        const STRING_FIELDS = [
          'businessName', 'legalName', 'email', 'contactName', 'website', 'phone', 'address',
          'abn', 'industry', 'yearFounded', 'targetAudience', 'competitors', 'usp',
          'brandValues', 'toneOfVoice', 'keyMessaging',
        ] as const;
        const ARRAY_FIELDS = ['colors', 'typography'] as const;
        const changes: Record<string, string | string[]> = {};
        for (const f of STRING_FIELDS) {
          const v = input[f];
          if (v === undefined || v === null) continue;
          if (typeof v !== 'string') return { error: `${f} must be text.` };
          changes[f] = v.trim();
        }
        for (const f of ARRAY_FIELDS) {
          const v = input[f];
          if (v === undefined || v === null) continue;
          if (!Array.isArray(v)) return { error: `${f} must be a list of strings.` };
          changes[f] = v.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
        }
        // Fields the model wants the USER to supply on the card as blank, validated
        // inputs (facts it can't infer) — a form instead of chat-prose questions.
        // Dedupe against keys already carrying a real value, and against each other.
        const requestable = new Set<string>(PROFILE_REQUESTABLE_FIELDS);
        const requestFields: string[] = [];
        if (input.requestFields !== undefined && input.requestFields !== null) {
          if (!Array.isArray(input.requestFields)) return { error: 'requestFields must be a list of field keys.' };
          for (const raw of input.requestFields) {
            const key = String(raw ?? '').trim();
            if (!requestable.has(key)) return { error: `"${key}" is not a requestable profile field.` };
            // Skip keys already given a non-empty value (or already listed).
            const proposed = changes[key];
            const hasValue = typeof proposed === 'string' ? proposed.length > 0 : Array.isArray(proposed) && proposed.length > 0;
            if (hasValue || requestFields.includes(key)) continue;
            requestFields.push(key);
          }
        }
        if (Object.keys(changes).length === 0 && requestFields.length === 0) {
          return { error: 'Provide at least one field to update, or list fields in requestFields for the user to fill in.' };
        }
        // businessName is NOT NULL on the brand — it cannot be blanked.
        if ('businessName' in changes && !changes.businessName) {
          return { error: 'Business name cannot be empty.' };
        }
        // email must be a valid address, or an empty string to clear it.
        if (typeof changes.email === 'string' && changes.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) {
          return { error: 'That email address is not valid.' };
        }
        pendingActions.push({ kind: 'update_profile', toolUseId, payload: { changes, requestFields } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'invite_staff_member',
        description: [
          "Propose inviting a new team member to this brand by email, optionally granting them tool/tab permissions. This surfaces a confirm card; the invitation email is only sent when the USER clicks confirm. The invitee accepts from their own account — they are NOT added until they accept.",
          'Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is sent yet. Never claim the invite was sent or the member was added. On failure returns { error } (e.g. an invalid email).',
          `Validation: email must be a valid address. permissions is an optional list; each must be one of: ${BRAND_STAFF_PERMISSIONS.join(', ')}. Grant only what the user asked for — permissions ending in "Viewer" are read-only; "staffManagement" lets the invitee manage the whole team, so only include it when explicitly requested.`,
        ].join('\n'),
        input_schema: obj(
          {
            email: { type: 'string', description: 'The invitee\'s email address. Must be a valid email.' },
            permissions: {
              type: 'array',
              items: { type: 'string', enum: [...BRAND_STAFF_PERMISSIONS] },
              description: 'Optional list of permissions to grant. Omit or pass an empty list to invite with no permissions (the user can grant them later).',
            },
          },
          ['email'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const email = String(input.email ?? '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { error: 'A valid email address is required.' };
        }
        const rawPerms = Array.isArray(input.permissions) ? input.permissions.map((p) => String(p)) : [];
        const allowed = new Set<string>(BRAND_STAFF_PERMISSIONS);
        const invalid = rawPerms.filter((p) => !allowed.has(p));
        if (invalid.length) {
          return { error: `Invalid permission(s): ${invalid.join(', ')}. Allowed: ${BRAND_STAFF_PERMISSIONS.join(', ')}.` };
        }
        // De-dupe while preserving order.
        const permissions = [...new Set(rawPerms)];
        const changes: Record<string, string> = {
          Email: email,
          Permissions: permissions.length ? permissions.join(', ') : 'None (grant later)',
        };
        pendingActions.push({ kind: 'invite_staff_member', toolUseId, payload: { email, permissions, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. The invite is NOT sent until they confirm.' };
      },
    },
    {
      def: {
        name: 'set_brand_policy',
        description: [
          "Propose adding a new policy to this brand's Company Info, or editing an existing one (e.g. a refund, shipping, or privacy policy). This surfaces a confirm card; the change is only applied when the USER clicks confirm. To EDIT an existing policy pass its policyId (from get_brand_policies) — read it first so you don't overwrite the wrong one; to ADD a new policy omit policyId.",
          'Validation, or the call returns { error }: title is required (1–200 characters); body is required (1+ characters); when editing, the policyId must be an existing policy on this brand. Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. (This tool cannot delete a policy — direct the user to the Company Info page for removals.)',
          'DUPLICATE GUARD (add mode only): if the brand already has a SIMILAR policy, the tool returns { status: "similar_exists", similar } instead of proposing anything — do NOT create; tell the user what exists and ask whether they want a new one anyway (then re-call with createAnyway: true) or to edit the existing policy instead (call this tool again with its policyId).',
        ].join('\n'),
        input_schema: obj(
          {
            policyId: { type: 'string', description: 'The id of an EXISTING policy to edit (from get_brand_policies). Omit to add a new policy.' },
            title: { type: 'string', description: 'The policy title (1–200 characters), e.g. "Refund Policy".' },
            body: { type: 'string', description: 'The policy text (plain text, 1+ characters).' },
            ...CREATE_ANYWAY_PROP,
          },
          ['title', 'body'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const title = String(input.title ?? '').trim();
        const body = String(input.body ?? '').trim();
        if (!title) return { error: 'A policy title is required.' };
        if (title.length > 200) return { error: 'The policy title must be 200 characters or fewer.' };
        if (!body) return { error: 'Policy body text is required.' };
        const [b] = await db.select({ policies: brands.policies }).from(brands).where(eq(brands.id, brandId)).limit(1);
        const existing = (b?.policies ?? []).map((p) => ({ id: p.id, title: p.title, body: p.body }));
        const policyId = typeof input.policyId === 'string' && input.policyId.trim() ? input.policyId.trim() : '';
        let policies: { id: string; title: string; body: string }[];
        let mode: 'add' | 'edit';
        if (policyId) {
          if (!existing.some((p) => p.id === policyId)) return { error: 'That policy does not exist on this brand.' };
          policies = existing.map((p) => (p.id === policyId ? { id: p.id, title, body } : p));
          mode = 'edit';
        } else {
          // Adding a new policy — unless the user already confirmed, surface a
          // SIMILAR existing policy so the model can ask before duplicating.
          if (input.createAnyway !== true) {
            const similar = findSimilarByName(title, existing.map((p) => ({ id: p.id, name: p.title })));
            if (similar.length) {
              return similarExistsResult('policy', similar, 'To edit the existing policy instead, call this tool again with its policyId.');
            }
          }
          policies = [...existing, { id: `pol-${crypto.randomUUID()}`, title, body }];
          mode = 'add';
        }
        pendingActions.push({
          kind: 'set_brand_policy',
          toolUseId,
          // `title`/`body` are top-level so the confirm card renders them as editable
          // inputs; `policyId` lets the card re-target the right policy when applying
          // the (possibly edited) values.
          payload: { mode, policyId: policyId || undefined, policyTitle: title, title, body, policies, changes: { [mode === 'add' ? 'New policy' : 'Updated policy']: title } },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'create_support_ticket',
        description: [
          'Propose creating a support ticket with the Prodesk team on behalf of the user (e.g. a billing question, a bug report, a feature request, or anything you cannot resolve yourself). This surfaces a confirm card; the ticket is only submitted when the USER clicks confirm. Write the subject and body yourself from what the user described — clear, specific, and polite — and show them what will be sent.',
          `Validation, or the call returns { error }: subject 3–200 characters; body 1–10000 characters; category one of ${SUPPORT_CATEGORIES.join(', ')} (default "general"); priority one of ${SUPPORT_PRIORITIES.join(', ')} (default "medium" — reserve "urgent" for genuine outages/blockers). Returns { status: "awaiting_confirmation" } on success — nothing is submitted until the user confirms. Replies arrive on the Support page of the app they use.`,
        ].join('\n'),
        input_schema: obj(
          {
            subject: { type: 'string', description: 'Short summary of the issue (3–200 characters).' },
            body: { type: 'string', description: 'The full ticket message: what happened, what was expected, and any relevant details the user gave (1–10000 characters). Plain text.' },
            category: { type: 'string', description: 'Ticket category. Default "general".', enum: [...SUPPORT_CATEGORIES] },
            priority: { type: 'string', description: 'Ticket priority. Default "medium".', enum: [...SUPPORT_PRIORITIES] },
          },
          ['subject', 'body'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const subject = String(input.subject ?? '').trim();
        const body = String(input.body ?? '').trim();
        if (subject.length < 3 || subject.length > 200) return { error: 'The subject must be 3–200 characters.' };
        if (!body || body.length > 10000) return { error: 'The body must be 1–10000 characters.' };
        const category = input.category !== undefined ? String(input.category) : 'general';
        if (!(SUPPORT_CATEGORIES as readonly string[]).includes(category)) {
          return { error: `category must be one of: ${SUPPORT_CATEGORIES.join(', ')}.` };
        }
        const priority = input.priority !== undefined ? String(input.priority) : 'medium';
        if (!(SUPPORT_PRIORITIES as readonly string[]).includes(priority)) {
          return { error: `priority must be one of: ${SUPPORT_PRIORITIES.join(', ')}.` };
        }
        pendingActions.push({
          kind: 'create_support_ticket',
          toolUseId,
          payload: { subject, body, category, priority },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user with the drafted ticket. Nothing is submitted until they confirm.' };
      },
    },
    {
      def: {
        name: 'create_brand',
        description: [
          'Propose creating a NEW brand (a separate workspace/tenant) owned by the current user. This surfaces a confirm card; the brand is only created when the USER clicks confirm. Creating a brand is free, but features inside it (links, reviews, signatures, the AI assistant) have their own subscriptions — mention that if relevant.',
          'Validation, or the call returns { error }: businessName is required and must not already be taken (checked live against every brand and agency); email must be a valid address if provided; website must be a valid URL if provided. Returns { status: "awaiting_confirmation" } on success — nothing is created until the user confirms. Note: this AI chat stays scoped to the CURRENT brand — the user switches to the new brand from the workspace selector.',
        ].join('\n'),
        input_schema: obj(
          {
            businessName: { type: 'string', description: 'The new brand\'s business/trading name (required, must be unique on the platform).' },
            email: { type: 'string', description: 'Optional contact email for the new brand.' },
            website: { type: 'string', description: 'Optional website URL for the new brand.' },
            phone: { type: 'string', description: 'Optional contact phone number.' },
          },
          ['businessName'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const businessName = String(input.businessName ?? '').trim();
        if (!businessName) return { error: 'A business name is required.' };
        const nameCheck = await checkBusinessNameAvailable(db, businessName);
        if (!nameCheck.available) return { error: `"${businessName}" is already taken — pick a different business name.` };
        const payload: Record<string, unknown> = { businessName };
        const changes: Record<string, string> = { 'Business name': businessName };
        if (input.email !== undefined && input.email !== null && String(input.email).trim()) {
          const email = String(input.email).trim();
          if (!EMAIL_RE.test(email)) return { error: `"${email}" is not a valid email address.` };
          payload.email = email;
          changes['Email'] = email;
        }
        if (input.website !== undefined && input.website !== null && String(input.website).trim()) {
          const website = String(input.website).trim();
          try { new URL(website); } catch { return { error: 'The website is not a valid URL (include https://).' }; }
          payload.website = website;
          changes['Website'] = website;
        }
        if (input.phone !== undefined && input.phone !== null && String(input.phone).trim()) {
          payload.phone = String(input.phone).trim();
          changes['Phone'] = String(input.phone).trim();
        }
        pendingActions.push({ kind: 'create_brand', toolUseId, payload: { ...payload, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm. Remind the user the new brand is a separate workspace they switch to from the workspace selector.' };
      },
    },
  ];
}
