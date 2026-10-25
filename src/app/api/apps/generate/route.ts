import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { genRuns, type GenStep } from '@/lib/db/schema';
import { generateSpec } from '@/lib/agent/pipeline';
import { getProvider } from '@/lib/agent/provider';
import { createAppFromSpec } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Body = { prompt?: string; csv?: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const prompt = (body.prompt ?? '').trim();
  const csv = (body.csv ?? '').trim();
  if (prompt.length < 2 && csv.length === 0) {
    return Response.json({ error: '请至少描述一句需求，或上传一份表格' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const effectivePrompt = prompt.length >= 2 ? prompt : '按上传的表格生成一套登记系统';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let runId: string | null = null;
      const stepMap = new Map<string, GenStep>();

      try {
        const [run] = await db
          .insert(genRuns)
          .values({ prompt: effectivePrompt, status: 'running', model: getProvider().name })
          .returning();
        runId = run.id;
        send({ t: 'run', runId: run.id, model: getProvider().name });

        const { spec, attempts, model, fallbackNote } = await generateSpec({
          prompt: effectivePrompt,
          csv: csv.length > 0 ? csv : null,
          emit: (event) => {
            if (event.t === 'step') {
              stepMap.set(event.id, {
                id: event.id,
                label: event.label,
                status: event.status,
                detail: event.detail,
              });
            }
            send(event);
          },
        });

        const { app, shareToken } = await createAppFromSpec({ spec, prompt: effectivePrompt, model });

        await db
          .update(genRuns)
          .set({
            appId: app.id,
            status: 'done',
            attempts,
            model,
            steps: Array.from(stepMap.values()),
            finishedAt: new Date(),
          })
          .where(eq(genRuns.id, run.id));

        send({ t: 'saved', appId: app.id, shareToken, name: spec.app.name, attempts, fallbackNote });
      } catch (err) {
        const message = (err as Error).message;
        if (runId) {
          await db
            .update(genRuns)
            .set({
              status: 'failed',
              error: message.slice(0, 800),
              steps: Array.from(stepMap.values()),
              finishedAt: new Date(),
            })
            .where(eq(genRuns.id, runId))
            .catch(() => undefined);
        }
        send({ t: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
