import "server-only";

import { and, asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { studyMessage, studySession } from "@/lib/db/schema";
import { getStudyPrompt, STUDY_MODEL, type StudyCondition } from "./study";
import {
  getStudyElapsedSeconds,
  STUDY_MIN_SECONDS,
  StudySessionError,
} from "./timing";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export async function getOrCreateStudySession(
  userId: string,
  condition: StudyCondition
) {
  await db
    .insert(studySession)
    .values({
      condition,
      model: STUDY_MODEL,
      systemPrompt: getStudyPrompt(condition),
      userId,
    })
    .onConflictDoNothing();

  const [session] = await db
    .select()
    .from(studySession)
    .where(
      and(
        eq(studySession.userId, userId),
        eq(studySession.condition, condition)
      )
    )
    .limit(1);

  if (!session) {
    throw new Error("Unable to create study session");
  }
  return session;
}

export async function getStudySession(id: string) {
  const [session] = await db
    .select()
    .from(studySession)
    .where(eq(studySession.id, id))
    .limit(1);
  return session;
}

export function getStudyMessages(sessionId: string) {
  return db
    .select()
    .from(studyMessage)
    .where(eq(studyMessage.sessionId, sessionId))
    .orderBy(asc(studyMessage.sequence));
}

export function updateStudySession(
  id: string,
  userId: string,
  action: "start" | "end"
) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(studySession)
      .where(and(eq(studySession.id, id), eq(studySession.userId, userId)))
      .for("update");
    if (!session) {
      throw new StudySessionError("无权访问该对话。", 403);
    }
    if (session.endedAt || (action === "start" && session.startedAt)) {
      return session;
    }

    const now = new Date();
    if (
      action === "end" &&
      (!session.startedAt ||
        getStudyElapsedSeconds(session.startedAt, null, now.getTime()) <
          STUDY_MIN_SECONDS)
    ) {
      throw new StudySessionError("对话满 10 分钟后才能结束，请继续交流。");
    }
    const [updated] = await tx
      .update(studySession)
      .set(action === "start" ? { startedAt: now } : { endedAt: now })
      .where(eq(studySession.id, id))
      .returning();
    return updated;
  });
}

export function saveStudyExchange(
  sessionId: string,
  userText: string,
  assistantText: string
) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(studySession)
      .where(eq(studySession.id, sessionId))
      .for("update");
    if (!session?.startedAt || session.endedAt) {
      throw new StudySessionError("本次对话尚未开始或已经结束，请刷新页面。");
    }
    const [{ total }] = await tx
      .select({ total: count() })
      .from(studyMessage)
      .where(eq(studyMessage.sessionId, sessionId));
    const [userMessage] = await tx
      .insert(studyMessage)
      .values({
        content: userText,
        role: "user",
        sequence: total + 1,
        sessionId,
      })
      .returning();
    const [assistantMessage] = await tx
      .insert(studyMessage)
      .values({
        content: assistantText,
        role: "assistant",
        sequence: total + 2,
        sessionId,
      })
      .returning();
    return [userMessage, assistantMessage];
  });
}

export function getStudyExportRows() {
  return db
    .select({
      condition: studySession.condition,
      content: studyMessage.content,
      endedAt: studySession.endedAt,
      messageCreatedAt: studyMessage.createdAt,
      messageId: studyMessage.id,
      model: studySession.model,
      participantId: studySession.id,
      role: studyMessage.role,
      sequence: studyMessage.sequence,
      sessionCreatedAt: studySession.createdAt,
      startedAt: studySession.startedAt,
      systemPrompt: studySession.systemPrompt,
    })
    .from(studySession)
    .leftJoin(studyMessage, eq(studyMessage.sessionId, studySession.id))
    .orderBy(asc(studySession.createdAt), asc(studyMessage.sequence));
}
