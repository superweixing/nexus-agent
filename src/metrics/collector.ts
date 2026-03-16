/**
 * Nexus Agent - Metrics Collector
 *
 * 监控指标收集器
 * 追踪运行指标、性能指标和业务指标
 */

import * as os from 'os';

/**
 * 运行指标
 */
export interface RuntimeMetrics {
  // LLM 调用
  llmCalls: number;
  llmTotalTokens: number;
  llmTotalCost: number;
  // Codex 执行
  codexExecutions: number;
  codexSuccessCount: number;
  codexFailedCount: number;
  // GitHub API
  githubApiCalls: number;
  githubApiErrors: number;
  // 进化
  evolutionAttempts: number;
  evolutionSuccesses: number;
  evolutionFailures: number;
  evolutionSuccessRate: number;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  // 时间指标
  avgProcessingTime: number; // 平均处理时间 (ms)
  minProcessingTime: number;
  maxProcessingTime: number;
  totalProcessingTime: number;
  requestCount: number;

  // 内存趋势 (最近 N 个采样点)
  memoryTrend: Array<{
    timestamp: number;
    used: number;
    percent: number;
  }>;

  // 响应延迟
  avgResponseLatency: number;
  recentLatencies: number[];
}

/**
 * 业务指标
 */
export interface BusinessMetrics {
  // Issue 处理
  issuesProcessed: number;
  issuesOpen: number;
  issuesClosed: number;

  // PR 创建
  prsCreated: number;
  prsMerged: number;
  prsOpen: number;

  // 测试
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  testPassRate: number;
}

/**
 * 完整指标数据
 */
export interface MetricsData {
  runtime: RuntimeMetrics;
  performance: PerformanceMetrics;
  business: BusinessMetrics;
  lastUpdate: string;
}

/**
 * 单个处理记录
 */
interface ProcessingRecord {
  startTime: number;
  endTime: number;
  duration: number;
  type: 'issue' | 'pr' | 'evolution' | 'codex' | 'llm';
  success: boolean;
}

/**
 * 监控指标收集器
 */
export class MetricsCollector {
  private runtime: RuntimeMetrics;
  private performance: PerformanceMetrics;
  private business: BusinessMetrics;
  private processingRecords: ProcessingRecord[];
  private maxMemoryTrendPoints: number = 60; // 保留 60 个内存采样点
  private maxLatencyPoints: number = 100;
  private maxProcessingRecords: number = 1000;

  constructor() {
    // 初始化运行指标
    this.runtime = {
      llmCalls: 0,
      llmTotalTokens: 0,
      llmTotalCost: 0,
      codexExecutions: 0,
      codexSuccessCount: 0,
      codexFailedCount: 0,
      githubApiCalls: 0,
      githubApiErrors: 0,
      evolutionAttempts: 0,
      evolutionSuccesses: 0,
      evolutionFailures: 0,
      evolutionSuccessRate: 0,
    };

    // 初始化性能指标
    this.performance = {
      avgProcessingTime: 0,
      minProcessingTime: 0,
      maxProcessingTime: 0,
      totalProcessingTime: 0,
      requestCount: 0,
      memoryTrend: [],
      avgResponseLatency: 0,
      recentLatencies: [],
    };

    // 初始化业务指标
    this.business = {
      issuesProcessed: 0,
      issuesOpen: 0,
      issuesClosed: 0,
      prsCreated: 0,
      prsMerged: 0,
      prsOpen: 0,
      testsTotal: 0,
      testsPassed: 0,
      testsFailed: 0,
      testPassRate: 0,
    };

    this.processingRecords = [];

    // 立即记录初始内存状态
    this.recordMemoryUsage();
  }

  // =========================================================================
  // LLM 指标
  // =========================================================================

  /**
   * 记录 LLM 调用
   */
  recordLLMCall(tokens: number = 0, cost: number = 0): void {
    this.runtime.llmCalls++;
    this.runtime.llmTotalTokens += tokens;
    this.runtime.llmTotalCost += cost;
  }

  /**
   * 获取 LLM 调用次数
   */
  getLLMCalls(): number {
    return this.runtime.llmCalls;
  }

  /**
   * 获取 LLM 总成本
   */
  getLLMTotalCost(): number {
    return this.runtime.llmTotalCost;
  }

  // =========================================================================
  // Codex 指标
  // =========================================================================

  /**
   * 记录 Codex 执行
   */
  recordCodexExecution(success: boolean): void {
    this.runtime.codexExecutions++;
    if (success) {
      this.runtime.codexSuccessCount++;
    } else {
      this.runtime.codexFailedCount++;
    }
  }

  /**
   * 获取 Codex 执行次数
   */
  getCodexExecutions(): number {
    return this.runtime.codexExecutions;
  }

