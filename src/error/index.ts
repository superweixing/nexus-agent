/**
 * Nexus Agent 错误处理模块
 *
 * 提供统一的错误分类、重试机制、优雅降级和错误日志
 */

import { EventEmitter } from 'events';

// ============================================================================
// 错误类型定义
// ============================================================================

/**
 * 错误分类
 */
export enum ErrorCategory {
  NETWORK = 'NETWORK', // 网络错误
  API = 'API', // API 错误
  CODE = 'CODE', // 代码错误
  PERMISSION = 'PERMISSION', // 权限错误
  TIMEOUT = 'TIMEOUT', // 超时错误
  UNKNOWN = 'UNKNOWN', // 未知错误
}

/**
 * 错误严重级别
 */
export enum ErrorSeverity {
  LOW = 'LOW', // 低 - 不影响主流程
  MEDIUM = 'MEDIUM', // 中 - 需要关注
  HIGH = 'HIGH', // 高 - 需要立即处理
  CRITICAL = 'CRITICAL', // 严重 - 系统不可用
}

/**
 * 错误上下文
 */
export interface ErrorContext {
  timestamp: number;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  stack?: string;
  context?: Record<string, any>;
  retries: number;
  recoverable: boolean;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  maxRetries: number; // 最大重试次数
  initialDelayMs: number; // 初始延迟（毫秒）
  maxDelayMs: number; // 最大延迟（毫秒）
  backoffMultiplier: number; // 退避乘数
  retryableErrors: ErrorCategory[]; // 可重试的错误类型
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [ErrorCategory.NETWORK, ErrorCategory.API, ErrorCategory.TIMEOUT],
};

// ============================================================================
// 自定义错误类
// ============================================================================

/**
 * 基础错误类
 */
export class NexusError extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly recoverable: boolean;
  public readonly context: Record<string, any>;
  public readonly timestamp: number;

  constructor(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    recoverable: boolean = true,
    context: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'NexusError';
    this.category = category;
    this.severity = severity;
    this.recoverable = recoverable;
    this.context = context;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      recoverable: this.recoverable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * 网络错误
 */
export class NetworkError extends NexusError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM, true, context);
    this.name = 'NetworkError';
  }
}

/**
 * API 错误
 */
export class APIError extends NexusError {
  public readonly statusCode?: number;
  public readonly response?: any;

  constructor(
    message: string,
    statusCode?: number,
    response?: any,
    context: Record<string, any> = {}
  ) {
    super(message, ErrorCategory.API, ErrorSeverity.MEDIUM, true, {
      ...context,
      statusCode,
      response,
    });
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * 代码错误
 */
export class CodeError extends NexusError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.CODE, ErrorSeverity.HIGH, false, context);
    this.name = 'CodeError';
  }
}

/**
 * 权限错误
 */
export class PermissionError extends NexusError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.PERMISSION, ErrorSeverity.HIGH, false, context);
    this.name = 'PermissionError';
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends NexusError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.TIMEOUT, ErrorSeverity.MEDIUM, true, context);
    this.name = 'TimeoutError';
  }
}

// ============================================================================
// 错误处理器
// ============================================================================

/**
 * 错误处理器
 */
export class ErrorHandler extends EventEmitter {
  private errorHistory: ErrorContext[] = [];
  private maxHistorySize: number;
  private retryConfig: RetryConfig;

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    super();
    this.maxHistorySize = 100;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * 分类错误
   */
  classifyError(error: any): ErrorCategory {
    if (error instanceof NexusError) {
      return error.category;
    }

    const message = error.message?.toLowerCase() || '';
    const code = error.code || '';

    // 网络错误
    if (
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      message.includes('network') ||
      message.includes('socket') ||
      message.includes('connection')
    ) {
      return ErrorCategory.NETWORK;
    }

    // API 错误
    if (
      code === 'API_ERROR' ||
      code === 'HTTP_ERROR' ||
      error.statusCode ||
      message.includes('api') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503')
    ) {
      return ErrorCategory.API;
    }

    // 权限错误
    if (
      code === 'PERMISSION_DENIED' ||
      code === 'EACCES' ||
      code === 'UNAUTHORIZED' ||
      code === 'FORBIDDEN' ||
      message.includes('permission') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('access denied')
    ) {
      return ErrorCategory.PERMISSION;
    }

    // 超时错误
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT' || message.includes('timeout')) {
      return ErrorCategory.TIMEOUT;
    }

