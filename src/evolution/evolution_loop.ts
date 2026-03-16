import { GitHubIssue, IssueFetcher } from './issue_fetcher';
import { PRManager, CreatePROptions } from '../github/pr_manager';
import { SelfTester, SelfTestConfig } from '../test/self_tester';

// 导入错误处理模块
import {
  ErrorHandler,
  getErrorHandler,
  withRetry,
  ErrorCategory,
  DEFAULT_RETRY_CONFIG,
  LLMFallbackStrategy,
} from '../error';

// LLM 评估模块（动态导入）
let LLMModule: typeof import('../../openclaw/dist/llm/index.js') | null = null;

// 错误处理器单例
let errorHandlerInstance: ErrorHandler | null = null;

/**
 * 获取错误处理器
 */
function getEvolutionErrorHandler(): ErrorHandler {
  if (!errorHandlerInstance) {
    errorHandlerInstance = getErrorHandler({
      maxRetries: 2,
      initialDelayMs: 500,
      retryableErrors: [ErrorCategory.API, ErrorCategory.TIMEOUT],
    });
  }
  return errorHandlerInstance;
}

/**
 * 初始化 LLM 模块
 */
async function getLLMModule() {
  if (!LLMModule) {
    LLMModule = await import('../../openclaw/dist/llm/index.js');
  }
  return LLMModule;
}

/**
 * 解析 LLM 评估响应
 */
function parseLLMResponse(response: string): Partial<Evaluation> {
  const result: Partial<Evaluation> = {
    importance: 0.5,
    difficulty: 0.5,
    actionable: true,
    reason: '',
    strategy: '',
  };

  // 解析重要程度 (0-1)
  const importanceMatch =
    response.match(/重要程度[：:]\s*([0-9.]+)/i) ||
    response.match(/importance[：:]\s*([0-9.]+)/i) ||
    response.match(/重要性[：:]\s*([0-9.]+)/i);
  if (importanceMatch) {
    result.importance = Math.max(0, Math.min(1, parseFloat(importanceMatch[1])));
  }

  // 解析难度 (0-1)
  const difficultyMatch =
    response.match(/难度[：:]\s*([0-9.]+)/i) || response.match(/difficulty[：:]\s*([0-9.]+)/i);
  if (difficultyMatch) {
    result.difficulty = Math.max(0, Math.min(1, parseFloat(difficultyMatch[1])));
  }

  // 解析是否可执行
  const actionableMatch =
    response.match(/可执行[：:]?\s*(是|否|yes|no|true|false|可以|不可以)/i) ||
    response.match(/actionable[：:]?\s*(yes|no|true|false)/i);
  if (actionableMatch) {
    const value = actionableMatch[1].toLowerCase();
    result.actionable = value === '是' || value === 'yes' || value === 'true' || value === '可以';
  }

  // 解析执行策略
  const strategyMatch =
    response.match(/执行策略[：:]\s*([^\n]+)/i) ||
    response.match(/策略[：:]\s*([^\n]+)/i) ||
    response.match(/strategy[：:]\s*([^\n]+)/i);
  if (strategyMatch) {
    result.strategy = strategyMatch[1].trim();
  }

  // 如果没有找到策略，尝试提取最后一段作为策略
  if (!result.strategy) {
    const lines = response.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      result.strategy = lines[lines.length - 1].trim();
    }
  }

  result.reason = `LLM 智能评估: ${response.substring(0, 200)}...`;

  return result;
}

/**
 * Issue 评估结果
 */
export interface Evaluation {
  issue: GitHubIssue;
  // 重要程度 (0-1)
  importance: number;
  // 难度 (0-1)
  difficulty: number;
  // 是否可执行
  actionable: boolean;
  // 执行策略
  strategy?: string;
  // 评估理由
  reason: string;
  // 需要修改的文件（预估）
  estimatedFiles?: string[];
}

/**
 * 进化循环配置
 */
