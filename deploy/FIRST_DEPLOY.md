# QuantTrade 第一次自更新部署 · 实操剧本

> 这是给"第一次"做的 step-by-step 剧本。每一步**该做什么 + 该看到什么 + 卡住怎么办**都写清楚了。
> 全程顺利约 **30-40 分钟**。
>
> 完整参考手册见 `deploy/SETUP.md`，本文聚焦"第一次"的关键路径。

---

## 0. 你需要先准备好这些（在动手前确认）

| 项 | 说明 |
|---|---|
| **VPS** | Ubuntu 22.04 / Debian 12，root 或 sudo 用户，2GB+ 内存（1GB 也行但 build 需开 swap） |
| **公网 IP** | 服务器要能从公网访问（云厂商默认都有） |
| **域名** | 已经把 A 记录解析到服务器 IP，等待 5 分钟生效 |
| **本地仓库** | `git push` 能直接推到 `origin/main` |
| **GitHub 账号** | 仓库管理员，能配置 Webhook |

> 没域名先别开始 —— 没域名拿不到 HTTPS，GitHub Webhook 不让发到 http。

---

## 1. 上服务器装环境（5 分钟）

SSH 进 VPS：

```bash
ssh root@<你的服务器 IP>
```

一次性把所有环境装好（复制粘贴整段）：

```bash
# Node 22（用 nvm，不污染系统 apt）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22

# PM2 进程管理器
npm i -g pm2

# nginx + certbot + git + 编译工具
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git build-essential
```

**预期看到**：
- `node -v` 输出 `v22.x.x`
- `pm2 -v` 输出版本号
- `nginx -v` 输出版本号

**卡住怎么办**：
- nvm 装不上 → 是 GitHub raw 被墙，换镜像：
  ```bash
  curl -o- https://gitee.com/mirrors/nvm/raw/master/install.sh | bash
  ```
- `npm i -g pm2` 报权限 → 用 nvm 的 node 不会有这问题；如果你用的是 apt 装的 node，加 `sudo`

---

## 2. 拉代码 + 第一次手动构建（5-10 分钟）

```bash
# 放在 /opt 是惯例（也可放 /srv 或 ~/）
sudo mkdir -p /opt
cd /opt
sudo git clone https://github.com/bolutotop/QuantTrade.git
sudo chown -R $USER:$USER /opt/QuantTrade
cd /opt/QuantTrade

# 装依赖 + 构建
npm ci
npm run build

# 数据目录（SQLite + 反馈截图 + 日志，被 .gitignore 排除）
mkdir -p .data/logs
```

**预期看到**：
- `npm ci` 装包约 1-2 分钟，结束显示 `added xxx packages`
- `npm run build` 约 1-3 分钟，最后 `✓ Compiled successfully`，输出 `.next/` 目录
- `.data/logs/` 创建出来

**卡住怎么办**：
- `npm run build` 报内存不足（OOM Killed）：
  ```bash
  # 先看是不是 1G 小机器
  free -h

  # 加 2G swap
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

  # 再 build 一次，加上限制
  NODE_OPTIONS='--max-old-space-size=2048' npm run build
  ```

---

## 3. 配置 PM2 + 生成 webhook 密钥（3 分钟）

```bash
cd /opt/QuantTrade

# 复制配置模板，本地版不进 git（含密钥）
cp deploy/ecosystem.config.cjs deploy/ecosystem.local.cjs

# 生成一个密钥（一会儿 GitHub Webhook 也要填同一个）
openssl rand -hex 24
# 例如输出: 7f3a9c2e8b1d4f5a6e7c8d9b0a1c2d3e4f5a6b7c8d9e0f1a
# ⚠️ 这串字符串 GitHub Webhook 配置和服务器 PM2 配置必须完全一致
```

**把刚生成的密钥贴到 `deploy/ecosystem.local.cjs`**：

```bash
nano deploy/ecosystem.local.cjs
```

修改这两行：
```js
env: {
  NODE_ENV: 'production',
  WEBHOOK_SECRET: '7f3a9c2e8b1d4f5a6e7c8d9b0a1c2d3e4f5a6b7c8d9e0f1a',  // ← 填上面那串
  // ...
}
```

