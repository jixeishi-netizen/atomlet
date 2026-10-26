# 17. ECS 部署手册（阿里云）

> 目标：在一台干净的阿里云 ECS 上，30 分钟内把 Atomlet 跑起来，得到一个可点开的公网链接。  
> 前置：一台 ECS、一个可用的模型 key（可选，没有 key 也能跑 mock）。

---

## 0. 先做三个决定

| 决定   | 建议                                   | 理由                                       |
| ---- | ------------------------------------ | ---------------------------------------- |
| 规格   | **2 核 4G 起**（2G 必须加 swap）            | `next build` 在 2G 上大概率 OOM；本项目构建峰值约 1.6G |
| 系统   | Ubuntu 22.04 或 Alibaba Cloud Linux 3 | Docker 生态资料多，出问题好搜                       |
| 访问方式 | 先用 `IP:3000`，有域名再上 Nginx             | 国内备案周期长；Demo 用 IP 完全够，且不影响 SSE           |

**安全组**必须放行：`22`（SSH）、`3000`（应用）。要上域名就再加 `80` / `443`。

> 按量付费的 ECS **不能备案**，只能 IP 访问。48 小时 Demo 用按量（约 5–10 元/天）最划算。

---

## 1. 装 Docker

```bash
# 一键脚本 + 阿里云镜像源（国内快）
curl -fsSL https://get.docker.com | sudo sh -s -- --mirror Aliyun

# 开机自启 + 当前用户免 sudo
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker

# 验证（Compose v2 随脚本安装）
docker -v && docker compose version
```

**配置镜像加速**（拉 Node/Postgres 镜像会快一个数量级。**不配的话 `docker compose up --build` 会直接失败**，报 `dial tcp x.x.x.x:443: connection refused` 或 `registry-1.docker.io` 超时）：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://<你的ID>.mirror.aliyuncs.com"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

> 加速地址在阿里云「容器镜像服务 → 镜像工具 → 镜像加速器」里，每人一个专属地址。

**2G 内存的机器必须加 swap**（否则构建中途被杀）：

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 2. 把代码传上去

**方式 A：Git（推荐，后续更新只需要 `git pull`）**

```bash
sudo apt install -y git        # Alibaba Cloud Linux 用 dnf install -y git
git clone <你的仓库地址> atomlet
cd atomlet
```

**方式 B：本机打包上传**（没仓库时）

```bash
# 本地执行（排除依赖与构建产物，包体从 500MB 降到 2MB）
tar --exclude=node_modules --exclude=.next -czf atomlet.tar.gz .
scp atomlet.tar.gz root@<ECS_IP>:/opt/
# 服务器执行
mkdir -p /opt/atomlet && tar -xzf /opt/atomlet.tar.gz -C /opt/atomlet && cd /opt/atomlet
```

---

## 3. 写生产环境变量

```bash
cd /opt/atomlet        # 或你的目录
cat > .env <<'EOF'
POSTGRES_PASSWORD=换成你自己的强密码
DATABASE_URL=postgres://atomlet:换成你自己的强密码@db:5432/atomlet

LLM_PROVIDER=openai
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash

GEN_TIMEOUT_MS=90000
EOF
chmod 600 .env
```

两个要点：

- `DATABASE_URL` 里的主机名必须是 **`db`**（compose 服务名），不是 `localhost`
- `.env` 里是明文密钥，权限设 600，别提交到仓库

> 不填 `LLM_API_KEY` 也能启动，会自动走 mock 通道（模板生成），适合先验证部署链路。

---

## 4. 构建并启动

```bash
docker compose up -d --build
```

首次会拉 `node:20-alpine`、`postgres:16-alpine` 并 `npm ci`，**5–10 分钟**（已默认走 npmmirror 源）。

看进度与结果：

```bash
docker compose ps                 # db 应为 healthy，web 应为 running
docker compose logs -f web        # Ctrl+C 退出日志跟随
```

**构建太慢或 OOM 的替代方案**：在本机构建好镜像再传上去（本机是 amd64 就没问题）。

```bash
# 本机
docker build -t atomlet-web:latest .
docker save atomlet-web:latest | gzip > atomlet-web.tar.gz
scp atomlet-web.tar.gz root@<ECS_IP>:/opt/
# 服务器
docker load < /opt/atomlet-web.tar.gz
docker compose up -d --no-build
```

---

## 5. 建表（关键一步，漏了会 500）

生产镜像里只有 standalone 产物、没有 `drizzle-kit`，所以**不能用容器内 npm 建表**。DDL 已随代码带上，按顺序全部执行：

```bash
for f in drizzle/*.sql; do
  echo "→ $f"
  docker compose exec -T db psql -U atomlet -d atomlet < "$f"
done
```

验证表都在：

```bash
docker compose exec -T db psql -U atomlet -d atomlet -c '\dt'
# 应看到 6 张：app_records / app_versions / apps / gen_runs / messages / share_links
```

> 每个 SQL 都是幂等的（`CREATE TABLE IF NOT EXISTS`），重复执行只会有 `NOTICE ... already exists, skipping`，不会报错。

### 5.1 时区与时钟（部署后必查）

页面时间不准通常是两件事叠在一起，都要处理：

**① 宿主机时钟漂移。** 云主机默认可能没开 NTP，跑几天就慢几分钟。

```bash
timedatectl status | grep -E "System clock|NTP|Time zone"
timedatectl set-ntp true
chronyc makestep            # 立即校正，不等渐进调整
chronyc sources -v          # 同步源前应出现 ^*
date                        # 应为 CST（+0800）
```