export interface EvolutionConfig {
  // 检查间隔（毫秒）
  fetchInterval: number;
  // 最大并发执行数
  maxConcurrent: number;
  // 最小重要程度阈值
  minImportance: number;
  // 最大难度阈值
  maxDifficulty: number;
  // 是否自动执行
  autoExecute: boolean;
  // 排除的标签
  excludeLabels?: string[];
  // 包含的标签
  requireLabels?: string[];
  // 是否启用自我测试
  enableSelfTest?: boolean;
  // 自我测试失败时是否阻止 PR
  blockOnTestFailure?: boolean;
  // OpenClaw 项目路径
  openclawPath?: string;
}

/**
 * 进化结果
 */
export interface EvolutionResult {
  issueNumber: number;
  success: boolean;
  message: string;
  changes?: string[];
  prNumber?: number;
  prUrl?: string;
  error?: string;
  // 测试结果
  testPassed?: boolean;
  testReport?: string;
}

/**
 * GitHub 配置
 */
export interface GitHubConfig {
  // GitHub Token
  token: string;
  // 仓库 owner
  owner: string;
  // 仓库名称
  repo: string;
  // 默认目标分支
  defaultBase?: string;
  // 是否自动创建 PR
  autoCreatePR?: boolean;
}

/**
 * 进化循环
 * 负责评估和执行 Issue 修复
 */
export class EvolutionLoop {
  private issueFetcher: IssueFetcher;
  private config: EvolutionConfig;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;
  private executionHistory: EvolutionResult[] = [];
  private codexExecutor?: CodexExecutor;
  private prManager?: PRManager;
  private githubConfig?: GitHubConfig;
  private selfTester?: SelfTester;

  constructor(
    config?: Partial<EvolutionConfig>,
    codexExecutor?: CodexExecutor,
    githubConfig?: GitHubConfig
  ) {
    this.config = {
      fetchInterval: config?.fetchInterval || 60 * 60 * 1000, // 默认 1 小时
      maxConcurrent: config?.maxConcurrent || 1,
      minImportance: config?.minImportance || 0.5,
      maxDifficulty: config?.maxDifficulty || 0.7,
      autoExecute: config?.autoExecute || false,
      excludeLabels: config?.excludeLabels || ['wontfix', 'duplicate', 'invalid', 'low-priority'],
      requireLabels: config?.requireLabels,
      enableSelfTest: config?.enableSelfTest ?? true, // 默认启用自我测试
      blockOnTestFailure: config?.blockOnTestFailure ?? true, // 默认阻止失败
      openclawPath: config?.openclawPath,
    };

    this.issueFetcher = new IssueFetcher(this.config.fetchInterval);
    this.codexExecutor = codexExecutor;

    // 初始化 PRManager
    if (githubConfig?.token) {
      this.githubConfig = githubConfig;
      this.prManager = new PRManager({
        token: githubConfig.token,
        defaultBase: githubConfig.defaultBase || 'main',
      });
      console.log('[EvolutionLoop] PRManager 已初始化');
    }

    // 初始化自我测试器
    if (this.config.enableSelfTest) {
      const testConfig: Partial<SelfTestConfig> = {
        openclawPath: this.config.openclawPath,
        blockOnFailure: this.config.blockOnTestFailure,
      };
      this.selfTester = new SelfTester(testConfig);
      console.log('[EvolutionLoop] 自我测试器已初始化');
    }
  }

  /**
   * 设置 Codex 执行器
   */
  setCodexExecutor(executor: CodexExecutor): void {
    this.codexExecutor = executor;
  }

  /**
   * 设置 GitHub 配置
   */
  setGitHubConfig(config: GitHubConfig): void {
    if (config.token) {
      this.githubConfig = config;
      this.prManager = new PRManager({
        token: config.token,
        defaultBase: config.defaultBase || 'main',
      });
      console.log('[EvolutionLoop] PRManager 配置已更新');
    }
  }

