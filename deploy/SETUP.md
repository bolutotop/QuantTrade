# QuantTrade 自动部署 · 一次性安装手册

> 目标：**部署一次后，每次 `git push` 自动更新服务器**。
> 适用：Ubuntu/Debian VPS，root 权限，公网 IP，已绑定域名。

---

## 一、原理（速览）

```
你的电脑                           服务器                     你的浏览器
─────────────────────────────────────────────────────────────────────────
git push                                                       https://your-domain
      │                                                              │
      ▼                                                              ▼
   GitHub ──webhook (HMAC 验签)──▶ 9000 (webhook.js) ──▶ deploy.sh
                                       │                       │
                                       │                       ├─ git fetch + reset
                                       │                       ├─ npm ci (智能跳过)
                                       │                       ├─ npm run build (智能跳过)
                                       │                       └─ pm2 reload quanttrade  ◀──── 零停机
                                       │
                                       └──────── pm2 也守护 ────▶ 3000 (Next.js)
                                                                    8787 (sentiment 可选)
                                                       │
                                                       ▼
                                                    nginx 443 → 反代
```

---

## 二、首次部署清单（约 30 分钟）

### 1. 基础环境

```bash
# Node 20+（推荐 22）。这里用 nvm，干净又灵活
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22

# PM2（进程管理 + 开机自启）
npm i -g pm2

# nginx + certbot（反代 + 自动 HTTPS）
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git build-essential
```

### 2. 拉代码 & 装依赖

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/bolutotop/QuantTrade.git
sudo chown -R $USER:$USER /opt/QuantTrade
cd /opt/QuantTrade

npm ci
npm run build

# 数据目录（被 .gitignore 排除，不会被部署覆盖）
mkdir -p .data/logs
```

### 3. 配置 PM2（管理 Next.js + Webhook + Sentiment）

```bash
# 复制并改 secret
cp deploy/ecosystem.config.cjs deploy/ecosystem.local.cjs

# 生成一个强随机串作为 webhook secret
openssl rand -hex 24
# 把输出的字符串记下来，下一步两边都要填
```

编辑 `deploy/ecosystem.local.cjs`：
- `WEBHOOK_SECRET`：填刚才生成的随机串
- 不跑 sentiment 子服务的话，把 `sentiment` 那一段从 `apps` 数组里删掉
- `QUOTE_PROVIDER`：默认 `sina`，要切腾讯就改 `tencent`

启动：
```bash
pm2 start deploy/ecosystem.local.cjs --env production
pm2 save
pm2 startup    # 复制输出的 sudo 行执行一次
pm2 status     # 应看到 quanttrade / webhook / (sentiment) online
```

### 4. 配置 Nginx 反代 + HTTPS

```bash
# 复制示例配置
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/quanttrade.conf

# 把 server_name 改成你的域名（两处）
sudo nano /etc/nginx/sites-available/quanttrade.conf

sudo ln -s /etc/nginx/sites-available/quanttrade.conf /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null   # 可选：移除默认站点
sudo nginx -t && sudo systemctl reload nginx

# 自动签发 Let's Encrypt 证书
sudo certbot --nginx -d your-domain.com
# 选 "重定向到 HTTPS"（选项 2）
```

打开 `https://your-domain.com` 应能看到 QuantTrade 主页。

### 5. 配置 GitHub Webhook（关键！）

进入仓库：https://github.com/bolutotop/QuantTrade/settings/hooks

点 **Add webhook**，填：

| 项 | 值 |
|---|---|
| Payload URL | `https://your-domain.com/webhook` |
| Content type | `application/json` |
| Secret | **第 3 步生成的那个字符串**（必须完全一致！） |
| SSL verification | Enable |
| Which events | Just the push event |
| Active | ✅ |

点 **Add webhook**。GitHub 会立即发一个 ping。

验证：
```bash
pm2 logs webhook --lines 20
# 应看到 "[reject] bad signature" 一条都不要有，至少有一条 "ping" → "pong"
```

### 6. 测试自动部署

