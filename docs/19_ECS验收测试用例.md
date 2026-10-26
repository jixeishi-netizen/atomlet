# 19. ECS 验收测试用例（已部署实例）

| 项 | 内容 |
|---|---|
| 被测对象 | Atomlet `0.1.0`（Next.js 14.2.35，standalone 镜像） |
| 被测环境 | 阿里云 ECS，Docker Compose，`/opt/atomlet` |
| 访问地址 | 公网 `http://118.178.174.105:3000`，本机 `http://127.0.0.1:3000` |
| 容器 | `atomlet-db`（postgres:16-alpine）、`atomlet-web`（atomlet-web 镜像，`0.0.0.0:3000->3000/tcp`） |
| 模型通道 | DeepSeek `deepseek-flash`（真实通道），失败自动降级 `mock` |
| 执行身份 | root，登录 ECS 后 `cd /opt/atomlet` |
| 用例编号 | `E-01` ~ `E-18`（延续 `docs/11` 的编号风格，`E` = Environment/ECS） |
| 编写依据 | `docs/17`（部署）、`docs/16`（本地实测）、`docs/08` §5（接口契约）、`docs/15` §9（P-01~P-09）、`src/app/api/**`、`src/lib/**` 源码 |
| 与本地测试的分工 | `docs/16` 已覆盖生成质量基准、patch 引擎自检、主流程冒烟。本文档**只补 ECS 特有维度**：外网可达、容器与数据卷、重启持久化、密钥外泄、备份恢复、并发、降级通道 |

> **本文档不重复** `docs/15` §9 的 P-01 ~ P-09 语义用例。P-05（越界补丁被丢弃）、P-06（`SPEC_INVALID` 不产生版本）在本文档由 E-10 / E-11 以「不变量」形式复验，因为这两条在已部署实例上无法注入补丁，只能通过真实模型驱动。

---

## 1. 当前已知状态（执行前必读）

| 检查项 | 实测结果 | 影响 |
|---|---|---|
| ECS 本机 `curl -sI http://127.0.0.1:3000/` | `HTTP/1.1 200 OK`，`X-Powered-By: Next.js` | 应用本身正常 |
| `docker compose ps` | `atomlet-db` healthy、`atomlet-web` healthy | 容器正常 |
| 容器日志 | `Ready in 41ms` | 启动正常 |
| 外部网络访问 `http://118.178.174.105:3000` | `curl: (28) Connection timed out`（15s 超时，不是 refused） | **安全组未放行 3000** |

**结论：E-01 当前为失败态，E-07 的手机 4G 子项依赖 E-01。** 其余 16 条用例全部走 `127.0.0.1`，不受安全组影响，现在就能跑。

放行安全组后再跑 E-01 与 E-07 子项，其余用例结果不需要重跑。

---

## 2. 一轮执行总览

| 编号 | 优先级 | 覆盖维度 | 预计耗时 | 依赖 |
|---|---|---|---|---|
| E-01 | P0 | 外网可达与安全组（超时 / refused / 502 三态区分） | 3 min | 无 |
| E-02 | P0 | 健康检查与数据库连通（`/api/healthz`，含 503 语义） | 2 min | 无 |
| E-03 | P0 | 容器状态与数据卷持久化 | 2 min | 无 |
| E-04 | P0 | 一句话生成（真实模型，验证无 `fallbackNote`） | 6 min | 无 |
| E-05 | P0 | 记录入库 + 字段校验拦截（422 逐字段报错） | 5 min | E-04 |
| E-06 | P0 | 统计卡随数据变化 | 4 min | E-04 |
| E-07 | P0 | 分享链接免登录填报（含手机 4G 真外网） | 6 min | E-04、E-01 |
| E-08 | P0 | 一句话改需求（JSON Patch）+ 版本号递增 | 5 min | E-04 |
| E-09 | P0 | 回滚 + 数据一条不丢 | 5 min | E-08 |
| E-10 | P0 | 越界补丁被丢弃（诱导改写 `/specVersion`） | 4 min | E-08 |
| E-11 | P0 | 非法枚举被拦（诱导非法 theme） | 4 min | E-08 |
| E-12 | P0 | 容器重启 / 重建后数据仍在 | 4 min | E-09 |
| E-13 | P0 | 模型不可用时降级（`fallbackNote` 而非 500） | 8 min | E-04 |
| E-14 | P0 | 密钥不进前端（页面、JS、镜像内均无 `sk-`） | 4 min | 无 |
| E-15 | P1 | 备份与恢复（`pg_dump` 到恢复的最小验证） | 6 min | E-09 |
| E-16 | P1 | 并发生成（4 路并发，观察终态与一致性） | 6 min | 无 |
| E-17 | P1 | 分享链接越权防护（无效 token / 只读 token） | 4 min | E-04 |
| E-18 | P1 | 错误码一致性（400 / 404 / 409 / 422） | 4 min | E-04 |

**耗时合计：P0 十四条 62 分钟；P1 四条 20 分钟；一轮全量 82 分钟。**

---

## 3. 执行前的公共准备（每开一个新终端都要跑）

```bash
cd /opt/atomlet
LOCAL=http://127.0.0.1:3000
EXT=http://118.178.174.105:3000

PSQL() { docker compose exec -T db psql -U atomlet -d atomlet -tAc "$1"; }

RECMD5() { PSQL "select md5(coalesce(string_agg(payload::text, '|' order by id), '')) from app_records where app_id='$APP_ID'"; }
```

**命令约定（照这个前提读下面的用例）：**

1. `PSQL "..."` 等价于 `docker compose exec -T db psql -U atomlet -d atomlet -tAc "..."`，只输出值、不带表头与空格。`-T` 关闭 TTY，避免管道卡住。
2. 函数与 `APP_ID` / `TOKEN` 变量只在**同一个终端会话**内有效。新开终端先重跑本节。
3. `POST /api/apps/generate` 与 `POST /api/apps/:id/chat` 返回 `text/event-stream`，每行是 `data: {...}`。**这两个接口在业务失败时 HTTP 仍是 200**，失败信息在流内的 `{"t":"error"}` 事件里。判定看流内最后一条事件，不看 HTTP 码。
4. 生成接口的 `{"t":"saved"}` 事件形如 `data: {"t":"saved","appId":"...","shareToken":"...","name":"...","attempts":1}`；降级时多一个 `"fallbackNote":"..."` 字段。
5. 所有 `curl` 都带 `-s`；需要状态码时带 `-w "\nHTTP %{http_code}\n"`。
6. 带变量的 JSON 用双引号包外层、变量处不转义：`-d "{\"payload\":$PAYLOAD}"`。

**`APP_ID` 丢了的恢复命令**（重连终端后重新取最近生成的应用）：

```bash
APP_ID=$(PSQL "select id from apps order by created_at desc limit 1")
echo "APP_ID=$APP_ID"
```

**基准应用命名约定**：下文所有 `$APP_ID` 都指 E-04 生成的那一个应用，本文档称「基准应用 A」。E-05 ~ E-11、E-15、E-17、E-18 都复用它，不要中途换应用。

---

## 4. 用例

### E-01 外网可达与安全组放行【P0】

**覆盖维度**：外网可达、安全组、端口监听、超时 / refused / 502 三态区分。

**前置条件**
- 已在 ECS 上，`cd /opt/atomlet`。
- `docker compose ps` 显示 `atomlet-web` 为 healthy。
- 手上另有一台不在同一内网的设备（手机 4G 或另一台电脑）用于反向确认。

**执行步骤**

步骤 1：确认应用在 ECS 本机是通的（排除应用自身问题）

```bash
curl -s -o /dev/null -w "local_code=%{http_code} time=%{time_total}\n" --max-time 10 $LOCAL/
curl -sI --max-time 10 $LOCAL/ | head -6
```

步骤 2：确认宿主机确实在 0.0.0.0:3000 上监听（排除端口映射问题）

```bash
ss -ltnp | grep ':3000'
docker compose ps --format '{{.Name}} | {{.Status}} | {{.Ports}}'
```

步骤 3：从公网侧自测（这是本用例的主判定）

```bash
curl -s -o /dev/null -w "ext_code=%{http_code} time=%{time_total}\n" --max-time 15 $EXT/
curl -sI --max-time 15 $EXT/ | head -6
```

步骤 4：用三种现象定位失败在哪一层

```bash
# a) 端口是否可达（超时会直接打印 timeout，refused 会立刻返回）
curl -sv --max-time 8 $EXT/ 2>&1 | grep -E 'Trying|Connected|timed out|refused|HTTP/'

# b) 主机防火墙是否放行
systemctl is-active firewalld 2>/dev/null; systemctl is-active ufw 2>/dev/null
iptables -S INPUT 2>/dev/null | head -5

# c) 是否被前置代理接管（返回 502 时看这条）
which nginx >/dev/null 2>&1 && nginx -T 2>/dev/null | grep -c 'proxy_pass'
```

**期望结果**

- 步骤 1：输出 `local_code=200`，响应头含 `HTTP/1.1 200 OK` 与 `X-Powered-By: Next.js`。
- 步骤 2：`ss -ltnp` 输出含 `0.0.0.0:3000`；`docker compose ps` 中 `atomlet-web` 一行含 `0.0.0.0:3000->3000/tcp` 与 `(healthy)`。
- 步骤 3：输出 `ext_code=200`，`time` 小于 `1.0`；响应头含 `X-Powered-By: Next.js`。
- 步骤 4 的三种失败现象对照：