如果**不打算跑 sentiment-service**（B 站/小红书爬虫，多数人用不到）：把 `apps:` 数组里 `sentiment` 那一段删掉。

启动 PM2：

```bash
pm2 start deploy/ecosystem.local.cjs --env production
pm2 save
pm2 startup
# 它会输出一行 sudo 命令，复制粘贴执行（用于开机自启）

pm2 status
```

**预期看到**：
```
┌─────┬──────────────┬─────────┬──────────┬──────┬───────────┐
│ id  │ name         │ status  │ memory   │ cpu  │ uptime    │
├─────┼──────────────┼─────────┼──────────┼──────┼───────────┤
│ 0   │ quanttrade   │ online  │ 80MB     │ 0%   │ 5s        │
│ 1   │ webhook      │ online  │ 30MB     │ 0%   │ 5s        │
└─────┴──────────────┴─────────┴──────────┴──────┴───────────┘
```

**冒烟测试**：
```bash
curl http://127.0.0.1:3000/api/health
# 或访问首页（任意 200 OK 都说明 Next.js 起来了）
curl -I http://127.0.0.1:3000/

curl http://127.0.0.1:9000/health
# {"ok":true,"running":false,"pending":false,"branch":"main"}
```

**卡住怎么办**：
- `pm2 status` 看到 `errored` → `pm2 logs quanttrade --lines 50` 看错误
- 端口被占 → `sudo lsof -i :3000` 看是谁，必要时 `pm2 delete all` 重来

---

## 4. 配置 Nginx 反代 + HTTPS（5 分钟）

```bash
# 复制示例配置
sudo cp /opt/QuantTrade/deploy/nginx.conf.example /etc/nginx/sites-available/quanttrade.conf

# 改 server_name 为你的域名（共两处：80 和 443 server 块）
sudo nano /etc/nginx/sites-available/quanttrade.conf
# 找到 server_name your-domain.com; 改成你的真实域名

# 启用配置
sudo ln -s /etc/nginx/sites-available/quanttrade.conf /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null    # 移除默认欢迎页

# 测试 + 重载
sudo nginx -t && sudo systemctl reload nginx
```

**预期看到** `nginx -t` 输出：
```
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

现在用 certbot 申请 Let's Encrypt 免费证书：

```bash
sudo certbot --nginx -d your-domain.com
# 跟着交互填邮箱、同意协议
# 选择 "2: Redirect" —— 自动把 http 重定向到 https
```

**预期看到**：
```
Successfully received certificate.
Deploying certificate to /etc/letsencrypt/live/your-domain.com/...
Successfully deployed certificate
Congratulations!
```

打开浏览器访问 `https://your-domain.com`，应该看到 QuantTrade 首页。

**卡住怎么办**：
- certbot 报 `DNS problem: NXDOMAIN` → 域名 DNS 还没生效，等 5-10 分钟再试
- 报 `connection refused on port 80` → 服务器防火墙没开 80/443，云厂商面板配安全组
- 502 Bad Gateway → Next.js 没起来，回到第 3 步看 `pm2 logs`

---

## 5. 配置 GitHub Webhook（这是关键 ⭐）

打开浏览器：`https://github.com/bolutotop/QuantTrade/settings/hooks`

点 **Add webhook**，填表：

| 项 | 值 |
|---|---|
| **Payload URL** | `https://your-domain.com/webhook` |
| **Content type** | `application/json` |
| **Secret** | 第 3 步那串密钥（完全一致，无空格） |
| **SSL verification** | Enable SSL verification |
| **Which events?** | Just the push event（默认） |
| **Active** | ✅ |

点 **Add webhook**。GitHub 会立即发一个 ping 测试。

**回到服务器看日志**：
```bash
pm2 logs webhook --lines 20
```

**预期看到**：
```
[webhook] [<sha>] received push to refs/heads/main
[webhook] [<sha>] queue size = 1, run now
```
或仅一条 `[ping]` 类型的握手记录。

**最容易卡住的地方**：