  /**
   * 获取 Codex 成功率
   */
  getCodexSuccessRate(): number {
    if (this.runtime.codexExecutions === 0) return 0;
    return (this.runtime.codexSuccessCount / this.runtime.codexExecutions) * 100;
  }

  // =========================================================================
  // GitHub API 指标
  // =========================================================================

  /**
   * 记录 GitHub API 调用
   */
  recordGitHubApiCall(error: boolean = false): void {
    this.runtime.githubApiCalls++;
    if (error) {
      this.runtime.githubApiErrors++;
    }
  }

  /**
   * 获取 GitHub API 调用次数
   */
  getGitHubApiCalls(): number {
    return this.runtime.githubApiCalls;
  }

  /**
   * 获取 GitHub API 错误率
   */
  getGitHubApiErrorRate(): number {
    if (this.runtime.githubApiCalls === 0) return 0;
    return (this.runtime.githubApiErrors / this.runtime.githubApiCalls) * 100;
  }

  // =========================================================================
  // 进化指标
  // =========================================================================

  /**
   * 记录进化尝试
   */
  recordEvolutionAttempt(success: boolean): void {
    this.runtime.evolutionAttempts++;
    if (success) {
      this.runtime.evolutionSuccesses++;
    } else {
      this.runtime.evolutionFailures++;
    }
    // 更新成功率
    if (this.runtime.evolutionAttempts > 0) {
      this.runtime.evolutionSuccessRate =
        (this.runtime.evolutionSuccesses / this.runtime.evolutionAttempts) * 100;
    }
  }

  /**
   * 获取进化成功率
   */
  getEvolutionSuccessRate(): number {
    return this.runtime.evolutionSuccessRate;
  }

  // =========================================================================
  // 性能指标
  // =========================================================================

  /**
   * 记录处理时间
   */
  recordProcessingTime(duration: number, type: ProcessingRecord['type'], success: boolean): void {
    // 更新处理时间统计
    this.performance.requestCount++;
    this.performance.totalProcessingTime += duration;
    this.performance.avgProcessingTime =
      this.performance.totalProcessingTime / this.performance.requestCount;

    // 更新最小/最大处理时间
    if (this.performance.minProcessingTime === 0 || duration < this.performance.minProcessingTime) {
      this.performance.minProcessingTime = duration;
    }
    if (duration > this.performance.maxProcessingTime) {
      this.performance.maxProcessingTime = duration;
    }

    // 保存处理记录
    const record: ProcessingRecord = {
      startTime: Date.now() - duration,
      endTime: Date.now(),
      duration,
      type,
      success,
    };
    this.processingRecords.unshift(record);

    // 限制记录数量
    if (this.processingRecords.length > this.maxProcessingRecords) {
      this.processingRecords = this.processingRecords.slice(0, this.maxProcessingRecords);
    }
  }

  /**
   * 记录内存使用
   */
  recordMemoryUsage(): void {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const percent = (usedMem / totalMem) * 100;

    this.performance.memoryTrend.push({
      timestamp: Date.now(),
      used: usedMem,
      percent,
    });

    // 限制趋势点数量
    if (this.performance.memoryTrend.length > this.maxMemoryTrendPoints) {
      this.performance.memoryTrend = this.performance.memoryTrend.slice(-this.maxMemoryTrendPoints);
    }
  }

  /**
   * 记录响应延迟
   */
  recordLatency(latency: number): void {
    this.performance.recentLatencies.push(latency);
    if (this.performance.recentLatencies.length > this.maxLatencyPoints) {
      this.performance.recentLatencies = this.performance.recentLatencies.slice(
        -this.maxLatencyPoints
      );
    }
    // 计算平均延迟
    const sum = this.performance.recentLatencies.reduce((a, b) => a + b, 0);
    this.performance.avgResponseLatency = sum / this.performance.recentLatencies.length;
  }

  /**
   * 获取平均处理时间
   */
  getAvgProcessingTime(): number {
    return this.performance.avgProcessingTime;
  }

  /**
   * 获取内存趋势
   */
  getMemoryTrend(): PerformanceMetrics['memoryTrend'] {
    return [...this.performance.memoryTrend];
  }

  /**
   * 获取当前内存使用率
   */
  getCurrentMemoryPercent(): number {
    if (this.performance.memoryTrend.length === 0) return 0;
    return this.performance.memoryTrend[this.performance.memoryTrend.length - 1].percent;
  }

  /**
   * 获取平均响应延迟
   */
  getAvgResponseLatency(): number {
    return this.performance.avgResponseLatency;
  }

  // =========================================================================
  // 业务指标
  // =========================================================================

  /**
   * 记录 Issue 处理
   */
  recordIssueProcessed(status: 'open' | 'closed'): void {
    this.business.issuesProcessed++;
    if (status === 'open') {
      this.business.issuesOpen++;
    } else {
      this.business.issuesClosed++;
    }
  }

