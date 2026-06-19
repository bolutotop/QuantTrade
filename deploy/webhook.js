#!/usr/bin/env node
/**
 * GitHub Webhook 监听器
 *
 * 职责：
 *   1. 接收 GitHub 的 push webhook
 *   2. 用 HMAC-SHA256 验签（防止任何人都能触发部署）
 *   3. 校验 ref == refs/heads/main
 *   4. 调用 deploy.sh，stream 日志到 .data/deploy.log
 *   5. 文件锁防并发：部署中再来的请求直接 202 Accepted（已排队）
 *
 * 环境变量：
 *   WEBHOOK_PORT       默认 9000
 *   WEBHOOK_SECRET     必填，与 GitHub webhook 配置的 secret 完全一致
 *   DEPLOY_BRANCH      默认 main
 *   DEPLOY_SCRIPT      默认 ./deploy/deploy.sh
 *   DEPLOY_LOG         默认 ./.data/deploy.log
 *   NOTIFY_SCRIPT      可选，部署完成后调用，参数: success|fail commit_sha "msg"
 *
 * 启动：
 *   pm2 start deploy/webhook.js --name webhook --update-env
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.WEBHOOK_PORT || 9000);
const SECRET = process.env.WEBHOOK_SECRET || '';
const BRANCH = process.env.DEPLOY_BRANCH || 'main';
const SCRIPT = path.resolve(process.env.DEPLOY_SCRIPT || './deploy/deploy.sh');
const LOG_FILE = path.resolve(process.env.DEPLOY_LOG || './.data/deploy.log');
const NOTIFY = process.env.NOTIFY_SCRIPT ? path.resolve(process.env.NOTIFY_SCRIPT) : '';
const REPO_DIR = process.env.REPO_DIR ? path.resolve(process.env.REPO_DIR) : process.cwd();

if (!SECRET) {
  console.error('[webhook] FATAL: WEBHOOK_SECRET is empty. Set it to a random string and configure in GitHub.');
  process.exit(1);
}
if (!fs.existsSync(SCRIPT)) {
  console.error(`[webhook] FATAL: deploy script not found at ${SCRIPT}`);
  process.exit(1);
}

// 确保 log 目录存在
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// ----------- 部署队列（同一时刻只跑一个，新请求会直接合并） -----------
let running = false;
let pending = false;
let pendingSha = '';

function appendLog(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(LOG_FILE, stamped);
  process.stdout.write(stamped);
}

function notify(status, sha, msg) {
  if (!NOTIFY) return;
  try {
    spawn(NOTIFY, [status, sha, msg], { stdio: 'ignore', detached: true }).unref();
  } catch (e) {
    appendLog(`[notify] failed: ${String(e)}`);
  }
}

function runDeploy(sha) {
  if (running) {
    pending = true;
    pendingSha = sha;
    appendLog(`[queue] another deploy is running, queued for ${sha}`);
    return;
  }
  running = true;
  appendLog(`[deploy] start, target sha=${sha}`);

  const child = spawn('bash', [SCRIPT, sha], {
    cwd: REPO_DIR,
    env: { ...process.env, DEPLOY_SHA: sha },
  });

  child.stdout.on('data', (d) => fs.appendFileSync(LOG_FILE, d));
  child.stderr.on('data', (d) => fs.appendFileSync(LOG_FILE, d));

  child.on('exit', (code) => {
    running = false;
    const ok = code === 0;
    appendLog(`[deploy] finished, exit=${code}`);
    notify(ok ? 'success' : 'fail', sha, ok ? 'deploy ok' : `deploy failed (exit ${code})`);
    if (pending) {
      const next = pendingSha;
      pending = false;
      pendingSha = '';
      runDeploy(next);
    }
  });
}

// ----------- HMAC 验签 -----------
function verifySignature(secret, body, signatureHeader) {
  if (!signatureHeader) return false;
  // GitHub 头：X-Hub-Signature-256: sha256=xxxx
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ----------- HTTP 服务 -----------
const server = http.createServer((req, res) => {
  // 健康检查
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, running, pending, branch: BRANCH }));
    return;
  }
  // 部署日志查看（仅本机或反代时配 IP 白名单）
  if (req.method === 'GET' && req.url === '/log') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    try {
      const txt = fs.readFileSync(LOG_FILE, 'utf-8');
      // 只返回最后 200KB，避免大文件
      res.end(txt.length > 200000 ? txt.slice(-200000) : txt);
    } catch {
      res.end('(no log yet)');
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404).end('not found');
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const sig = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'] || '';
    const delivery = req.headers['x-github-delivery'] || '';

    if (!verifySignature(SECRET, body, sig)) {
      appendLog(`[reject] bad signature, delivery=${delivery}`);
      res.writeHead(401).end('bad signature');
      return;
    }

    if (event === 'ping') {
      res.writeHead(200).end('pong');
      return;
    }
    if (event !== 'push') {
      res.writeHead(200).end(`event ${event} ignored`);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body.toString('utf-8'));
    } catch {
      res.writeHead(400).end('invalid json');
      return;
    }

    const ref = payload.ref || '';
    if (ref !== `refs/heads/${BRANCH}`) {
      appendLog(`[skip] ref ${ref} != refs/heads/${BRANCH}`);
      res.writeHead(200).end(`branch skipped: ${ref}`);
      return;
    }

    const sha = (payload.after || '').slice(0, 12) || 'unknown';
    const author = payload?.head_commit?.author?.name || 'unknown';
    const msg = (payload?.head_commit?.message || '').split('\n')[0];
    appendLog(`[push] sha=${sha} by ${author}: ${msg}`);

    runDeploy(sha);
    res.writeHead(202).end('accepted');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook] listening on 127.0.0.1:${PORT}, branch=${BRANCH}`);
  console.log(`[webhook] script=${SCRIPT}`);
  console.log(`[webhook] log=${LOG_FILE}`);
  if (NOTIFY) console.log(`[webhook] notify=${NOTIFY}`);
});

// 优雅退出
function shutdown(sig) {
  console.log(`[webhook] ${sig} received, closing...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