| 现象 | 原因 |
|---|---|
| `bad signature` | Secret 两边不一致，**包括前后有没有空格** |
| `404 Not Found` | nginx 没把 `/webhook` 反代到 `127.0.0.1:9000`，检查 `deploy/nginx.conf.example` 里那段 |
| `Recent Deliveries` 显示 502 | webhook 进程没起来，`pm2 status` 看 |
| 完全没日志 | Webhook URL 拼错了，或者 SSL 验签 GitHub 失败 |

---

## 6. 第一次自动部署测试 🚀

在**本地**（不是服务器）：

```bash
# 改一行无关紧要的内容触发部署
echo "" >> README.md
git add README.md
git commit -m "chore: test auto deploy"
git push
```

**回到服务器看日志**（保持 SSH 连着）：

```bash
# 一窗口看 webhook 接收
pm2 logs webhook --lines 50

# 另一窗口看部署进度
tail -f /opt/QuantTrade/.data/deploy.log
```

**预期看到** `.data/deploy.log` 里完整流水：
```
========== [deploy] start at 2026-06-20 01:23:45 ==========
[deploy] target sha: a1b2c3d
[deploy] git fetch ...
[deploy] git reset --hard origin/main ...
[deploy] package-lock unchanged, skip npm ci
[deploy] src/ unchanged, skip build  (←本次只改了 README，所以跳过 build)
[deploy] pm2 reload quanttrade ...
[deploy] DONE in 4s
========== [deploy] end ==========
```

刷新浏览器访问站点，README 改动已生效。

---

## 7. 收尾 · 把这些做好你才算真正"完成第一次部署"

### 7.1 **加备份 cron**（5 秒就能改完，但能救你一次大事故）

```bash
crontab -e
# 在末尾加一行（每天凌晨 3 点备份 SQLite 数据库 + 反馈截图）
0 3 * * * cd /opt/QuantTrade && tar czf ~/backup/qt-$(date +\%F).tar.gz .data/ 2>/dev/null
```

```bash
mkdir -p ~/backup
```

### 7.2 **加防火墙（如果还没加）**

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
# webhook 监听 127.0.0.1:9000，不暴露到公网
```

### 7.3 **保存关键配置**（写在密码管理器里）

- 服务器 IP / SSH 密钥
- VPS root 密码
- `WEBHOOK_SECRET`（万一服务器挂了重新生成新机器要用）
- 域名 DNS 提供商账号

---

## 常用运维命令（贴墙备查）

```bash
# 看进程
pm2 status

# 看日志
pm2 logs                           # 所有进程
pm2 logs quanttrade --lines 200    # 仅主应用
pm2 logs webhook --lines 100       # 仅 webhook
tail -f /opt/QuantTrade/.data/deploy.log   # 部署流水

# 健康检查
curl http://127.0.0.1:9000/health

# 手动触发一次部署（绕过 GitHub）
cd /opt/QuantTrade && bash deploy/deploy.sh manual

# 滚回到某次 commit
cd /opt/QuantTrade
git reset --hard <要回到的 sha>
npm ci && npm run build
pm2 reload quanttrade

# 重启全部
pm2 reload all
```

---

## 自更新工作原理（一图速读）

```
本地 git push
       │
       ▼
GitHub  ──webhook (HMAC-SHA256 签)──▶  https://你的域名/webhook
                                              │ (Nginx 反代)
                                              ▼
                                       127.0.0.1:9000
                                       (deploy/webhook.js)
                                              │ 验签 + 队列
                                              ▼
                                       deploy/deploy.sh
                                       │
                                       ├─ git fetch + reset --hard
                                       ├─ npm ci  (智能跳过：lock 没变)
                                       ├─ npm run build  (智能跳过：src 没变)
                                       └─ pm2 reload quanttrade  ◀── 零停机
                                              │
                                              ▼
                                       新版本生效（用户无感知）
```

---

## 完。

如果哪一步卡死且文档没说怎么办，把对应的：
- `pm2 logs --err --lines 100`
- `tail -200 .data/deploy.log`
- `sudo journalctl -u nginx --lines 100`

三段日志贴出来，能定位 95% 的问题。
