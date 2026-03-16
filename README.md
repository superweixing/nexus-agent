# Nexus Agent

<div align="center">

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/nexus-agent)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellowgreen)](LICENSE)

</div>

## 项目介绍

Nexus Agent 是 OpenClaw 生态系统的核心管理模块，被誉为"**系统总控中枢**"。它负责自动化管理 OpenClaw 的整个生命周期，提供健康监控、Codex 集成以及系统自我进化能力。

### 什么是 Nexus Agent？

Nexus Agent 是一个智能化的 AI Agent 管理系统，它：

- 🔄 **自动化管理** - 自动启动、停止、重启 OpenClaw 服务
- 🏥 **健康监控** - 实时监控系统状态，异常自动恢复
- 🤖 **Codex 集成** - 无缝集成 Anthropic Codex，提供代码修改能力
- 🧬 **自我进化** - 自动获取和处理 GitHub Issues，实现系统自我优化
- 📊 **可视化面板** - 提供 Web 状态监控面板
- 📝 **通知系统** - 关键事件实时通知（飞书等）

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nexus Agent                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │   Dashboard  │  │ Notification │  │    Evolution Loop    │ │
│  │  (Web 面板)   │  │   Manager    │  │     (进化循环)        │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Core Manager                             ││
│  │  ┌─────────────────┐    ┌─────────────────────────────┐   ││
│  │  │ OpenClaw Manager │    │      Codex Manager         │   ││
│  │  │ • 生命周期管理    │    │ • 安装/卸载                 │   ││
│  │  │ • 健康检查       │    │ • 任务执行                  │   ││
│  │  │ • 自动重启       │    │ • 状态监控                  │   ││
│  │  └─────────────────┘    └─────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │   GitHub     │  │    LLM       │  │     Config           │ │
│  │   Issues    │  │  (MiniMax)   │  │     (YAML)           │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │   Agents   │ │   Memory   │ │    LLM     │ │   Skills    │ │
│  └────────────┘ └────────────┘ └────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

| 组件 | 说明 |
|------|------|
| **OpenClaw Manager** | 管理 OpenClaw 进程的生命周期、健康检查、自动重启 |
| **Codex Manager** | 集成 Anthropic Codex，提供代码修改和任务执行能力 |
| **Evolution Loop** | 自动获取 GitHub Issues，评估并执行系统优化 |
| **Notification Manager** | 发送启动、错误、进化等关键事件通知 |
| **Dashboard** | Web 可视化面板，实时展示系统状态 |

---

## 核心功能

### 1. OpenClaw 生命周期管理
- ✅ 自动启动/停止/重启 OpenClaw
- ✅ 进程状态监控
- ✅ 异常自动恢复
- ✅ 启动顺序控制

### 2. 健康检查系统
- ✅ 定期健康检查（默认 30 秒）
- ✅ 自动重启失败服务
- ✅ 状态持久化存储

### 3. Codex 集成
- ✅ 自动安装 Codex
- ✅ 任务执行能力
- ✅ 代码修改能力
- ✅ 状态监控

### 4. 进化循环 (Evolution Loop)
- ✅ 自动获取 GitHub Issues
- ✅ 智能评估 Issues（重要性、难度）
- ✅ 自动执行优化任务
- ✅ 排除不相关标签

### 5. 通知系统
- ✅ 飞书 Webhook 通知
- ✅ 支持多种通知类型
- ✅ 可配置通知事件

### 6. 多环境支持
- ✅ default（默认）
- ✅ development（开发）
- ✅ production（生产）

### 7. Docker 支持
- ✅ Dockerfile 构建
- ✅ Docker Compose 编排
- ✅ 健康检查集成

### 8. Web 状态面板
- ✅ 实时状态展示
- ✅ 进化历史记录
- ✅ 健康检查状态

---

## 快速开始

### 前置要求

| 要求 | 最低版本 |
|------|----------|
| Node.js | >= 18.0.0 |
| npm | >= 8.0.0 |
| Git | 已安装 |

### 安装步骤

#### 1. 克隆项目

```bash
cd ~/.openclaw/workspace
# 如果目录不存在，先创建
mkdir -p ~/.openclaw/workspace
cd ~/.openclaw/workspace

# 克隆或确认 nexus-agent 目录存在
ls -la nexus-agent/
```

#### 2. 安装依赖

