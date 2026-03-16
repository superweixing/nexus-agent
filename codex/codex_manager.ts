/**
 * Nexus Agent - Codex Manager
 * 
 * Codex 管理模块，负责代码修改和任务执行
 * 整合 OpenAI Codex CLI 功能
 * 
 * 架构：
 *   Nexus (决策) → Codex (修改工具) → 修改 → openclaw/ (代码库)
 * 
 * 错误处理：
 *   - 重试机制（指数退避）
 *   - 优雅降级（失败时跳过修改）
 *   - 详细错误日志
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

// 导入错误处理模块
import { 
  ErrorHandler, 
  getErrorHandler, 
  withRetry,
  NexusError,
  CodeError,
  TimeoutError,
  NetworkError,
  ErrorCategory,
  DEFAULT_RETRY_CONFIG,
  CodexSkipStrategy
} from '../src/error';

const exec = promisify(execCallback);

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CodexTask {
  id?: string;
  prompt: string;
  files?: string[];
  directory?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModificationResult {
  success: boolean;
  taskId: string;
  output?: string;
  filesModified?: string[];
  error?: string;
  executionTime: number;
}

export interface TaskResult {
  success: boolean;
  taskId: string;
  output?: string;
  filesModified?: string[];
  error?: string;
  executionTime: number;
  metrics?: {
    llmCalls: number;
    tokensUsed: number;
    cost: number;
    filesEdited: number;
  };
}

export interface CodexStatus {
  installed: boolean;
  version?: string;
  path?: string;
  availableModels?: string[];
  error?: string;
}

export interface CodexManagerConfig {
  codexPath?: string;
  defaultModel?: string;
  workingDirectory?: string;
  timeout?: number;
  autoInstall?: boolean;
  openclawPath?: string;
  // 错误处理配置
  maxRetries?: number;
  retryDelayMs?: number;
}

// ============================================================================
// Codex Manager Class
// ============================================================================

export class CodexManager {
  private config: CodexManagerConfig;
  private codexPath: string;
  private defaultModel: string;
  private workingDirectory: string;
  private timeout: number;
  private autoInstall: boolean;
  private openclawPath: string;
  
  // 错误处理器
  private errorHandler: ErrorHandler;
  
  constructor(config: CodexManagerConfig = {}) {
    this.config = config;
    this.codexPath = config.codexPath || 'codex';
    this.defaultModel = config.defaultModel || 'claude-sonnet-4-20250514';
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.timeout = config.timeout || 300000; // 5 minutes
    this.autoInstall = config.autoInstall ?? true;
    this.openclawPath = config.openclawPath || '/home/weixing/.openclaw/workspace/nexus-agent/openclaw';
    
    // 初始化错误处理器
    this.errorHandler = getErrorHandler({
      maxRetries: config.maxRetries || 3,
      initialDelayMs: config.retryDelayMs || 1000,
      retryableErrors: [
        ErrorCategory.NETWORK,
        ErrorCategory.API,
        ErrorCategory.TIMEOUT
      ]
    });
  }

  // ========================================================================
  // Status & Installation
  // ========================================================================

  /**
   * 检查 Codex 是否可用
   */
  async checkAvailable(): Promise<boolean> {
    try {
      await exec(`${this.codexPath} --version`, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 Codex 状态
   */
  async getStatus(): Promise<CodexStatus> {
    try {
      const { stdout } = await exec(`${this.codexPath} --version`, {
        timeout: 10000
      });
      
      const version = stdout.trim();
      return {
        installed: true,
        version,
        path: this.codexPath,
        availableModels: await this.listModels()
      };
    } catch (error) {
      return {
        installed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 安装 Codex
   */
  async install(): Promise<void> {
    try {
      // Try npm global install
      await exec('npm install -g @openai/codex', { timeout: 120000 });
      console.log('[CodexManager] Codex 已通过 npm 安装');
    } catch (npmError) {
      try {
        // Try brew install (macOS)
        await exec('brew install --cask codex', { timeout: 120000 });
        console.log('[CodexManager] Codex 已通过 brew 安装');
      } catch (brewError) {
        throw new Error('Codex 安装失败，请手动运行: npm install -g @openai/codex');
      }
    }
  }

  /**
   * 确保 Codex 可用，如未安装则尝试安装
   */
  async ensureAvailable(): Promise<boolean> {
    const available = await this.checkAvailable();
    
    if (!available && this.autoInstall) {
      console.log('[CodexManager] Codex 不可用，尝试安装...');
      try {
        await this.install();
        return await this.checkAvailable();
      } catch (error) {
        console.error('[CodexManager] 自动安装失败:', error);
        return false;
      }
    }
    
    return available;
  }

  /**
   * 列出可用模型
   */
  async listModels(): Promise<string[]> {
    try {
      const { stdout } = await exec(`${this.codexPath} model list`, {
        timeout: 30000
      });
      
      const models: string[] = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('=') && !trimmed.startsWith('Model')) {
          const model = trimmed.split(/\s+/)[0];
          if (model) models.push(model);
        }
      }
      return models.length > 0 ? models : ['claude-sonnet-4-20250514', 'gpt-5'];
    } catch {
      return ['claude-sonnet-4-20250514', 'gpt-5'];
    }
  }

  // ========================================================================
  // Code Modification
  // ========================================================================

  /**
   * 修改 OpenClaw 代码（带重试和优雅降级）
   * @param targetPath 目标文件路径（相对于 openclaw 目录）
   * @param instruction 修改指令
   */
  async modifyCode(targetPath: string, instruction: string): Promise<ModificationResult> {
    const taskId = `modify-${Date.now()}`;
    const startTime = Date.now();
    const fullPath = path.join(this.openclawPath, targetPath);
    
    // 确保目标目录存在
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    try {
      // 使用重试机制执行
      const result = await withRetry<ModificationResult>(
        async () => {
          // 构建修改指令
          const prompt = `请根据以下指令修改文件: ${targetPath}\n\n指令: ${instruction}\n\n请直接修改文件，不要输出其他内容。`;

          // 执行 Codex
          const output = await this.runCodexPrompt(prompt, [targetPath]);

          // 检测修改的文件
          const filesModified = this.detectModifiedFiles(output);
          // 确保目标文件被记录
          if (!filesModified.includes(targetPath)) {
            filesModified.push(targetPath);
          }

          return {
            success: true,
            taskId,
            output,
            filesModified,
            executionTime: Date.now() - startTime
          };
        },
        {
          maxRetries: this.config.maxRetries || 2,
          initialDelayMs: this.config.retryDelayMs || 1000
        },
        this.errorHandler,
        { module: 'CodexManager', action: 'modifyCode', targetPath, instruction }
      );

      return result;
    } catch (error: any) {
      // 优雅降级：Codex 失败时返回跳过结果
      this.errorHandler.handleError(error, {
        module: 'CodexManager',
        action: 'modifyCode',
        targetPath,
        instruction
      });

      console.warn(`[CodexManager] Codex 修改失败（已重试），跳过修改: ${error.message}`);
      
      return {
        success: false,
        taskId,
        error: 'Codex 修改失败，已跳过（优雅降级）',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * 批量修改多个文件
   */
  async modifyMultipleFiles(
    files: string[],
    instruction: string
  ): Promise<ModificationResult> {
    const taskId = `modify-multi-${Date.now()}`;
    const startTime = Date.now();

    try {
      const prompt = `请根据以下指令修改多个文件:\n\n文件列表: ${files.join(', ')}\n\n指令: ${instruction}`;

      const output = await this.runCodexPrompt(prompt, files);
      const filesModified = this.detectModifiedFiles(output);

      return {
        success: true,
        taskId,
        output,
        filesModified: filesModified.length > 0 ? filesModified : files,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  // ========================================================================
  // Task Execution
  // ========================================================================

  /**
   * 执行任务（带重试和优雅降级）
   */
  async executeTask(task: string): Promise<TaskResult> {
    const taskId = `task-${Date.now()}`;
    const startTime = Date.now();

    try {
      // 使用重试机制执行
      const result = await withRetry<TaskResult>(
        async () => {
          const output = await this.runCodexPrompt(task);
          const filesModified = this.detectModifiedFiles(output);

          return {
            success: true,
            taskId,
            output,
            filesModified,
            executionTime: Date.now() - startTime,
            metrics: {
              llmCalls: 1,
              tokensUsed: Math.floor(output.length / 4),
              cost: 0,
              filesEdited: filesModified.length
            }
          };
        },
        {
          maxRetries: this.config.maxRetries || 3,
          initialDelayMs: this.config.retryDelayMs || 1000,
          backoffMultiplier: 2,
          maxDelayMs: 30000
        },
        this.errorHandler,
        { module: 'CodexManager', action: 'executeTask', task }
      );

      return result;
    } catch (error: any) {
      // 优雅降级：Codex 失败时返回跳过结果
      this.errorHandler.handleError(error, {
        module: 'CodexManager',
        action: 'executeTask',
        task
      });

      console.warn(`[CodexManager] Codex 执行失败（已重试），跳过修改: ${error.message}`);
      
      return {
        success: false,
        taskId,
        output: '',
        filesModified: [],
        error: 'Codex 执行失败，已跳过修改（优雅降级）',
        executionTime: Date.now() - startTime,
        metrics: {
          llmCalls: 0,
          tokensUsed: 0,
          cost: 0,
          filesEdited: 0
        }
      };
    }
  }

  /**
   * 执行带上下文的复杂任务
   */
  async executeComplexTask(
    task: string,
    context: {
      files?: string[];
      directory?: string;
      model?: string;
    }
  ): Promise<TaskResult> {
    const taskId = `complex-${Date.now()}`;
    const startTime = Date.now();
    const workDir = context.directory || this.openclawPath;

    try {
      const cmd = this.buildCommand({
        prompt: task,
        files: context.files,
        model: context.model || this.defaultModel
      });

      const output = await this.runCodex(cmd, workDir);
      const filesModified = this.detectModifiedFiles(output);

      return {
        success: true,
        taskId,
        output,
        filesModified,
        executionTime: Date.now() - startTime,
        metrics: {
          llmCalls: 1,
          tokensUsed: Math.floor(output.length / 4),
          cost: 0,
          filesEdited: filesModified.length
        }
      };
    } catch (error) {
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  // ========================================================================
  // Utility Methods
  // ========================================================================

  /**
   * 获取安装说明
   */
  getInstallInstructions(): string {
    return `
OpenAI Codex CLI 安装说明
==========================

方式1 - npm:
  npm install -g @openai/codex

方式2 - Homebrew (macOS):
  brew install --cask codex

方式3 - 直接下载:
  访问 https://github.com/openai/codex/releases

安装后认证:
  codex auth login

查看可用模型:
  codex model list
`;
  }

  /**
   * 获取 OpenClaw 路径
   */
  getOpenClawPath(): string {
    return this.openclawPath;
  }

  /**
   * 设置 OpenClaw 路径
   */
  setOpenClawPath(newPath: string): void {
    this.openclawPath = newPath;
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private buildCommand(task: CodexTask): string[] {
    const cmd: string[] = [this.codexPath];
    
    if (task.model) {
      cmd.push('--model', task.model);
    }
    
    if (task.temperature !== undefined) {
      cmd.push('--temperature', task.temperature.toString());
    }
    
    if (task.maxTokens) {
      cmd.push('--max-tokens', task.maxTokens.toString());
    }
    
    cmd.push('--prompt', task.prompt);
    
    if (task.files && task.files.length > 0) {
      cmd.push('--files', task.files.join(','));
    }
    
    return cmd;
  }

  private async runCodexPrompt(prompt: string, files?: string[]): Promise<string> {
    const args = this.buildCommand({ prompt, files });
    return this.runCodex(args, this.openclawPath);
  }

  private async runCodex(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(args[0], args.slice(1), {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('Codex execution timeout'));
      }, this.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Codex exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private detectModifiedFiles(output: string): string[] {
    const files: string[] = [];
    const patterns = [
      /modified:\s*(.+)/gi,
      /edited:\s*(.+)/gi,
      /changed:\s*(.+)/gi,
      /File:\s*(.+)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const file = match[1].trim();
        if (file && !files.includes(file)) {
          files.push(file);
        }
      }
    }

    return files;
  }
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let codexManagerInstance: CodexManager | null = null;

/**
 * 获取 CodexManager 单例
 */
export function getCodexManager(config?: CodexManagerConfig): CodexManager {
  if (!codexManagerInstance) {
    codexManagerInstance = new CodexManager(config);
  }
  return codexManagerInstance;
}

/**
 * 创建 CodexManager 实例
 */
export function createCodexManager(config: CodexManagerConfig): CodexManager {
  return new CodexManager(config);
}

export default CodexManager;