| 观察到的输出 | 含义 | 修的地方 |
|---|---|---|
| `curl: (28) Failed to connect ... timed out`（等待 8–15s 才报） | 数据包被丢弃：安全组或网络 ACL 未放行 | 阿里云控制台放行 TCP 3000 |
| `curl: (7) Failed to connect ... Connection refused`（几毫秒就报） | 端口可达但无人监听：web 容器挂了或端口没映射 | `docker compose up -d`、查 `ss -ltnp` |
| `HTTP/1.1 502 Bad Gateway` | 前面有代理（Nginx/ALB）转发到 127.0.0.1:3000 失败 | 查 `nginx -t`、`docker compose ps`、上游地址 |

安全组放行路径：阿里云控制台 → ECS → 实例 → 点实例名 → 「安全组」标签 → 「配置规则」→ 入方向 → 手动添加：协议类型 `TCP`、端口范围 `3000/3000`、授权对象 `0.0.0.0/0`（演示期；正式用限源 IP）→ 保存，立即生效，不需要重启实例。

如已安装阿里云 CLI，可先确认参数再执行：

```bash
aliyun ecs AuthorizeSecurityGroup --help | head -30
```

放行后重跑步骤 3 复核。

**判定标准**

公网 `curl` 返回 `ext_code=200` 且响应头含 `X-Powered-By: Next.js`，同一地址在手机 4G 上能打开首页，即为通过。当前状态为**未通过**（超时），必须先放行 3000 再重测。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 步骤 1 就失败（本机也不通） | 容器未就绪或应用崩溃 | `docker compose ps` → `docker compose logs --tail=100 web` → `docker compose up -d` |
| 步骤 3 超时，但手机浏览器用 `https://` 打不开也打不卡 | 安全组只放行了 22，或放了 80/443 没放 3000 | 控制台按上文路径加 `3000/3000`；复核 `iptables -S INPUT \| head -5` 无 DROP 规则 |
| 步骤 3 返回 502 | 前面有 Nginx 反代且上游挂了 | `nginx -t && systemctl reload nginx`；`docker compose ps` 确认 web healthy |

---

### E-02 健康检查与数据库连通【P0】

**覆盖维度**：`/api/healthz`、数据库连通性、容器 healthcheck、DB 断连时的 503 语义。

**前置条件**
- 已执行 §3 公共准备。
- `docker compose ps` 两个容器均为 healthy。

**执行步骤**

```bash
# 2a 健康检查（应用内探活，含 DB ping）
curl -s -w "\nHTTP %{http_code}\n" $LOCAL/api/healthz

# 2b 数据库直连交叉验证（不看应用，直接问 PG）
PSQL "select 1"

# 2c 容器级健康状态与表清单
docker inspect atomlet-web --format '{{.State.Health.Status}}'
docker inspect atomlet-db --format '{{.State.Health.Status}}'
PSQL "select tablename from pg_tables where schemaname='public' order by tablename"
```

可选步骤（验证 503 语义，一次性粘贴，末尾自动恢复）：

```bash
# 2d 停库 → 期望 503 → 起库 → 期望恢复
docker compose stop db
curl -s -w "\nHTTP %{http_code}\n" $LOCAL/api/healthz
docker compose start db
for i in $(seq 1 40); do curl -sf -o /dev/null $LOCAL/api/healthz && break; sleep 2; done
curl -s -w "\nHTTP %{http_code}\n" $LOCAL/api/healthz
```

**期望结果**

- 2a：`{"ok":true,"db":"up","ts":"2026-..."}`，`HTTP 200`。
- 2b：输出 `1`。
- 2c：两行都是 `healthy`；表清单为 5 行：`app_records`、`app_versions`、`apps`、`gen_runs`、`share_links`。
- 2d：停库后返回 `{"ok":false,"db":"down","error":"..."}` 与 `HTTP 503`；起库后健康检查恢复 `{"ok":true,"db":"up"}` 与 `HTTP 200`。

**判定标准**

`/api/healthz` 返回 `ok:true`、`db:up`、HTTP 200，且 `psql select 1` 成功、5 张表齐备，即为通过。2d 是 503 语义的加分证据，不作为主判定。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| `{"ok":false,"db":"down",...}` HTTP 503 | `DATABASE_URL` 写错（主机名写成了 localhost）或密码与 `POSTGRES_PASSWORD` 不一致 | `grep '^DATABASE_URL' .env` 确认主机名是 `db`；`docker compose up -d --force-recreate web` |
| 健康检查 200 但表清单为空 | 建表脚本没执行 | `docker compose exec -T db psql -U atomlet -d atomlet < drizzle/0000_init.sql` |
| 2d 停库后容器一直 unhealthy 不恢复 | db 起不来（密码/数据目录权限） | `docker compose logs --tail=80 db`；`docker compose up -d` |

---

### E-03 容器状态与数据卷持久化【P0】

**覆盖维度**：`docker compose ps`、named volume 挂载、数据只在卷里。

**前置条件**
- 已执行 §3 公共准备。

**执行步骤**

```bash
# 3a 两个容器的状态与端口
docker compose ps --format '{{.Name}} | {{.Image}} | {{.Status}} | {{.Ports}}'

# 3b db 容器的挂载点（确认 PGDATA 落在 named volume 上）
docker inspect atomlet-db --format '{{range .Mounts}}{{.Type}} | {{.Name}} | {{.Destination}}{{"\n"}}{{end}}'

# 3c 卷本身存在、且有实际大小
VOL=$(docker inspect atomlet-db --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')
echo "VOL=$VOL"
docker volume inspect "$VOL" --format '{{.Name}} | {{.Driver}} | {{.Mountpoint}}'
du -sh /var/lib/docker/volumes/"$VOL"/_data

# 3d web 容器不应持有业务数据卷（数据唯一来源是 db 的卷）
docker inspect atomlet-web --format '{{range .Mounts}}{{.Type}} | {{.Destination}}{{"\n"}}{{end}}'
```

**期望结果**

- 3a：两行，`atomlet-db` 状态含 `(healthy)`、端口列不含 `0.0.0.0`（DB 只在容器网络内）；`atomlet-web` 状态含 `(healthy)`、端口列 `0.0.0.0:3000->3000/tcp`。
- 3b：一行 `volume | atomlet_pgdata | /var/lib/postgresql/data`（卷名前缀随 compose 项目名，目录名为 `atomlet` 时为 `atomlet_pgdata`）。
- 3c：`VOL=atomlet_pgdata`；`docker volume inspect` 输出含 `local` 与 `/var/lib/docker/volumes/atomlet_pgdata/_data`；`du -sh` 输出大于 `30M`。
- 3d：web 容器挂载列表为空（无输出）。

**判定标准**

`PGDATA` 确实挂在 named volume（Type 为 `volume`）上并占用了实际磁盘空间，且 db 容器端口未对宿主机暴露，即为通过。这三条同时说明「删掉 web 容器不会丢数据」。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 3b 显示 `bind` 而不是 `volume`，或 Destination 不是 `/var/lib/postgresql/data` | compose 文件被改过，数据写进宿主目录 | `grep -A3 'volumes' docker-compose.yml`；恢复 `volumes: ['pgdata:/var/lib/postgresql/data']` 后重建 |
| `du -sh` 报 `No such file or directory` | 卷名取错（compose 项目名不是 `atomlet`） | `docker volume ls \| grep pgdata` 取真实名字后手工替换 `$VOL` |
| 3a 中 web 端口列是 `127.0.0.1:3000->3000/tcp` | 端口绑到回环，外网永远打不开 | 改回 `ports: ['3000:3000']` 后 `docker compose up -d` |

---

### E-04 一句话生成（真实模型，确认无降级）【P0】

**覆盖维度**：生成主流程、真实模型通道是否生效、`fallbackNote` 是否出现、`gen_runs` 可观测性、生成结果可渲染。

**前置条件**
- 已执行 §3 公共准备。
- `.env` 中 `LLM_PROVIDER=openai` 且 `LLM_API_KEY` 非空（`grep -c '^LLM_API_KEY=sk-' .env` 输出 `1`）。

**执行步骤**

```bash
# 4a 生成一个基准应用（SSE，逐行输出）
curl -sN -w '\n[HTTP %{http_code}]\n' -X POST $LOCAL/api/apps/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"做一个门店巡检登记：门店名称、所属区域、巡检日期、巡检得分、检查结果（合格/不合格/整改中）、发现问题"}' \
  | tee /tmp/gen1.log | tail -6

# 4b 从流里取 appId 与 token
APP_ID=$(grep -o '"appId":"[^"]*"' /tmp/gen1.log | head -1 | cut -d'"' -f4)
TOKEN=$(grep -o '"shareToken":"[^"]*"' /tmp/gen1.log | head -1 | cut -d'"' -f4)
echo "APP_ID=$APP_ID"; echo "TOKEN=$TOKEN"

# 4c 通道判定：run 事件的 model 字段
grep -o '"t":"run","runId":"[^"]*","model":"[^"]*"' /tmp/gen1.log | head -1

# 4d 是否降级：出现 fallbackNote 即降级
echo "fallback 次数: $(grep -c 'fallbackNote' /tmp/gen1.log)"

# 4e 数据库侧核对（模型名、状态、尝试次数、错误）
PSQL "select status, model, attempts, coalesce(left(error,60),'-') from gen_runs order by started_at desc limit 1"

# 4f 生成结果可打开、字段齐全
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID
PSQL "select string_agg(f->>'label', ' / ') from app_versions v, jsonb_array_elements(v.spec->'entities'->0->'fields') f where v.app_id='$APP_ID' and v.version=1"
PSQL "select jsonb_array_length(spec->'pages') from app_versions where app_id='$APP_ID' and version=1"
```

**期望结果**

