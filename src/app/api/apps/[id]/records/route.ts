import { getApp, getCurrentSpec, insertRecord, validateRecordPayload } from '@/lib/data';

export const dynamic = 'force-dynamic';

type Body = { entity?: string; payload?: Record<string, unknown> };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const app = await getApp(params.id);
  if (!app) return Response.json({ error: '应用不存在' }, { status: 404 });

  const spec = await getCurrentSpec(app.id, app.currentVersion);
  if (!spec) return Response.json({ error: '应用版本缺失' }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const entityKey = body.entity ?? spec.entities[0]?.key;
  const entity = spec.entities.find((e) => e.key === entityKey);
  if (!entity) return Response.json({ error: `实体 ${entityKey} 不存在` }, { status: 400 });

  const result = validateRecordPayload(entity, body.payload ?? {});
  if (!result.ok) {
    return Response.json({ error: '校验未通过', fieldErrors: result.errors }, { status: 422 });
  }

  const row = await insertRecord(app.id, entity.key, result.clean);
  return Response.json({ ok: true, record: row }, { status: 201 });
}
