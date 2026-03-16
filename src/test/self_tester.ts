import { exec as execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(execSync);

/**
 * 测试结果
 */
export interface TestResult {
  success: boolean;
  passed: number;
  failed: number;
  total: number;
  duration: number;
  details: TestDetail[];
  error?: string;
}

/**
 * 单个测试详情
 */
export interface TestDetail {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
}

/**
 * 代码质量检查结果
 */
export interface QualityResult {
  success: boolean;
  issues: QualityIssue[];
  score: number;
  summary: string;
}

/**
 * 代码质量问题
 */
export interface QualityIssue {
  severity: 'error' | 'warning' | 'info';
  file: string;
  line?: number;
  message: string;
  rule?: string;
}

/**
 * 构建结果
 */
export interface BuildResult {
  success: boolean;
  duration: number;
  output: string;
  errors: string[];
  warnings: string[];
  error?: string;
}

/**
 * 自我测试配置
 */
export interface SelfTestConfig {
  // OpenClaw 项目路径
  openclawPath: string;
  // 测试命令
  testCommand: string;
  // 构建命令
  buildCommand: string;
  // Lint 命令
  lintCommand?: string;
  // TypeScript 编译检查
  typeCheckCommand: string;
  // 是否在测试失败时阻止流程
  blockOnFailure: boolean;
  // 超时时间（毫秒）
  timeout: number;
}

/**
 * 自我测试器
 * 用于在 Codex 修改 OpenClaw 代码后自动运行测试验证修改是否正确
 */
export class SelfTester {
  private config: SelfTestConfig;
  private lastTestResult?: TestResult;
  private lastQualityResult?: QualityResult;
  private lastBuildResult?: BuildResult;

  constructor(config?: Partial<SelfTestConfig>) {
    this.config = {
      openclawPath: config?.openclawPath || path.join(__dirname, '../openclaw'),
      testCommand: config?.testCommand || 'npm run test',
      buildCommand: config?.buildCommand || 'npm run build',
      lintCommand: config?.lintCommand || 'npm run lint',
      typeCheckCommand: config?.typeCheckCommand || 'npx tsc --noEmit',
      blockOnFailure: config?.blockOnFailure ?? true,
      timeout: config?.timeout || 300000 // 默认 5 分钟
    };
  }

  /**
   * 运行所有测试
   */
  async runTests(): Promise<TestResult> {
    console.log('[SelfTester] 开始运行测试...');
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(this.config.testCommand, {
        cwd: this.config.openclawPath,
        timeout: this.config.timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });

      const duration = Date.now() - startTime;
      const result = this.parseTestOutput(stdout + stderr);
      
      this.lastTestResult = {
        ...result,
        duration,
        success: result.failed === 0
      };

      console.log(`[SelfTester] 测试完成: ${result.passed}/${result.total} 通过, 耗时 ${duration}ms`);
      return this.lastTestResult;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error('[SelfTester] 测试执行失败:', error.message);
      
      this.lastTestResult = {
        success: false,
        passed: 0,
        failed: 1,
        total: 1,
        duration,
        details: [{
          name: 'Test Suite',
          status: 'fail',
          error: error.message
        }],
        error: error.message
      };

      return this.lastTestResult;
    }
  }

  /**
   * 解析测试输出
   */
  private parseTestOutput(output: string): TestResult {
    const details: TestDetail[] = [];
    let passed = 0;
    let failed = 0;
    let total = 0;

    // 解析 vitest 输出
    const passMatch = output.match(/✓\s+(\d+)\s+passed/g);
    const failMatch = output.match(/✗\s+(\d+)\s+failed/g);
    const totalMatch = output.match(/(\d+)\s+tests?\s+(run|completed)/i);

    if (passMatch) {
      passed = passMatch.length;
    }
    if (failMatch) {
      failed = failMatch.length;
    }
    if (totalMatch) {
      total = parseInt(totalMatch[1]);
    }

    // 尝试解析更详细的输出
    const testNameMatches = output.match(/✓\s+(.+)/g);
    const failNameMatches = output.match(/✗\s+(.+)/g);

    if (testNameMatches) {
      testNameMatches.forEach(match => {
        const name = match.replace(/^✓\s+/, '').trim();
        details.push({ name, status: 'pass' });
      });
    }

    if (failNameMatches) {
      failNameMatches.forEach(match => {
        const name = match.replace(/^✗\s+/, '').trim();
        details.push({ name, status: 'fail' });
      });
    }

    // 如果无法解析详细信息，基于统计
    if (details.length === 0) {
      if (output.includes('passing') || output.includes('passed')) {
        details.push({ name: 'All Tests', status: 'pass' });
        passed = total = 1;
      } else if (output.includes('failing') || output.includes('failed')) {
        details.push({ name: 'Test Suite', status: 'fail' });
        failed = total = 1;
      }
    }

    return {
      success: failed === 0,
      passed: passed || 0,
      failed: failed || 0,
      total: total || (passed + failed),
      duration: 0,
      details
    };
  }

  /**
   * 检查代码质量
   */
  async checkCodeQuality(): Promise<QualityResult> {
    console.log('[SelfTester] 开始代码质量检查...');
    const issues: QualityIssue[] = [];

    try {
      // TypeScript 类型检查
      const typeCheckResult = await this.runTypeCheck();
      issues.push(...typeCheckResult.issues);

      // 可选的 Lint 检查
      if (this.config.lintCommand) {
        try {
          const { stdout, stderr } = await execAsync(this.config.lintCommand, {
            cwd: this.config.openclawPath,
            timeout: this.config.timeout,
            maxBuffer: 10 * 1024 * 1024
          });
          
          const lintIssues = this.parseLintOutput(stdout + stderr);
          issues.push(...lintIssues);
        } catch (error: any) {
          // Lint 失败不一定会阻止流程
          console.log('[SelfTester] Lint 检查跳过:', error.message);
        }
      }

      const score = this.calculateQualityScore(issues);
      const summary = this.generateQualitySummary(issues);

      this.lastQualityResult = {
        success: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        score,
        summary
      };

      console.log(`[SelfTester] 代码质量检查完成: 得分 ${score}, ${issues.length} 个问题`);
      return this.lastQualityResult;

    } catch (error: any) {
      console.error('[SelfTester] 代码质量检查失败:', error.message);
      
      this.lastQualityResult = {
        success: false,
        issues: [{
          severity: 'error',
          file: 'unknown',
          message: error.message
        }],
        score: 0,
        summary: '检查失败'
      };

      return this.lastQualityResult;
    }
  }

  /**
   * 运行 TypeScript 类型检查
   */
  private async runTypeCheck(): Promise<{ issues: QualityIssue[] }> {
    const issues: QualityIssue[] = [];

    try {
      const { stdout, stderr } = await execAsync(this.config.typeCheckCommand, {
        cwd: this.config.openclawPath,
        timeout: this.config.timeout,
        maxBuffer: 10 * 1024 * 1024
      });

      const output = stdout + stderr;
      const tsErrors = this.parseTypeScriptErrors(output);
      issues.push(...tsErrors);

    } catch (error: any) {
      // TypeScript 编译失败
      const output = error.stdout + error.stderr;
      const tsErrors = this.parseTypeScriptErrors(output);
      issues.push(...tsErrors);
    }

    return { issues };
  }

  /**
   * 解析 TypeScript 错误
   */
  private parseTypeScriptErrors(output: string): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const lines = output.split('\n');

    // 匹配格式: file.ts(line,col): error TS1234: message
    const regex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        issues.push({
          severity: match[4] as 'error' | 'warning',
          file: match[1],
          line: parseInt(match[2]),
          message: match[6],
          rule: match[5]
        });
      }
    }

    return issues;
  }

  /**
   * 解析 Lint 输出
   */
  private parseLintOutput(output: string): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // 简单解析 ESLint 格式
      const match = line.match(/^(.+?):(\d+):(\d+):\s+(.+)$/);
      if (match) {
        issues.push({
          severity: 'warning',
          file: match[1],
          line: parseInt(match[2]),
          message: match[4]
        });
      }
    }

    return issues;
  }

  /**
   * 计算质量得分 (0-100)
   */
  private calculateQualityScore(issues: QualityIssue[]): number {
    let score = 100;
    
    for (const issue of issues) {
      switch (issue.severity) {
        case 'error':
          score -= 10;
          break;
        case 'warning':
          score -= 2;
          break;
        case 'info':
          score -= 0.5;
          break;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 生成质量摘要
   */
  private generateQualitySummary(issues: QualityIssue[]): string {
    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos = issues.filter(i => i.severity === 'info').length;

    if (errors === 0 && warnings === 0 && infos === 0) {
      return '代码质量良好';
    }

    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} 个错误`);
    if (warnings > 0) parts.push(`${warnings} 个警告`);
    if (infos > 0) parts.push(`${infos} 个提示`);

    return parts.join(', ');
  }

  /**
   * 验证构建
   */
  async verifyBuild(): Promise<BuildResult> {
    console.log('[SelfTester] 开始构建验证...');
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(this.config.buildCommand, {
        cwd: this.config.openclawPath,
        timeout: this.config.timeout,
        maxBuffer: 10 * 1024 * 1024
      });

      const duration = Date.now() - startTime;
      const output = stdout + stderr;
      const errors = this.extractBuildErrors(output);
      const warnings = this.extractBuildWarnings(output);

      const success = errors.length === 0;

      this.lastBuildResult = {
        success,
        duration,
        output,
        errors,
        warnings
      };

      console.log(`[SelfTester] 构建完成: ${success ? '成功' : '失败'}, 耗时 ${duration}ms`);
      return this.lastBuildResult;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const output = error.stdout + error.stderr;
      const errors = this.extractBuildErrors(output);
      const warnings = this.extractBuildWarnings(output);

      console.error('[SelfTester] 构建失败:', error.message);

      this.lastBuildResult = {
        success: false,
        duration,
        output,
        errors,
        warnings,
        error: error.message
      };

      return this.lastBuildResult;
    }
  }

  /**
   * 提取构建错误
   */
  private extractBuildErrors(output: string): string[] {
    const errors: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.toLowerCase().includes('error') && !line.toLowerCase().includes('warning')) {
        errors.push(line.trim());
      }
    }

    return errors.slice(0, 50); // 最多 50 个
  }

  /**
   * 提取构建警告
   */
  private extractBuildWarnings(output: string): string[] {
    const warnings: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.toLowerCase().includes('warning')) {
        warnings.push(line.trim());
      }
    }

    return warnings.slice(0, 50);
  }

  /**
   * 运行完整验证流程
   * 修改 → 测试 → 质量检查 → 构建
   */
  async runFullValidation(): Promise<{
    success: boolean;
    testResult?: TestResult;
    qualityResult?: QualityResult;
    buildResult?: BuildResult;
    canProceed: boolean;
  }> {
    console.log('[SelfTester] ==================== 开始完整验证流程 ====================');

    // 1. 先验证构建
    const buildResult = await this.verifyBuild();
    if (!buildResult.success) {
      console.error('[SelfTester] 构建失败，跳过测试');
      return {
        success: false,
        buildResult,
        canProceed: this.config.blockOnFailure ? false : true
      };
    }

    // 2. 运行测试
    const testResult = await this.runTests();
    
    // 3. 代码质量检查
    const qualityResult = await this.checkCodeQuality();

    // 综合判断
    const allPassed = testResult.success && qualityResult.success && buildResult.success;
    
    console.log('[SelfTester] ==================== 验证完成 ====================');
    console.log(`[SelfTester] 测试: ${testResult.success ? '✓' : '✗'}, 质量: ${qualityResult.success ? '✓' : '✗'}, 构建: ${buildResult.success ? '✓' : '✗'}`);

    return {
      success: allPassed,
      testResult,
      qualityResult,
      buildResult,
      canProceed: allPassed || !this.config.blockOnFailure
    };
  }

  /**
   * 获取上一次的测试结果
   */
  getLastTestResult(): TestResult | undefined {
    return this.lastTestResult;
  }

  /**
   * 获取上一次的代码质量结果
   */
  getLastQualityResult(): QualityResult | undefined {
    return this.lastQualityResult;
  }

  /**
   * 获取上一次的构建结果
   */
  getLastBuildResult(): BuildResult | undefined {
    return this.lastBuildResult;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SelfTestConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 生成测试报告
   */
  generateReport(): string {
    const lines: string[] = [];
    lines.push('='.repeat(50));
    lines.push('Nexus Agent 自我测试报告');
    lines.push('='.repeat(50));
    lines.push('');

    // 测试结果
    if (this.lastTestResult) {
      lines.push('【测试结果】');
      lines.push(`  状态: ${this.lastTestResult.success ? '✓ 通过' : '✗ 失败'}`);
      lines.push(`  通过: ${this.lastTestResult.passed}/${this.lastTestResult.total}`);
      lines.push(`  失败: ${this.lastTestResult.failed}`);
      lines.push(`  耗时: ${this.lastTestResult.duration}ms`);
      lines.push('');
    }

    // 代码质量
    if (this.lastQualityResult) {
      lines.push('【代码质量】');
      lines.push(`  得分: ${this.lastQualityResult.score}/100`);
      lines.push(`  状态: ${this.lastQualityResult.success ? '✓ 通过' : '✗ 失败'}`);
      lines.push(`  摘要: ${this.lastQualityResult.summary}`);
      if (this.lastQualityResult.issues.length > 0) {
        lines.push('  问题列表:');
        for (const issue of this.lastQualityResult.issues.slice(0, 10)) {
          lines.push(`    - [${issue.severity}] ${issue.file}${issue.line ? `:${issue.line}` : ''}: ${issue.message}`);
        }
        if (this.lastQualityResult.issues.length > 10) {
          lines.push(`    ... 还有 ${this.lastQualityResult.issues.length - 10} 个问题`);
        }
      }
      lines.push('');
    }

    // 构建结果
    if (this.lastBuildResult) {
      lines.push('【构建结果】');
      lines.push(`  状态: ${this.lastBuildResult.success ? '✓ 成功' : '✗ 失败'}`);
      lines.push(`  耗时: ${this.lastBuildResult.duration}ms`);
      if (this.lastBuildResult.errors.length > 0) {
        lines.push('  错误:');
        for (const error of this.lastBuildResult.errors.slice(0, 5)) {
          lines.push(`    - ${error}`);
        }
      }
      lines.push('');
    }

    lines.push('='.repeat(50));

    return lines.join('\n');
  }
}

export default SelfTester;