- 4a：`[HTTP 200]`；流内依次出现 `{"t":"run",...}`、若干 `{"t":"step",...}`、最后一条为 `{"t":"saved",...}`。
- 4b：`APP_ID` 是 36 位 UUID；`TOKEN` 是 12 位字母数字（`newToken()` 固定 12 位）。
- 4c：输出含 `"model":"openai+fallback"`——这是通道已切到真实模型的标志；输出 `"model":"mock"` 表示根本没走真实通道。
- 4d：`fallback 次数: 0`。
- 4e：`done | deepseek-flash | 1 | -`（三列分别是 status、model、attempts、error，error 为 `-`）。
- 4f：`app_page=200`；字段标签串含「门店」「区域」「日期」「得分」「结果」，字段数 ≥ 6；页面数 ≥ 3（含表单页与列表页）。

**判定标准**

`gen_runs.model` 落在 `deepseek-flash` 上、`fallbackNote` 出现 0 次、`status=done`、应用页 HTTP 200 且字段覆盖需求里列出的 6 个业务项，即为通过。若 `model` 是 `mock:template` 或 `mock(降级)`，判**不通过**——本轮验收要求真实模型通道。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| `4c` 输出 `"model":"mock"`，4e 是 `mock:template` | `LLM_PROVIDER` 不是 `openai`，或 `LLM_API_KEY` 为空，`getProvider()` 直接返回 mock | `grep -E '^LLM_(PROVIDER\|API_KEY\|MODEL)' .env`；改完执行 `docker compose up -d --force-recreate web`（`restart` 不会重读 `env_file`） |
| 4e 是 `mock(降级)` 且 error 非 `-`，或 4d 出现 `fallbackNote` | key 失效/余额不足/模型名写错，触发 `withFallback` | 看 `docker compose logs --tail=50 web` 里的 `模型调用失败 4xx`；确认 `LLM_MODEL=deepseek-flash`（DeepSeek 仅支持该值与 `deepseek-v4-pro`） |
| 4f `app_page=500` 或页面提示「缺少版本快照」 | `app_versions` 写入失败（`bumpVersion`/`createAppFromSpec` 事务出错） | `PSQL "select version from app_versions where app_id='$APP_ID'"`；重建应用后重测 |

---

### E-05 记录入库与字段校验拦截（422 逐字段）【P0】

**覆盖维度**：`POST /api/apps/:id/records` 写入、必填缺失、数字/枚举/日期类型校验、未知实体、脏数据不入库。

**前置条件**
- E-04 已通过，`APP_ID` 指向基准应用 A。
- 记录基线数：`R0=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")`，记下这个数。

**执行步骤**

先定义一个构造 payload 的辅助函数（合法值 + 指定类型注入非法值），一次性粘贴：

```bash
R0=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")
echo "R0=$R0"

mkpayload() {  # 无参=全合法；mkpayload <fieldType> <badValue>=把一个该类型的字段写成非法值
  PSQL "select jsonb_object_agg(f->>'key', case
      when '$1' <> '' and f->>'type' = '$1' then to_jsonb('$2'::text)
      when f->>'type'='number' then to_jsonb(1)
      when f->>'type'='date' then to_jsonb(to_char(current_date,'YYYY-MM-DD')::text)
      when f->>'type'='bool' then 'true'::jsonb
      when f->>'type'='enum' then to_jsonb(coalesce(f->'enum'->>0,'A')::text)
      when f->>'type'='url' then to_jsonb('https://example.com'::text)
      else to_jsonb('自动验收样本'::text) end)::text
    from app_versions v, jsonb_array_elements(v.spec->'entities'->0->'fields') f
    where v.app_id='$APP_ID' and v.version=(select current_version from apps where id='$APP_ID')
      and f->>'type' not in ('ref','user')"
}

echo "合法 payload: $(mkpayload)"
```

```bash
# 5a 合法提交 → 201
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/records \
  -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload)}"

# 5b 空 payload → 必填缺失（若基准应用无必填字段则返回 201，见判定标准）
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/records \
  -H 'Content-Type: application/json' -d '{"payload":{}}'

# 5c 数字字段写非数字 → 422
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/records \
  -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload number abc)}"

# 5d 枚举字段写越界值 → 422
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/records \
  -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload enum 不存在的取值)}"

# 5e 日期字段写非法格式 → 422
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/records \
  -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload date 2026/01/01)}"

# 5f 未知实体 → 400
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/records \
  -H 'Content-Type: application/json' -d '{"entity":"not_an_entity","payload":{}}'

# 5g 核对：脏数据一条都没进库（只允许 5a 那 1 条）
R1=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")
echo "R0=$R0 -> R1=$R1"
PSQL "select entity, count(*) from app_records where app_id='$APP_ID' group by entity order by entity"
```

**期望结果**

- 5a：`{"ok":true,"record":{"id":"...","payload":{...},"createdAt":"..."}}`，`HTTP 201`；`payload` 里只保留 spec 定义过的字段。
- 5b：`{"error":"校验未通过","fieldErrors":{"<字段key>":"请填写<字段label>", ...}}`，`HTTP 422`；`fieldErrors` 一次列出**全部**缺失的必填字段。
- 5c：`HTTP 422`，`fieldErrors` 中该数字字段的文案为 `<label>必须是数字`。
- 5d：`HTTP 422`，文案为 `<label>取值必须是：<候选1> / <候选2> / ...`。
- 5e：`HTTP 422`，文案为 `<label>格式应为 YYYY-MM-DD`。
- 5f：`{"error":"实体 not_an_entity 不存在"}`，`HTTP 400`。
- 5g：`R1 = R0 + 1`；分实体计数只增加 1 行。

**判定标准**

5a 写入成功且 5c / 5d / 5e 三次非法提交全部 422、`fieldErrors` 的 key 正好是被注入的字段 key、并且 `R1 = R0 + 1`（脏数据零入库），即为通过。5b 若返回 201，说明该应用字段全部非必填——把它记为观察项，不算失败，必填拦截能力由 5c/5d/5e 证明。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 5a 就返回 422，且 `fieldErrors` 提到某字段「请填写」 | 基准应用有 `ref` / `user` 类型必填字段，`mkpayload` 故意跳过了这两类 | `PSQL "select f->>'key',f->>'type' from app_versions v, jsonb_array_elements(v.spec->'entities'->0->'fields') f where v.app_id='$APP_ID' and v.version=(select current_version from apps where id='$APP_ID')"`；先建一条被引用记录，再把手填的 id 加进 payload |
| 5c/5d/5e 返回 201（非法值被接受） | 该应用里没有对应类型的字段，`mkpayload` 的注入条件没命中 | 同上 SQL 查字段类型；若确无该类型，改用存在的类型（如 `longtext` 写 2001 字）重测，并在记录里注明「本次未覆盖 enum」 |
| 5b 返回 201 且库里出现空 payload 记录 | 应用无必填字段，属数据模型正常行为 | `PSQL "delete from app_records where app_id='$APP_ID' and payload='{}'::jsonb"` 清掉这条，继续后面的用例 |

---

### E-06 统计卡随数据变化【P0】

**覆盖维度**：统计卡定义、`count`/`sum`/`avg` 计算、数据变化后数字同步、页面渲染。

**前置条件**
- E-04 已通过；基准应用 A 里已有 E-05 写入的 1 条记录。
- E-05 里定义的 `mkpayload` 函数仍在当前会话内（新开终端则回到 E-05 复制那一段）。

**执行步骤**

```bash
# 6a 看这个应用定义了哪些统计卡
PSQL "select p->>'label' || ' | ' || (p->>'fn') || ' | ' || coalesce(p->>'field','-') from app_versions v, jsonb_array_elements(v.spec->'pages') pg, jsonb_array_elements(pg->'cards') p where v.app_id='$APP_ID' and v.version=(select current_version from apps where id='$APP_ID') and pg->>'type'='stats'"

# 6b 当前真值（SQL 复算，与页面展示对比用）
ENT=$(PSQL "select spec->'entities'->0->>'key' from app_versions where app_id='$APP_ID' and version=(select current_version from apps where id='$APP_ID')")
NUM=$(PSQL "select f->>'key' from app_versions v, jsonb_array_elements(v.spec->'entities'->0->'fields') f where v.app_id='$APP_ID' and v.version=(select current_version from apps where id='$APP_ID') and f->>'type'='number' limit 1")
echo "entity=$ENT number_field=$NUM"
PSQL "select count(*) as cnt from app_records where app_id='$APP_ID' and entity='$ENT'"
PSQL "select coalesce(sum((payload->>'$NUM')::numeric),0) as total from app_records where app_id='$APP_ID' and entity='$ENT'"

# 6c 再写 2 条，观察数字变化
for i in 1 2; do
  curl -s -o /dev/null -w "insert$i=%{http_code} " -X POST $LOCAL/api/apps/$APP_ID/records \
    -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload)}"
done; echo
PSQL "select count(*) as cnt from app_records where app_id='$APP_ID' and entity='$ENT'"
PSQL "select coalesce(sum((payload->>'$NUM')::numeric),0) as total from app_records where app_id='$APP_ID' and entity='$ENT'"

# 6d 页面可渲染
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID
```

**期望结果**

- 6a：输出若干行，形如 `记录总数 | count | -`、`平均巡检得分 | avg | score`。
- 6b：`count(*)` 为 1（或 E-05 之后的值），`sum` 为该数值字段的合计。
- 6c：两次 `insert` 都返回 `201`；`count(*)` 比 6b 多 2；`sum` 增加 2（因为 `mkpayload` 给数值字段填的是 1）。
- 6d：`app_page=200`。
- 浏览器核对：打开 `http://118.178.174.105:3000/apps/$APP_ID`（安全组未放行时用 `http://127.0.0.1:3000/apps/$APP_ID`），点顶部「统计」页签，`count` 类卡片的数字等于 6c 的 `count(*)`，`avg`/`sum` 类卡片的数字等于 6c 的复算值（`avg` 保留位数可能与 SQL 的 numeric 精度不同，取整一致即可）。