**② 容器时区。** Docker 容器默认 UTC，会让页面时间慢 8 小时。本项目已处理两层：

- `docker-compose.yml` 里 `web` 与 `db` 都设了 `TZ: Asia/Shanghai`（日志和 psql 里看 `now()` 才是本地时间）
- 代码层 `src/lib/format.ts` 的时间格式化固定用 `Asia/Shanghai`，不依赖宿主机时区

验证：

```bash
docker compose exec web date          # 应含 CST
docker compose exec db date           # 应含 CST
```

> 数据库存的是 `timestamptz`（绝对时刻），时区配错只影响"看起来"，不影响数据正确性；修好显示层后历史数据的时间会自动变对，无需迁移。



---

## 6. 冒烟验证

```bash
# ① 健康检查（含数据库连通性）
curl -s localhost:3000/api/healthz
# 期望：{"ok":true,"db":"up",...}

# ② 首页
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/

# ③ 跑一次真实生成（验证模型 key 通不通）
curl -sN -X POST localhost:3000/api/apps/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"做一个门店巡检登记，记录门店、区域、日期、得分"}' | tail -3
# 期望最后一条是 {"t":"saved", ...}；若是 "fallbackNote"，说明 key 有问题但链路没断
```

然后浏览器打开 `http://<ECS_IP>:3000`，点「新建应用」走一遍主流程。

**（可选）灌演示种子数据**。生产镜像没有 `tsx`，用一次性容器挂源码跑：

```bash
docker run --rm --network atomlet_default \
  -v "$PWD":/app -w /app \
  -e DATABASE_URL="postgres://atomlet:<密码>@db:5432/atomlet" \
  node:20-alpine sh -c "npm ci --omit=dev >/dev/null 2>&1; npx tsx scripts/seed.ts"
```

> 更省事的做法：不灌种子，直接在前端点两次「新建应用」，用真实模型生成——演示效果更好，也顺带验证了模型通道。

---

## 7. （可选）Nginx 反代 + 域名

不做这一步也能用，只是对外是 `:3000` 端口。上域名/80 端口时：

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/conf.d/atomlet.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';
        proxy_buffering off;        # SSE 必需，否则生成过程会"卡住不动"
        proxy_cache off;
        proxy_read_timeout 300s;    # 覆盖 90s 生成超时
        chunked_transfer_encoding on;
    }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

`proxy_buffering off` 是这一节的唯一重点：SSE 被缓冲时页面看起来像死机了，日志却一切正常。

---

## 8. 日常运维

```bash
# 查看日志
docker compose logs -f web
docker compose logs --tail=100 db

# 重启
docker compose restart web

# 更新发布（git 方式）
git pull && docker compose up -d --build

# 备份数据库（建议加进 crontab，每天 3 点）
docker compose exec -T db pg_dump -U atomlet atomlet | gzip > backup-$(date +%F).sql.gz
```

---

## 9. 故障速查

| 现象                                                                   | 原因                                         | 处理                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| web 起不来，日志 `28P01`                                                   | `DATABASE_URL` 密码与 `POSTGRES_PASSWORD` 不一致 | 两者必须一致；改完 `docker compose up -d` 重建                                                                                                                                      |
| 页面 500，日志 `relation "apps" does not exist`                           | 漏了第 5 步建表                                  | 执行 `psql < drizzle/0000_init.sql`                                                                                                                                        |
| 构建被杀 / `Killed`                                                      | 内存不足                                       | 加 2G swap，或本机构建后传镜像                                                                                                                                                      |
| 生成时进度条停住、最后一次性出结果                                                    | Nginx 缓冲了 SSE                              | `proxy_buffering off`                                                                                                                                                    |
| 生成返回 `fallbackNote`                                                  | 模型 key 无效/限流                               | 检查 key 与模型名（DeepSeek 只有 `deepseek-flash`、`deepseek-v4-pro`）                                                                                                              |
| 端口 3000 打不开                                                          | 安全组未放行                                     | 控制台加规则 `3000/3000`                                                                                                                                                       |
| 页面时间差 8 小时                                                         | 容器默认 UTC（旧版本未配 TZ）                  | 新版本 compose 已设 `TZ: Asia/Shanghai` 且格式化固定用北京时间；确认 `docker compose exec web date` 含 CST |
| `date` 与真实时间差几分钟到几十分钟                                        | 宿主机未开 NTP，时钟漂移                       | `timedatectl set-ntp true && chronyc makestep`                                                                                |
| `docker compose up` 报 `dial tcp 4.78.139.50:443: connection refused` | 未配镜像加速，Docker Hub 被拦                       | 在 `/etc/docker/daemon.json` 配 `registry-mirrors` 后 `systemctl restart docker`；或手动 `docker pull <公共镜像站>/library/postgres:16-alpine` 再 `docker tag` 成 `postgres:16-alpine` |
| `docker pull` 仍然超时                                                   | 镜像站失效                                      | 依次换：`docker.m.daocloud.io` → `docker.nju.edu.cn` → `hub.rat.dev`；或改用阿里云 ACR 个人版托管镜像                                                                                      |

---

## 10. 一句话交付清单

部署完成后，交给面试方的应该是：

- 入口链接：`http://<ECS_IP>:3000`
- 至少 2 个已生成好的应用（点开即用，不用等生成）
- 一个可填写的分享链接：应用页右上「分享填报链接」→ 复制
- 一份 `docs/16_测试执行报告.md`（说明这套东西实测到什么程度）
