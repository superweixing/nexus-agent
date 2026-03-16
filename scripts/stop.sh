#!/bin/bash
# Nexus Agent 停止脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.nexus-agent.pid"

# 检查是否是 systemd 系统
if [ -d /run/systemd/system ]; then
    if [ -f /etc/systemd/system/nexus-agent.service ]; then
        echo "使用 systemd 停止 Nexus Agent..."
        sudo systemctl stop nexus-agent
        exit $?
    fi
fi

echo -e "${YELLOW}正在停止 Nexus Agent...${NC}"

# 尝试从 PID 文件读取
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    
    # 检查进程是否存在
    if ps -p $PID > /dev/null 2>&1; then
        echo "正在终止进程 $PID..."
        kill $PID
        
        # 等待进程结束
        for i in {1..10}; do
            if ! ps -p $PID > /dev/null 2>&1; then
                echo -e "${GREEN}Nexus Agent 已停止${NC}"
                rm -f "$PID_FILE"
                exit 0
            fi
            sleep 1
        done
        
        # 如果进程还没结束，强制终止
        echo "进程仍未结束，强制终止..."
        kill -9 $PID 2>/dev/null
        rm -f "$PID_FILE"
        echo -e "${GREEN}Nexus Agent 已强制停止${NC}"
    else
        echo "PID 文件中的进程不存在，清理 PID 文件..."
        rm -f "$PID_FILE"
    fi
fi

# 尝试通过进程名查找并终止
PIDS=$(pgrep -f "nexus-agent" 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "找到 Nexus Agent 进程: $PIDS"
    for pid in $PIDS; do
        echo "终止进程 $pid..."
        kill $pid 2>/dev/null
    done
    sleep 2
    
    # 检查是否还有残留进程
    REMAINING=$(pgrep -f "nexus-agent" 2>/dev/null)
    if [ -n "$REMAINING" ]; then
        echo "仍有残留进程，强制终止..."
        pkill -9 -f "nexus-agent" 2>/dev/null
    fi
    
    echo -e "${GREEN}Nexus Agent 已停止${NC}"
else
    echo -e "${YELLOW}未找到运行中的 Nexus Agent${NC}"
fi

# 清理 PID 文件
rm -f "$PID_FILE"

# 停止相关的 OpenClaw 进程（可选）
echo "检查 OpenClaw 进程..."
if pgrep -f "openclaw" > /dev/null 2>&1; then
    read -p "是否停止 OpenClaw 进程? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pkill -f "openclaw" 2>/dev/null || true
        echo -e "${GREEN}OpenClaw 进程已停止${NC}"
    fi
fi

exit 0