```bash
cd nexus-agent
npm install
```

#### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入实际配置
nano .env
```

#### 4. 启动服务

```bash
# 开发模式启动
npm start

# 或使用脚本管理
./scripts/start.sh
```

#### 5. 验证运行

```bash
# 查看状态
npm run status

# 查看日志
tail -f logs/nexus-agent.log
```

### Docker 部署（可选）

```bash
# 使用 Docker Compose 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

---

## 配置说明

### 配置文件位置

```
configs/
├── default.yaml      # 默认配置（所有环境通用）
├── development.yaml  # 开发环境配置
└── production.yaml   # 生产环境配置
```

### 环境变量

在 `.env` 文件中配置：

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `NEXUS_ENV` | 运行环境 | 否 | `default` |
| `NODE_ENV` | Node 环境 | 否 | `production` |
| `FEISHU_WEBHOOK_URL` | 飞书 Webhook 地址 | 否 | - |
| `GITHUB_TOKEN` | GitHub Personal Access Token | 否 | - |
| `MINIMAX_API_KEY` | MiniMax API Key | 否 | - |
| `LOG_LEVEL` | 日志级别 | 否 | `info` |
| `NOTIFICATION_ENABLED` | 是否启用通知 | 否 | `true` |

### 配置文件详解

#### default.yaml

```yaml
# OpenClaw 相关配置
openclaw:
  path: "/home/weixing/.openclaw/workspace/nexus-agent/openclaw"
  autoInstall: true
  healthCheckInterval: 30000  # 健康检查间隔（毫秒）
  autoRestart: true

# Codex 相关配置
codex:
  openclawPath: "/home/weixing/.openclaw/workspace/nexus-agent/openclaw"
  autoInstall: true
  version: "latest"

# 进化循环配置
evolution:
  fetchInterval: 3600000     # 获取 Issue 间隔（毫秒）
  maxConcurrent: 1          # 最大并发数
  minImportance: 0.5         # 最小重要性（0-1）
  maxDifficulty: 0.7         # 最大难度（0-1）
  autoExecute: false        # 是否自动执行（谨慎！）
  excludeLabels:
    - "wontfix"
    - "duplicate"
    - "invalid"
    - "low-priority"

# 通知配置
notification:
  enabled: true
  types:
    - "startup"
    - "shutdown"
    - "error"
    - "evolution"

# 日志配置
logging:
  level: "info"       # debug, info, warn, error
  dir: "./logs"
  maxSize: 10         # MB
  maxDays: 7
```

---

## 命令列表

### 基础命令

| 命令 | 说明 |
|------|------|
| `npm start` | 启动 Nexus Agent |
| `npm run stop` | 停止 Nexus Agent |
| `npm run restart` | 重启 Nexus Agent |
| `npm run status` | 查看运行状态 |

### Codex 命令

| 命令 | 说明 |
|------|------|
| `npm run codex:status` | 查看 Codex 状态 |
| `npm run codex:modify` | 修改代码 |
| `npm run codex:task` | 执行 Codex 任务 |

### 进化循环命令

| 命令 | 说明 |
|------|------|
| `npm run evolution:status` | 查看进化状态 |
| `npm run evolution:trigger` | 手动触发进化 |
| `npm run evolution:history` | 查看进化历史 |

### 测试命令

| 命令 | 说明 |
|------|------|
| `npm test` | 运行示例测试 |
| `npm run test:run` | 运行完整验证测试 |
| `npm run self-test` | 快速自检 |

### 脚本命令

```bash
# 使用 Shell 脚本管理
./scripts/start.sh    # 启动
./scripts/stop.sh     # 停止
./scripts/status.sh   # 查看状态
```

---

## 测试方法

### 自检测试

运行内置的自我验证测试：

```bash
# 快速自检
npm run self-test

# 完整验证
npm run test:run

# 查看详细输出
ts-node -e "import { SelfTester } from './src/test/self_tester'; new SelfTester().runFullValidation().then(r => console.log(JSON.stringify(r, null, 2)))"
```

### 验证项目

测试会验证以下内容：

- ✅ Node.js 版本 >= 18.0.0
- ✅ 依赖包安装完整
- ✅ 配置文件存在且有效
- ✅ OpenClaw 目录可访问
- ✅ 日志目录可写
- ✅ 环境变量配置正确
- ✅ 网络连接正常

