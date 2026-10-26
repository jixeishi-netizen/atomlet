# 18. GitHub 上传手册

> 适用：把本地这个项目推到 GitHub，拿到笔试要求的「代码链接」。  
> 前置状态：本地已完成 `git init` 与首次提交（`e680ca2`，78 个文件，分支 `master`，工作区干净，无远程）。

---

## 0. 先确认三件事

```bash
cd "E:/workBuddy_workplace/deepwisdom demo"

git --version                  # 有版本号即已装 git
git log --oneline              # 应看到 e680ca2 feat: Atomlet ...
git ls-files | wc -l           # 应为 78
```

如果 `git ls-files` 里出现了 `.env` 或 `model.config.json`，**先停下**，说明忽略规则失效，里面是你的 API key。

```bash
git ls-files | grep -E "^\.env$|model\.config\.json" || echo "安全：无敏感文件"
```

---

## 1. 建仓库（GitHub 网页，约 1 分钟）

1. 打开 <https://github.com/new>
2. **Repository name**：`atomlet`
3. **Description**（可选）：`多智能体驱动的内部小工具生成器：一句话或一张表格，生成带真实数据库的可用应用`
4. 可见性：**Public**（笔试建议公开，对方能直接点开看代码；若要 Private，交付后需把面试官账号加成 Collaborator，否则他打不开）
5. **三个勾选项全部不要勾**：`Add a README file`、`Add .gitignore`、`Choose a license`

> 第 5 条是新手最常踩的坑：勾了 README，远程就有一个你本地没有的提交，push 会被拒绝（见 §5 报错 5）。

1. 点 **Create repository**，页面会显示一串命令——**先别关，等会儿要用里面的地址**。

---

## 2. 认证方式（二选一，这步最容易卡住）

GitHub 早已不允许用账号密码 push，必须用 **PAT** 或 **SSH**。

### 方式 A：HTTPS + PAT（推荐，5 分钟）

1. 打开 <https://github.com/settings/tokens>
2. 点 **Generate new token** → **Generate new token (classic)**
3. Note 填 `atomlet-push`，Expiration 选 30 days
4. 勾选 **`repo`**（整个大类，会连带勾上下面的子项）
5. 拉到底点 **Generate token**
6. **立刻复制** `ghp_xxxxxxxx`——这个页面关掉就再也看不到了

push 时提示输入：

- `Username`：你的 GitHub 用户名（不是邮箱）
- `Password`：**粘贴刚才那串 token**（不是登录密码）

Windows 会自动存进「凭据管理器」，下次不用再输。

### 方式 B：SSH key（更稳，长期用）

```bash
ssh-keygen -t ed25519 -C "你的邮箱"      # 一路回车，不设密码也行
cat ~/.ssh/id_ed25519.pub                 # 复制输出的整行
```

复制后打开 <https://github.com/settings/keys> → **New SSH key** → 粘贴 → Add SSH key。

验证：

```bash
ssh -T git@github.com
# 期望：Hi <用户名>! You've successfully authenticated...
```

---

## 3. 推送（三条命令）

```bash
cd "E:/workBuddy_workplace/deepwisdom demo"

# ① 关联远程仓库（地址换成你刚建的那个）
git remote add origin https://github.com/<你的用户名>/atomlet.git

# ② 本地分支 master 改名为 main（GitHub 默认用 main，保持一致）
git branch -M main

# ③ 首次推送并建立追踪关系
git push -u origin main
```

**用 SSH 的话**把第 ① 行换成：

```bash
git remote add origin git@github.com:<你的用户名>/atomlet.git
```

三条命令分别在做什么：

| 命令                    | 作用                       | 失败会怎样                                 |
| --------------------- | ------------------------ | ------------------------------------- |
| `remote add`          | 只在本地配置里记一个叫 `origin` 的地址 | 写错地址 → 后面 push 报 404                  |
| `branch -M main`      | 把当前分支重命名为 main           | 不改也能推，只是分支叫 master，与 GitHub 默认不一致     |
| `push -u origin main` | 上传并记住"以后 push 默认推这里"     | `-u` 省掉后，以后要写全 `git push origin main` |

---

## 4. 验证上传成功

浏览器打开 `https://github.com/<用户名>/atomlet`，逐项核对：

- [ ] 文件数 **78**
- [ ] `README.md` 在首页自动渲染（不是显示源码）
- [ ] `SUBMISSION.md` 能看到
- [ ] `docs/` 下有 18 份 .md
- [ ] **没有** `.env`、`model.config.json`、`node_modules`
- [ ] 右上角 About 里填了描述，并加上 Demo 链接

