import { getAppByToken, insertRecord, validateRecordPayload } from '@/lib/data';

export const dynamic = 'force-dynamic';

type Body = { entity?: string; payload?: Record<string, unknown> };

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const found = await getAppByToken(params.token);
  if (!found) return Response.json({ error: '链接无效或已过期' }, { status: 404 });

  const { app, spec, link } = found;
  if (link.scope !== 'write') {
    return Response.json({ error: '该链接为只读链接，不能提交数据' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const entityKey = body.entity ?? spec.sharePolicy.entities[0];
  if (!spec.sharePolicy.entities.includes(entityKey)) {
    return Response.json({ error: '该实体不允许通过分享链接提交' }, { status: 403 });
  }

  const entity = spec.entities.find((e) => e.key === entityKey);
  if (!entity) return Response.json({ error: '实体不存在' }, { status: 400 });

  const result = validateRecordPayload(entity, body.payload ?? {});
  if (!result.ok) {
    return Response.json({ error: '校验未通过', fieldErrors: result.errors }, { status: 422 });
  }

  const row = await insertRecord(app.id, entity.key, result.clean);
  return Response.json({ ok: true, record: row }, { status: 201 });
}
