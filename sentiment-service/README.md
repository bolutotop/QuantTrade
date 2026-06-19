# sentiment-service —— B站 / 小红书 / 微博 舆情服务

QuantTrade 的舆情子服务。**独立部署**，与 Next.js 主应用通过 HTTP 通信。

> 本服务**只在你想抓 B站/小红书/抖音/微博 视频与评论区**时才需要启动。
> 仅启动 Next.js 主应用也能使用「资讯」「公告」「雪球」「热度」等合规公开源 Tab。

---

## 一、它是什么

```
┌──────────────────┐    HTTP    ┌─────────────────────────────────┐
│  Next.js 前端    │  ────────▶ │  sentiment-service (FastAPI)    │
│  /api/social ──┐ │            │  ┌───────────────────────────┐  │
│                └────────────▶ │  │  MediaCrawler (Playwright)│  │
│                  │            │  │  └─ 小红书/B站/微博/抖音  │  │
└──────────────────┘            │  ├───────────────────────────┤  │
                                │  │  关键词→股票映射          │  │
                                │  ├───────────────────────────┤  │
                                │  │  情感打分 (SnowNLP/LLM)   │  │
                                │  ├───────────────────────────┤  │
                                │  │  SQLite 存储              │  │
                                │  └───────────────────────────┘  │
                                └─────────────────────────────────┘
```

- **爬虫核心**：[NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) (25k★)
- **HTTP 包装**：FastAPI（轻量，自带 OpenAPI 文档）
- **存储**：SQLite（足够个人/小团队；后续可换 PostgreSQL）
- **调度**：APScheduler 定时按自选股关键词抓取

---

## 二、目录结构

```
sentiment-service/
├── README.md            # 你正在看
├── requirements.txt     # Python 依赖
├── .env.example         # 环境变量模板
├── server.py            # FastAPI HTTP 服务入口
├── scheduler.py         # 定时抓取调度器
├── db.py                # SQLite 模型 + 操作
├── stock_keywords.py    # 股票代码↔关键词映射
├── sentiment.py         # 情感分析（SnowNLP，可换 LLM）
├── crawlers/            # MediaCrawler 适配层（薄封装）
│   ├── __init__.py
│   ├── base.py
│   ├── bilibili.py      # B站：搜索关键词→视频→评论
│   ├── xhs.py           # 小红书：搜索→笔记→评论
│   └── weibo.py         # 微博：搜索→帖子→评论
└── data/
    └── sentiment.db     # 运行时生成
```

---

## 三、首次部署

### 1. 系统依赖

- **Python 3.10+**（推荐 3.11）
- **Playwright** 浏览器：首次会下载 Chromium 约 150MB

### 2. 克隆 MediaCrawler 到当前目录

由于 MediaCrawler 不发布到 PyPI，需要直接克隆：

```bash
cd sentiment-service
git clone https://github.com/NanmiCoder/MediaCrawler.git vendor/MediaCrawler
```

### 3. 装依赖

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
# source .venv/bin/activate

pip install -r requirements.txt
pip install -r vendor/MediaCrawler/requirements.txt

playwright install chromium
```

### 4. 配置

```bash
cp .env.example .env
# 编辑 .env，填入：
#   - 数据库路径
#   - 想抓的平台
#   - 抓取间隔
```

### 5. 首次登录（保留 cookie）

每个平台需要扫码登录一次，cookie 会保存在 `vendor/MediaCrawler/browser_data/` 下：

```bash
# 走 MediaCrawler 自带的登录流程，每平台跑一次
cd vendor/MediaCrawler
python main.py --platform bili --lt qrcode --type search --keywords "测试"
python main.py --platform xhs  --lt qrcode --type search --keywords "测试"
python main.py --platform wb   --lt qrcode --type search --keywords "测试"
```

> ⚠ 不要使用主力账号；建议为爬虫单独注册小号。

### 6. 启动 HTTP 服务

```bash
# 开发
uvicorn server:app --reload --host 127.0.0.1 --port 8787

# 生产
uvicorn server:app --host 0.0.0.0 --port 8787 --workers 1
```

服务起来后，前端 `/api/social` 会自动接到。
访问 http://127.0.0.1:8787/docs 可看 OpenAPI 文档。

### 7. 启动定时抓取（可选）

```bash
python scheduler.py
```

它会读取 `watchlist_keywords.json`（你可以从 Next.js 前端导出，或手动维护），
按配置的频率为每只股票抓最新数据并写入 SQLite。

---

## 四、与 Next.js 前端对接

Next.js 这边已就绪：

1. `src/app/api/social/route.ts` 反代到 `SENTIMENT_SERVICE_URL`（默认 `http://127.0.0.1:8787`）。
2. 前端 `SentimentPanel` 组件的「社媒」Tab 会拉这个接口。
3. 当本服务**未启动**时，Next.js 前端会优雅降级，显示
   *"舆情服务未启动，请按 sentiment-service/README.md 部署"*，主应用其他功能不受影响。

要改服务地址，在 Next.js 项目根目录的 `.env.local` 添加：

```
SENTIMENT_SERVICE_URL=http://your-server:8787
```

---

## 五、HTTP 接口契约

### `GET /api/posts`

| 参数 | 必填 | 说明 |
|---|---|---|
| `code` | ✅ | 6 位股票代码 |
| `name` | | 股票名称（用于关键词匹配） |
| `limit` | | 返回数量，默认 40 |
| `platforms` | | 逗号分隔，默认 `bilibili,xhs,weibo` |

返回：

```json
{
  "code": "600519",
  "name": "贵州茅台",
  "items": [
    {
      "id": "bili:BV1xxxxx",
      "platform": "bilibili",
      "type": "video",
      "title": "贵州茅台2026年终业绩分析",
      "content": "...",
      "author": "财经UP主",
      "url": "https://www.bilibili.com/video/BV1xxxxx",
      "time": "2026-06-19 14:32",
      "ts": 1734567890123,
      "likes": 1234,
      "comments": 56,
      "views": 78901,
      "sentiment": 1,
      "sentimentScore": 0.78
    }
  ],
  "serviceAvailable": true
}
```

### `POST /api/refresh`

立即触发一次某股票的抓取（同步等待）。仅供调试。

---

## 六、合规与免责

- 本服务仅抓取**公开**内容，不绕过登录墙、不破解付费内容。
- MediaCrawler 作者声明 *"仅供学习交流，请勿用于商业"* —— **请遵守**。
- 各平台 robots / 用户协议 优先。建议：
  - 爬取频率 ≥ 5 分钟/次
  - 单平台 cookie 用小号
  - 数据本地存储，**不要二次分发**

如有疑问或被风控，请降低频率或停用。
