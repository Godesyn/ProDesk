import { obj } from './helpers.js';
import {
  listConversationsFor,
  listKnownPeopleFor,
  listRequestsFor,
  nameThreadsFor,
  readConversationFor,
  searchMessagesFor,
} from '../../chat/queries.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

/**
 * THE MESSENGER, from the assistant's side.
 *
 * Chat (chat.prodesk.com) is a person-to-person messenger, and everything in it
 * belongs to a PERSON rather than to the brand — which makes this module the odd
 * one out in the registry, where every other tool is scoped to `ctx.brandId`.
 * Three rules follow from that, and none of them is optional:
 *
 * 1. EVERY read is scoped to `ctx.userId`, the person who sent this turn. The
 *    scope lives in modules/chat/queries.ts, where the membership join IS the
 *    from-clause, because the backend runs as owner and bypasses RLS.
 *
 * 2. EVERY write is a confirm-then-execute card. Nothing here sends a message or
 *    changes a group server-side. The card is executed by the CLIENT, as the
 *    user, through the ordinary tRPC procedures — so the assistant can never do
 *    something in someone's name that they did not watch themselves approve.
 *    For a messenger that is not a nicety: a message sent under your name is
 *    indistinguishable from one you wrote.
 *
 * 3. NO EMAIL IS RESOLVED HERE. "Does this address have an account" is answered
 *    in exactly one place (routers/chat/directory.ts#discoverByEmail) behind
 *    three rate-limit budgets and one indistinguishable negative answer,
 *    precisely so it cannot be used to walk the user table. A tool that resolved
 *    addresses in bulk would be that walk, wearing a friendly face. So the model
 *    passes addresses through to the card, and the CLIENT looks them up when the
 *    user confirms — same door, same budgets, same deliberate act.
 *
 * A note on discretion: this AI thread is shared with the brand's team, so
 * anything the assistant repeats out of a private conversation is repeated to
 * everyone who can open the thread. The system prompt says so; the tool
 * descriptions below say so again where it matters most.
 */
