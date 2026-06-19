#!/usr/bin/env bash
# =============================================================================
# 部署完成通知脚本（占位）
#
# webhook.js 会以 3 个参数调用本脚本：
#   $1 = success | fail
#   $2 = commit_sha (12 位)
#   $3 = 一句话信息
#
# 接通知时把对应分支的 curl 取消注释 + 填上 webhook URL / token 即可。
# 当前默认什么都不做（保留接口）。
# =============================================================================

STATUS="${1:-unknown}"
SHA="${2:-unknown}"
MSG="${3:-}"

REPO_NAME="QuantTrade"
EMOJI_OK="✅"
EMOJI_FAIL="❌"
EMOJI=$([ "$STATUS" = "success" ] && echo "$EMOJI_OK" || echo "$EMOJI_FAIL")
TEXT="${EMOJI} ${REPO_NAME} 部署${STATUS} | sha=${SHA} | ${MSG}"

# ----------- 1) 企业微信群机器人（取消注释 + 填 KEY 启用） -----------
# WX_KEY="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# curl -s -X POST -H 'Content-Type: application/json' \
#   -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"$TEXT\"}}" \
#   "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=$WX_KEY" >/dev/null

# ----------- 2) Telegram bot（取消注释 + 填 BOT_TOKEN/CHAT_ID 启用） -----------
# BOT_TOKEN="xxx:yyy"
# CHAT_ID="-1001234567890"
# curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
#   --data-urlencode "chat_id=${CHAT_ID}" \
#   --data-urlencode "text=${TEXT}" >/dev/null

# ----------- 3) 钉钉群机器人（取消注释启用） -----------
# DD_TOKEN="xxxx"
# curl -s -X POST -H 'Content-Type: application/json' \
#   -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"$TEXT\"}}" \
#   "https://oapi.dingtalk.com/robot/send?access_token=$DD_TOKEN" >/dev/null

# ----------- 4) Server 酱 / Bark / 邮件 自行扩展 -----------

# 默认：写一行到日志文件，不发外部请求
echo "[notify $(date '+%Y-%m-%d %H:%M:%S')] $TEXT" >> .data/notify.log
exit 0
