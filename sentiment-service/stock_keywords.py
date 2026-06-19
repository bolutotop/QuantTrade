"""股票代码 ↔ 关键词映射。

抓社媒时关键词比代码更有效（用户不会发『600519』），
所以我们用『股票名 + 别名 + 代码』组合搜索。
"""
from __future__ import annotations

import json
import os
from typing import Iterable

# 简单别名词库；可手工扩展
ALIAS: dict[str, list[str]] = {
    "600519": ["贵州茅台", "茅台"],
    "000858": ["五粮液"],
    "300750": ["宁德时代", "宁王"],
    "000001": ["平安银行"],
    "600036": ["招商银行", "招行"],
    "601318": ["中国平安"],
}


def keywords_for(code: str, name: str | None = None) -> list[str]:
    code = (code or "").strip()
    name = (name or "").strip()
    out: list[str] = []
    if name:
        out.append(name)
    out.extend(ALIAS.get(code, []))
    if code and code not in out:
        out.append(code)
    # 去重保序
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def load_watchlist(path: str) -> list[dict]:
    """读取 watchlist 配置。

    格式（数组），由前端导出或手动维护：
      [
        {"code": "600519", "name": "贵州茅台"},
        {"code": "300750", "name": "宁德时代"}
      ]
    """
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [d for d in data if isinstance(d, dict) and d.get("code")]
    except Exception:
        return []
