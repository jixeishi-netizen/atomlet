/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  /**
   * 允许把构建产物放到别的目录：本机 WorkBuddy 环境的 safe-delete 守卫会拦下
   * `next build` 清理旧 `.next` 的批量删除（SAFE_DELETE_BULK_CONFIRM_REQUIRED）。
   * 需要干净构建时用 `ATOMLET_DIST_DIR=.next-verify npm run build` 指到空目录即可，
   * 默认仍是标准 `.next`，云端/Docker 构建不受影响。
   */
  distDir: process.env.ATOMLET_DIST_DIR || '.next',
};

export default nextConfig;