在本地：
```bash
# 改一行无关紧要的文件（比如 README）
echo "" >> README.md
git commit -am "chore: test auto deploy"
git push
```

服务器上看日志：
```bash
pm2 logs webhook --lines 30
tail -f .data/deploy.log
```

应该看到完整的 `[deploy] start` → `git fetch` → `pm2 reload quanttrade` → `[deploy] DONE`。

---

## 三、（可选）sentiment-service 子服务

不需要 B 站/小红书爬虫的话**不用搞**，前端会自动降级显示提示。

```bash
cd /opt/QuantTrade/sentiment-service

# 装 Python venv
sudo apt install -y python3-venv
python3 -m venv .venv
source .venv/bin/activate

# clone MediaCrawler 到 vendor/（第一次会下载浏览器，约 200MB）
git clone https://github.com/NanmiCoder/MediaCrawler.git vendor/MediaCrawler
pip install -r requirements.txt
pip install -r vendor/MediaCrawler/requirements.txt
playwright install chromium

# 每个平台扫码登录一次（参考 sentiment-service/README.md）
deactivate

# 让 PM2 接管它（之前 ecosystem.cjs 已经定义了 sentiment 进程）
pm2 reload sentiment
```

---

## 四、（可选）接入通知

参考 `deploy/notify.sh`，把对应渠道的 curl 取消注释 + 填 token，然后在 `ecosystem.local.cjs` 里启用：

```js
env: {
  // ...
  NOTIFY_SCRIPT: './deploy/notify.sh',
}
```

`pm2 reload webhook --update-env` 生效。

---

## 五、常用运维命令

```bash
# 看进程状态
pm2 status

# 实时日志
pm2 logs                    # 全部
pm2 logs quanttrade         # 仅主应用
pm2 logs webhook --lines 100

# 部署日志（webhook 自己写的）
tail -f .data/deploy.log
curl http://127.0.0.1:9000/log | tail -100   # 也可以从 webhook 服务读

# 手动触发一次部署（不用 webhook）
bash deploy/deploy.sh manual

# 健康检查
curl http://127.0.0.1:9000/health
# {"ok":true,"running":false,"pending":false,"branch":"main"}

# 重启所有
pm2 reload all

# 滚回到某个 commit
cd /opt/QuantTrade
git reset --hard <sha>
npm ci && npm run build
pm2 reload quanttrade
```

---

## 六、安全提醒

- `WEBHOOK_SECRET` 一定要 **强随机**（`openssl rand -hex 24` 产出的就行），不要用人能猜的字符串。
- webhook 监听 `127.0.0.1:9000`，**不直接暴露**，由 nginx 反代到 `/webhook` 路径并走 https。
- `.data/` 目录里有 SQLite 数据库 + 反馈截图 + 部署日志 + 推荐定期备份：
  ```bash
  # 加到 crontab：每天 3 点备份到 ~/backup/
  0 3 * * * cd /opt/QuantTrade && tar czf ~/backup/qt-$(date +\%F).tar.gz .data/
  ```
- 不要把 `ecosystem.local.cjs` 提交到 git（含 secret）。仓库里的 `ecosystem.config.cjs` 是带占位符的模板。

---

## 七、踩坑速查

| 现象 | 原因 / 排查 |
|---|---|
| `pm2 logs webhook` 出现 `bad signature` | secret 不一致；GitHub Webhook 配置和 PM2 env 必须完全相同 |
| 推送后 webhook 没反应 | GitHub 那边 webhook → Recent Deliveries 看 HTTP 状态码 |
| `npm run build` 报内存不足 | `NODE_OPTIONS='--max-old-space-size=2048' npm run build`；或加 swap |
| `pm2 reload` 后端口冲突 | 上一次构建挂了，端口被占；`pm2 stop quanttrade && pm2 start ecosystem...` |
| 反馈截图传完看不到 | nginx `client_max_body_size` 太小；改成 20M 后 `nginx -s reload` |
| 部署中 push 第二个 commit | webhook.js 有队列，会自动等当前完再跑下一个 |

完。
