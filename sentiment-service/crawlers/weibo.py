"""微博爬虫适配（骨架）。"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from . import CrawlResult


class WeiboCrawler:
    name = "weibo"

    def __init__(self, mediacrawler_dir: str):
        self.mc_dir = Path(mediacrawler_dir).resolve()
        self._available = (self.mc_dir / "main.py").exists()

    async def search(self, keywords: list[str], limit: int) -> CrawlResult:
        if not self._available:
            return CrawlResult(items=[], error=f"MediaCrawler 未安装到 {self.mc_dir}")
        kw = keywords[0] if keywords else ""
        if not kw:
            return CrawlResult(items=[], error="empty keyword")

        cmd = [
            "python", "main.py",
            "--platform", "wb",
            "--lt", "qrcode",
            "--type", "search",
            "--keywords", kw,
            "--save_data_option", "json",
            "--get_comment", "no",
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=str(self.mc_dir),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
            if proc.returncode != 0:
                return CrawlResult(items=[], error=stderr.decode("utf-8", errors="ignore")[:500])
        except asyncio.TimeoutError:
            return CrawlResult(items=[], error="weibo crawl timeout")
        except Exception as e:
            return CrawlResult(items=[], error=str(e))

        items: list[dict] = []
        for jf in (self.mc_dir / "data" / "weibo" / "json").glob("**/*contents*.json"):
            try:
                rows = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            for r in rows[:limit]:
                mid = r.get("mblogid") or r.get("id") or r.get("mid")
                if not mid:
                    continue
                items.append({
                    "id": f"wb:{mid}",
                    "platform": "weibo",
                    "type": "post",
                    "title": (r.get("content") or r.get("text_raw") or "")[:80],
                    "content": r.get("content") or r.get("text_raw"),
                    "author": (r.get("user") or {}).get("screen_name") if isinstance(r.get("user"), dict) else r.get("user_name"),
                    "url": r.get("url") or f"https://m.weibo.cn/detail/{mid}",
                    "ts": int(r.get("created_at_ts") or time.time() * 1000),
                    "likes": r.get("attitudes_count") or r.get("liked_count"),
                    "comments": r.get("comments_count"),
                    "views": r.get("reposts_count"),
                    "raw": r,
                })
        return CrawlResult(items=items[:limit])