**判定标准**

写入 2 条后 `count(*)` 精确增加 2，且浏览器统计页上 `count` 卡片的数字与 SQL 复算一致，即为通过。「数字会变」和「数字算对」两条都要满足，只满足前者不算通过。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 6a 无输出 | 该应用没有 stats 页（生成时没要求统计） | 用 E-08 的对话指令「加一张平均分卡片」补一个 stats 页后重测，或换一个带统计要求的需求重新生成 |
| 页面数字与 SQL 不一致 | 记录写进了别的 `entity`，统计只算 `active.entity` | `PSQL "select entity,count(*) from app_records where app_id='$APP_ID' group by entity"` 对齐实体 key |
| 卡片显示 `NaN` 或空白 | 聚合字段不是 number 类型 | `PSQL "select f->>'key',f->>'type' from app_versions v, jsonb_array_elements(v.spec->'entities'->0->'fields') f where v.app_id='$APP_ID' and v.version=(select current_version from apps where id='$APP_ID')"`，改用 number 字段重建卡片 |

---

### E-07 分享链接免登录填报（含手机 4G）【P0】

**覆盖维度**：token 生成、匿名写入、无 cookie 场景、公网真机填报。

**前置条件**
- E-04 已通过，`TOKEN` 已取到。
- E-01 已通过（手机 4G 子项依赖它）。
- E-05 里定义的 `mkpayload` 函数仍在当前会话内。

**执行步骤**

```bash
# 7a 确认当前应用的分享 token 与 scope
PSQL "select token, scope, coalesce(expires_at::text,'无期限') from share_links where app_id='$APP_ID' order by created_at desc limit 1"

# 7b 匿名提交（不带任何 cookie，模拟外部填报者）
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/public/$TOKEN/records \
  -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload)}"

# 7c 分享页免登录可打开，且渲染的是表单
curl -s -o /dev/null -w "share_page=%{http_code}\n" $LOCAL/p/$TOKEN
curl -s $LOCAL/p/$TOKEN | grep -c '由 Atomlet 生成'
curl -s $LOCAL/p/$TOKEN | grep -c '提交'

# 7d 数据确实进了同一个库、同一个应用
PSQL "select entity, count(*) from app_records where app_id='$APP_ID' group by entity"

# 7e 打印真机要打开的地址
echo "手机 4G 打开：$EXT/p/$TOKEN"
```

7e 之后在**关掉 WiFi、只用蜂窝数据**的手机上执行：

1. 打开上一步打印的地址；
2. 填完表单，点提交；
3. 看到提交成功提示后，回到 ECS 跑一次 7d，确认记录数 +1。

**期望结果**

- 7a：`token` 为 12 位、`scope=write`、`expires_at` 为 `无期限`。
- 7b：`{"ok":true,"record":{...}}`，`HTTP 201`；即使请求没有 cookie 也成功。
- 7c：`share_page=200`；`由 Atomlet 生成` 命中 1 次；`提交` 至少命中 1 次（说明渲染出的是表单而不是空态）。
- 7d：对应实体记录数比 7b 之前多 1。
- 7e：手机 4G 能打开页面、能提交，提交后 7d 的记录数再 +1。

**判定标准**

无 cookie 的匿名 POST 返回 201，且手机 4G 上完成一次真实填报后数据库记录数增加，即为通过。只在本机 `curl` 成功、手机打不开的，判**不通过**——那只是内网可用。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 7b 返回 `404 {"error":"链接无效或已过期"}` | token 取错（取到了别的应用），或 `expires_at` 已过 | `PSQL "select app_id, token, expires_at from share_links order by created_at desc limit 5"`；重新从 7a 取 token |
| 7b 返回 `403 {"error":"该链接为只读链接，不能提交数据"}` | 该应用 spec 的 `sharePolicy.mode` 是 `read` | `PSQL "update share_links set scope='write' where token='$TOKEN'"` 后重测（演示前务必确认改成 write） |
| 手机 4G 打不开 | 安全组未放行 3000 | 回到 E-01 放行后重测 |

---

### E-08 一句话改需求（JSON Patch）+ 版本号递增【P0】

**覆盖维度**：`POST /api/apps/:id/chat`、patch 事件、版本号单调递增、版本快照落库、旧数据不受影响。

**前置条件**
- 基准应用 A 存在（E-04），且已有 ≥1 条记录。
- `.env` 为真实模型通道（与 E-04 相同）。

**执行步骤**

```bash
# 8a 记录改动前的状态
V0=$(PSQL "select current_version from apps where id='$APP_ID'")
R0=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")
F0=$(PSQL "select jsonb_array_length(spec->'entities'->0->'fields') from app_versions where app_id='$APP_ID' and version=$V0")
echo "V0=$V0 R0=$R0 F0=$F0"

# 8b 发一句修改指令（SSE）
curl -sN -w '\n[HTTP %{http_code}]\n' -X POST $LOCAL/api/apps/$APP_ID/chat \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"加一个字段：整改负责人"}' | tee /tmp/chat1.log

# 8c 版本号与字段数变化
V1=$(PSQL "select current_version from apps where id='$APP_ID'")
R1=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")
F1=$(PSQL "select jsonb_array_length(spec->'entities'->0->'fields') from app_versions where app_id='$APP_ID' and version=$V1")
echo "V: $V0 -> $V1 ; records: $R0 -> $R1 ; fields: $F0 -> $F1"

# 8d 版本表里的 patch 条数与备注
PSQL "select version, coalesce(note,'-'), coalesce(jsonb_array_length(patch),0) as ops from app_versions where app_id='$APP_ID' order by version"

# 8e 旧记录的原有字段一个没丢（payload 里仍带 v1 的字段）
PSQL "select count(*) as total, count(*) filter (where payload ? (select spec->'entities'->0->'fields'->0->>'key' from app_versions where app_id='$APP_ID' and version=1)) as has_first_field from app_records where app_id='$APP_ID'"

# 8f 页面仍可打开
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID
```

**期望结果**

- 8a：`V0` 为当前版本号，`R0` ≥ 1，`F0` ≥ 6。
- 8b：`[HTTP 200]`；流内先出现 `{"t":"patch","patch":[{"op":"add",...}],"model":"deepseek-flash",...}`，最后一条为 `{"t":"done","versionNo":<V0+1>,"appliedOps":<n>,"droppedOps":0,"degraded":false}`。
- 8c：`V1 = V0 + 1`；`R1 = R0`（记录数不变）；`F1 = F0 + 1`（多一个字段）。
- 8d：最新一行 `version=V1`，`note` 为 `加一个字段：整改负责人`（截断到 60 字），`ops` 等于 `appliedOps`。
- 8e：`total` 等于 `has_first_field`（每条旧记录都仍带 v1 的第一个字段）。
- 8f：`app_page=200`。

**判定标准**

`done.versionNo` 等于改动前版本号 +1，字段数 +1，`app_records` 条数不变且旧记录原字段覆盖率 100%，页面 200，即为通过。「改结构不丢数据」的证据是 8e 的两列相等，不是页面看起来正常。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| `done` 里 `appliedOps:0`、`degraded:true` | 模型没定位到目标字段（字段名差异大），或 `LLM_PROVIDER` 退回 mock | 换一条更贴近 label 的指令（如直接用页面上显示的字段名）；`grep -E '^LLM_' .env` 确认通道 |
| 返回 `{"t":"error","code":"SPEC_INVALID"}` | 模型产出的补丁让 spec 不合法（`validateAfterApply` 拦下） | 正常拦截，换一句更明确的指令重试；`grep -o '"issues":\[.*\]' /tmp/chat1.log` 看具体问题 |
| `V1` 没变但流里有 `patch` 事件 | 所有补丁都被丢弃（`applied.length === 0`） | 看流里的 `{"t":"warn","reason":...}`；说明补丁路径写错，属拦截生效，换指令重试 |

---

### E-09 回滚 + 数据一条不丢【P0】

**覆盖维度**：`POST /api/apps/:id/versions/:vid/rollback`、回滚语义（复制成新版本）、业务数据与 spec 解耦、409 冲突。

**前置条件**
- E-08 已通过，当前版本 ≥ v2，`app_records` 有 ≥ 2 条记录。
- 已有 v1 快照（`PSQL "select count(*) from app_versions where app_id='$APP_ID' and version=1"` 输出 `1`）。

**执行步骤**

```bash
# 9a 回滚前的基线（条数 + 内容指纹）
CUR=$(PSQL "select current_version from apps where id='$APP_ID'")
R0=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")
H0=$(RECMD5)
echo "CUR=$CUR R0=$R0 H0=$H0"

# 9b 回滚到 v1
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/versions/1/rollback

# 9c 回滚后的状态
NEWV=$(PSQL "select current_version from apps where id='$APP_ID'")
R1=$(PSQL "select count(*) from app_records where app_id='$APP_ID'")
H1=$(RECMD5)
echo "V: $CUR -> $NEWV ; records: $R0 -> $R1"
echo "H0=$H0"; echo "H1=$H1"

# 9d 新版本的内容与 v1 完全一致（回滚是复制，不是删除）
PSQL "select (select spec from app_versions where app_id='$APP_ID' and version=1) = (select spec from app_versions where app_id='$APP_ID' and version=$NEWV) as spec_equal"

# 9e 历史一条没删
PSQL "select count(*) as versions_kept from app_versions where app_id='$APP_ID'"

# 9f 回滚到当前版本 → 409
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/versions/$NEWV/rollback

# 9g 页面与数据仍可用
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID
PSQL "select id, left(payload::text, 80) from app_records where app_id='$APP_ID' order by created_at limit 3"
```

**期望结果**

