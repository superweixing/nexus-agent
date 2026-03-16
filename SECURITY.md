# Nexus Agent 安全增强功能

## 概述

Nexus Agent 现在包含完整的安全增强功能，包括安全边界、沙箱限制和操作日志。这些功能确保 Codex 在执行代码修改时的安全性。

## 功能特性

### 1. 安全边界

- **目录白名单**: 限制 Codex 只能修改特定目录下的文件
- **文件扩展名白名单**: 只允许修改特定类型的文件
- **禁止目录黑名单**: 明确禁止访问系统关键目录

**默认允许目录:**
- `/home/weixing/.openclaw/workspace/nexus-agent/openclaw`
- `/home/weixing/.openclaw/workspace/nexus-agent/src`

**默认禁止目录:**
- `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/root`, `/boot`, `/sys`, `/proc`, `/dev`

### 2. 沙箱限制

- **禁止删除系统文件**: 阻止删除系统关键文件
- **禁止修改敏感配置**: 阻止修改系统配置文件
- **禁止访问密钥文件**: 阻止访问 .env、.key、.pem 等密钥文件

**默认禁止访问的文件模式:**
- `*.env`, `*.env.*`, `.env*`
- `*.key`, `*.pem`, `*.cert`
- `*.password`, `*.secret`
- `credentials.json`, `*.credentials`
- `.git/config`, `.ssh/*`
- `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`

**危险命令检测:**
- `rm -rf`, `dd`, `mkfs`, `format`
- `chmod -R 777`, `chown -R`
- `wget | sh`, `curl | sh`
- Fork 炸弹等

### 3. 操作日志

- **完整操作记录**: 记录所有文件读取、写入、修改、删除操作
- **可追溯性**: 每个操作都有时间戳、操作类型、结果状态
- **快照功能**: 修改前自动创建文件快照，支持回滚
- **审计功能**: 支持查询特定文件或操作类型的历史记录

**日志存储位置:** `./logs/security/`

## 使用方法

### 基础使用

```typescript
import { getSecureCodexManager } from './codex';

// 创建安全版本的 Codex 管理器
const codexManager = getSecureCodexManager({
  openclawPath: '/home/weixing/.openclaw/workspace/nexus-agent/openclaw',
  enableSecurity: true  // 默认启用
});

// 执行代码修改（自动安全检查）
const result = await codexManager.modifyCode(
  'src/main.ts',
  '添加日志输出'
);

console.log(result);
```

### 查看操作历史

```typescript
// 获取所有操作历史
const history = await codexManager.getOperationHistory({
  limit: 100
});

// 获取特定文件的操作历史
const fileHistory = await codexManager.getOperationHistory({
  filePath: 'src/main.ts',
  operationType: 'file_modify'
});

// 获取操作统计
const stats = await codexManager.getOperationStatistics();
console.log('总操作数:', stats.total);
console.log('被阻止的操作:', stats.blocked);
```

### 快照与回滚

```typescript
// 获取可用的快照列表
const snapshots = await codexManager.listSnapshots('src/main.ts');
console.log('可用快照:', snapshots);

// 回滚到指定快照
await codexManager.rollbackToSnapshot('snapshot-id-here');
```

### 单独使用安全模块

```typescript
import { getSecurityManager } from './src/security';

// 获取安全管理器
const security = getSecurityManager();

// 检查文件访问权限
const result = security.validateFileAccess('/path/to/file.ts');

if (!result.valid) {
  console.log('访问被拒绝:', result.errors);
}

// 检查命令是否危险
const cmdCheck = security.checkDangerousCommand('rm -rf /');
if (!cmdCheck.allowed) {
  console.log('命令被阻止:', cmdCheck.reason);
}
```

## 配置文件

安全配置位于 `configs/security.yaml`:

```yaml
security:
  allowedDirectories:
    - "/home/weixing/.openclaw/workspace/nexus-agent/openclaw"
  forbiddenDirectories:
    - "/etc"
    - "/usr"
  allowedExtensions:
    - ".ts"
    - ".js"
    - ".json"
  forbiddenPatterns:
    - "*.env"
    - "*.key"
  enabled: true
  sandboxMode: true
  logOperations: true

sandbox:
  forbidDangerousCommands: true
  forbidDelete:
    enabled: true
    exceptions: []
  forbidSystemFiles: true

logging:
  dir: "./logs/security"
  auditEnabled: true
  rollbackEnabled: true
  maxRollbackVersions: 10
```

## API 参考

### SecureCodexManager

| 方法 | 描述 |
|------|------|
| `modifyCode(path, instruction)` | 安全修改单个文件 |
| `modifyMultipleFiles(files, instruction)` | 安全修改多个文件 |
| `executeTask(task)` | 执行 Codex 任务（带危险命令检测） |
| `executeComplexTask(task, context)` | 执行复杂任务 |
| `getOperationHistory(options)` | 获取操作历史 |
| `getOperationStatistics()` | 获取操作统计 |
| `listSnapshots(filePath?)` | 获取快照列表 |
| `rollbackToSnapshot(id)` | 回滚到指定快照 |
| `getSecurityConfig()` | 获取安全配置 |

### SecurityManager

| 方法 | 描述 |
|------|------|
| `validateFileAccess(path)` | 验证文件访问权限 |
| `checkDangerousCommand(cmd)` | 检查命令是否危险 |
| `checkDeleteOperation(path)` | 检查删除操作是否允许 |
| `logOperation(...)` | 记录操作日志 |
| `getOperationHistory(options)` | 查询操作历史 |
| `createSnapshot(path, id)` | 创建文件快照 |
| `rollbackToSnapshot(id)` | 回滚到快照 |
| `listSnapshots(path?)` | 列出快照 |
| `getConfig()` | 获取当前配置 |

## 注意事项

1. **默认启用**: 安全功能默认启用，无需额外配置
2. **操作日志**: 所有操作都会被记录，包括被阻止的操作
3. **快照机制**: 修改文件前会自动创建快照，但磁盘空间有限，请定期清理旧快照
4. **性能影响**: 安全检查对性能影响很小，但在高频调用场景下建议批量处理
