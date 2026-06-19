"""AKShare HTTP 网关

启动:
    uvicorn server:app --host 127.0.0.1 --port 8788

接口:
    GET /api/news?code=<symbol>&name=<name>&limit=<n>
        统一返回 { items: NewsItem[] }
"""
from __future__ import annotations

import os
import re
import time
import logging
from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("akshare-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# 延迟导入 akshare：让 server 即使没装 akshare 也能启动空运行
try:
    import akshare as ak  # type: ignore
    _AK_AVAILABLE = True
except Exception as e:  # noqa: BLE001
    _AK_AVAILABLE = False
    logger.error("akshare not available: %s", e)


app = FastAPI(title="QuantTrade AKShare News Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_code(code: str) -> tuple[str, str]:
    """把内部 symbol 拆成 (market, raw_code)
    sh600519 -> ('A', '600519')
    hk09626  -> ('HK', '09626')
    us.AAPL  -> ('US', 'AAPL')
    """
    code = (code or "").strip().lower()
    if code.startswith("sh") or code.startswith("sz") or code.startswith("bj"):
        return "A", code[2:]
    if code.startswith("hk"):
        return "HK", code[2:].lstrip("0").rjust(5, "0") if code[2:] else ""
    if code.startswith("us."):
        return "US", code[3:].upper()
    if re.fullmatch(r"\d{6}", code):
        return "A", code
    if re.fullmatch(r"\d{1,5}", code):
        return "HK", code.rjust(5, "0")
    return "?", code


def _fmt_ts(ts) -> tuple[str, int]:
    """归一化时间字符串 → (HH:mm 显示, ms epoch)"""
    if ts is None:
        return "", 0
    try:
        s = str(ts)
        if re.fullmatch(r"\d{13}", s):
            n = int(s); return time.strftime("%Y-%m-%d %H:%M", time.localtime(n / 1000)), n
        if re.fullmatch(r"\d{10}", s):
            n = int(s); return time.strftime("%Y-%m-%d %H:%M", time.localtime(n)), n * 1000
        # 文本时间：交给 dateutil 解析？不引入额外依赖，自己做几个常见格式
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y-%m-%d"):
            try:
                t = time.strptime(s, fmt)
                ms = int(time.mktime(t)) * 1000
                return time.strftime("%Y-%m-%d %H:%M", t), ms
            except ValueError:
                continue
    except Exception:
        pass
    return str(ts), 0


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "akshare_available": _AK_AVAILABLE,
        "akshare_version": getattr(ak, "__version__", None) if _AK_AVAILABLE else None,
        "ts": int(time.time() * 1000),
    }


@app.get("/api/news")
def get_news(
    code: str = Query(...),
    name: Optional[str] = Query(""),
    limit: int = Query(40, ge=1, le=200),
):
    if not _AK_AVAILABLE:
        return {"items": [], "error": "akshare not installed"}

    market, raw = _parse_code(code)
    items: list[dict] = []

    # ----- AKShare stock_news_em：A 股 / 港股都支持，参数为纯代码 -----
    try:
        if market in ("A", "HK") and raw:
            df = ak.stock_news_em(symbol=raw)  # type: ignore[attr-defined]
            for _, row in df.head(limit).iterrows():
                title = str(row.get("新闻标题") or row.get("标题") or "").strip()
                if not title:
                    continue
                content = str(row.get("新闻内容") or row.get("内容") or "")
                url = str(row.get("新闻链接") or row.get("链接") or "")
                t_str, t_ms = _fmt_ts(row.get("发布时间") or row.get("时间"))
                src = str(row.get("文章来源") or row.get("来源") or "")
                items.append({
                    "id": f"ak:em:{url or title}",
                    "source": "akshare",
                    "type": "news",
                    "title": title,
                    "summary": content[:200] if content and content != title else None,
                    "url": url,
                    "time": t_str,
                    "ts": t_ms,
                    "author": src or None,
                })
    except Exception as e:  # noqa: BLE001
        logger.warning("stock_news_em failed for %s: %s", code, e)

    # 简单去重 + 时间倒序
    seen = set()
    dedup: list[dict] = []
    for it in items:
        key = it.get("url") or it.get("id")
        if key in seen:
            continue
        seen.add(key)
        dedup.append(it)
    dedup.sort(key=lambda x: x.get("ts") or 0, reverse=True)

    return {"items": dedup[:limit]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8788")))
