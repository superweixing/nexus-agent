# Nexus Agent 多阶段构建 Docker 镜像
# 阶段 1: 构建
FROM node:18-bullseye-slim AS builder

WORKDIR /build

# 安装构建依赖
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 复制源码并构建
COPY tsconfig.json ./
COPY src ./src
COPY configs ./configs

# 阶段 2: 运行
FROM node:18-bullseye-slim

# 设置环境变量
ENV NODE_ENV=production \
    NEXUS_ENV=production \
    NODE_OPTIONS="--max-old-space-size=4096"

# 创建非 root 用户
RUN groupadd -r nexus && useradd -r -g nexus nexus

# 设置工作目录
WORKDIR /app

# 从构建阶段复制已编译的文件
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/src ./src
COPY --from=builder /build/configs ./configs

# 创建日志目录并设置权限
RUN mkdir -p /app/logs && chown -R nexus:nexus /app

# 暴露端口
EXPOSE 3000

# 复制启动脚本
COPY scripts/start.sh /usr/local/bin/nexus-start
COPY scripts/stop.sh /usr/local/bin/nexus-stop
RUN chmod +x /usr/local/bin/nexus-*

# 切换到非 root 用户
USER nexus

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 默认启动命令
CMD ["npm", "start"]
