/**
 * 带模型配置的启动器。
 *
 * 为什么需要它：`.env` 是点开头的文件，某些文件浏览器/编辑器默认不显示，
 * 而这里把模型配置放在普通的 model.config.json 里，改完直接跑：
 *
 *   npm run start:model      # 生产模式（先 npm run build）
 *   npm run dev:model        # 开发模式
 *
 * apiKey 为空时自动走 mock 通道；填了 key 会自动切成 openai 通道。
 * model.config.json 已加入 .gitignore，不会被提交。
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const mode = process.argv[2] === 'dev' ? 'dev' : 'start';
const cfgPath = resolve(process.cwd(), 'model.config.json');
const envPath = resolve(process.cwd(), '.env');

const env = { ...process.env };

/**
 * 手动加载 .env 并注入子进程。
 * 原因：`next start` 会复用构建时写进 required-server-files.json 的环境变量，
 * 改了 .env 不重新 build 就不生效。显式注入 process.env 可以绕开这一点。
 */
const MANAGED_KEYS = [
  'DATABASE_URL',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'GEN_TIMEOUT_MS',
];

if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (MANAGED_KEYS.includes(key) && value.length > 0) env[key] = value;
  }
}

if (existsSync(cfgPath)) {
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (cfg.apiKey && String(cfg.apiKey).trim().length > 0) {
      env.LLM_PROVIDER = 'openai';
      env.LLM_BASE_URL = cfg.baseUrl || 'https://api.deepseek.com/v1';
      env.LLM_MODEL = cfg.model || 'deepseek-chat';
      env.LLM_API_KEY = String(cfg.apiKey).trim();
      console.log(`[model] 真实通道：${env.LLM_MODEL} @ ${env.LLM_BASE_URL}`);
    } else {
      // model.config.json 没有 key 时完全沿用 .env，不覆盖 provider
      console.log('[model] model.config.json 未填 apiKey，沿用 .env 配置');
    }
    if (cfg.port) env.PORT = String(cfg.port);
  } catch (err) {
    console.error(`[model] model.config.json 解析失败：${err.message}`);
    process.exit(1);
  }
} else {
  console.log('[model] 未找到 model.config.json，使用 .env / 默认配置');
}

env.NEXT_TELEMETRY_DISABLED = '1';

const useReal = String(env.LLM_PROVIDER ?? '').toLowerCase() === 'openai' && !!env.LLM_API_KEY;
console.log(
  useReal
    ? `[model] 生效通道：真实模型 ${env.LLM_MODEL} @ ${env.LLM_BASE_URL}（key 长度 ${String(env.LLM_API_KEY).length}）`
    : '[model] 生效通道：mock（本地确定性生成）',
);

const port = env.PORT || '3100';
const args = ['next', mode === 'dev' ? 'dev' : 'start', '-p', port];

const child = spawn('npx', args, { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