  /**
   * 启动进化循环
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      console.log('[EvolutionLoop] 进化循环已在运行中');
      return;
    }

    console.log('[EvolutionLoop] 启动进化循环...');
    this.isRunning = true;

    // 立即执行一次
    await this.evolve();

    // 设置定时器
    this.intervalId = setInterval(async () => {
      await this.evolve();
    }, this.config.fetchInterval);

    console.log(
      `[EvolutionLoop] 进化循环已启动，间隔: ${this.config.fetchInterval / 1000 / 60} 分钟`
    );
  }

  /**
   * 停止进化循环
   */
  async stop(): Promise<void> {
    console.log('[EvolutionLoop] 停止进化循环...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
    console.log('[EvolutionLoop] 进化循环已停止');
  }

  /**
   * 执行一次进化
   */
  async evolve(): Promise<EvolutionResult[]> {
    console.log('[EvolutionLoop] 开始进化检查...');

    const results: EvolutionResult[] = [];

    try {
      // 1. 获取 Issues
      const issues = await this.issueFetcher.fetchIssues({
        state: 'open',
        excludeLabels: this.config.excludeLabels,
        requireLabels: this.config.requireLabels,
      });

      console.log(`[EvolutionLoop] 获取到 ${issues.length} 个 issues`);

      // 2. 过滤可处理的 Issues
      const actionableIssues = await this.issueFetcher.filterActionable(issues);
      console.log(`[EvolutionLoop] ${actionableIssues.length} 个可处理 issues`);

      // 3. 评估每个 Issue
      const evaluations = await Promise.all(
        actionableIssues.map(issue => this.evaluateIssue(issue))
      );

      // 4. 过滤需要执行的
      const toExecute = evaluations.filter(
        evalResult =>
          evalResult.actionable &&
          evalResult.importance >= this.config.minImportance &&
          evalResult.difficulty <= this.config.maxDifficulty
      );

      console.log(`[EvolutionLoop] ${toExecute.length} 个 issues 需要执行`);

      // 5. 执行修改
      for (const evaluation of toExecute) {
        const result = await this.executeModification(evaluation.issue, evaluation);
        results.push(result);
        this.executionHistory.push(result);

        // 保存进化历史
        this.saveEvolutionHistory();
      }
    } catch (error) {
      console.error('[EvolutionLoop] 进化过程出错:', error);
    }

    return results;
  }

  /**
   * 公开方法：获取 Issues
   */
  async fetchIssues(): Promise<GitHubIssue[]> {
    return await this.issueFetcher.fetchIssues({
      state: 'open',
      excludeLabels: this.config.excludeLabels,
      requireLabels: this.config.requireLabels,
    });
  }

  /**
   * 使用 LLM 评估 Issue
   */
  /**
   * 使用 LLM 评估 Issue（带重试和优雅降级）
   */
  async evaluateWithLLM(issue: GitHubIssue): Promise<Evaluation> {
    const evaluation: Evaluation = {
      issue,
      importance: 0.5,
      difficulty: 0.5,
      actionable: false,
      reason: '',
      estimatedFiles: [],
    };

    const errorHandler = getEvolutionErrorHandler();

    // 优雅降级策略：LLM 失败时回退到规则引擎
    const strategy = new LLMFallbackStrategy(
      // 主策略：使用 LLM 评估
      async () => {
        return await withRetry(
          async () => {
            // 获取 LLM 模块
            const llmModule = await getLLMModule();

            // 创建 LLM 实例
            const llm = llmModule.createMiniMax({
              model: 'MiniMax-M2.5',
              temperature: 0.7,
            });

            // 构建评估 prompt
            const systemPrompt = `你是一个专业的代码审查和 Issue 评估专家。你的任务是评估 GitHub Issue 的重要性和难度，并判断是否可执行。`;

            const userPrompt = `请评估以下 GitHub Issue：

标题: ${issue.title}
内容: ${issue.body || '(无内容)'}
标签: ${issue.labels.join(', ') || '无'}
作者: ${issue.user.login}

请按以下格式给出评估：
1. 重要程度 (0-1): [数值]
2. 难度 (0-1): [数值]  
3. 是否可执行: [是/否]
4. 执行策略: [简短的策略描述]

请基于以下因素进行评估：
- Bug 和安全相关的问题重要性更高
- 重构、架构类问题难度较高
- 有明确解决方案的 issue 更可执行
- 过于模糊或需要讨论的 issue 可能是不可执行的`;

            // 调用 LLM
            const response = await llm.chat(systemPrompt, userPrompt);

            // 解析响应
            const parsed = parseLLMResponse(response.content);

            evaluation.importance = parsed.importance ?? 0.5;
            evaluation.difficulty = parsed.difficulty ?? 0.5;
            evaluation.actionable = parsed.actionable ?? false;
            evaluation.strategy = parsed.strategy ?? this.generateStrategy(issue);
            evaluation.reason = parsed.reason ?? '';

            console.log(
              `[EvolutionLoop] LLM 评估 Issue #${issue.number}: 重要性=${evaluation.importance.toFixed(2)}, 难度=${evaluation.difficulty.toFixed(2)}, 可执行=${evaluation.actionable}`
            );

            return evaluation;
          },
          {
            maxRetries: 2,
            initialDelayMs: 500,
            backoffMultiplier: 2,
          },
          errorHandler,
          { module: 'EvolutionLoop', action: 'evaluateWithLLM', issueNumber: issue.number }
        );
      },
      // 降级策略：使用规则评估
      async () => {
        console.warn(
          `[EvolutionLoop] LLM 评估失败（已重试），回退到规则评估 Issue #${issue.number}`
        );
        return this.evaluateIssueWithRules(issue);
      }
    );

    try {
      return await strategy.execute();
    } catch (error: any) {
      // 记录错误并返回规则评估
      errorHandler.handleError(error, {
        module: 'EvolutionLoop',
        action: 'evaluateWithLLM',
        issueNumber: issue.number,
      });

      console.error(`[EvolutionLoop] LLM 评估异常，回退到规则评估:`, error.message);
      return this.evaluateIssueWithRules(issue);
    }
  }

  /**
   * 基于规则的 Issue 评估（回退方案）
   */
  private evaluateIssueWithRules(issue: GitHubIssue): Evaluation {
    const evaluation: Evaluation = {
      issue,
      importance: 0.5,
      difficulty: 0.5,
      actionable: false,
      reason: '',
      estimatedFiles: [],
    };

    // 评估重要性
    evaluation.importance = this.calculateImportance(issue);

    // 评估难度
    evaluation.difficulty = this.calculateDifficulty(issue);

    // 判断是否可执行
    evaluation.actionable = this.isActionable(issue, evaluation);

    // 生成策略
    if (evaluation.actionable) {
      evaluation.strategy = this.generateStrategy(issue);
      evaluation.estimatedFiles = this.estimateFiles(issue);
    }

    evaluation.reason = this.generateReason(issue, evaluation);

    return evaluation;
  }

  /**
   * 评估 Issue（主方法，会尝试 LLM 评估）
   */
  async evaluateIssue(issue: GitHubIssue): Promise<Evaluation> {
    // 检查是否配置了 LLM（通过环境变量）
    const hasLLM = !!process.env.MINIMAX_API_KEY;

    if (hasLLM) {
      try {
        // 尝试使用 LLM 评估
        return await this.evaluateWithLLM(issue);
      } catch (error) {
        console.warn(`[EvolutionLoop] LLM 评估失败:`, error);
        // 回退到规则评估
        return this.evaluateIssueWithRules(issue);
      }
    } else {
      // 没有配置 LLM 时使用规则评估
      console.log(`[EvolutionLoop] 未配置 MINIMAX_API_KEY，使用规则评估 Issue #${issue.number}`);
      return this.evaluateIssueWithRules(issue);
    }
  }

  /**
   * 计算重要性
   */
  private calculateImportance(issue: GitHubIssue): number {
    let importance = 0.5;

    // 高优先级标签
    if (issue.labels.includes('urgent') || issue.labels.includes('critical')) {
      importance += 0.4;
    } else if (issue.labels.includes('high-priority')) {
      importance += 0.3;
    } else if (issue.labels.includes('medium-priority')) {
      importance += 0.1;
    }

    // Bug 优先级较高
    if (issue.labels.includes('bug')) {
      importance += 0.2;
    }

    // 根据标题关键词
    const title = issue.title.toLowerCase();
    if (title.includes('crash') || title.includes('security') || title.includes('vulnerability')) {
      importance += 0.3;
    } else if (title.includes('error') || title.includes('fail')) {
      importance += 0.1;
    }

    return Math.min(importance, 1.0);
  }

  /**
   * 计算难度
   */
  private calculateDifficulty(issue: GitHubIssue): number {
    let difficulty = 0.3;

    // 根据标题和内容估算
    const content = (issue.title + ' ' + issue.body).toLowerCase();

    // 复杂功能词
    const complexKeywords = [
      'refactor',
      'architecture',
      'database',
      'migration',
      'api',
      'security',
      'performance',
    ];
    for (const keyword of complexKeywords) {
      if (content.includes(keyword)) {
        difficulty += 0.1;
      }
    }

    // 简单修复词
    const simpleKeywords = ['typo', 'fix', 'update', 'add'];
    for (const keyword of simpleKeywords) {
      if (content.includes(keyword)) {
        difficulty -= 0.05;
      }
    }

    return Math.max(0, Math.min(difficulty, 1.0));
  }

  /**
   * 判断是否可执行
   */
  private isActionable(issue: GitHubIssue, evaluation: Evaluation): boolean {
    // 非可执行标签
    const nonActionableLabels = ['wontfix', 'duplicate', 'invalid', 'question', 'documentation'];
    if (issue.labels.some(label => nonActionableLabels.includes(label))) {
      return false;
    }

    // 已经有解决方案的
    if (
      issue.body.toLowerCase().includes('resolved') ||
      issue.body.toLowerCase().includes('fixed')
    ) {
      return false;
    }

    // 难度太高
    if (evaluation.difficulty > 0.8) {
      return false;
    }

    return true;
  }

  /**
   * 生成执行策略
   */
  private generateStrategy(issue: GitHubIssue): string {
    const labels = issue.labels;

    if (labels.includes('bug')) {
      return '修复 bug';
    } else if (labels.includes('enhancement')) {
      return '实现功能增强';
    } else if (labels.includes('documentation')) {
      return '更新文档';
    } else if (labels.includes('refactor')) {
      return '代码重构';
    }

    return '分析并修复';
  }

  /**
   * 预估需要修改的文件
   */
  private estimateFiles(issue: GitHubIssue): string[] {
    const files: string[] = [];
    const content = (issue.title + ' ' + issue.body).toLowerCase();

    // 根据关键词猜测
    if (content.includes('browser')) {
      files.push('src/browser/*');
    }
    if (content.includes('tool') || content.includes('exec')) {
      files.push('src/tools/*');
    }
    if (content.includes('feishu') || content.includes('飞书')) {
      files.push('extensions/feishu/*');
    }
    if (content.includes('config') || content.includes('配置')) {
      files.push('config/*');
    }

    return files;
  }

  /**
   * 生成评估理由
   */
  private generateReason(issue: GitHubIssue, evaluation: Evaluation): string {
    const parts: string[] = [];

    parts.push(`标签: ${issue.labels.join(', ') || '无'}`);
    parts.push(`重要性: ${(evaluation.importance * 100).toFixed(0)}%`);
    parts.push(`难度: ${(evaluation.difficulty * 100).toFixed(0)}%`);

    return parts.join(' | ');
  }

  /**
   * 执行修改
   */
  async executeModification(issue: GitHubIssue, evaluation: Evaluation): Promise<EvolutionResult> {
    console.log(`[EvolutionLoop] 执行 Issue #${issue.number}: ${issue.title}`);

    if (!this.codexExecutor) {
      return {
        issueNumber: issue.number,
        success: false,
        message: 'Codex 执行器未设置',
        error: 'Codex executor not configured',
      };
    }

    try {
      // 构建修改指令
      const instruction = this.buildModificationInstruction(issue, evaluation);

      // 执行修改
      const result = await this.codexExecutor.execute(issue.number, instruction);

      if (result.success) {
        console.log(`[EvolutionLoop] Issue #${issue.number} 修改成功`);

        // 执行自我测试验证
        let testPassed = true;
        let testReport = '';

        if (this.selfTester) {
          console.log(`[EvolutionLoop] 开始自我测试验证...`);

          try {
            const validation = await this.selfTester.runFullValidation();
            testPassed = validation.canProceed;
            testReport = this.selfTester.generateReport();

            console.log(`[EvolutionLoop] 自我测试结果: ${testPassed ? '✓ 通过' : '✗ 失败'}`);

            if (!testPassed) {
              console.error(`[EvolutionLoop] 自我测试失败，不创建 PR`);
              console.log(testReport);

              return {
                issueNumber: issue.number,
                success: false,
                message: '修改成功但测试失败',
                changes: result.changes,
                testPassed: false,
                testReport,
              };
            }
          } catch (error: any) {
            console.error(`[EvolutionLoop] 自我测试执行异常:`, error.message);
            if (this.config.blockOnTestFailure) {
              return {
                issueNumber: issue.number,
                success: false,
                message: '修改成功但测试执行异常',
                changes: result.changes,
                testPassed: false,
                testReport: error.message,
              };
            }
          }
        }

        // 如果配置了 GitHub 且自动创建 PR 开启，则创建 PR
        let prNumber: number | undefined;
        let prUrl: string | undefined;

        if (this.prManager && this.githubConfig?.autoCreatePR) {
          console.log(`[EvolutionLoop] 开始创建 PR...`);

          // 生成分支名称
          const branchName = `fix/issue-${issue.number}-${Date.now()}`;

          // 创建 PR 选项
          const prOptions: CreatePROptions = {
            owner: this.githubConfig.owner,
            repo: this.githubConfig.repo,
            title: `Fix #${issue.number}: ${issue.title}`,
            body: this.buildPRBody(issue, evaluation, result.changes),
            head: branchName,
            base: this.githubConfig.defaultBase || 'main',
          };

          // 创建分支（如果需要）
          if (this.githubConfig.autoCreatePR) {
            await this.prManager.createBranch(
              this.githubConfig.owner,
              this.githubConfig.repo,
              branchName,
              this.githubConfig.defaultBase
            );
          }

          // 创建 PR
          const prResult = await this.prManager.createPR(prOptions);

          if (prResult.success) {
            prNumber = prResult.prNumber;
            prUrl = prResult.prUrl;
            console.log(`[EvolutionLoop] PR 创建成功: #${prNumber} - ${prUrl}`);
          } else {
            console.error(`[EvolutionLoop] PR 创建失败:`, prResult.error);
          }
        }

        return {
          issueNumber: issue.number,
          success: true,
          message: '修改成功',
          changes: result.changes,
          prNumber,
          prUrl,
          testPassed,
          testReport,
        };
      } else {
        console.error(`[EvolutionLoop] Issue #${issue.number} 修改失败:`, result.error);
        return {
          issueNumber: issue.number,
          success: false,
          message: '修改失败',
          error: result.error,
        };
      }
    } catch (error: any) {
      console.error(`[EvolutionLoop] Issue #${issue.number} 执行异常:`, error);
      return {
        issueNumber: issue.number,
        success: false,
        message: '执行异常',
        error: error.message,
      };
    }
  }

  /**
   * 构建 PR 描述
   */
  private buildPRBody(issue: GitHubIssue, evaluation: Evaluation, changes?: string[]): string {
    const lines: string[] = [
      `## 修复 Issue #${issue.number}`,
      '',
      `**标题**: ${issue.title}`,
      '',
      `**描述**`,
      issue.body || '无',
      '',
      `**标签**: ${issue.labels.join(', ')}`,
      '',
      `**评估**`,
      `- 重要性: ${(evaluation.importance * 100).toFixed(0)}%`,
      `- 难度: ${(evaluation.difficulty * 100).toFixed(0)}%`,
      `- 策略: ${evaluation.strategy}`,
      '',
    ];

    if (changes?.length) {
      lines.push('**修改内容**');
      lines.push('');
      changes.forEach(change => {
        lines.push(`- ${change}`);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('*由 Nexus Agent 自动创建*');

    return lines.join('\n');
  }

  /**
   * 构建修改指令
   */
  private buildModificationInstruction(issue: GitHubIssue, evaluation: Evaluation): string {
    const lines: string[] = [
      `请处理 GitHub Issue #${issue.number}`,
      `标题: ${issue.title}`,
      `描述: ${issue.body}`,
      `标签: ${issue.labels.join(', ')}`,
      `策略: ${evaluation.strategy}`,
    ];

    if (evaluation.estimatedFiles?.length) {
      lines.push(`预估文件: ${evaluation.estimatedFiles.join(', ')}`);
    }

    lines.push('');
    lines.push('请分析问题并尝试修复。');

    return lines.join('\n');
  }

  /**
   * 保存进化历史
   */
  private saveEvolutionHistory(): void {
    // 简单保存到文件
    const fs = require('fs');
    const path = require('path');
    const historyFile = path.join(__dirname, 'evolution_history.json');

    try {
      fs.writeFileSync(historyFile, JSON.stringify(this.executionHistory, null, 2));
    } catch (error) {
      console.error('[EvolutionLoop] 保存历史失败:', error);
    }
  }

  /**
   * 获取进化历史
   */
  getHistory(): EvolutionResult[] {
    return this.executionHistory;
  }

  /**
   * 获取状态
   */
  getStatus(): { running: boolean; lastRun?: Date; historyCount: number } {
    return {
      running: this.isRunning,
      historyCount: this.executionHistory.length,
    };
  }

  /**
   * 手动触发一次进化
   */
  async trigger(): Promise<EvolutionResult[]> {
    return await this.evolve();
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EvolutionConfig>): void {
    this.config = { ...this.config, ...config };
    this.issueFetcher.setFetchInterval(this.config.fetchInterval);
  }

  /**
   * 获取自我测试器
   */
  getSelfTester(): SelfTester | undefined {
    return this.selfTester;
  }

  /**
   * 手动触发自我测试
   */
  async runSelfTest(): Promise<{
    success: boolean;
    testResult?: any;
    qualityResult?: any;
    buildResult?: any;
    report?: string;
  }> {
    if (!this.selfTester) {
      return { success: false, report: '自我测试器未初始化' };
    }

    const result = await this.selfTester.runFullValidation();
    return {
      success: result.canProceed,
      testResult: result.testResult,
      qualityResult: result.qualityResult,
      buildResult: result.buildResult,
      report: this.selfTester.generateReport(),
    };
  }
}

/**
 * Codex 执行器接口
 */
export interface CodexExecutor {
  execute(
    issueNumber: number,
    instruction: string
  ): Promise<{
    success: boolean;
    changes?: string[];
    error?: string;
  }>;
}

export default EvolutionLoop;

// 全局 EvolutionLoop 实例
let globalEvolutionLoop: EvolutionLoop | undefined;

/**
 * 获取全局 EvolutionLoop 实例
 */
export function getEvolutionLoop(): EvolutionLoop | undefined {
  return globalEvolutionLoop;
}

/**
 * 设置全局 EvolutionLoop 实例
 */
export function setEvolutionLoop(loop: EvolutionLoop): void {
  globalEvolutionLoop = loop;
}
