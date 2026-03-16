#!/bin/bash
# Nexus Agent 启动脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 默认配置
ENV="${NEXUS_ENV:-default}"
CONFIG_FILE="$PROJECT_DIR/configs/${ENV}.yaml"

# 检查配置文件是否存在
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}错误: 配置文件 $CONFIG_FILE 不存在${NC}"
    exit 1
fi

# 检查是否是 systemd 系统
if [ -d /run/systemd/system ]; then
    # 检查服务是否已存在
    if [ -f /etc/systemd/system/nexus-agent.service ]; then
        echo "使用 systemd 启动 Nexus Agent..."
        sudo systemctl start nexus-agent
        exit $?
    fi
fi

# 检查端口占用
check_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        if lsof -i:$port &> /dev/null; then
            return 1
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tuln | grep -q ":$port "; then
            return 1
        fi
    fi
    return 0
}

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: Node.js 未安装${NC}"
    exit 1
fi

# 检查依赖
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo -e "${YELLOW}警告: node_modules 不存在，正在安装依赖...${NC}"
    cd "$PROJECT_DIR"
    npm install
fi

# 检查 ts-node
if ! command -v npx &> /dev/null; then
    echo -e "${RED}错误: npx 未安装${NC}"
    exit 1
fi

echo -e "${GREEN}正在启动 Nexus Agent (环境: $ENV)...${NC}"
echo "配置文件: $CONFIG_FILE"

# 启动应用
cd "$PROJECT_DIR"
export NEXUS_ENV=$ENV

# 使用 nohup 启动，保持后台运行
nohup npm start > "$PROJECT_DIR/logs/nexus-agent.log" 2>&1 &
PID=$!

echo "Nexus Agent 进程 PID: $PID"

# 等待几秒检查是否启动成功
sleep 3

# 检查进程是否还在运行
if ps -p $PID > /dev/null 2>&1; then
    echo $PID > "$PROJECT_DIR/.nexus-agent.pid"
    echo -e "${GREEN}Nexus Agent 启动成功!${NC}"
    echo "日志文件: $PROJECT_DIR/logs/nexus-agent.log"
    
    # 显示状态
    if command -v npm &> /dev/null; then
        npm run status 2>/dev/null || true
    fi
else
    echo -e "${RED}Nexus Agent 启动失败，请检查日志: $PROJECT_DIR/logs/nexus-agent.log${NC}"
    exit 1
fi