export function messengerTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, userId, pendingActions } = ctx;

  /** Every read tool needs a signed-in person. Belt and braces — chat.ts sets it. */
  const noUser = { error: 'No signed-in user for this turn, so the messenger is unavailable.' };

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

  return [
    /* ── Reads ──────────────────────────────────────────────────────────── */
    {
      def: {
        name: 'list_chat_conversations',
        description: [
          "List the signed-in user's conversations in Chat — their DMs, their groups, and the workspace threads they belong to. This is how you find the conversation an instruction refers to: before you can send a message to \"the design group\" or add someone to it, you need its threadId, and this is where threadIds come from. Never guess or invent one.",
          'Returns, per conversation: threadId, name, type, surface ("messenger" for DMs/groups on chat.prodesk.com, "workspace" for org threads), memberCount, otherMembers (each with userId and name — pass those userIds when adding people you can see here), unreadCount, lastMessage, lastMessageAt, and whether it is archived / muted / pinned, plus iAmAdmin (whether the user can rename it or manage its members).',
          'Ordered by most recent activity. Pass `query` to filter by conversation or member name. Archived conversations are hidden unless `includeArchived` is true. Message CONTENT is not included beyond the one-line last-message preview — use read_chat_conversation for that.',
        ].join('\n'),
        input_schema: obj({
          query: { type: 'string', description: 'Optional filter on the conversation name or a member name (e.g. "design", "Priya").' },
          includeArchived: { type: 'boolean', description: 'Include conversations the user has archived. Defaults to false.' },
          limit: { type: 'number', description: 'How many to return, 1–60. Defaults to 30.' },
        }),
      },
      run: async (input) => {
        if (!userId) return noUser;
        const conversations = await listConversationsFor(db, userId, {
          query: str(input.query) || undefined,
          includeArchived: input.includeArchived === true,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        return { conversations, count: conversations.length };
      },
    },
    {
      def: {
        name: 'read_chat_conversation',
        description: [
          'Read the most recent messages in one conversation, oldest-first, so you can answer questions about it, summarise it, or draft a reply that fits what was actually said. Requires a threadId from list_chat_conversations or search_chat_messages.',
          'Returns the conversation name, its members, and the messages: sender name, whether the user wrote it, the text, and — for a photo, video or file — what the attachment IS rather than its contents (you cannot see inside an attachment; never describe one as if you had opened it). Deleted messages appear as "(deleted)" rather than being hidden, so you are not reading around a hole without knowing it.',
          'BE DISCREET. These are private conversations, and this assistant thread is shared with the brand\'s whole team. Use what you read to do the task you were asked to do; do not transcribe or summarise someone\'s private messages beyond what the request needs.',
        ].join('\n'),
        input_schema: obj(
          {
            threadId: { type: 'string', description: 'The conversation to read, from list_chat_conversations.' },
            limit: { type: 'number', description: 'How many recent messages, 1–100. Defaults to 30.' },
          },
          ['threadId'],
        ),
      },
      run: async (input) => {
        if (!userId) return noUser;
        const threadId = str(input.threadId);
        if (!threadId) return { error: 'A threadId is required.' };
        const transcript = await readConversationFor(
          db,
          userId,
          threadId,
          typeof input.limit === 'number' ? input.limit : 30,
        );
        if (!transcript) {
          return { error: 'No such conversation, or the user is not in it. Use list_chat_conversations to find the right threadId.' };
        }
        return transcript;
      },
    },
    {
      def: {
        name: 'search_chat_messages',
        description: [
          'Find a message by its words, across every conversation the user is in (or inside one conversation with `threadId`). Use it for "what did Sam say about the invoice", "find where we agreed the deadline", or to locate the conversation a topic lives in when you do not know its name.',
          'Returns matching messages with messageId, threadId, threadName, senderName, the text and when it was sent, newest-first. The query must be at least 2 characters. It matches message TEXT only — attachments are found by their conversation, not their contents.',
        ].join('\n'),
        input_schema: obj(
          {
            query: { type: 'string', description: 'The words to look for. At least 2 characters.' },
            threadId: { type: 'string', description: 'Optional — restrict the search to one conversation.' },
            limit: { type: 'number', description: 'How many hits, 1–40. Defaults to 20.' },
          },
          ['query'],
        ),
      },
      run: async (input) => {
        if (!userId) return noUser;
        const query = str(input.query);
        if (query.length < 2) return { error: 'Search for at least 2 characters.' };
        const hits = await searchMessagesFor(db, userId, query, {
          threadId: str(input.threadId) || undefined,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        return { hits, count: hits.length };
      },
    },
    {
      def: {
        name: 'list_chat_people',
        description: [
          'List the people the user can already reach in Chat — everyone they share at least one conversation with — with each person\'s userId, name, and how many conversations they share. This is how you turn a name into something you can act on: pass these userIds to create_chat_group or update_chat_members and nobody has to type an email address.',
          'It introduces nobody: it only reports people the user is already talking to. For someone NOT in this list you must use their email address instead, and the address is resolved when the user confirms the card — you cannot look up whether an address has an account, and you must not claim to know.',
        ].join('\n'),
        input_schema: obj({
          query: { type: 'string', description: 'Optional filter on the person\'s name.' },
          limit: { type: 'number', description: 'How many people, 1–100. Defaults to 40.' },
        }),
      },
      run: async (input) => {
        if (!userId) return noUser;
        const people = await listKnownPeopleFor(db, userId, {
          query: str(input.query) || undefined,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        return { people, count: people.length };
      },
    },
    {
      def: {
        name: 'list_chat_requests',
        description: [
          "List the user's pending message requests: first messages from people they share no other conversation with, which sit in a separate queue and deliberately do not notify. Returns threadId, who it is from, the one-line preview and when it arrived.",
          'Use it to answer "has anyone been trying to reach me" and to feed answer_chat_request. Accepting a request is the same as replying; declining leaves the sender\'s side untouched, so they are never told they were declined.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        if (!userId) return noUser;
        const requests = await listRequestsFor(db, userId);
        return { requests, count: requests.length };
      },
    },

    /* ── Actions — every one is a card the user confirms ─────────────────── */
    {
      def: {
        name: 'send_chat_message',
        description: [
          'Propose a message for the user to send in one of their conversations. Shows a confirm card with the text in an EDITABLE field, so they can adjust the wording before it goes; nothing is sent until they press send, and the message is sent as them.',
          'Requires a threadId from list_chat_conversations or search_chat_messages — this tool cannot start a new conversation, so to message someone the user is not already talking to, create a group or ask them to open the DM first.',
          'Write the message in the USER\'S voice, not yours. It will appear under their name with no indication an assistant drafted it, so it must read like something they would type: their register, their length, no assistant throat-clearing, no "I hope this finds you well" unless that is how they write. Returns { status: "awaiting_confirmation" } — the message has NOT been sent, and you must not say it has.',
        ].join('\n'),
        input_schema: obj(
          {
            threadId: { type: 'string', description: 'The conversation to send into.' },
            message: { type: 'string', description: 'The message text, written as the user would write it.' },
          },
          ['threadId', 'message'],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const threadId = str(input.threadId);
        const message = str(input.message);
        if (!threadId) return { error: 'A threadId is required — find it with list_chat_conversations.' };
        if (!message) return { error: 'The message text cannot be empty.' };
        const names = await nameThreadsFor(db, userId, [threadId]);
        const threadName = names.get(threadId);
        if (!threadName) {
          return { error: 'No such conversation, or the user is not in it.' };
        }
        pendingActions.push({
          kind: 'send_chat_message',
          toolUseId,
          payload: { threadId, threadName, message },
        });
        return {
          status: 'awaiting_confirmation',
          note: `A send card for "${threadName}" is shown. Nothing has been sent yet — never claim it has, and never assume the user kept your wording.`,
        };
      },
    },
    {
      def: {
        name: 'create_chat_group',
        description: [
          'Propose a new group conversation in Chat. Shows a confirm card with the name and the people; the group is created when the user confirms, with them as its admin, and everyone added is notified.',
          'Add people by `memberIds` (userIds from list_chat_people — the reliable path for anyone the user already talks to) and/or by `memberEmails` for people they do not yet share a conversation with. An email is resolved WHEN THE USER CONFIRMS: you cannot know in advance whether an address has an account, so never state that it does. If an address turns out to have no account the card reports it and offers to send an invitation instead.',
          'A group needs at least one other person. Returns { status: "awaiting_confirmation" } — nothing has been created.',
        ].join('\n'),
        input_schema: obj(
          {
            name: { type: 'string', description: 'The group name (up to 80 characters). Optional — a group can be named later — but a name makes it findable, so provide one unless the user objects.' },
            memberIds: { type: 'array', items: { type: 'string' }, description: 'userIds from list_chat_people. Preferred over emails for anyone the user already knows.' },
            memberEmails: { type: 'array', items: { type: 'string' }, description: 'Email addresses for people not in list_chat_people. Resolved at confirm time, not now.' },
          },
          [],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const memberIds = strList(input.memberIds);
        const memberEmails = strList(input.memberEmails);
        if (!memberIds.length && !memberEmails.length) {
          return { error: 'A group needs at least one other person — pass memberIds and/or memberEmails.' };
        }
        const name = str(input.name).slice(0, 80);
        // Name the ids we were given, so the card reads "Priya, Sam" rather than
        // two uuids. Anyone the user cannot see is dropped rather than shown as
        // an unknown id — the assistant should not be able to put a stranger's
        // id on a card by guessing.
        const known = await listKnownPeopleFor(db, userId, { limit: 100 });
        const byId = new Map(known.map((p) => [p.userId, p.name]));
        const members = memberIds
          .filter((id) => byId.has(id))
          .map((id) => ({ userId: id, name: byId.get(id) as string }));
        const unknownIds = memberIds.filter((id) => !byId.has(id));
        if (!members.length && !memberEmails.length) {
          return {
            error:
              'None of those userIds belong to people the user shares a conversation with. Call list_chat_people and use the ids it returns, or pass email addresses instead.',
          };
        }
        pendingActions.push({
          kind: 'create_chat_group',
          toolUseId,
          payload: { name, members, emails: memberEmails },
        });
        return {
          status: 'awaiting_confirmation',
          note: 'A create-group card is shown. The group does not exist yet.',
          ...(unknownIds.length
            ? { warning: `Ignored ${unknownIds.length} userId(s) that are not people the user shares a conversation with.` }
            : {}),
        };
      },
    },
    {
      def: {
        name: 'update_chat_members',
        description: [
          "Propose adding people to, or removing them from, one of the user's groups. Shows a confirm card; the change happens when they confirm, and only if they are an admin of that group (list_chat_conversations reports iAmAdmin — check it before proposing, and say so plainly if they are not).",
          'Set `mode` to "add" or "remove". Identify people by `memberIds` from list_chat_people; for adding someone new you may also pass `memberEmails`, resolved at confirm time. Removing is only ever by userId — you must not remove someone by guessing at an address.',
          'Returns { status: "awaiting_confirmation" }. Nobody has been added or removed.',
        ].join('\n'),
        input_schema: obj(
          {
            threadId: { type: 'string', description: 'The group to change.' },
            mode: { type: 'string', enum: ['add', 'remove'], description: 'Whether to add these people or remove them.' },
            memberIds: { type: 'array', items: { type: 'string' }, description: 'userIds from list_chat_people, or from the conversation\'s otherMembers.' },
            memberEmails: { type: 'array', items: { type: 'string' }, description: 'For mode "add" only: addresses of people not yet known to the user.' },
          },
          ['threadId', 'mode'],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const threadId = str(input.threadId);
        const mode = str(input.mode);
        if (mode !== 'add' && mode !== 'remove') return { error: 'mode must be "add" or "remove".' };
        const conversations = await listConversationsFor(db, userId, { includeArchived: true, limit: 60 });
        const conversation = conversations.find((c) => c.threadId === threadId);
        if (!conversation) return { error: 'No such conversation, or the user is not in it.' };
        if (conversation.type !== 'group') {
          return { error: 'Only a group has a member list you can change. A DM has exactly two people in it by definition.' };
        }
        if (!conversation.iAmAdmin) {
          return { error: `The user is not an admin of "${conversation.name}", so they cannot change who is in it. Tell them that rather than proposing a card that would fail.` };
        }

        const memberIds = strList(input.memberIds);
        const memberEmails = mode === 'add' ? strList(input.memberEmails) : [];
        const nameById = new Map<string, string>(conversation.otherMembers.map((m) => [m.userId, m.name]));
        if (mode === 'add') {
          for (const p of await listKnownPeopleFor(db, userId, { limit: 100 })) {
            if (!nameById.has(p.userId)) nameById.set(p.userId, p.name);
          }
        }
        const members = memberIds
          .filter((id) => nameById.has(id))
          .map((id) => ({ userId: id, name: nameById.get(id) as string }));
        if (!members.length && !memberEmails.length) {
          return {
            error:
              mode === 'remove'
                ? 'None of those userIds are in that group. Read its otherMembers from list_chat_conversations.'
                : 'Nobody to add — pass memberIds from list_chat_people, or memberEmails.',
          };
        }
        pendingActions.push({
          kind: 'update_chat_members',
          toolUseId,
          payload: {
            threadId,
            threadName: conversation.name,
            mode,
            members,
            emails: memberEmails,
          },
        });
        return {
          status: 'awaiting_confirmation',
          note: `A ${mode === 'add' ? 'add' : 'remove'}-members card for "${conversation.name}" is shown. Nothing has changed yet.`,
        };
      },
    },
    {
      def: {
        name: 'rename_chat_group',
        description: [
          "Propose a new name for one of the user's groups. Shows a confirm card with the name in an editable field; the rename happens on confirm, and everyone in the group sees a note that it was renamed. Admin-only — check iAmAdmin from list_chat_conversations first.",
          'Returns { status: "awaiting_confirmation" }. The group has not been renamed.',
        ].join('\n'),
        input_schema: obj(
          {
            threadId: { type: 'string', description: 'The group to rename.' },
            name: { type: 'string', description: 'The new name, up to 80 characters.' },
          },
          ['threadId', 'name'],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const threadId = str(input.threadId);
        const name = str(input.name).slice(0, 80);
        if (!name) return { error: 'A new name is required.' };
        const conversations = await listConversationsFor(db, userId, { includeArchived: true, limit: 60 });
        const conversation = conversations.find((c) => c.threadId === threadId);
        if (!conversation) return { error: 'No such conversation, or the user is not in it.' };
        if (conversation.type !== 'group') return { error: 'Only a group has a name of its own.' };
        if (!conversation.iAmAdmin) {
          return { error: `The user is not an admin of "${conversation.name}", so they cannot rename it.` };
        }
        pendingActions.push({
          kind: 'rename_chat_group',
          toolUseId,
          payload: { threadId, currentName: conversation.name, name },
        });
        return { status: 'awaiting_confirmation', note: 'A rename card is shown. The group still has its old name.' };
      },
    },
    {
      def: {
        name: 'invite_to_chat',
        description: [
          'Propose inviting an email address that has no Prodesk account yet to join Chat. Shows a confirm card; on confirm an invitation email goes out, and when they sign up the conversation is waiting for them.',
          'Use this for someone genuinely outside Prodesk. For someone who may already have an account, propose create_chat_group or update_chat_members with their address instead — those resolve the address first and only fall back to an invitation if there is no account. Invitations are rate-limited per user per day.',
          'Returns { status: "awaiting_confirmation" }. No email has been sent.',
        ].join('\n'),
        input_schema: obj(
          {
            email: { type: 'string', description: 'The address to invite.' },
          },
          ['email'],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const email = str(input.email).toLowerCase();
        // Shape only. Whether it EXISTS is not a question this tool may ask.
        if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
          return { error: 'That does not look like an email address.' };
        }
        pendingActions.push({ kind: 'invite_to_chat', toolUseId, payload: { email } });
        return { status: 'awaiting_confirmation', note: 'An invitation card is shown. No email has been sent yet.' };
      },
    },
    {
      def: {
        name: 'answer_chat_request',
        description: [
          'Propose accepting or declining a pending message request (see list_chat_requests). Accepting moves it into the inbox as an ordinary conversation; declining files it away and, optionally, blocks the sender.',
          'The sender is never told they were declined — their side of the conversation is left exactly as it would be if the user had simply not replied — so do not offer to "let them know".',
          'Returns { status: "awaiting_confirmation" }. Nothing has been accepted or declined.',
        ].join('\n'),
        input_schema: obj(
          {
            threadId: { type: 'string', description: 'The request, from list_chat_requests.' },
            decision: { type: 'string', enum: ['accept', 'decline'], description: 'What to do with it.' },
            block: { type: 'boolean', description: 'For "decline" only: also block the sender so they cannot reach the user again. Only propose this when the user has asked for it.' },
          },
          ['threadId', 'decision'],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const threadId = str(input.threadId);
        const decision = str(input.decision);
        if (decision !== 'accept' && decision !== 'decline') {
          return { error: 'decision must be "accept" or "decline".' };
        }
        const requests = await listRequestsFor(db, userId);
        const request = requests.find((r) => r.threadId === threadId);
        if (!request) return { error: 'That is not a pending request. Call list_chat_requests for the current queue.' };
        pendingActions.push({
          kind: 'answer_chat_request',
          toolUseId,
          payload: {
            threadId,
            fromName: request.fromName,
            decision,
            block: decision === 'decline' && input.block === true,
          },
        });
        return { status: 'awaiting_confirmation', note: `A card for the request from ${request.fromName} is shown. It is still pending.` };
      },
    },
    {
      def: {
        name: 'update_chat_conversation',
        description: [
          "Propose changing how one of the user's conversations behaves for THEM — nobody else sees any of these. Shows a confirm card.",
          'Actions: "archive" / "unarchive" (file it away and silence it), "mute" / "unmute" (stop it notifying; pass mutedHours for a temporary mute, omit for indefinite), "pin" / "unpin" (hold it at the top of the inbox), "leave" (leave a group for good — the user cannot rejoin themselves, so only propose it when they clearly asked to).',
          'Returns { status: "awaiting_confirmation" }. Nothing has changed.',
        ].join('\n'),
        input_schema: obj(
          {
            threadId: { type: 'string', description: 'The conversation to change.' },
            action: {
              type: 'string',
              enum: ['archive', 'unarchive', 'mute', 'unmute', 'pin', 'unpin', 'leave'],
              description: 'What to do.',
            },
            mutedHours: { type: 'number', description: 'For "mute": how many hours to mute for. Omit to mute until they turn it back on.' },
          },
          ['threadId', 'action'],
        ),
      },
      run: async (input, toolUseId) => {
        if (!userId) return noUser;
        const threadId = str(input.threadId);
        const action = str(input.action);
        const allowed = ['archive', 'unarchive', 'mute', 'unmute', 'pin', 'unpin', 'leave'];
        if (!allowed.includes(action)) return { error: `action must be one of: ${allowed.join(', ')}.` };
        const conversations = await listConversationsFor(db, userId, { includeArchived: true, limit: 60 });
        const conversation = conversations.find((c) => c.threadId === threadId);
        if (!conversation) return { error: 'No such conversation, or the user is not in it.' };
        if (action === 'leave' && conversation.type !== 'group') {
          return { error: 'Only a group can be left. A DM is archived instead.' };
        }
        pendingActions.push({
          kind: 'update_chat_conversation',
          toolUseId,
          payload: {
            threadId,
            threadName: conversation.name,
            action,
            mutedHours:
              action === 'mute' && typeof input.mutedHours === 'number' && input.mutedHours > 0
                ? Math.min(Math.round(input.mutedHours), 24 * 30)
                : null,
          },
        });
        return { status: 'awaiting_confirmation', note: `A card for "${conversation.name}" is shown. Nothing has changed yet.` };
      },
    },
  ];
}
