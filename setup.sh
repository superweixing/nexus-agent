#!/bin/bash

# ============================================
# Nexus Agent 配置引导脚本
# 用于设置飞书、GitHub、MiniMax 等配置
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Nexus Agent 配置引导脚本${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# 检查是否已存在 .env 文件
if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}检测到已存在 .env 配置文件${NC}"
    read -p "是否要重新配置? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "取消配置"
        exit 0
    fi
fi

echo -e "${GREEN}开始配置...${NC}"
echo ""

# ============================================
# 1. 飞书 Webhook 配置
# ============================================
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo -e "${BLUE}步骤 1: 飞书 Webhook 配置${NC}"
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo ""
echo -e "请提供飞书机器人 Webhook URL"
echo -e "获取方式: ${YELLOW}飞书开放平台 → 应用 → 你的应用 → 机器人 → 添加机器人 → 获取 Webhook 地址${NC}"
echo ""
read -p "请输入飞书 Webhook URL (直接回车跳过): " FEISHU_WEBHOOK_URL

if [ -z "$FEISHU_WEBHOOK_URL" ]; then
    echo -e "${YELLOW}⚠ 跳过飞书配置${NC}"
    FEISHU_WEBHOOK_URL=""
else
    echo -e "${GREEN}✓ 飞书 Webhook 已配置${NC}"
fi

echo ""

# ============================================
# 2. GitHub Token 配置
# ============================================
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo -e "${BLUE}步骤 2: GitHub Token 配置${NC}"
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo ""
echo -e "请提供 GitHub Personal Access Token"
echo -e "获取方式: ${YELLOW}GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token${NC}"
echo -e "权限要求: ${GREEN}repo (完整仓库访问)${NC}"
echo ""
read -p "请输入 GitHub Token (直接回车跳过): " GITHUB_TOKEN

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}⚠ 跳过 GitHub Token 配置${NC}"
    GITHUB_TOKEN=""
else
    echo -e "${GREEN}✓ GitHub Token 已配置${NC}"
fi

echo ""

# ============================================
# 3. MiniMax API 配置
# ============================================
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo -e "${BLUE}步骤 3: MiniMax API 配置${NC}"
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo ""
echo -e "请提供 MiniMax API Key"
echo -e "获取方式: ${YELLOW}https://platform.minimaxi.com/${NC}"
echo ""
read -p "请输入 MiniMax API Key (直接回车跳过): " MINIMAX_API_KEY

if [ -z "$MINIMAX_API_KEY" ]; then
    echo -e "${YELLOW}⚠ 跳过 MiniMax API 配置${NC}"
    MINIMAX_API_KEY=""
else
    echo -e "${GREEN}✓ MiniMax API Key 已配置${NC}"
fi

echo ""

# ============================================
# 4. 写入配置文件
# ============================================
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo -e "${BLUE}步骤 4: 保存配置${NC}"
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo ""

# 创建 .env 文件
cat > "$ENV_FILE" << EOF
# Nexus Agent 环境变量配置
# 由 setup.sh 自动生成

# ============================================
# 飞书通知配置
# ============================================
FEISHU_WEBHOOK_URL="${FEISHU_WEBHOOK_URL}"

# ============================================
# GitHub 配置
# ============================================
GITHUB_TOKEN="${GITHUB_TOKEN}"

# ============================================
# MiniMax API 配置
# ============================================
MINIMAX_API_KEY="${MINIMAX_API_KEY}"

# ============================================
# 可选配置
# ============================================
LOG_LEVEL="info"
NOTIFICATION_ENABLED="true"
EOF

echo -e "${GREEN}✓ 配置文件已保存到: $ENV_FILE${NC}"
echo ""

# ============================================
# 5. 测试配置
# ============================================
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo -e "${BLUE}步骤 5: 配置完成${NC}"
echo -e "${BLUE}─────────────────────────────────────────${NC}"
echo ""
echo -e "${GREEN}配置完成！${NC}"
echo ""
echo "配置文件位置: $ENV_FILE"
echo ""
echo "要使配置生效，请运行:"
echo "  ${YELLOW}source $ENV_FILE${NC}"
echo ""
echo "或者在启动时自动加载:"
echo "  ${YELLOW}source $ENV_FILE && npm start${NC}"
echo ""

# 提供导出命令供用户复制
echo -e "${BLUE}快速导出命令:${NC}"
echo "-----------------------------------"
echo "export FEISHU_WEBHOOK_URL=\"$FEISHU_WEBHOOK_URL\""
echo "export GITHUB_TOKEN=\"$GITHUB_TOKEN\""
echo "export MINIMAX_API_KEY=\"$MINIMAX_API_KEY\""
echo "-----------------------------------"
echo ""

exit 0
