"""小红书爬虫适配（骨架）。

实现方式同 bilibili.py：调 MediaCrawler CLI → 读 JSON 输出 → 归一化。
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from . import CrawlResult


class XhsCrawler:
    name = "xhs"

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
            "--platform", "xhs",
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
            return CrawlResult(items=[], error="xhs crawl timeout")
        except Exception as e:
            return CrawlResult(items=[], error=str(e))

        items: list[dict] = []
        for jf in (self.mc_dir / "data" / "xhs" / "json").glob("**/*contents*.json"):
            try:
                rows = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            for r in rows[:limit]:
                nid = r.get("note_id") or r.get("id")
                if not nid:
                    continue
                items.append({
                    "id": f"xhs:{nid}",
                    "platform": "xhs",
                    "type": "note",
                    "title": r.get("title") or r.get("desc") or "",
                    "content": r.get("desc"),
                    "author": r.get("nickname") or (r.get("user") or {}).get("nickname"),
                    "url": r.get("note_url") or f"https://www.xiaohongshu.com/explore/{nid}",
                    "ts": int(r.get("time") or r.get("last_update_time") or time.time() * 1000),
                    "likes": r.get("liked_count") or r.get("likes"),
                    "comments": r.get("comment_count") or r.get("comments"),
                    "raw": r,
                })
        return CrawlResult(items=items[:limit])