### 日志调试

```bash
# 实时查看日志
tail -f logs/nexus-agent.log

# 查看错误日志
grep -i error logs/nexus-agent.log

# 查看最近 100 行
tail -n 100 logs/nexus-agent.log
```

---

## 目录结构

```
nexus-agent/
├── agents/                    # Agent 目录（预留）
├── codex/                    # Codex 集成模块
│   ├── index.ts
│   └── codex_manager.ts
├── configs/                  # 配置文件
│   ├── default.yaml         # 默认配置
│   ├── development.yaml     # 开发环境
│   └── production.yaml      # 生产环境
├── openclaw/                # OpenClaw 子模块
├── scripts/                 # 管理脚本
│   ├── start.sh
│   ├── stop.sh
│   └── status.sh
├── src/                     # 源代码
│   ├── main.ts              # 主入口
│   ├── openclaw_manager.ts  # OpenClaw 管理器
│   ├── evolution/           # 进化循环模块
│   │   ├── index.ts
│   │   ├── evolution_loop.ts
│   │   ├── evaluator.ts
│   │   └── github_fetcher.ts
│   ├── github/              # GitHub 集成
│   ├── notification/        # 通知模块
│   │   ├── index.ts
│   │   └── notification_manager.ts
│   ├── test/                # 测试模块
│   │   ├── index.ts
│   │   ├── example.ts
│   │   └── self_tester.ts
│   └── web/                 # Web 面板
│       ├── dashboard.ts
│       └── status.ts
├── logs/                    # 日志目录
├── dist/                    # 编译输出
├── .env.example             # 环境变量模板
├── Dockerfile               # Docker 配置
├── docker-compose.yml       # Docker Compose
├── package.json             # 项目配置
├── tsconfig.json           # TypeScript 配置
└── README.md               # 本文档
```

---

## 贡献指南

欢迎为 Nexus Agent 贡献代码！

### 提交问题

1. 搜索现有 Issues，确认没有重复
2. 创建新 Issue，包含：
   - 清晰的标题
   - 详细的描述
   - 复现步骤
   - 环境信息

### 提交代码

1. Fork 项目
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 进行开发并测试
4. 提交更改：`git commit -m 'Add feature'`
5. 推送分支：`git push origin feature/your-feature`
6. 创建 Pull Request

### 开发规范

- 使用 TypeScript
- 遵循现有代码风格
- 添加适当的注释
- 确保通过测试

### 代码审查

- 保持 PR 简洁
- 描述变更内容
- 关联相关 Issue

---

## 故障排除

### 常见问题

#### 1. Codex 安装失败

```bash
# 检查网络
curl -I https://www.npmjs.com

# 手动安装
npx @anthropic-ai/codex install
```

#### 2. OpenClaw 启动失败

```bash
# 检查端口占用
lsof -i:3000

# 查看详细日志
tail -f logs/nexus-agent.log
```

#### 3. 权限问题

```bash
# 赋予脚本执行权限
chmod +x scripts/*.sh
```

#### 4. 健康检查失败

```bash
# 手动检查 OpenClaw
cd openclaw
npm start

# 检查进程
ps aux | grep openclaw
```

---

## systemd 服务（生产环境）

创建服务文件：

```bash
sudo nano /etc/systemd/system/nexus-agent.service
```

内容：

```ini
[Unit]
Description=Nexus Agent
After=network.target

[Service]
Type=simple
User=weixing
WorkingDirectory=/home/weixing/.openclaw/workspace/nexus-agent
Environment=NODE_ENV=production
Environment=NEXUS_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable nexus-agent
sudo systemctl start nexus-agent
sudo systemctl status nexus-agent
```

---

## 更新日志

### v1.0.0 (2024-03-16)

- ✨ 初始版本
- 🔄 OpenClaw 生命周期管理
- 🏥 健康检查系统
- 🤖 Codex 集成
- 🧬 进化循环
- 📝 飞书通知
- 🐳 Docker 支持

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 相关链接

- [OpenClaw 官网](https://github.com/openclaw)
- [Anthropic Codex](https://www.anthropic.com/codex)
- [MiniMax API](https://platform.minimaxi.com/)
- [飞书开放平台](https://open.feishu.cn/)

---

<div align="center">

**Nexus Agent** - OpenClaw 的核心管理模块 🧠

</div>
