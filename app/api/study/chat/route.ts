import { ipAddress } from "@vercel/functions";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { checkIpRateLimit } from "@/lib/ratelimit";
import {
  getStudyMessages,
  getStudySession,
  saveStudyExchange,
} from "@/lib/study/queries";
import { getStudyMaxExchanges } from "@/lib/study/study";
import { StudySessionError } from "@/lib/study/timing";

export const maxDuration = 60;

const requestSchema = z.object({
  participantId: z.uuid(),
  text: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "请刷新页面后重试。" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(
      { error: "消息格式无效或超过 2000 字。" },
      { status: 400 }
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "管理员尚未配置模型 API Key。" },
      { status: 503 }
    );
  }

  try {
    await checkIpRateLimit(ipAddress(request));
  } catch {
    return Response.json(
      { error: "发送过于频繁，请稍后再试。" },
      { status: 429 }
    );
  }

  try {
    const studySession = await getStudySession(parsed.data.participantId);
    if (!studySession || studySession.userId !== session.user.id) {
      return Response.json({ error: "无权访问该对话。" }, { status: 403 });
    }
    if (!studySession.startedAt || studySession.endedAt) {
      return Response.json(
        { error: "本次对话尚未开始或已经结束，请刷新页面。" },
        { status: 409 }
      );
    }

    const history = await getStudyMessages(studySession.id);
    const maxExchanges = getStudyMaxExchanges();
    if (
      maxExchanges !== null &&
      history.filter((item) => item.role === "user").length >= maxExchanges
    ) {
      return Response.json(
        { error: "已达到设定的对话轮数，请在满 10 分钟后点击结束对话。" },
        { status: 409 }
      );
    }
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      body: JSON.stringify({
        messages: [
          { content: studySession.systemPrompt, role: "system" },
          ...history.map(({ role, content }) => ({ content, role })),
          { content: parsed.data.text, role: "user" },
        ],
        model: studySession.model,
        stream: false,
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(55_000),
    });

    if (!response.ok) {
      console.error("DeepSeek request failed with status", response.status);
      return Response.json(
        { error: "AI 暂时无法回复，请稍后重试。" },
        { status: 502 }
      );
    }

    const result = await response.json();
    const answer = result?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      return Response.json(
        { error: "AI 未返回有效回复，请重试。" },
        { status: 502 }
      );
    }

    const messages = await saveStudyExchange(
      studySession.id,
      parsed.data.text,
      answer.trim()
    );
    return Response.json({ messages });
  } catch (error) {
    if (error instanceof StudySessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Study chat failed:", error);
    return Response.json({ error: "发送失败，请重试。" }, { status: 503 });
  }
}
