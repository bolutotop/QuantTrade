"""情感分析。

默认使用 SnowNLP（无网、轻量、对中文短文本够用）。
也可以切换 LLM（OpenAI 兼容协议）。
"""
from __future__ import annotations

import os
from typing import Optional

BACKEND = os.environ.get("SENTIMENT_BACKEND", "snownlp").lower()


def _snownlp_score(text: str) -> Optional[float]:
    if not text or not text.strip():
        return None
    try:
        from snownlp import SnowNLP  # type: ignore
        return float(SnowNLP(text).sentiments)  # 0~1，1 越正面
    except Exception:
        return None


def analyze(text: str) -> tuple[Optional[int], Optional[float]]:
    """返回 (sentiment_label: -1|0|1, score: -1.0~1.0)"""
    if BACKEND == "snownlp":
        s = _snownlp_score(text)
        if s is None:
            return None, None
        # 0.4 / 0.6 阈值，中间归零
        if s >= 0.6:
            return 1, (s - 0.5) * 2
        if s <= 0.4:
            return -1, (s - 0.5) * 2
        return 0, (s - 0.5) * 2

    # LLM 后端：留接口，避免引入额外依赖
    return None, None