- 9b：`{"versionNo":<NEWV>,"rolledBackFrom":<CUR>,"rolledBackTo":1}`，`HTTP 200`；`NEWV = CUR + 1`。
- 9c：`R1 = R0`；`H1` 与 `H0` **完全相同**（记录 id、payload、顺序全部一致）。
- 9d：`spec_equal` 输出 `t`。
- 9e：`versions_kept` 等于 `NEWV`（历史版本数 = 最新版本号，一行没删）。
- 9f：`{"error":"当前已在该版本，无需回滚","code":"CONFLICT"}`，`HTTP 409`。
- 9g：`app_page=200`；记录 payload 内容与回滚前一致。

**判定标准**

`H1 == H0`（内容指纹一致）且 `R1 == R0`（条数一致）且 `spec_equal = t`（新版本内容等于 v1）且历史版本数未减少，即为通过。这是「回滚不丢数据」的唯一硬证据；只看页面能打开不算通过。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| `H1 != H0` 或 `R1 < R0` | 有人手工删过记录，或回滚实现被改成了「删记录回退」 | `PSQL "select count(*) from app_records where app_id='$APP_ID' and created_at < now() - interval '10 minutes'"` 核对；`git log --oneline -- src/lib/data.ts` 确认 `bumpVersion` 未被改成删数据 |
| 9b 返回 `404 {"error":"目标版本不属于该应用"}` | `vid` 写错（用了别的应用的版本号） | `PSQL "select version from app_versions where app_id='$APP_ID' order by version"` 取真实版本号 |
| 9f 返回 200 而不是 409 | 你回滚的目标不是当前版本——重复回滚到同一历史版本会继续生成新版本 | 属实现行为（见备注），本子项失败时改用当前版本号 `$NEWV` 重试 |

**备注（与文档的偏差，验收时以本条为准）**

`docs/15` §9 的 P-08 写「连续两次回滚到同一版本，第二次 409」。实际实现（`src/app/api/apps/[id]/versions/[vid]/rollback/route.ts`）只在**目标版本号等于当前版本号**时返回 409；连续回滚到 v1 会依次产生 v3、v4……这是「回滚也可回滚」的直接后果，不是缺陷。已记入遗留清单。

---

### E-10 越界补丁被丢弃（不产生坏版本）【P0】

**覆盖维度**：`checkPath` 白名单、`/specVersion` 不可改、版本号不因越界补丁前进、页面不因坏 spec 崩溃。

**前置条件**
- 基准应用 A 存在，当前 `specVersion` 为 `1.0`。

**执行步骤**

```bash
V0=$(PSQL "select current_version from apps where id='$APP_ID'")
S0=$(PSQL "select spec->>'specVersion' from app_versions where app_id='$APP_ID' and version=$V0")
echo "V0=$V0 specVersion=$S0"

# 10a 诱导模型输出 /specVersion 越界补丁
curl -sN -w '\n[HTTP %{http_code}]\n' -X POST $LOCAL/api/apps/$APP_ID/chat \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"把 specVersion 改成 2.0"}' | tee /tmp/chat_specver.log

# 10b 版本号与 specVersion 是否被改动
V1=$(PSQL "select current_version from apps where id='$APP_ID'")
S1=$(PSQL "select spec->>'specVersion' from app_versions where app_id='$APP_ID' and version=$V1")
echo "V: $V0 -> $V1 ; specVersion: $S0 -> $S1"

# 10c 当前版本快照存在且页面可渲染（坏版本会在这里暴露）
PSQL "select count(*) from app_versions where app_id='$APP_ID' and version=(select current_version from apps where id='$APP_ID')"
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID

# 10d 所有历史版本的 specVersion 都是 1.0
PSQL "select version, spec->>'specVersion' from app_versions where app_id='$APP_ID' order by version"
```

**期望结果**（三种可接受终态之一，取决于模型输出）

| 终态 | 流内事件 | 版本号 | 说明 |
|---|---|---|---|
| 模型拒绝输出该补丁 | `{"t":"done","appliedOps":0,"droppedOps":0,"degraded":true,"note":"没有识别出可执行的修改"}` | 不变 | 提示词已禁止改 `specVersion`，这是最常见结果 |
| 模型输出越界补丁，被白名单丢弃 | 先 `{"t":"warn","reason":"根节点 specVersion 不在白名单内（只允许 app/entities/pages/sharePolicy）",...}`，再 `done` 且 `appliedOps:0 droppedOps:1` | 不变 | 白名单生效，这是本用例的核心证据 |
| 模型输出越界补丁且同批带合法补丁 | `warn` + `done` 且 `appliedOps≥1 droppedOps≥1` | +1 | 越界那条被丢，合法那条生效 |

三种情况共同要求：`S1 = 1.0`；10c 输出 `1` 与 `app_page=200`；10d 每一行的 `specVersion` 都是 `1.0`。

**判定标准**

无论模型输出什么，`specVersion` 始终保持 `1.0`，当前版本快照存在，应用页 HTTP 200，即为通过。版本号不变或 +1 都算通过——加的是合法那一部分补丁；**只有 `specVersion` 被改写或页面 500 才算失败**。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 10d 出现某行 `specVersion` 为 `2.0` | 白名单被绕过（`ALLOWED_ROOTS` 被改） | `grep -n 'ALLOWED_ROOTS' src/lib/patch.ts`；必要时 `git diff src/lib/patch.ts` 回退后 `docker compose up -d --build` |
| 10c `app_page=500` | 坏 spec 已落库 | `PSQL "select version, spec->>'specVersion' from app_versions where app_id='$APP_ID' order by version desc limit 3"`；回滚到合法版本：`curl -s -X POST $LOCAL/api/apps/$APP_ID/versions/1/rollback` |
| 没有出现 `warn` 事件 | 模型直接拒绝（第一种终态），属正常 | 无需修复，按「终态一」判定 |

---

### E-11 非法枚举被拦（不产生坏版本）【P0】

**覆盖维度**：`app.theme` 枚举约束（`neutral` / `warm` / `cool`）、`validateAfterApply` 的拦截能力、模型语义近似时的降级行为。

**前置条件**
- 基准应用 A 存在，当前版本可渲染。

**执行步骤**

```bash
V0=$(PSQL "select current_version from apps where id='$APP_ID'")
T0=$(PSQL "select theme from apps where id='$APP_ID'")
echo "V0=$V0 theme=$T0"

# 11a 要求一个不存在的主题色
curl -sN -w '\n[HTTP %{http_code}]\n' -X POST $LOCAL/api/apps/$APP_ID/chat \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"把整个系统的配色改成紫色"}' | tee /tmp/chat_theme.log

# 11b 主题值必须仍是三个合法值之一
V1=$(PSQL "select current_version from apps where id='$APP_ID'")
T1=$(PSQL "select theme from apps where id='$APP_ID'")
echo "V: $V0 -> $V1 ; theme: $T0 -> $T1"
PSQL "select count(*) as illegal_theme_rows from apps where theme not in ('neutral','warm','cool')"

# 11c 当前版本快照存在、页面可渲染
PSQL "select count(*) from app_versions where app_id='$APP_ID' and version=(select current_version from apps where id='$APP_ID')"
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID

# 11d 如果被拦，错误事件长这样
grep -o '"t":"error".*' /tmp/chat_theme.log | head -1
```

**期望结果**（两种可接受终态之一）

| 终态 | 流内事件 | 版本号 | 说明 |
|---|---|---|---|
| 模型输出 `purple` → 被 zod 拦下 | `{"t":"error","code":"SPEC_INVALID","message":"这次修改会让应用结构不合法，已放弃，未产生新版本","issues":[...]}` | 不变 | 校验链生效，这是本用例的核心证据 |
| 模型输出最近的合法值 `cool` | `{"t":"done","appliedOps":1,"droppedOps":0,"degraded":false}` | +1 | 语义近似但值合法，属能力边界内的降级 |

两种情况的共同要求：`theme` 落在 `neutral/warm/cool` 内；`illegal_theme_rows` 输出 `0`；11c 输出 `1` 与 `app_page=200`。

**判定标准**

`apps.theme` 始终是三个合法值之一，非法主题行数为 0，当前版本快照存在，应用页 HTTP 200，即为通过。「改成紫色」这个指令本身不要求被满足——要求的是**不能被写坏**。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| `illegal_theme_rows` 大于 0 | 枚举校验被绕过（主题值直接从 patch 写入 `apps`） | `grep -n 'theme' src/lib/data.ts src/lib/patch.ts`；回退代码后 `docker compose up -d --build` |
| 11c `app_page=500` | 坏版本已落库 | `curl -s -X POST $LOCAL/api/apps/$APP_ID/versions/1/rollback` 恢复，再查 `docker compose logs --tail=50 web` |
| 流内既无 error 也无 done | SSE 连接被代理缓冲 | 直连 `127.0.0.1:3000` 重测；若前面有 Nginx，确认 `proxy_buffering off` |

---

### E-12 容器重启 / 重建后数据仍在【P0】

**覆盖维度**：named volume 持久化、`restart` 与 `down`/`up` 两种路径、重启后服务自愈。

**前置条件**
- E-09 已通过，`app_records` 有 ≥ 2 条记录，记下基线：
  - `A0=$(PSQL "select count(*) from apps")`
  - `R0=$(PSQL "select count(*) from app_records")`
  - `H0=$(RECMD5)`

**执行步骤**

