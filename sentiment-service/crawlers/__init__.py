"""爬虫适配层基类。

所有平台抓取器统一返回 list[dict]，字段对齐前端 SocialPost：

    {
      "id":         "bili:BV1xxx" | "xhs:abc" | "wb:123",
      "platform":   "bilibili" | "xhs" | "weibo",
      "type":       "video" | "note" | "post",
      "title":      str,
      "content":    str,
      "author":     str,
      "url":        str,
      "ts":         int (ms),
      "likes":      int,
      "comments":   int,
      "views":      int,
      "raw":        any (原始数据，调试用)
    }

具体抓取实现委托给 vendor/MediaCrawler，
我们只做：
   1. 调 MediaCrawler 的搜索命令 / Python API
   2. 把结果归一化
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class CrawlResult:
    items: list[dict]
    error: str | None = None


class Crawler(Protocol):
    name: str

    async def search(self, keywords: list[str], limit: int) -> CrawlResult: ...
