#!/bin/bash
# Nexus Agent 状态检查脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.nexus-agent.pid"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}      Nexus Agent 状态检查${NC}"
echo -e "${BLUE}========================================${NC}"
echo

# 检查是否是 systemd 系统
if [ -d /run/systemd/system ]; then
    if [ -f /etc/systemd/system/nexus-agent.service ]; then
        echo -e "${YELLOW}使用 systemd 管理...${NC}"
        sudo systemctl status nexus-agent --no-pager
        exit $?
    fi
fi

# 检查 Node.js
echo -e "${YELLOW}Node.js 版本:${NC}"
node --version
echo

# 检查 PID 文件
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    echo -e "${YELLOW}PID 文件:${NC} $PID"
    
    if ps -p $PID > /dev/null 2>&1; then
        echo -e "${GREEN}● Nexus Agent 状态: 运行中${NC}"
        echo "  PID: $PID"
        
        # 显示进程详细信息
        echo -e "\n${YELLOW}进程详情:${NC}"
        ps -p $PID -o pid,ppid,cmd,etime --no-headers
    else
        echo -e "${RED}● Nexus Agent 状态: 未运行 (PID 文件过期)${NC}"
    fi
else
    # 尝试查找进程
    PIDS=$(pgrep -f "nexus-agent" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo -e "${GREEN}● Nexus Agent 状态: 运行中${NC}"
        echo "  PIDs: $PIDS"
    else
        echo -e "${RED}● Nexus Agent 状态: 未运行${NC}"
    fi
fi

echo

# 检查 OpenClaw 状态
echo -e "${YELLOW}OpenClaw 状态:${NC}"
if pgrep -f "openclaw" > /dev/null 2>&1; then
    echo -e "${GREEN}  ● OpenClaw: 运行中${NC}"
    pgrep -f "openclaw" -a | head -3 | while read line; do
        echo "    $line"
    done
else
    echo -e "${RED}  ● OpenClaw: 未运行${NC}"
fi

echo

# 检查日志
LOG_FILE="$PROJECT_DIR/logs/nexus-agent.log"
if [ -f "$LOG_FILE" ]; then
    echo -e "${YELLOW}最近日志 (最后 10 行):${NC}"
    echo "----------------------------------------"
    tail -10 "$LOG_FILE" | while read line; do
        echo "  $line"
    done
    echo "----------------------------------------"
    
    # 检查日志大小
    LOG_SIZE=$(du -h "$LOG_FILE" | cut -f1)
    echo -e "${YELLOW}日志大小:${NC} $LOG_SIZE"
else
    echo -e "${YELLOW}日志文件:${NC} 不存在"
fi

echo

# 检查配置文件
ENV="${NEXUS_ENV:-default}"
CONFIG_FILE="$PROJECT_DIR/configs/${ENV}.yaml"
echo -e "${YELLOW}当前环境:${NC} $ENV"
echo -e "${YELLOW}配置文件:${NC} $CONFIG_FILE"

if [ -f "$CONFIG_FILE" ]; then
    echo -e "${GREEN}  配置文件存在${NC}"
else
    echo -e "${RED}  配置文件不存在${NC}"
fi

echo

# 尝试运行状态命令
echo -e "${YELLOW}运行 npm status...${NC}"
cd "$PROJECT_DIR"
npm run status 2>/dev/null

echo
echo -e "${BLUE}========================================${NC}"
