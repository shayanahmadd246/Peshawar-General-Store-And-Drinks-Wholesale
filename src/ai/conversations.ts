import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { chatMessages, conversations } from '../db/schema';
import { HttpError } from '../auth/rbac';
import type { AuthUser } from '../auth/types';

function assertClient(user: AuthUser) {
  if (user.role !== 'client') {
    throw new HttpError(403, 'Only shopkeepers can use the AI assistant.');
  }
}

export async function getOrCreateConversation(user: AuthUser, conversationId?: string, language = 'en') {
  assertClient(user);
  if (conversationId) {
    const [existing] = await getDb()
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, user.id)))
      .limit(1);
    if (!existing) throw new HttpError(404, 'Conversation not found.');
    return existing;
  }

  const [latest] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.clientId, user.id), eq(conversations.status, 'open')))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (latest) return latest;

  const [created] = await getDb()
    .insert(conversations)
    .values({
      id: `CONV-${user.id}-${Date.now()}`,
      clientId: user.id,
      language,
      title: 'Shopkeeper Assistant',
      status: 'open',
    })
    .returning();
  return created;
}

export async function listConversations(user: AuthUser) {
  assertClient(user);
  return getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.clientId, user.id))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversationMessages(user: AuthUser, conversationId: string, limit = 50) {
  assertClient(user);
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, user.id)))
    .limit(1);
  if (!conversation) throw new HttpError(404, 'Conversation not found.');

  const rows = await getDb()
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.clientId, user.id)))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit);

  return { conversation, messages: rows };
}

export async function appendMessage(input: {
  conversationId: string;
  clientId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}) {
  const [row] = await getDb()
    .insert(chatMessages)
    .values({
      id: `MSG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      conversationId: input.conversationId,
      clientId: input.clientId,
      role: input.role,
      content: input.content.slice(0, 8000),
      language: input.language || null,
      metadata: input.metadata || null,
    })
    .returning();

  await getDb()
    .update(conversations)
    .set({
      updatedAt: new Date(),
      ...(input.language ? { language: input.language } : {}),
    })
    .where(eq(conversations.id, input.conversationId));

  return row;
}

export async function loadRecentHistory(conversationId: string, clientId: string, limit = 12) {
  const rows = await getDb()
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.clientId, clientId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}
