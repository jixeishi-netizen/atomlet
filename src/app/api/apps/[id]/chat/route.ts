import { appendMessage, getApp, getCurrentSpec, bumpVersion, listVersions } from '@/lib/data';
import { buildPatch } from '@/lib/agent/patchAgent';
import { applyPatch, validateAfterApply, summarizeDropped } from '@/lib/patch';
import { applyConstraintHints } from '@/lib/agent/pipeline';

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
        // 先落用户这句指令（在调用模型之前），再落助手结果：
        // 这样即使模型超时/崩溃，用户回来也能看到"我说过什么"（缺陷 1）
        await appendMessage({
          appId: app.id,
          role: 'user',
          content: instruction,
          version: app.currentVersion,
          meta: { kind: 'patch' },
        });

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
          const note = out.note ?? '没有识别出可执行的修改';
          await appendMessage({
            appId: app.id,
            role: 'assistant',
            content: `未产生新版本（仍为 v${app.currentVersion}）：${note}`,
            version: app.currentVersion,
            meta: {
              kind: 'patch',
              ops: 0,
              dropped: 0,
              degraded: true,
              model: out.model,
              note,
            },
          });
          send({
            t: 'done',
            versionNo: app.currentVersion,
            appliedOps: 0,
            droppedOps: 0,
            degraded: true,
            note,
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
          const note = '所有补丁都被拒绝，未产生新版本';
          await appendMessage({
            appId: app.id,
            role: 'assistant',
            content: `未产生新版本（仍为 v${app.currentVersion}）：${note}`,
            version: app.currentVersion,
            meta: {
              kind: 'patch',
              ops: 0,
              dropped: applied.dropped.length,
              degraded: true,
              model: out.model,
              note,
            },
          });
          send({
            t: 'done',
            versionNo: app.currentVersion,
            appliedOps: 0,
            droppedOps: applied.dropped.length,
            degraded: true,
            note,
          });
          return;
        }

        // 自然语言约束（「金额大于 0」）在改结构时同样要落到字段上（缺陷 3）
        const hinted = applyConstraintHints(applied.spec, instruction);
        if (hinted.changed.length > 0) {
          send({
            t: 'text',
            text: `按需求补充了字段下限：${hinted.changed.join('、')}`,
          });
        }

        const check = validateAfterApply(hinted.spec);
        if (!check.ok) {
          await appendMessage({
            appId: app.id,
            role: 'assistant',
            content: `未产生新版本（仍为 v${app.currentVersion}）：这次修改会让应用结构不合法，已放弃`,
            version: app.currentVersion,
            meta: {
              kind: 'failed',
              ops: applied.applied.length,
              dropped: applied.dropped.length,
              degraded: true,
              model: out.model,
              note: check.issues.map((i) => `${i.code} ${i.path}`).join('; ').slice(0, 200),
            },
          });
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

        const parts = [`已生成 v${versionNo}：应用 ${applied.applied.length} 处修改`];
        if (applied.dropped.length > 0) parts.push(`丢弃 ${applied.dropped.length} 处`);
        if (hinted.changed.length > 0) parts.push(`补充下限约束 ${hinted.changed.join('、')}`);
        if (out.note) parts.push(out.note);

        await appendMessage({
          appId: app.id,
          role: 'assistant',
          content: parts.join('；'),
          version: versionNo,
          meta: {
            kind: 'patch',
            ops: applied.applied.length,
            dropped: applied.dropped.length,
            degraded: false,
            model: out.model,
            note: out.note ?? null,
            fallbackNote: out.fallbackNote ?? null,
            instructions: hinted.changed,
          },
        });

        send({
          t: 'done',
          versionNo,
          appliedOps: applied.applied.length,
          droppedOps: applied.dropped.length,
          degraded: false,
        });
      } catch (err) {
        const message = (err as Error).message;
        await appendMessage({
          appId: app.id,
          role: 'assistant',
          content: `未产生新版本（仍为 v${app.currentVersion}）：修改失败，${message.slice(0, 120)}`,
          version: app.currentVersion,
          meta: { kind: 'failed', degraded: true, note: message.slice(0, 200) },
        });
        send({ t: 'error', code: 'PATCH_FAILED', message });
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
