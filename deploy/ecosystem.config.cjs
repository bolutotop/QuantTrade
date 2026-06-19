// PM2 ecosystem 配置
//
// 启动：
//   cd /opt/quanttrade
//   pm2 start deploy/ecosystem.config.cjs --env production
//   pm2 save
//   pm2 startup    # 输出一行 sudo，照做即可开机自启
//
// 默认管理 3 个进程：
//   1. quanttrade    Next.js 主应用（端口 3000）
//   2. webhook       GitHub Webhook 监听器（端口 9000，仅 127.0.0.1）
//   3. sentiment     可选，Python FastAPI 子服务（如未部署可移除该块）

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // Next.js 主应用
    // -------------------------------------------------------------------------
    {
      name: 'quanttrade',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: __dirname.replace(/[/\\]deploy$/, ''),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        // 默认 quote 数据源：sina | tencent
        QUOTE_PROVIDER: 'sina',
        // 与 sentiment-service 联动；不跑可不设
        SENTIMENT_SERVICE_URL: 'http://127.0.0.1:8787',
      },
      // 日志
      out_file: './.data/logs/quanttrade.out.log',
      error_file: './.data/logs/quanttrade.err.log',
      merge_logs: true,
      time: true,
    },

    // -------------------------------------------------------------------------
    // GitHub Webhook 监听器
    // -------------------------------------------------------------------------
    {
      name: 'webhook',
      script: './deploy/webhook.js',
      cwd: __dirname.replace(/[/\\]deploy$/, ''),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        WEBHOOK_PORT: '9000',
        // ⚠ 改成 32 位以上随机字符串，并填到 GitHub Webhook 的 Secret
        WEBHOOK_SECRET: 'CHANGE_ME_TO_RANDOM_LONG_STRING',
        DEPLOY_BRANCH: 'main',
        DEPLOY_SCRIPT: './deploy/deploy.sh',
        DEPLOY_LOG: './.data/deploy.log',
        // 通知脚本，先不接，留接口；接通知时取消注释：
        // NOTIFY_SCRIPT: './deploy/notify.sh',
      },
      out_file: './.data/logs/webhook.out.log',
      error_file: './.data/logs/webhook.err.log',
      merge_logs: true,
      time: true,
    },

    // -------------------------------------------------------------------------
    // sentiment-service（可选；不部署可整段删除或注释）
    // -------------------------------------------------------------------------
    {
      name: 'sentiment',
      // 用 venv 里的 python；首次部署见 sentiment-service/README.md
      script: './sentiment-service/.venv/bin/python',
      args: '-m uvicorn server:app --host 127.0.0.1 --port 8787',
      cwd: __dirname.replace(/[/\\]deploy$/, '') + '/sentiment-service',
      interpreter: 'none',     // 不用 node 解释
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        PORT: '8787',
        HOST: '127.0.0.1',
      },
      out_file: '../.data/logs/sentiment.out.log',
      error_file: '../.data/logs/sentiment.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