    // 代码错误
    if (
      code === 'CODE_ERROR' ||
      code === 'SYNTAX_ERROR' ||
      message.includes('syntax') ||
      message.includes('typeerror') ||
      message.includes('referenceerror')
    ) {
      return ErrorCategory.CODE;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * 确定错误严重级别
   */
  determineSeverity(category: ErrorCategory, error: any): ErrorSeverity {
    // 检查是否是 429（速率限制）或 5xx 错误
    if (error.statusCode === 429) {
      return ErrorSeverity.MEDIUM;
    }
    if (error.statusCode && error.statusCode >= 500) {
      return ErrorSeverity.HIGH;
    }

    switch (category) {
      case ErrorCategory.NETWORK:
        return ErrorSeverity.MEDIUM;
      case ErrorCategory.API:
        return ErrorSeverity.MEDIUM;
      case ErrorCategory.CODE:
        return ErrorSeverity.HIGH;
      case ErrorCategory.PERMISSION:
        return ErrorSeverity.HIGH;
      case ErrorCategory.TIMEOUT:
        return ErrorSeverity.LOW;
      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  /**
   * 判断错误是否可恢复
   */
  isRecoverable(category: ErrorCategory): boolean {
    return this.retryConfig.retryableErrors.includes(category);
  }

  /**
   * 处理错误
   */
  handleError(error: any, context: Record<string, any> = {}): ErrorContext {
    const category = this.classifyError(error);
    const severity = this.determineSeverity(category, error);
    const recoverable = this.isRecoverable(category);

    const errorContext: ErrorContext = {
      timestamp: Date.now(),
      category,
      severity,
      message: error.message || String(error),
      originalError: error instanceof Error ? error : new Error(String(error)),
      stack: error.stack,
      context,
      retries: 0,
      recoverable,
    };

    // 添加到历史记录
    this.errorHistory.push(errorContext);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    // 发出错误事件
    this.emit('error', errorContext);

    // 严重错误发出警告
    if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
      this.emit('criticalError', errorContext);
    }

    // 记录到日志
    this.logError(errorContext);

    return errorContext;
  }

  /**
   * 记录错误
   */
  private logError(context: ErrorContext): void {
    const timestamp = new Date(context.timestamp).toISOString();
    const level =
      context.severity === ErrorSeverity.CRITICAL
        ? '❌'
        : context.severity === ErrorSeverity.HIGH
          ? '⚠️'
          : context.severity === ErrorSeverity.MEDIUM
            ? '⚡'
            : 'ℹ️';

    console.error(`[ErrorHandler] ${level} [${context.category}] ${context.severity}`);
    console.error(`[ErrorHandler] 时间: ${timestamp}`);
    console.error(`[ErrorHandler] 消息: ${context.message}`);

    if (context.stack) {
      console.error(`[ErrorHandler] 堆栈: ${context.stack}`);
    }

    if (context.context && Object.keys(context.context).length > 0) {
      console.error(`[ErrorHandler] 上下文:`, context.context);
    }

    if (context.recoverable) {
      console.error(`[ErrorHandler] 可恢复: 是`);
    }

    console.error('---');
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(limit?: number): ErrorContext[] {
    if (limit) {
      return this.errorHistory.slice(-limit);
    }
    return [...this.errorHistory];
  }

  /**
   * 获取最近错误统计
   */
  getErrorStats(hours: number = 24): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  } {
    const since = Date.now() - hours * 60 * 60 * 1000;
    const recentErrors = this.errorHistory.filter(e => e.timestamp >= since);

    const stats = {
      total: recentErrors.length,
      byCategory: {} as Record<ErrorCategory, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
    };

    for (const category of Object.values(ErrorCategory)) {
      stats.byCategory[category] = 0;
    }
    for (const severity of Object.values(ErrorSeverity)) {
      stats.bySeverity[severity] = 0;
    }

    for (const error of recentErrors) {
      stats.byCategory[error.category]++;
      stats.bySeverity[error.severity]++;
    }

    return stats;
  }

  /**
   * 清除错误历史
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * 更新重试配置
   */
  updateRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * 获取重试配置
   */
  getRetryConfig(): RetryConfig {
    return { ...this.retryConfig };
  }
}

// ============================================================================
// 重试装饰器
// ============================================================================

/**
 * 带重试的函数执行器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  errorHandler?: ErrorHandler,
  context: Record<string, any> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: any;
  let currentDelay = retryConfig.initialDelayMs;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // 处理错误
      const errorContext = errorHandler?.handleError(error, {
        ...context,
        attempt: attempt + 1,
        maxRetries: retryConfig.maxRetries,
      });

      // 判断是否可重试
      const category = errorHandler?.classifyError(error) || ErrorCategory.UNKNOWN;
      const canRetry =
        attempt < retryConfig.maxRetries && retryConfig.retryableErrors.includes(category);

      if (!canRetry) {
        console.error(`[Retry] 错误不可重试: ${category}`);
        throw error;
      }

      console.warn(
        `[Retry] 尝试 ${attempt + 1}/${retryConfig.maxRetries + 1} 失败，${currentDelay}ms 后重试...`
      );

      // 指数退避
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
    }
  }

  throw lastError;
}

// ============================================================================
// 优雅降级策略
// ============================================================================

/**
 * 优雅降级策略接口
 */
export interface DegradationStrategy<T> {
  execute(): Promise<T>;
  fallback?: () => Promise<T>;
  skip?: () => Promise<T>;
}

/**
 * LLM 失败时的回退策略
 */
export class LLMFallbackStrategy<T> implements DegradationStrategy<T> {
  private primaryFn: () => Promise<T>;
  private fallbackFn: () => Promise<T>;

  constructor(primaryFn: () => Promise<T>, fallbackFn: () => Promise<T>) {
    this.primaryFn = primaryFn;
    this.fallbackFn = fallbackFn;
  }

  async execute(): Promise<T> {
    try {
      return await this.primaryFn();
    } catch (error: any) {
      console.warn(`[LLMFallback] LLM 失败，回退到规则引擎: ${error.message}`);
      return await this.fallbackFn();
    }
  }
}

/**
 * GitHub API 失败时的缓存重试策略
 */
export class GitHubCacheRetryStrategy<T> implements DegradationStrategy<T> {
  private primaryFn: () => Promise<T>;
  private cache: Map<string, { data: T; timestamp: number }>;
  private cacheTTL: number;
  private cacheKey: string;

  constructor(
    primaryFn: () => Promise<T>,
    cacheKey: string,
    cacheTTL: number = 3600000 // 默认 1 小时
  ) {
    this.primaryFn = primaryFn;
    this.cache = new Map();
    this.cacheKey = cacheKey;
    this.cacheTTL = cacheTTL;
  }

  async execute(): Promise<T> {
    try {
      const result = await this.primaryFn();
      // 更新缓存
      this.cache.set(this.cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (error: any) {
      console.warn(`[GitHubCache] API 失败，尝试使用缓存: ${error.message}`);

      const cached = this.cache.get(this.cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        console.log(
          `[GitHubCache] 使用缓存数据 (${Math.round((Date.now() - cached.timestamp) / 1000)}s 前)`
        );
        return cached.data;
      }

      throw error;
    }
  }

  getCache(): T | undefined {
    const cached = this.cache.get(this.cacheKey);
    return cached?.data;
  }

  clearCache(): void {
    this.cache.delete(this.cacheKey);
  }
}

/**
 * Codex 失败时的跳过策略
 */
export class CodexSkipStrategy<T> implements DegradationStrategy<T> {
  private primaryFn: () => Promise<T>;
  private skipFn: () => Promise<T>;

  constructor(primaryFn: () => Promise<T>, skipFn: () => Promise<T>) {
    this.primaryFn = primaryFn;
    this.skipFn = skipFn;
  }

  async execute(): Promise<T> {
    try {
      return await this.primaryFn();
    } catch (error: any) {
      console.warn(`[CodexSkip] Codex 执行失败，跳过修改: ${error.message}`);
      return await this.skipFn();
    }
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let errorHandlerInstance: ErrorHandler | null = null;

/**
 * 获取错误处理器单例
 */
export function getErrorHandler(config?: Partial<RetryConfig>): ErrorHandler {
  if (!errorHandlerInstance) {
    errorHandlerInstance = new ErrorHandler(config);
  }
  return errorHandlerInstance;
}

export default ErrorHandler;
