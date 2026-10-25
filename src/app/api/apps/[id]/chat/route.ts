import { getApp, getCurrentSpec, bumpVersion, listVersions } from '@/lib/data';
import { buildPatch } from '@/lib/agent/patchAgent';
import { applyPatch, validateAfterApply, summarizeDropped } from '@/lib/patch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Body = { instruction?: string };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const app = await getApp(params.id);
  if (!app) return Response.json({ error: '应用不存在', code: 'NOT_FOUND' }, { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: '请求体不是合法 JSON', code: 'PARSE_FAILED' }, { status: 422 });
  }

  const instruction = (body.instruction ?? '').trim();
  if (instruction.length < 2 || instruction.length > 500) {
    return Response.json(
      { error: '指令长度需在 2–500 字之间', code: 'PATCH_OUT_OF_SCOPE' },
      { status: 422 },
    );
  }

  const spec = await getCurrentSpec(app.id, app.currentVersion);
  if (!spec) return Response.json({ error: '当前版本缺失', code: 'NOT_FOUND' }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const historyRows = await listVersions(app.id);
        const history = historyRows
          .filter((v) => v.note)
          .slice(0, 3)
          .map((v) => `v${v.version}：${v.note}`);

        const out = await buildPatch({ spec, instruction, history });
        send({
          t: 'patch',
          patch: out.patch,
          model: out.model,
          note: out.note,
          degraded: out.degraded,
          fallbackNote: out.fallbackNote,
        });

        if (out.patch.length === 0) {
          send({
            t: 'done',
            versionNo: app.currentVersion,
            appliedOps: 0,
            droppedOps: 0,
            degraded: true,
            note: out.note ?? '没有识别出可执行的修改',
          });
          return;
        }

        const applied = applyPatch(spec, out.patch);
        if (applied.dropped.length > 0) {
          send({
            t: 'warn',
            reason: summarizeDropped(applied.dropped),
            dropped: applied.dropped,
          });
        }

        if (applied.applied.length === 0) {
          send({
            t: 'done',
            versionNo: app.currentVersion,
            appliedOps: 0,
            droppedOps: applied.dropped.length,
            degraded: true,
            note: '所有补丁都被拒绝，未产生新版本',
          });
          return;
        }

        const check = validateAfterApply(applied.spec);
        if (!check.ok) {
          send({
            t: 'error',
            code: 'SPEC_INVALID',
            message: '这次修改会让应用结构不合法，已放弃，未产生新版本',
            issues: check.issues,
          });
          return;
        }

        const versionNo = await bumpVersion({
          appId: app.id,
          spec: check.spec,
          patch: applied.applied,
          note: instruction.slice(0, 60),
        });

        send({
          t: 'done',
          versionNo,
          appliedOps: applied.applied.length,
          droppedOps: applied.dropped.length,
          degraded: false,
        });
      } catch (err) {
        send({ t: 'error', code: 'PATCH_FAILED', message: (err as Error).message });
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
