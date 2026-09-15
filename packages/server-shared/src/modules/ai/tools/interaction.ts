/**
 * Conversation-mechanics tools: the ask_user question form and the settlement follow-up request.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { obj, ASK_FIELD_TYPES } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function interactionTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { pendingActions, flags } = ctx;
  return [
    {
      def: {
        name: 'ask_user',
        description: [
          "Ask the user for specific, factual answers by surfacing a small FORM card in the chat (like a structured questionnaire) instead of typing the questions out as prose. Use this whenever what you need is objective input the user must supply — a fact, a value, a detail there's a single true answer to — rather than an open judgement call. The card renders each field as a labelled input with inline validation, the user fills them in and submits, and their answers come back to you so you can continue. This is clearer and quicker for the user than a back-and-forth of typed questions, and it validates input up front.",
          'Prefer this over asking factual questions in your reply text. Reserve plain chat questions for genuinely open-ended or subjective prompts (a preference, a strategic direction, "which of these did you mean", anything needing a paragraph of reasoning) — those do not belong in a form. Do NOT use this to collect fields that another action tool already gathers on its own card (e.g. brand-profile facts belong in update_brand_profile\'s requestFields; a task\'s title belongs in create_brand_task) — use ask_user for questions that are not already tied to a specific write action.',
          'Each field is OPTIONAL unless you mark it required. Choose the right `type` so validation and the input match the answer (email/url/tel/number/year/date/select/textarea/text). For a fixed set of answers use type "select" with `options`. Keep it focused — only ask for what you actually need, ideally a handful of fields. After the user submits, you are automatically re-invoked with their answers (you do not also need request_settlement_followup for this). If the user dismisses the form, treat it as them declining to answer.',
          'Returns { status: "awaiting_answers" } on success — the form was shown, you do NOT have the answers yet; never assume or invent them. On failure returns { error } (e.g. no fields, or an invalid field type).',
        ].join('\n'),
        input_schema: obj(
          {
            prompt: { type: 'string', description: 'Optional short heading shown above the fields explaining what you\'re asking for and why (1 sentence). Omit if the field labels are self-explanatory.' },
            fields: {
              type: 'array',
              description: 'The questions to ask, each rendered as one input. Provide 1–10 fields. Ask only for what you need.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  key: { type: 'string', description: 'A short unique identifier for this answer (e.g. "monthlyBudget"). You receive answers keyed by this. Must be unique within the form.' },
                  label: { type: 'string', description: 'The human-facing question / field label (e.g. "Monthly ad budget (AUD)").' },
                  type: { type: 'string', enum: [...ASK_FIELD_TYPES], description: 'Input type controlling validation and the control shown. Defaults to "text". Use "textarea" for long answers, "select" (with options) for a fixed choice, and email/url/tel/number/year/date for those formats.' },
                  required: { type: 'boolean', description: 'Whether an answer is mandatory before the user can submit. Defaults to false (optional).' },
                  placeholder: { type: 'string', description: 'Optional placeholder / example shown inside an empty input.' },
                  hint: { type: 'string', description: 'Optional one-line helper text shown under the field.' },
                  options: {
                    type: 'array',
                    description: 'For type "select" ONLY: the selectable choices. Required and non-empty when type is "select"; ignored otherwise.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        value: { type: 'string', description: 'The value recorded when this option is chosen.' },
                        label: { type: 'string', description: 'The human-facing option text.' },
                      },
                      required: ['value', 'label'],
                    },
                  },
                },
                required: ['key', 'label'],
              },
            },
          },
          ['fields'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const rawFields = input.fields;
        if (!Array.isArray(rawFields) || rawFields.length === 0) {
          return { error: 'Provide at least one field for the user to answer.' };
        }
        if (rawFields.length > 10) return { error: 'Ask for at most 10 fields at once.' };
        const allowedTypes = new Set<string>(ASK_FIELD_TYPES);
        const seenKeys = new Set<string>();
        const fields: Array<Record<string, unknown>> = [];
        for (let i = 0; i < rawFields.length; i++) {
          const f = rawFields[i] as Record<string, unknown>;
          const label = `field ${i + 1}`;
          if (!f || typeof f !== 'object') return { error: `${label}: each field must be an object.` };
          const key = String(f.key ?? '').trim();
          const fieldLabel = String(f.label ?? '').trim();
          if (!key) return { error: `${label}: a non-empty key is required.` };
          if (!fieldLabel) return { error: `${label}: a non-empty label is required.` };
          if (seenKeys.has(key)) return { error: `Duplicate field key "${key}" — keys must be unique.` };
          seenKeys.add(key);
          const type = f.type === undefined || f.type === null ? 'text' : String(f.type);
          if (!allowedTypes.has(type)) return { error: `${label}: "${type}" is not a valid field type.` };
          const clean: Record<string, unknown> = { key, label: fieldLabel, type };
          if (f.required === true) clean.required = true;
          if (typeof f.placeholder === 'string' && f.placeholder.trim()) clean.placeholder = f.placeholder.trim();
          if (typeof f.hint === 'string' && f.hint.trim()) clean.hint = f.hint.trim();
          if (type === 'textarea') clean.rows = 3;
          if (type === 'select') {
            const rawOpts = Array.isArray(f.options) ? f.options : [];
            const options = rawOpts
              .map((o) => (o && typeof o === 'object' ? o : {}) as Record<string, unknown>)
              .map((o) => ({ value: String(o.value ?? '').trim(), label: String(o.label ?? '').trim() }))
              .filter((o) => o.value && o.label);
            if (options.length === 0) return { error: `${label}: a "select" field needs at least one option with a value and label.` };
            clean.options = options;
          }
          fields.push(clean);
        }
        const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
        pendingActions.push({ kind: 'ask_user', toolUseId, payload: { prompt, fields } });
        // A question is only useful once answered, so always resume after the user
        // submits — the model doesn't need a separate request_settlement_followup.
        flags.settlementFollowup = true;
        return { status: 'awaiting_answers', note: 'Question form surfaced to the user. You do NOT have their answers yet — never assume them. You will be re-invoked with the answers once they submit (or with a dismissal if they decline).' };
      },
    },
    {
      def: {
        name: 'request_user_location',
        description: [
          "Ask the user to share their current location from their browser. Surfaces a small card in the chat with a 'Share my location' button; when the user allows it, their browser resolves their approximate position and you are re-invoked with it — the city, region and country plus latitude/longitude. Use this ONLY when knowing WHERE the user is genuinely improves your help: local competitor or market research, region-specific pricing/norms, nearby press or events, timezone-sensitive scheduling, or anything that turns on their locale. Don't request it out of curiosity, or when the brand's stated location already covers what you need.",
          "Sharing is OPTIONAL and permission-gated — the user must allow it, and may decline. Returns { status: 'awaiting_location' } once the card is shown: you do NOT have the location yet, so never assume, guess, or invent it. You are automatically re-invoked once the user shares it (or declines) — you do not also need request_settlement_followup. If the user declines, continue without it or ask them to type their city instead; do not re-surface this card. Takes no arguments.",
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async (_input: Record<string, unknown>, toolUseId: string) => {
        pendingActions.push({ kind: 'request_user_location', toolUseId, payload: {} });
        // Location is only useful once shared, so always resume after the user acts
        // (shares or declines) — no separate request_settlement_followup needed.
        flags.settlementFollowup = true;
        return {
          status: 'awaiting_location',
          note: 'Location request surfaced to the user. You do NOT have their location yet — never assume it. You will be re-invoked once they share it (or decline).',
        };
      },
    },
    {
      def: {
        name: 'request_settlement_followup',
        description: [
          "Force a one-time automatic re-invocation after the user settles the card(s) you proposed this turn, so you can follow up. You almost never need this: any turn that shows a confirm-then-execute card ALREADY auto-arms this re-invocation for you. The ONLY case that does not auto-arm is a turn whose cards are all pure DRAFTS (an agency message, proposal reply, or marketplace inquiry) — call this then if, and only if, you genuinely want to continue once the user has dealt with those drafts. Takes no arguments.",
          'Only call it in the SAME turn you propose the card(s); it does nothing when no card is shown. You will receive each card\'s outcome (and any edits the user made) when re-invoked. Returns { status: "ok" }.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        flags.settlementFollowup = true;
        return { status: 'ok', note: 'You will be re-invoked once the user settles every card from this turn.' };
      },
    },
  ];
}
