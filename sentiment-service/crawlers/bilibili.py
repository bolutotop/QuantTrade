"""B站爬虫适配。

骨架版：直接调用 MediaCrawler 的 CLI，结果落入 MediaCrawler 自己的存储，
然后我们再读出来归一化。

> ⚠ 这是骨架。完整实现需要：
> 1. 在 vendor/MediaCrawler 已 git clone 并安装依赖
> 2. 已用 qrcode 登录过一次（cookie 持久化）
>
> TODO:
> - 改为直接调用 MediaCrawler 的 Python API（更高效，无需子进程）
> - 走 MediaCrawler 的 store/json 输出再读取
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path

from . import CrawlResult


class BilibiliCrawler:
    name = "bilibili"

    def __init__(self, mediacrawler_dir: str):
        self.mc_dir = Path(mediacrawler_dir).resolve()
        if not (self.mc_dir / "main.py").exists():
            # 不抛异常，而是在 search 时返回 error，这样 server 启动不挂
            self._available = False
        else:
            self._available = True

    async def search(self, keywords: list[str], limit: int) -> CrawlResult:
        if not self._available:
            return CrawlResult(items=[], error=f"MediaCrawler 未安装到 {self.mc_dir}")

        kw = keywords[0] if keywords else ""
        if not kw:
            return CrawlResult(items=[], error="empty keyword")

        # 生成本次输出目录（让 MediaCrawler 把结果写到 json 文件）
        run_id = uuid.uuid4().hex[:8]
        out_dir = self.mc_dir / "data" / "bilibili" / "json" / run_id
        out_dir.mkdir(parents=True, exist_ok=True)

        # 调 MediaCrawler CLI（具体参数随上游版本会变，使用前请对照其 README）
        cmd = [
            "python",
            "main.py",
            "--platform", "bili",
            "--lt", "qrcode",          # 已登录过会复用 cookie
            "--type", "search",
            "--keywords", kw,
            "--save_data_option", "json",
            "--get_comment", "no",     # 评论按需开启，默认关
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=str(self.mc_dir),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
            if proc.returncode != 0:
                return CrawlResult(items=[], error=stderr.decode("utf-8", errors="ignore")[:500])
        except asyncio.TimeoutError:
            return CrawlResult(items=[], error="bilibili crawl timeout")
        except Exception as e:
            return CrawlResult(items=[], error=str(e))

        # 解析 MediaCrawler 输出（约定：bilibili/json/*_contents_*.json）
        items: list[dict] = []
        for jf in (self.mc_dir / "data" / "bilibili" / "json").glob("**/*contents*.json"):
            try:
                rows = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            for r in rows[:limit]:
                bvid = r.get("bvid") or r.get("aid") or r.get("video_id")
                if not bvid:
                    continue
                items.append({
                    "id": f"bili:{bvid}",
                    "platform": "bilibili",
                    "type": "video",
                    "title": r.get("title") or "",
                    "content": r.get("desc") or r.get("description"),
                    "author": (r.get("owner") or {}).get("name") if isinstance(r.get("owner"), dict) else r.get("user_name"),
                    "url": f"https://www.bilibili.com/video/{bvid}",
                    "ts": int((r.get("pubdate") or r.get("create_time") or 0)) * (1000 if (r.get("pubdate") and len(str(r.get("pubdate"))) == 10) else 1) or int(time.time() * 1000),
                    "likes": (r.get("stat") or {}).get("like") if isinstance(r.get("stat"), dict) else r.get("liked_count"),
                    "comments": (r.get("stat") or {}).get("reply") if isinstance(r.get("stat"), dict) else r.get("comment_count"),
                    "views": (r.get("stat") or {}).get("view") if isinstance(r.get("stat"), dict) else r.get("view_count"),
                    "raw": r,
                })
        # 限制数量
        items = items[:limit]
        return CrawlResult(items=items)
