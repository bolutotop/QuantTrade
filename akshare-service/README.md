# akshare-service —— A 股/港股/美股 资讯网关

QuantTrade 的资讯子服务。基于 [AKShare](https://github.com/akfamily/akshare)（22k★，长期维护），覆盖：

- A 股 / 港股 / 美股 个股新闻
- 公司公告
- 研报、F10、龙虎榜
- CCTV 财经、东方财富要闻、新浪 7×24

> 本服务**只在你想要更全的新闻源**时才需要启动。
> Next.js 主应用在没有它的时候，会自动降级到内置的"新浪/东财/雪球/巨潮"四源聚合。

---

## 一、架构

```
┌──────────────────┐   HTTP    ┌──────────────────────────┐
│  Next.js         │  ───────▶ │ akshare-service (FastAPI) │
│  /api/news       │           │ ┌──────────────────────┐ │
│   ↓ 港股/A 股    │           │ │  AKShare (Python)    │ │
│   ↓ 名称/代码    │           │ │  ├ stock_news_em     │ │
│   反代到本服务   │           │ │  ├ stock_zh_a_news   │ │
└──────────────────┘           │ │  ├ stock_hk_news     │ │
                               │ │  └ news_cctv         │ │
                               │ └──────────────────────┘ │
                               └──────────────────────────┘
```

---

## 二、安装

```bash
cd akshare-service
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
```

`requirements.txt`：
```
akshare>=1.18.0
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
pydantic>=2.6.0
python-dotenv>=1.0.0
```

---

## 三、启动

```bash
uvicorn server:app --host 127.0.0.1 --port 8788 --reload
```

然后在 Next.js 项目根目录的 `.env.local` 里加：
```
AKSHARE_SERVICE_URL=http://127.0.0.1:8788
```

`pm2 reload quanttrade --update-env` 后生效。

---

## 四、HTTP 契约

### `GET /api/news?code=<symbol>&name=<name>&limit=<n>`

- `code`: 内部 symbol（`sh600519` / `hk09626` / `us.AAPL`）
- `name`: 股票名称（可选，AKShare 部分接口需要）
- `limit`: 返回数量

返回：
```json
{
  "items": [
    {
      "id": "ak:em:xxxxxxxxx",
      "source": "akshare",
      "type": "news",
      "title": "...",
      "summary": "...",
      "url": "...",
      "time": "2026-06-19 14:32",
      "ts": 1781234567000,
      "author": "..."
    }
  ]
}
```

### 推荐 AKShare 接口对应表（在 server.py 里实现）

| 资讯类型 | A 股 | 港股 | 备注 |
|---|---|---|---|
| 个股新闻 | `stock_news_em(symbol="600519")` | `stock_news_em(symbol="00700")` | 东方财富，覆盖最广 |
| 个股公告 | `stock_notice_report` | `stock_hk_notice_em` | |
| 研报 | `stock_research_report_em` | 同 | |
| 财经要闻 | `news_cctv` / `stock_news_main_cx` | 同 | 大盘资讯，不分股票 |

---

## 五、注意

- AKShare 内部调用很多上游接口，**会有短时不可达**；server.py 里都加了 try/except 容错
- 国内环境直接装即可；海外服务器有时需要走代理
- 数据多为公开资讯，遵守对应平台 robots