  /**
   * 记录 PR 创建
   */
  recordPRCreated(status: 'open' | 'merged' | 'closed' = 'open'): void {
    this.business.prsCreated++;
    if (status === 'open') {
      this.business.prsOpen++;
    } else if (status === 'merged') {
      this.business.prsMerged++;
    }
  }

  /**
   * 记录测试结果
   */
  recordTestResult(passed: boolean): void {
    this.business.testsTotal++;
    if (passed) {
      this.business.testsPassed++;
    } else {
      this.business.testsFailed++;
    }
    // 更新测试通过率
    if (this.business.testsTotal > 0) {
      this.business.testPassRate = (this.business.testsPassed / this.business.testsTotal) * 100;
    }
  }

  /**
   * 批量记录测试结果
   */
  recordTestResults(passed: number, failed: number): void {
    this.business.testsTotal += passed + failed;
    this.business.testsPassed += passed;
    this.business.testsFailed += failed;
    if (this.business.testsTotal > 0) {
      this.business.testPassRate = (this.business.testsPassed / this.business.testsTotal) * 100;
    }
  }

  /**
   * 获取处理的 Issue 数量
   */
  getIssuesProcessed(): number {
    return this.business.issuesProcessed;
  }

  /**
   * 获取创建的 PR 数量
   */
  getPRsCreated(): number {
    return this.business.prsCreated;
  }

  /**
   * 获取测试通过率
   */
  getTestPassRate(): number {
    return this.business.testPassRate;
  }

  // =========================================================================
  // 获取完整指标数据
  // =========================================================================

  /**
   * 获取所有指标
   */
  getMetrics(): MetricsData {
    return {
      runtime: { ...this.runtime },
      performance: {
        ...this.performance,
        memoryTrend: [...this.performance.memoryTrend],
        recentLatencies: [...this.performance.recentLatencies],
      },
      business: { ...this.business },
      lastUpdate: new Date().toISOString(),
    };
  }

  /**
   * 获取简化的指标摘要（用于 Dashboard）
   */
  getSummary(): {
    runtime: {
      llmCalls: number;
      llmCost: string;
      codexExecutions: number;
      codexSuccessRate: string;
      githubCalls: number;
      evolutionSuccessRate: string;
    };
    performance: {
      avgProcessingTime: string;
      memoryPercent: string;
      avgLatency: string;
    };
    business: {
      issuesProcessed: number;
      prsCreated: number;
      testPassRate: string;
    };
  } {
    return {
      runtime: {
        llmCalls: this.runtime.llmCalls,
        llmCost: `$${this.runtime.llmTotalCost.toFixed(4)}`,
        codexExecutions: this.runtime.codexExecutions,
        codexSuccessRate: `${this.getCodexSuccessRate().toFixed(1)}%`,
        githubCalls: this.runtime.githubApiCalls,
        evolutionSuccessRate: `${this.runtime.evolutionSuccessRate.toFixed(1)}%`,
      },
      performance: {
        avgProcessingTime: `${this.performance.avgProcessingTime.toFixed(0)}ms`,
        memoryPercent: `${this.getCurrentMemoryPercent().toFixed(1)}%`,
        avgLatency: `${this.performance.avgResponseLatency.toFixed(0)}ms`,
      },
      business: {
        issuesProcessed: this.business.issuesProcessed,
        prsCreated: this.business.prsCreated,
        testPassRate: `${this.business.testPassRate.toFixed(1)}%`,
      },
    };
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.runtime = {
      llmCalls: 0,
      llmTotalTokens: 0,
      llmTotalCost: 0,
      codexExecutions: 0,
      codexSuccessCount: 0,
      codexFailedCount: 0,
      githubApiCalls: 0,
      githubApiErrors: 0,
      evolutionAttempts: 0,
      evolutionSuccesses: 0,
      evolutionFailures: 0,
      evolutionSuccessRate: 0,
    };

    this.performance = {
      avgProcessingTime: 0,
      minProcessingTime: 0,
      maxProcessingTime: 0,
      totalProcessingTime: 0,
      requestCount: 0,
      memoryTrend: [],
      avgResponseLatency: 0,
      recentLatencies: [],
    };

    this.business = {
      issuesProcessed: 0,
      issuesOpen: 0,
      issuesClosed: 0,
      prsCreated: 0,
      prsMerged: 0,
      prsOpen: 0,
      testsTotal: 0,
      testsPassed: 0,
      testsFailed: 0,
      testPassRate: 0,
    };

    this.processingRecords = [];
  }
}

// =========================================================================
// Singleton
// =========================================================================

let metricsCollectorInstance: MetricsCollector | null = null;

/**
 * 获取 MetricsCollector 单例
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    metricsCollectorInstance = new MetricsCollector();
  }
  return metricsCollectorInstance;
}

export default MetricsCollector;