```bash
A0=$(PSQL "select count(*) from apps"); R0=$(PSQL "select count(*) from app_records"); H0=$(RECMD5)
echo "before: apps=$A0 records=$R0 md5=$H0"

# 12a 只重启容器（不重建、不动卷）
docker compose restart
for i in $(seq 1 40); do curl -sf -o /dev/null $LOCAL/api/healthz && break; sleep 2; done

# 12b 重启后复核
curl -s -w "\nHTTP %{http_code}\n" $LOCAL/api/healthz
docker compose ps --format '{{.Name}} | {{.Status}}'
A1=$(PSQL "select count(*) from apps"); R1=$(PSQL "select count(*) from app_records"); H1=$(RECMD5)
echo "after restart: apps=$A1 records=$R1 md5=$H1"

# 12c 更彻底：删容器重建（注意：绝对不要加 -v，加了就删卷）
docker compose down
docker compose up -d
for i in $(seq 1 60); do curl -sf -o /dev/null $LOCAL/api/healthz && break; sleep 2; done

# 12d 重建后复核
curl -s -w "\nHTTP %{http_code}\n" $LOCAL/api/healthz
A2=$(PSQL "select count(*) from apps"); R2=$(PSQL "select count(*) from app_records"); H2=$(RECMD5)
echo "after recreate: apps=$A2 records=$R2 md5=$H2"
curl -s -o /dev/null -w "app_page=%{http_code}\n" $LOCAL/apps/$APP_ID
```

**期望结果**

- 12b：`{"ok":true,"db":"up"}` HTTP 200；两容器都回到 `(healthy)`；`apps=$A0`、`records=$R0`、`md5=$H0` 三个值全部与重启前一致。
- 12d：`down`/`up` 之后同样 `apps=$A0`、`records=$R0`、`md5=$H0`；应用页 `200`。
- `docker compose down` 的输出里不含 `delete ... volume`（加 `-v` 才会有）。
- 12c 只重建容器，不触发镜像构建；`docker compose down` 不删除镜像也不删除卷。

**判定标准**

`restart` 与 `down`+`up` 两条路径之后，`apps` 条数、`app_records` 条数、`app_records` 内容 md5 三者全部与基线一致，且健康检查恢复 200，即为通过。三者缺一即失败。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 12d 后 `records=0` | 用了 `docker compose down -v`，named volume 被删 | 从备份恢复：`docker compose exec -T db psql -U atomlet -d atomlet < 备份文件`（见 E-15）；今后只用 `down` 不加 `-v` |
| `md5` 变了但条数没变 | 记录被更新过（`app_records` 无 `updated_at`，正常路径只插入） | `PSQL "select id, created_at from app_records where app_id='$APP_ID' order by created_at"` 对比创建时间，确认是否有新插入 |
| 健康检查一直 503 | db 容器没起来（12d 后 `depends_on` 等待超时） | `docker compose ps`；`docker compose logs --tail=80 db`；`docker compose up -d` |

---

### E-13 模型不可用时的降级行为【P0】

**覆盖维度**：`withFallback` 降级、`fallbackNote` 透出、HTTP 不返回 500、`.env` 改动需要重建容器才生效、恢复后通道还原。

**前置条件**
- E-04 已通过（真实通道工作正常）。
- `.env` 里 `LLM_API_KEY` 是真实 key。
- 本轮会临时改 `.env` 并重建 web 容器，**E-09 ~ E-12 的数据核对必须已经做完**。

**执行步骤**

```bash
# 13a 备份 .env，把 key 改成一个必然失败的假 key
cp -a /opt/atomlet/.env /opt/atomlet/.env.bak
chmod 600 /opt/atomlet/.env.bak
sed -i 's|^LLM_API_KEY=.*|LLM_API_KEY=sk-invalid-000000000000000000000000000000000000|' /opt/atomlet/.env
grep -c '^LLM_API_KEY=sk-invalid-' /opt/atomlet/.env

# 13b 必须重建容器（restart 不会重读 env_file）
docker compose up -d --force-recreate web
for i in $(seq 1 40); do curl -sf -o /dev/null $LOCAL/api/healthz && break; sleep 2; done

# 13c 用坏 key 生成一次
curl -sN -w '\n[HTTP %{http_code}]\n' -X POST $LOCAL/api/apps/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"做一个退货换货登记，记录订单号、客户、退货日期、原因"}' \
  | tee /tmp/gen_bad.log | tail -4

# 13d 关键断言：有 fallbackNote，没有 error 事件
echo "fallbackNote 命中: $(grep -c 'fallbackNote' /tmp/gen_bad.log)"
echo "error 事件命中: $(grep -c '\"t\":\"error\"' /tmp/gen_bad.log)"
PSQL "select status, model, coalesce(left(error,80),'-') from gen_runs order by started_at desc limit 1"

# 13e 恢复 .env 并重建
cp -a /opt/atomlet/.env.bak /opt/atomlet/.env
chmod 600 /opt/atomlet/.env
docker compose up -d --force-recreate web
for i in $(seq 1 40); do curl -sf -o /dev/null $LOCAL/api/healthz && break; sleep 2; done

# 13f 通道还原验证
curl -sN -X POST $LOCAL/api/apps/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"做一个来访登记，记录来访人、被访人、来访时间"}' \
  | tee /tmp/gen_ok.log | tail -2
echo "fallbackNote 命中: $(grep -c 'fallbackNote' /tmp/gen_ok.log)"
PSQL "select status, model from gen_runs order by started_at desc limit 1"
rm -f /opt/atomlet/.env.bak
```

**期望结果**

- 13a：输出 `1`（假 key 已写入）。
- 13b：健康检查恢复 200（应用本身不依赖 key，能起来）。
- 13c：`[HTTP 200]`；流内出现一行 `真实模型调用失败，已降级为模板生成：模型调用失败 401: ...`（`{"t":"text"}` 事件）。
- 13d：`fallbackNote 命中: 1`；`error 事件命中: 0`；`gen_runs` 最新一行 `done | mock(降级) | 模型调用失败 401...`。
- 13e：健康检查恢复 200。
- 13f：`fallbackNote 命中: 0`；`gen_runs` 最新一行 `done | deepseek-flash`。

**判定标准**

坏 key 下仍在 HTTP 200 的流里返回 `saved` 事件且带 `fallbackNote`、`gen_runs.model` 为 `mock(降级)`、流内没有 `error` 事件；恢复后 `gen_runs.model` 回到 `deepseek-flash` 且 `fallbackNote` 消失，即为通过。「不白屏、不 500、不隐瞒降级」三条同时满足才算过。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 13c 出现 `{"t":"error"}` 且 HTTP 仍 200 | 降级链没生效（`getProvider()` 未包 `withFallback`） | `grep -n 'withFallback' src/lib/agent/provider.ts`；`git diff` 确认后 `docker compose up -d --build` |
| 13f 的 `gen_runs.model` 还是 `mock(降级)` | 恢复 .env 后没重建容器，进程还拿着旧 env | `docker compose up -d --force-recreate web`；`docker compose exec -T web sh -c 'echo $LLM_API_KEY \| cut -c1-6'` 确认前 6 位是 `sk-` 开头且不是 `sk-inv` |
| 13a 的 `sed` 把 `.env` 改坏（JSON 或多行） | `.env` 里有注释或多余空格导致替换异常 | `cp -a /opt/atomlet/.env.bak /opt/atomlet/.env` 还原，改用 `vi .env` 手工改 `LLM_API_KEY` 一行 |

---

### E-14 密钥不进前端【P0】

**覆盖维度**：构建产物无密钥、HTML/JS 响应无密钥、容器内文件系统无 `.env`、错误信息不泄露密钥。

**前置条件**
- `.env` 中 `LLM_API_KEY` 非空且以 `sk-` 开头。

**执行步骤**

```bash
# 14a 取出真实 key（只用于比对，不回显全文）
KEY=$(grep -E '^LLM_API_KEY=' /opt/atomlet/.env | cut -d= -f2- | tr -d '\r')
echo "key 长度=${#KEY} 前缀=${KEY:0:3}"

# 14b 首页与新应用页的 HTML 里不能出现 key
curl -s $LOCAL/ | grep -c "$KEY"
curl -s $LOCAL/new | grep -c "$KEY"
curl -s $LOCAL/apps/$APP_ID | grep -c "$KEY"

# 14c 所有 JS chunk 里不能出现 key
for f in $(curl -s $LOCAL/new | grep -o '/_next/static/[^"]*\.js' | sort -u); do curl -s "$LOCAL$f"; done | grep -c "$KEY"

# 14d 接口响应与错误信息里不能出现 key
curl -s $LOCAL/api/healthz | grep -c "$KEY"
curl -s -X POST $LOCAL/api/apps/generate -H 'Content-Type: application/json' -d '{"prompt":""}' | grep -c "$KEY"

# 14e 镜像/容器文件系统里不能有 .env
docker compose exec -T web sh -c 'ls -a /app | grep -c "^\.env$"'
docker compose exec -T web sh -c "grep -rl '$KEY' /app 2>/dev/null | head"

# 14f 兜底：全容器搜 sk- 形态的串
docker compose exec -T web sh -c "grep -rEl 'sk-[A-Za-z0-9]{20,}' /app 2>/dev/null | head"
```

**期望结果**

- 14a：`key 长度` 大于 20，`前缀=sk-`。
- 14b：三次 `grep -c` 全部输出 `0`。
- 14c：输出 `0`。
- 14d：两次 `grep -c` 全部输出 `0`。
- 14e：第一条输出 `0`（容器里没有 `.env`，`.dockerignore` 已排除）；第二条无输出。
- 14f：无输出。

**判定标准**

