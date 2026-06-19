"""FastAPI HTTP 服务入口。

启动：
    uvicorn server:app --reload --port 8787

接口：
    GET  /api/posts          按股票拉舆情
    POST /api/refresh        触发一次抓取
    GET  /api/health         健康检查
    GET  /docs               OpenAPI 文档
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Body
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

import db
from stock_keywords import keywords_for
from sentiment import analyze
from crawlers.bilibili import BilibiliCrawler
from crawlers.xhs import XhsCrawler
from crawlers.weibo import WeiboCrawler


MEDIACRAWLER_DIR = os.environ.get("MEDIACRAWLER_DIR", "./vendor/MediaCrawler")
MAX_PER_PLATFORM = int(os.environ.get("MAX_ITEMS_PER_PLATFORM", "20"))


CRAWLERS = {
    "bilibili": BilibiliCrawler(MEDIACRAWLER_DIR),
    "xhs":      XhsCrawler(MEDIACRAWLER_DIR),
    "weibo":    WeiboCrawler(MEDIACRAWLER_DIR),
}


app = FastAPI(title="QuantTrade Sentiment Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "mediacrawler_dir": MEDIACRAWLER_DIR,
        "crawlers": {k: getattr(c, "_available", True) for k, c in CRAWLERS.items()},
        "ts": int(time.time() * 1000),
    }


@app.get("/api/posts")
def get_posts(
    code: str = Query(..., min_length=4, max_length=6, regex=r"^\d{4,6}$"),
    name: str = Query(""),
    limit: int = Query(40, ge=1, le=200),
    platforms: str = Query("bilibili,xhs,weibo"),
) -> dict:
    plats = [p.strip() for p in platforms.split(",") if p.strip() in CRAWLERS]
    rows = db.list_posts(code, plats, limit)
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "platform": r["platform"],
            "type": r["type"],
            "title": r["title"],
            "content": r["content"],
            "author": r["author"],
            "url": r["url"],
            "time": _fmt_ts(r["ts"]),
            "ts": r["ts"],
            "likes": r["likes"],
            "comments": r["comments"],
            "views": r["views"],
            "sentiment": r["sentiment"],
            "sentimentScore": r["sentiment_score"],
        })
    return {
        "code": code,
        "name": name,
        "items": items,
        "serviceAvailable": True,
    }


@app.post("/api/refresh")
async def refresh(
    code: str = Body(..., embed=True),
    name: str = Body("", embed=True),
    platforms: list[str] = Body(default=["bilibili", "xhs", "weibo"], embed=True),
) -> dict:
    """同步抓一次（最多 1~2 分钟）。"""
    kws = keywords_for(code, name)
    summary = {}
    for plat in platforms:
        c = CRAWLERS.get(plat)
        if not c:
            summary[plat] = {"ok": False, "error": "unknown platform"}
            continue
        started = int(time.time() * 1000)
        res = await c.search(kws, MAX_PER_PLATFORM)
        cnt = 0
        if res.items:
            # 加 stock 字段 + 情感打分
            enriched = []
            for it in res.items:
                text = (it.get("title") or "") + " " + (it.get("content") or "")
                sent_label, sent_score = analyze(text)
                enriched.append({
                    **it,
                    "stock_code": code,
                    "stock_name": name or None,
                    "sentiment": sent_label,
                    "sentiment_score": sent_score,
                })
            cnt = db.upsert_posts(enriched)
        db.log_run(code, plat, ok=res.error is None, count=cnt, error=res.error, started=started)
        summary[plat] = {"ok": res.error is None, "count": cnt, "error": res.error}
    return {"code": code, "name": name, "result": summary}


def _fmt_ts(ts: int) -> str:
    if not ts:
        return ""
    import datetime
    return datetime.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8787")),
    )
