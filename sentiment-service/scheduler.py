"""定时调度：按 watchlist_keywords.json 每 N 分钟抓一次。

启动：
    python scheduler.py

它通过 HTTP 调用本机 server.py 的 /api/refresh，所以
请先 `uvicorn server:app --port 8787`。

也可以改为直接 import server 同进程跑——但分两个进程更稳：
- server.py 永远响应前端
- scheduler.py 失败/卡住不影响在线接口
"""
from __future__ import annotations

import asyncio
import os
import time

import httpx
from dotenv import load_dotenv

from stock_keywords import load_watchlist

load_dotenv()

PORT = int(os.environ.get("PORT", "8787"))
INTERVAL_MIN = int(os.environ.get("SCHEDULE_INTERVAL_MINUTES", "15"))
CONCURRENCY = int(os.environ.get("SCHEDULE_CONCURRENCY", "2"))
WATCHLIST_FILE = os.environ.get("WATCHLIST_FILE", "./watchlist_keywords.json")
PLATFORMS = [p.strip() for p in os.environ.get("ENABLED_PLATFORMS", "bilibili,xhs,weibo").split(",") if p.strip()]


async def refresh_one(client: httpx.AsyncClient, code: str, name: str) -> None:
    try:
        r = await client.post(
            f"http://127.0.0.1:{PORT}/api/refresh",
            json={"code": code, "name": name, "platforms": PLATFORMS},
            timeout=180,
        )
        print(f"[{code} {name}] {r.status_code} {r.text[:200]}")
    except Exception as e:
        print(f"[{code} {name}] ERROR {e}")


async def tick() -> None:
    items = load_watchlist(WATCHLIST_FILE)
    if not items:
        print(f"watchlist empty: {WATCHLIST_FILE}")
        return
    sem = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient() as client:
        async def run(it: dict) -> None:
            async with sem:
                await refresh_one(client, it["code"], it.get("name", ""))
        await asyncio.gather(*(run(it) for it in items))


async def main() -> None:
    print(f"scheduler started, interval={INTERVAL_MIN}m, watchlist={WATCHLIST_FILE}")
    while True:
        t0 = time.time()
        try:
            await tick()
        except Exception as e:
            print("tick error:", e)
        elapsed = time.time() - t0
        sleep = max(60.0, INTERVAL_MIN * 60 - elapsed)
        print(f"sleeping {sleep:.0f}s")
        await asyncio.sleep(sleep)


if __name__ == "__main__":
    asyncio.run(main())