14b、14c、14d、14e、14f 全部为 0 或空输出，即为通过。任意一处命中，说明密钥已被下发到浏览器或打进镜像，判**不通过**并立即换 key。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 14c 命中（JS 里有 key） | 变量被写成了 `NEXT_PUBLIC_LLM_API_KEY`，Next.js 会内联到客户端 bundle | `grep -rn 'NEXT_PUBLIC' .env src/`；改名去掉 `NEXT_PUBLIC_` 前缀，`docker compose up -d --build`，并**立即在 DeepSeek 后台吊销旧 key** |
| 14e 第一条输出 `1` | `.env` 被 `COPY` 进镜像（`.dockerignore` 失效） | `cat .dockerignore \| grep env`；修复后 `docker compose build --no-cache web && docker compose up -d` |
| 14f 有输出，但内容是 `task-xxx`、`disk-xxx` 之类 | 正则把普通英文单词算作密钥 | 改用 14a/14b 的精确比对（拿真实 key 去 grep），14f 只作兜底 |
| 14d 命中 | 错误响应把请求头/环境变量带进了 message | `grep -rn 'LLM_API_KEY' src/` 定位拼接点，去掉后重新构建 |

---

### E-15 备份与恢复（最小验证）【P1】

**覆盖维度**：`pg_dump` 产物完整性、恢复到独立库、行数与内容核对、恢复库清理。

**前置条件**
- 已执行 §3 公共准备；`app_records` 有 ≥ 2 条记录。
- 磁盘剩余空间大于 200MB：`df -h /opt`。

**执行步骤**

```bash
# 15a 备份
mkdir -p /opt/atomlet/backups
BK=/opt/atomlet/backups/atomlet-$(date +%F-%H%M).sql
docker compose exec -T db pg_dump -U atomlet atomlet > "$BK"
ls -lh "$BK"
grep -c 'CREATE TABLE' "$BK"
grep -c 'COPY public.app_records' "$BK"

# 15b 记录备份时的真值
A0=$(PSQL "select count(*) from apps"); R0=$(PSQL "select count(*) from app_records"); H0=$(RECMD5)
echo "truth: apps=$A0 records=$R0 md5=$H0"

# 15c 恢复到独立库（不碰生产库）
docker compose exec -T db psql -U atomlet -d atomlet -c "drop database if exists atomlet_restore;"
docker compose exec -T db psql -U atomlet -d atomlet -c "create database atomlet_restore;"
docker compose exec -T db psql -U atomlet -d atomlet_restore < "$BK" > /dev/null
echo "restore exit=$?"

# 15d 核对恢复库
RPSQL() { docker compose exec -T db psql -U atomlet -d atomlet_restore -tAc "$1"; }
RPSQL "select count(*) as apps from apps"
RPSQL "select count(*) as records from app_records"
RPSQL "select md5(coalesce(string_agg(payload::text, '|' order by id), '')) from app_records where app_id='$APP_ID'"

# 15e 清理恢复库（必须执行，别留在生产实例里）
docker compose exec -T db psql -U atomlet -d atomlet -c "drop database atomlet_restore;"
docker compose exec -T db psql -U atomlet -d atomlet -tAc "select count(*) from pg_database where datname='atomlet_restore'"
```

**期望结果**

- 15a：`ls -lh` 显示文件大小大于 `100K`；`CREATE TABLE` 命中 5；`COPY public.app_records` 命中 1。
- 15b：三个值记下来，供 15d 比对。
- 15c：`restore exit=0`，无 `ERROR` 输出。
- 15d：`apps=$A0`、`records=$R0`、md5 与 15b 的 `H0` 相同。
- 15e：输出 `0`（恢复库已删除）。

**判定标准**

备份文件含 5 张表的建表语句与 1 段 `COPY public.app_records`，恢复库的 `apps`/`app_records` 行数与 md5 与生产库一致，且恢复库最终被清理，即为通过。只跑通 `pg_dump` 不验证恢复，不算通过。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 备份文件只有几百字节 | `pg_dump` 连错库或权限不足 | `docker compose exec -T db pg_dump -U atomlet -d atomlet -t 'public.*' \| head -5`；确认 `-U atomlet -d atomlet` 两个参数都在 |
| 15c 报 `ERROR: database "atomlet_restore" already exists` | 上一次没清理干净 | `docker compose exec -T db psql -U atomlet -d atomlet -c "drop database if exists atomlet_restore;"` 再重跑 |
| 15d 的 md5 不一致 | 备份与核对之间有人写入新记录 | 重新跑 15a ~ 15d，中间不插入数据 |

---

### E-16 并发生成（4 路并发观察）【P1】

**覆盖维度**：并发行为、终态一致性、应用数与成功流数是否对齐、进程稳定性。

**前置条件**
- `.env` 为真实通道（与 E-04 相同）。
- 已记下当前应用总数：`N0=$(PSQL "select count(*) from apps")`。

**执行步骤**

```bash
N0=$(PSQL "select count(*) from apps")
echo "N0=$N0"

# 16a 4 路并发（后台进程 + wait），记录总耗时
time (
  for i in 1 2 3 4; do
    curl -sN -X POST $LOCAL/api/apps/generate \
      -H 'Content-Type: application/json' \
      -d "{\"prompt\":\"并发验收 $i：客户回访记录，记录客户、回访日期、回访结果\"}" \
      > /tmp/conc$i.log &
  done
  wait
)

# 16b 每条流最后一条事件
for i in 1 2 3 4; do echo "--- conc$i"; tail -1 /tmp/conc$i.log; echo; done

# 16c 成功流数与应用增量是否对齐
echo "saved 数: $(cat /tmp/conc*.log | grep -c '\"t\":\"saved\"')"
echo "error 数: $(cat /tmp/conc*.log | grep -c '\"t\":\"error\"')"
echo "降级数: $(cat /tmp/conc*.log | grep -c 'fallbackNote')"
N1=$(PSQL "select count(*) from apps")
echo "apps: $N0 -> $N1"

# 16d 进程是否稳定（不应出现 unhandled rejection / OOM / 重启）
docker compose ps --format '{{.Name}} | {{.Status}}'
docker compose logs --since=10m web | grep -ciE 'unhandled|FATAL|out of memory|ECONNRESET'
docker compose logs --since=10m web | tail -5

# 16e 并发写入的应用都能打开
PSQL "select id, name, created_at from apps order by created_at desc limit 4"
```

**期望结果**

- 16a：`time` 输出 `real` 值；4 个 `/tmp/conc*.log` 都存在且非空。
- 16b：每条流最后一行是 `data: {"t":"saved",...}` 或 `data: {"t":"error",...}`，**不允许出现空文件或半截 JSON**。
- 16c：`saved 数 + error 数 = 4`；`apps` 增量等于 `saved 数`；允许 `降级数` 大于 0（模型限流时降级到模板属预期）。
- 16d：两容器仍为 `(healthy)`；错误关键字计数为 `0`；日志末尾无 `Error` 堆栈。
- 16e：新增的应用行数与 `saved 数` 一致，`name` 都是可读中文名。

**判定标准**

4 条流全部拿到终态事件、`saved 数 + error 数 = 4`、应用增量等于 saved 数、容器保持 healthy 且日志无未捕获异常，即为通过。「排队/限流」不是本用例的判定项（见备注），不出现并不算失败。

**备注（实现与文档的偏差，验收以本条为准）**

`docs/08` §7 列出 `429 RATE_LIMITED`（生成 5 次/分/用户），`docs/16` §6 ④ 提到「进程内信号量 max 3」。**当前代码里没有这两个实现**：`src/app/api/apps/generate/route.ts` 直接进入生成流程，没有任何计数或并发闸门；`.env` 里的 `GEN_TIMEOUT_MS` 也只被 `scripts/start.mjs`（本地启动器）读取，容器路径不读。因此本用例只验证「并发不互锁、不崩溃、不多写、不少写」，不期望 429，也不设时延门槛。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 某条流是空文件 | curl 在写入前被中断，或 SSE 被中间层缓冲 | 直连 `127.0.0.1:3000` 重测；`curl -sN` 的 `-N` 不能省 |
| `apps` 增量小于 `saved 数` | 事务失败或 `createAppFromSpec` 部分失败 | `PSQL "select status, count(*) from gen_runs group by status"`；`docker compose logs --since=10m web \| grep -i error` |
| 日志里有 `unhandled` 或容器重启 | 并发下连接池耗尽（`postgres` 客户端 `max: 5`） | `PSQL "select count(*) from pg_stat_activity"`；`docker compose logs --since=10m web \| tail -30`；把并发降到 2 重测以区分「能力不足」与「代码缺陷」 |

---

### E-17 分享链接越权防护【P1】

**覆盖维度**：无效 token 404、只读 token 403、页面与接口的一致性、测试数据清理。

**前置条件**
- 基准应用 A 存在；`APP_ID` 与 `TOKEN` 已取到。
- E-05 里定义的 `mkpayload` 函数仍在当前会话内。

**执行步骤**

```bash
# 17a 无效 token：接口与页面
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/public/0000invalidtoken/records \
  -H 'Content-Type: application/json' -d '{"payload":{}}'
curl -s -o /dev/null -w "share_page=%{http_code}\n" $LOCAL/p/0000invalidtoken
curl -s $LOCAL/p/0000invalidtoken | grep -c '链接无效或已过期'

# 17b 造一个只读 token（用完就删，不动真实 token）
READTOK=$(PSQL "insert into share_links (app_id, token, scope) values ('$APP_ID','readonlytest$RANDOM','read') returning token")
echo "READTOK=$READTOK"

# 17c 只读 token 写数据 → 403
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/public/$READTOK/records \
  -H 'Content-Type: application/json' -d "{\"payload\":$(mkpayload)}"

# 17d 只读 token 的页面仍能打开（记录前后差异）
curl -s -o /dev/null -w "readonly_page=%{http_code}\n" $LOCAL/p/$READTOK

# 17e 清理测试 token（必须执行）
PSQL "delete from share_links where token='$READTOK'"
PSQL "select count(*) from share_links where token like 'readonlytest%'"
```

**期望结果**