补 About（加分项，30 秒）：仓库页右侧齿轮 → Description 填一句话，Website 填你的 `http://ECS_IP:3000`，Topics 加 `ai-agent`、`nextjs`、`postgresql`、`vibe-coding`。

---

## 5. 常见报错对照表

| 报错                                                          | 原因                   | 处理                                                          |
| ----------------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `remote origin already exists`                              | 之前配过                 | `git remote remove origin` 后重试                              |
| `Authentication failed`                                     | 用了登录密码               | 改用 token（§2 方式 A）                                           |
| `Support for password authentication was removed`           | 同上                   | 同上                                                          |
| `Permission denied (publickey)`                             | SSH key 没加到 GitHub   | 重新执行 `cat ~/.ssh/id_ed25519.pub` 并粘贴到 Settings → SSH keys   |
| `Repository not found`                                      | 地址写错，或 Private 仓库无权限 | 核对用户名/仓库名；Private 下 token 必须勾 `repo`                        |
| `Updates were rejected because the remote contains work...` | 建仓库时勾了 README        | `git pull --rebase origin main` 再 `git push -u origin main` |
| `src refspec main does not match any`                       | 分支名还是 master         | 先 `git branch -M main`                                      |
| `Failed to connect to github.com port 443` / 超时             | 网络到 GitHub 不通        | 见 §6                                                        |
| `warning: LF will be replaced by CRLF`                      | Windows 换行提示         | 已用 `.gitattributes` 处理，可忽略                                  |

---

## 6. 网络连不上 GitHub 时的处理

先判断是哪一层：

```bash
ping github.com
curl -I https://github.com
```

**如果 HTTPS 443 不通，改用 SSH over 443**（很多网络只放行 443）：

```bash
# ~/.ssh/config（没有就新建）
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

然后 `ssh -T git@github.com` 验证，再用 SSH 地址 push。

**如果本机有代理**，给 git 单独设置（端口按你的客户端改）：

```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
# 取消：git config --global --unset http.proxy
```

---

## 7. 后续更新（改完代码怎么再传）

```bash
git add -A
git commit -m "feat: 支持 xlsx 直接解析"
git push
```

三个命令，不用再带 `origin main`（第一次用了 `-u`）。

---

## 8. 在 ECS 上拉代码

```bash
cd /opt
git clone https://github.com/<用户名>/atomlet.git atomlet
cd atomlet

# 关键：.env 不在仓库里，必须手动创建
cat > .env <<'EOF'
POSTGRES_PASSWORD=你的强密码
DATABASE_URL=postgres://atomlet:同一个密码@db:5432/atomlet
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
EOF
chmod 600 .env
```

Private 仓库在 ECS 上 clone 时，用户名填 GitHub 用户名、密码填 PAT。

---

## 9. 安全检查（提交前必做）

```bash
# ① 仓库里绝不能有密钥
git ls-files | grep -E "^\.env$|model\.config\.json" && echo "危险！" || echo "安全"

# ② 扫描硬编码的 key
git grep -nE "sk-[A-Za-z0-9]{20,}" -- '*.ts' '*.tsx' '*.md' || echo "无硬编码密钥"
```

**万一误传了 key**（这是唯一会造成实际损失的错误）：

1. 立刻去模型平台后台**吊销该 key 并重新生成**
2. 从仓库移除：`git rm --cached .env && git commit -m "chore: remove secret" && git push`
3. 注意：**仅删除文件不够**，历史提交里仍有记录。仓库是 Public 的话，删库重建最干净

---

## 10. 不想用命令行：GitHub Desktop

1. 下载安装 GitHub Desktop，登录账号
2. `File → Add local repository` → 选 `E:\workBuddy_workplace\deepwisdom demo`
3. 右上 `Publish repository` → 取消勾选 "Keep this code private"（要公开的话）→ Publish
4. 之后每次改动：左下填说明 → `Commit to main` → 右上 `Push origin`

---

## 附：一次性命令块（HTTPS 方式，复制即用）

把两处 `<你的用户名>` 换掉：

```bash
cd "E:/workBuddy_workplace/deepwisdom demo"
git remote add origin https://github.com/<你的用户名>/atomlet.git
git branch -M main
git push -u origin main
```

推送时会提示输入用户名与密码（密码填 PAT）。
