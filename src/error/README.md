# Nexus Agent 错误处理模块

Nexus Agent 提供了完善的错误处理和重试机制，确保系统稳定运行。

## 功能概览

### 1. 错误分类
- **NETWORK**: 网络连接错误
- **API**: API 调用错误（包含速率限制）
- **CODE**: 代码执行错误
- **PERMISSION**: 权限错误
- **TIMEOUT**: 超时错误
- **UNKNOWN**: 未知错误

### 2. 严重级别
- **LOW**: 不影响主流程
- **MEDIUM**: 需要关注但不影响核心功能
- **HIGH**: 需要立即处理
- **CRITICAL**: 系统不可用

## 使用方法

### 导入错误处理模块

```typescript
import { 
  ErrorHandler, 
  getErrorHandler,
  withRetry,
  NetworkError,
  APIError,
  CodeError,
  PermissionError,
  TimeoutError,
  ErrorCategory,
  ErrorSeverity
} from './error';

import { ErrorReporter, getErrorReporter } from './error/reporter';
```

### 创建错误处理器

```typescript
// 使用默认配置
const errorHandler = getErrorHandler();

// 或自定义配置
const errorHandler = new ErrorHandler({
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [ErrorCategory.NETWORK, ErrorCategory.API, ErrorCategory.TIMEOUT]
});
```

### 使用 withRetry 包装异步函数

```typescript
async function fetchData() {
  return await withRetry(
    async () => {
      // 您的业务逻辑
      const result = await fetch('https://api.example.com/data');
      return result.json();
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 30000
    },
    errorHandler,
    { module: 'MyModule', action: 'fetchData' }
  );
}
```

### 优雅降级策略

#### LLM 失败回退到规则引擎

```typescript
import { LLMFallbackStrategy } from './error';

const strategy = new LLMFallbackStrategy(
  // 主策略：使用 LLM
  async () => {
    const result = await llm.chat(prompt);
    return parseResult(result);
  },
  // 降级策略：使用规则
  async () => {
    return evaluateWithRules(issue);
  }
);

const result = await strategy.execute();
```

#### GitHub API 失败使用缓存

```typescript
import { GitHubCacheRetryStrategy } from './error';

const strategy = new GitHubCacheRetryStrategy(
  // 主策略：调用 API
  async () => {
    return await fetchGitHubIssues();
  },
  'issues-cache-key',
  3600000 // 缓存 1 小时
);

const issues = await strategy.execute();
```

#### Codex 失败跳过修改

```typescript
import { CodexSkipStrategy } from './error';

const strategy = new CodexSkipStrategy(
  // 主策略：执行 Codex
  async () => {
    return await codex.execute(task);
  },
  // 降级策略：跳过
  async () => {
    return { success: false, skipped: true };
  }
);
```

### 错误上报

```typescript
const reporter = getErrorReporter({
  logFilePath: './logs/nexus-error.log',
  consoleOutput: true,
  fileOutput: true,
  minSeverity: ErrorSeverity.HIGH,
  retentionDays: 30,
  // feishuWebhook: 'https://open.feishu.cn/...' // 可选
});

// 监听错误事件
errorHandler.on('error', async (errorContext) => {
  await reporter.report(errorContext);
});

errorHandler.on('criticalError', async (errorContext) => {
  await reporter.report(errorContext);
  // 发送紧急通知
  await sendAlert(errorContext);
});
```

### 在现有组件中集成

#### OpenClawManager 示例

```typescript
import { withRetry, getErrorHandler, ErrorCategory } from './error';

export class OpenClawManager {
  private errorHandler: ErrorHandler;

  constructor() {
    this.errorHandler = getErrorHandler();
  }

  async start(): Promise<void> {
    await withRetry(
      async () => {
        await execAsync('openclaw gateway start');
      },
      {
        maxRetries: 3,
        initialDelayMs: 2000,
        backoffMultiplier: 2
      },
      this.errorHandler,
      { module: 'OpenClawManager', action: 'start' }
    );
  }
}
```

#### IssueFetcher 示例

```typescript
import { withRetry, getErrorHandler } from './error';

export class IssueFetcher {
  private errorHandler: ErrorHandler;
  private issueCache: Map<number, Issue>;

  async fetchIssues(): Promise<Issue[]> {
    try {
      return await withRetry(
        async () => await this.fetchFromGitHub(),
        {
          maxRetries: 3,
          initialDelayMs: 1000
        },
        this.errorHandler,
        { module: 'IssueFetcher', action: 'fetchIssues' }
      );
    } catch (error) {
      // 返回缓存数据作为降级
      return Array.from(this.issueCache.values());
    }
  }
}
```

## 配置示例

配置文件: `configs/error-handling.yaml`

```yaml
retry:
  maxRetries: 3
  initialDelayMs: 1000
  maxDelayMs: 30000
  backoffMultiplier: 2
  retryableErrors:
    - NETWORK
    - API
    - TIMEOUT

degradation:
  llm:
    enabled: true
    fallbackToRules: true
  github:
    enabled: true
    cacheTTL: 3600
    fallbackToCache: true
  codex:
    enabled: true
    skipOnFailure: true

logging:
  logFilePath: "./logs/nexus-error.log"
  consoleOutput: true
  fileOutput: true
  minSeverity: "HIGH"
  retentionDays: 30
```

## API 参考

### ErrorHandler

| 方法 | 描述 |
|------|------|
| `handleError(error, context)` | 处理错误并返回错误上下文 |
| `classifyError(error)` | 分类错误类型 |
| `isRecoverable(category)` | 判断错误是否可恢复 |
| `getErrorHistory(limit?)` | 获取错误历史 |
| `getErrorStats(hours)` | 获取错误统计 |
| `updateRetryConfig(config)` | 更新重试配置 |

### withRetry

| 参数 | 类型 | 描述 |
|------|------|------|
| `fn` | `() => Promise<T>` | 要执行的异步函数 |
| `config` | `RetryConfig` | 重试配置 |
| `errorHandler` | `ErrorHandler` | 错误处理器 |
| `context` | `Record<string, any>` | 错误上下文 |

### ErrorReporter

| 方法 | 描述 |
|------|------|
| `report(errorContext)` | 上报错误 |
| `cleanOldLogs()` | 清理过期日志 |
| `close()` | 关闭日志流 |