- 17a：`{"error":"链接无效或已过期"}`，`HTTP 404`；页面 `share_page=200`（渲染的是友好错误页）；`链接无效或已过期` 命中 `1`。
- 17b：`READTOK` 形如 `readonlytest12345`。
- 17c：`{"error":"该链接为只读链接，不能提交数据"}`，`HTTP 403`。
- 17d：`readonly_page=200`（页面能开，但提交必被后端拒绝）。
- 17e：清理后残留计数为 `0`。

**判定标准**

无效 token 的写入返回 404 且页面显示「链接无效或已过期」，只读 token 的写入返回 403 且无记录入库，测试 token 已清理干净，即为通过。

**备注（已知偏差）**

`src/app/p/[token]/page.tsx` 只把 `link.token` 传给渲染器，没有把 `link.scope` 传下去，所以**只读链接的页面上提交按钮仍可见**（`docs/08` §7 写的是「前端先判、隐藏提交按钮」）。后端 403 是唯一防线，功能上不被绕过，已记入遗留清单。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 17c 返回 201 | 只读校验分支被删（`link.scope !== 'write'`） | `grep -n "scope" src/app/api/public/\[token\]/records/route.ts`；`git diff` 回退后 `docker compose up -d --build` |
| 17a 返回 200 而不是 404 | 无效 token 被当成合法 token 命中（token 撞值） | 换一个更长的随机串重测：`$LOCAL/api/public/zz$(date +%s)zz/records` |
| 17e 残留不为 0 | 清理命令没执行 | `PSQL "delete from share_links where token like 'readonlytest%'"` |

---

### E-18 错误码一致性【P1】

**覆盖维度**：400 / 404 / 409 / 422 四类状态码与响应体文案是否符合契约。

**前置条件**
- `APP_ID` 已取到；当前版本号 `CUR` 已知。

**执行步骤**

```bash
CUR=$(PSQL "select current_version from apps where id='$APP_ID'")

# 18a 空需求 → 400
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/generate \
  -H 'Content-Type: application/json' -d '{"prompt":""}'

# 18b 非法 JSON → 400
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/generate \
  -H 'Content-Type: application/json' -d 'not-a-json'

# 18c 应用不存在 → 404
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/00000000-0000-0000-0000-000000000000/records \
  -H 'Content-Type: application/json' -d '{"payload":{}}'

# 18d 版本不存在 → 404
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/versions/999/rollback

# 18e 回滚到当前版本 → 409
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/versions/$CUR/rollback

# 18f 指令太短 → 422
curl -s -w "\nHTTP %{http_code}\n" -X POST $LOCAL/api/apps/$APP_ID/chat \
  -H 'Content-Type: application/json' -d '{"instruction":"改"}'
```

**期望结果**

| 子项 | 期望状态码 | 期望响应体 |
|---|---|---|
| 18a | `400` | `{"error":"请至少描述一句需求，或上传一份表格"}` |
| 18b | `400` | `{"error":"请求体不是合法 JSON"}` |
| 18c | `404` | `{"error":"应用不存在"}` |
| 18d | `404` | `{"error":"目标版本不属于该应用","code":"NOT_FOUND"}` |
| 18e | `409` | `{"error":"当前已在该版本，无需回滚","code":"CONFLICT"}` |
| 18f | `422` | `{"error":"指令长度需在 2–500 字之间","code":"PATCH_OUT_OF_SCOPE"}` |

**判定标准**

6 条的状态码与错误文案逐条命中上表，即为通过。状态码对但文案与文档契约不一致的，记为缺陷（P2）。

**失败排查**

| 现象 | 原因 | 修复命令 |
|---|---|---|
| 18c 返回 500 | 传了非法 UUID（如 `abc`），Postgres 直接报 `22P02` | 用合法的全零 UUID（本文档给的 `00000000-...`）重测；如仍 500，`docker compose logs --tail=30 web` 看堆栈 |
| 18e 返回 200 | `CUR` 取到的不是当前版本（变量过期） | 重取：`CUR=$(PSQL "select current_version from apps where id='$APP_ID'")` 后再跑 |
| 18f 返回 200 且流内有 done | 长度校验被绕过（`instruction.length < 2` 分支被删） | `grep -n 'PATCH_OUT_OF_SCOPE' src/app/api/apps/\[id\]/chat/route.ts` |

---

## 5. 执行顺序建议

**第一优先（4 分钟，任何一次改动后都必须重跑）**：E-02 → E-03。前置基础设施不绿，后面的用例结果全部不可信。

**主链路（33 分钟，串行，共用一个应用）**：
E-04（生成基准应用 A，取 `APP_ID` / `TOKEN`）→ E-05（入库与校验）→ E-06（统计）→ E-08（改需求）→ E-09（回滚与数据核对）→ E-10、E-11（两条拦截用例，都只查不变量）。

这 7 条必须串行，因为 E-06 依赖 E-05 写入的记录、E-08 依赖 E-04 的应用、E-09 依赖 E-08 产生的多版本。

**可以并发的部分**：
- E-14（密钥扫描）与上面任何一条都不冲突，可随时插入，只读不写。
- E-07 的 `curl` 子项（7b ~ 7d）可与 E-06 同时做；只有手机 4G 子项（7e）要等 E-01。
- E-18（错误码）只发非法请求，不产生数据，可与 E-06 并行。

**破坏性用例放后面（28 分钟）**：
E-12（重启/重建容器）→ E-13（改 `.env` 并重建容器）→ E-15（备份恢复）→ E-16（4 路并发，会多出 4 个应用）→ E-17（造一个临时只读 token 再删）。

E-12、E-13、E-16 都会影响服务可用性，放在数据类用例（E-05 ~ E-11、E-15）之后执行，避免打断前半段的核对。

**E-01 单独看**：现在就必须跑一次记录失败现象；安全组放行后重跑一次确认 200，然后立刻做 E-07 的 7e 手机子项。E-01 不阻塞其他 16 条。

**一轮总时长**

| 阶段 | 用例 | 耗时 |
|---|---|---|
| 基础设施 | E-02、E-03 | 4 min |
| 主链路 | E-04、E-05、E-06、E-08、E-09、E-10、E-11 | 33 min |
| 只读与错误码 | E-14、E-18 | 8 min |
| 破坏性 | E-12、E-13、E-15、E-16、E-17 | 28 min |
| 外网与真机 | E-01、E-07 | 9 min |
| **合计** | 18 条 | **82 min** |

**最小必测集（25 分钟，改动后先跑这 6 条）**：E-02 → E-04 → E-05 → E-09 → E-14 → E-01。这 6 条覆盖「服务活着、能生成、能校验、回滚不丢数据、不泄密、外网可达」六个必答问题。

---

## 6. 结果登记表（执行时填）

| 编号 | 优先级 | 结果（通过/失败/未执行） | 实际观察 | 证据位置 |
|---|---|---|---|---|
| E-01 | P0 |  |  |  |
| E-02 | P0 |  |  |  |
| E-03 | P0 |  |  |  |
| E-04 | P0 |  |  |  |
| E-05 | P0 |  |  |  |
| E-06 | P0 |  |  |  |
| E-07 | P0 |  |  |  |
| E-08 | P0 |  |  |  |
| E-09 | P0 |  |  |  |
| E-10 | P0 |  |  |  |
| E-11 | P0 |  |  |  |
| E-12 | P0 |  |  |  |
| E-13 | P0 |  |  |  |
| E-14 | P0 |  |  |  |
| E-15 | P1 |  |  |  |
| E-16 | P1 |  |  |  |
| E-17 | P1 |  |  |  |
| E-18 | P1 |  |  |  |

**签署规则沿用 `docs/11` §9**：P0 不为 0 时只能判「不通过」，不接受以时间紧为由签有条件通过；有条件通过的边界仅限 P1，且必须写明演示时规避的具体动作。

---

## 7. 待办与偏差清单（本轮发现，交给开发角色处理）

| # | 类型 | 内容 | 影响 | 位置 |
|---|---|---|---|---|
| 1 | 环境待办 | 安全组未放行 TCP 3000，E-01 失败 | 外网与手机真机不可用 | 阿里云安全组 |
| 2 | 文档偏差 | 回滚 409 只在「目标版本 == 当前版本」时触发；重复回滚到同一历史版本会不断产生新版本 | `docs/15` P-08 描述与实际不符 | `versions/[vid]/rollback/route.ts` |
| 3 | 文档偏差 | 生成/改需求接口业务失败时 HTTP 仍是 200，错误在 SSE `t:error` 事件里；`docs/08` §5.1 写的 502/504 未实现 | 调用方若按 HTTP 码判断会误判成功 | `apps/generate/route.ts`、`apps/[id]/chat/route.ts` |
| 4 | 文档偏差 | 未实现 `429 RATE_LIMITED` 与进程内并发上限（`docs/08` §7、`docs/16` §6④ 提到） | 高频生成会全部排队打模型，无保护 | `apps/generate/route.ts` |
| 5 | 文档偏差 | `GEN_TIMEOUT_MS` 只被 `scripts/start.mjs` 读取，容器运行路径不生效 | 90s 生成超时在 ECS 上实际不生效，单次上限退化为模型 60s × 3 次重试 | `scripts/start.mjs`、`src/lib/agent/provider.ts` |
| 6 | 已知偏差 | 只读 token 的分享页不隐藏提交按钮（页面未接收 `link.scope`），仅后端 403 兜底 | 外部填报者点提交后看到 403 文案，体验瑕疵 | `src/app/p/[token]/page.tsx` |
| 7 | 已知偏差 | 「配色改成紫色」被模型近似为 `cool`（沿用 `docs/16` §6①） | 属能力边界，E-11 只验「不被写坏」 | `src/lib/agent/patchAgent.ts` |
