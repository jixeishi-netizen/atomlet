import { getApp, insertRecord } from '@/lib/data';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024;

/**
 * 交互式页面（沙箱 iframe 里跑的游戏/工具）的数据落库通道。
 * 这类页面没有实体与字段约束，payload 是自由结构，所以只做体积与类型兜底，
 * 不套 validateRecordPayload（那是给业务表单用的）。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const app = await getApp(params.id);
  if (!app) return Response.json({ error: '应用不存在' }, { status: 404 });

  let body: { data?: unknown };
  try {
    body = (await req.json()) as { data?: unknown };
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (body.data === null || typeof body.data !== 'object') {
    return Response.json({ error: 'data 必须是对象' }, { status: 422 });
  }

  const serialized = JSON.stringify(body.data);
  if (serialized.length > MAX_BYTES) {
    return Response.json({ error: `数据过大（上限 ${MAX_BYTES / 1024}KB）` }, { status: 413 });
  }

  const row = await insertRecord(app.id, '_interaction', {
    ...(body.data as Record<string, unknown>),
    _savedAt: new Date().toISOString(),
  });

  return Response.json({ ok: true, id: row.id }, { status: 201 });
}
