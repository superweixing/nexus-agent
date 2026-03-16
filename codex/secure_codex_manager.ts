/**
 * Nexus Agent - Secure Codex Manager
 * 
 * 带安全增强的 Codex 管理模块
 * 整合了安全边界、沙箱限制和操作日志功能
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SecurityManager,
  getSecurityManager,
  OperationType
} from '../src/security';

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
  blocked?: boolean;
  securityErrors?: string[];
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
  blocked?: boolean;
  securityErrors?: string[];
}

export interface CodexStatus {
  installed: boolean;
  version?: string;
  path?: string;
  availableModels?: string[];
  error?: string;
}

export interface SecureCodexManagerConfig {
  codexPath?: string;
  defaultModel?: string;
  workingDirectory?: string;
  timeout?: number;
  autoInstall?: boolean;
  openclawPath?: string;
  securityConfigPath?: string;
  enableSecurity?: boolean;
}

// ============================================================================
// Secure Codex Manager Class
// ============================================================================

export class SecureCodexManager {
  private config: SecureCodexManagerConfig;
  private codexPath: string;
  private defaultModel: string;
  private workingDirectory: string;
  private timeout: number;
  private autoInstall: boolean;
  private openclawPath: string;
  private securityManager: SecurityManager;
  private enableSecurity: boolean;
  
  constructor(config: SecureCodexManagerConfig = {}) {
    this.config = config;
    this.codexPath = config.codexPath || 'codex';
    this.defaultModel = config.defaultModel || 'claude-sonnet-4-20250514';
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.timeout = config.timeout || 300000; // 5 minutes
    this.autoInstall = config.autoInstall ?? true;
    this.openclawPath = config.openclawPath || '/home/weixing/.openclaw/workspace/nexus-agent/openclaw';
    this.enableSecurity = config.enableSecurity ?? true;
    
    // 初始化安全管理器
    this.securityManager = getSecurityManager(config.securityConfigPath);
  }

  // ========================================================================
  // Security Integration
  // ========================================================================

  /**
   * 安全检查单个文件
   */
  private async checkFileSecurity(filePath: string, operationType: OperationType): Promise<{
    allowed: boolean;
    errors: string[];
  }> {
    if (!this.enableSecurity) {
      return { allowed: true, errors: [] };
    }

    // 验证文件访问
    const validation = this.securityManager.validateFileAccess(filePath);
    
    if (!validation.valid) {
      // 记录被阻止的操作
      await this.securityManager.logOperation(
        operationType,
        filePath,
        { operation: 'security_check', reason: 'validation_failed' },
        'blocked'
      );
      
      return { allowed: false, errors: validation.errors };
    }

    // 检查删除操作
    if (operationType === 'file_delete') {
      const deleteCheck = this.securityManager.checkDeleteOperation(filePath);
      if (!deleteCheck.allowed) {
        await this.securityManager.logOperation(
          operationType,
          filePath,
          { operation: 'delete_check', reason: deleteCheck.reason },
          'blocked'
        );
        return { allowed: false, errors: [deleteCheck.reason || '删除操作被禁止'] };
      }
    }

    return { allowed: true, errors: [] };
  }

  /**
   * 安全检查多个文件
   */
  private async checkFilesSecurity(
    filePaths: string[],
    operationType: OperationType
  ): Promise<{
    allowed: boolean;
    errors: string[];
    blockedFiles: string[];
  }> {
    const allErrors: string[] = [];
    const blockedFiles: string[] = [];

    for (const filePath of filePaths) {
      const check = await this.checkFileSecurity(filePath, operationType);
      if (!check.allowed) {
        blockedFiles.push(filePath);
        allErrors.push(...check.errors);
      }
    }

    return {
      allowed: blockedFiles.length === 0,
      errors: allErrors,
      blockedFiles
    };
  }

  /**
   * 创建文件快照（用于回滚）
   */
  private async createFileSnapshot(filePath: string, taskId: string): Promise<void> {
    try {
      await this.securityManager.createSnapshot(filePath, taskId);
    } catch (error) {
      console.warn(`[SecureCodexManager] 创建快照失败: ${filePath}`, error);
    }
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
      await exec('npm install -g @openai/codex', { timeout: 120000 });
      console.log('[SecureCodexManager] Codex 已通过 npm 安装');
    } catch (npmError) {
      try {
        await exec('brew install --cask codex', { timeout: 120000 });
        console.log('[SecureCodexManager] Codex 已通过 brew 安装');
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
      console.log('[SecureCodexManager] Codex 不可用，尝试安装...');
      try {
        await this.install();
        return await this.checkAvailable();
      } catch (error) {
        console.error('[SecureCodexManager] 自动安装失败:', error);
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
  // Secure Code Modification
  // ========================================================================

  /**
   * 安全修改 OpenClaw 代码
   * @param targetPath 目标文件路径（相对于 openclaw 目录）
   * @param instruction 修改指令
   */
  async modifyCode(targetPath: string, instruction: string): Promise<ModificationResult> {
    const taskId = `modify-${Date.now()}`;
    const startTime = Date.now();
    const fullPath = path.join(this.openclawPath, targetPath);
    
    // 安全检查
    const securityCheck = await this.checkFileSecurity(fullPath, 'file_modify');
    if (!securityCheck.allowed) {
      await this.securityManager.logOperation(
        'file_modify',
        fullPath,
        { instruction, taskId, reason: 'security_blocked' },
        'blocked'
      );
      
      return {
        success: false,
        taskId,
        error: `安全检查失败: ${securityCheck.errors.join(', ')}`,
        executionTime: Date.now() - startTime,
        blocked: true,
        securityErrors: securityCheck.errors
      };
    }

    // 创建修改前的快照
    await this.createFileSnapshot(fullPath, taskId);

    try {
      // 确保目标目录存在
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

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

      // 记录成功操作
      await this.securityManager.logOperation(
        'file_modify',
        fullPath,
        { instruction, taskId, output: output.substring(0, 500) },
        'success'
      );

      return {
        success: true,
        taskId,
        output,
        filesModified,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      // 记录失败操作
      await this.securityManager.logOperation(
        'file_modify',
        fullPath,
        { instruction, taskId, error: error instanceof Error ? error.message : 'Unknown' },
        'failure'
      );
      
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * 安全批量修改多个文件
   */
  async modifyMultipleFiles(
    files: string[],
    instruction: string
  ): Promise<ModificationResult> {
    const taskId = `modify-multi-${Date.now()}`;
    const startTime = Date.now();
    
    // 转换为完整路径
    const fullPaths = files.map(f => path.join(this.openclawPath, f));
    
    // 安全检查所有文件
    const securityCheck = await this.checkFilesSecurity(fullPaths, 'file_modify');
    if (!securityCheck.allowed) {
      await this.securityManager.logOperation(
        'file_modify',
        fullPaths.join(', '),
        { instruction, taskId, reason: 'security_blocked', blockedFiles: securityCheck.blockedFiles },
        'blocked'
      );
      
      return {
        success: false,
        taskId,
        error: `安全检查失败: ${securityCheck.errors.join(', ')}`,
        filesModified: securityCheck.blockedFiles,
        executionTime: Date.now() - startTime,
        blocked: true,
        securityErrors: securityCheck.errors
      };
    }

    // 为所有文件创建快照
    for (const fullPath of fullPaths) {
      await this.createFileSnapshot(fullPath, taskId);
    }

    try {
      const prompt = `请根据以下指令修改多个文件:\n\n文件列表: ${files.join(', ')}\n\n指令: ${instruction}`;

      const output = await this.runCodexPrompt(prompt, files);
      const filesModified = this.detectModifiedFiles(output);

      // 记录成功操作
      await this.securityManager.logOperation(
        'file_modify',
        fullPaths.join(', '),
        { instruction, taskId },
        'success'
      );

      return {
        success: true,
        taskId,
        output,
        filesModified: filesModified.length > 0 ? filesModified : files,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      await this.securityManager.logOperation(
        'file_modify',
        fullPaths.join(', '),
        { instruction, taskId, error: error instanceof Error ? error.message : 'Unknown' },
        'failure'
      );
      
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  // ========================================================================
  // Secure Task Execution
  // ========================================================================

  /**
   * 安全执行任务
   */
  async executeTask(task: string): Promise<TaskResult> {
    const taskId = `task-${Date.now()}`;
    const startTime = Date.now();

    // 检查是否有危险命令
    if (this.enableSecurity) {
      const cmdCheck = this.securityManager.checkDangerousCommand(task);
      if (!cmdCheck.allowed) {
        await this.securityManager.logOperation(
          'command_execute',
          task,
          { taskId, reason: 'dangerous_command' },
          'blocked'
        );
        
        return {
          success: false,
          taskId,
          error: `命令被安全策略阻止: ${cmdCheck.reason}`,
          executionTime: Date.now() - startTime,
          blocked: true,
          securityErrors: [cmdCheck.reason || '危险命令']
        };
      }
    }

    try {
      const output = await this.runCodexPrompt(task);
      const filesModified = this.detectModifiedFiles(output);

      // 记录成功操作
      await this.securityManager.logOperation(
        'codex_task',
        this.openclawPath,
        { task, taskId, output: output.substring(0, 500) },
        'success'
      );

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
      await this.securityManager.logOperation(
        'command_execute',
        task,
        { taskId, error: error instanceof Error ? error.message : 'Unknown' },
        'failure'
      );
      
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * 安全执行带上下文的复杂任务
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

    // 如果指定了文件，进行安全检查
    if (context.files && context.files.length > 0) {
      const fullPaths = context.files.map(f => path.join(workDir, f));
      const securityCheck = await this.checkFilesSecurity(fullPaths, 'file_modify');
      
      if (!securityCheck.allowed) {
        await this.securityManager.logOperation(
          'codex_task',
          fullPaths.join(', '),
          { task, taskId, reason: 'security_blocked' },
          'blocked'
        );
        
        return {
          success: false,
          taskId,
          error: `安全检查失败: ${securityCheck.errors.join(', ')}`,
          executionTime: Date.now() - startTime,
          blocked: true,
          securityErrors: securityCheck.errors
        };
      }

      // 为所有文件创建快照
      for (const fullPath of fullPaths) {
        await this.createFileSnapshot(fullPath, taskId);
      }
    }

    try {
      const cmd = this.buildCommand({
        prompt: task,
        files: context.files,
        model: context.model || this.defaultModel
      });

      const output = await this.runCodex(cmd, workDir);
      const filesModified = this.detectModifiedFiles(output);

      await this.securityManager.logOperation(
        'codex_task',
        workDir,
        { task, taskId, context: { ...context, files: context.files } },
        'success'
      );

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
      await this.securityManager.logOperation(
        'codex_task',
        workDir,
        { task, taskId, error: error instanceof Error ? error.message : 'Unknown' },
        'failure'
      );
      
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  // ========================================================================
  // Rollback Support
  // ========================================================================

  /**
   * 获取可用的快照列表
   */
  async listSnapshots(filePath?: string): Promise<unknown[]> {
    return this.securityManager.listSnapshots(filePath);
  }

  /**
   * 回滚到指定快照
   */
  async rollbackToSnapshot(snapshotId: string): Promise<boolean> {
    return this.securityManager.rollbackToSnapshot(snapshotId);
  }

  // ========================================================================
  // Operation History
  // ========================================================================

  /**
   * 获取操作历史
   */
  async getOperationHistory(options?: {
    filePath?: string;
    operationType?: OperationType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<unknown[]> {
    return this.securityManager.getOperationHistory(options);
  }

  /**
   * 获取操作统计
   */
  async getOperationStatistics(startDate?: Date, endDate?: Date): Promise<Record<string, unknown>> {
    const logs = await this.securityManager.getOperationHistory({ startDate, endDate, limit: 10000 });
    
    const stats = {
      total: logs.length,
      byType: {} as Record<string, number>,
      byResult: {} as Record<string, number>,
      blocked: 0,
      success: 0,
      failure: 0
    };
    
    for (const log of logs as unknown as Array<{ type: string; result: string }>) {
      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
      stats.byResult[log.result] = (stats.byResult[log.result] || 0) + 1;
      
      if (log.result === 'blocked') stats.blocked++;
      if (log.result === 'success') stats.success++;
      if (log.result === 'failure') stats.failure++;
    }
    
    return stats;
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

  /**
   * 获取安全配置
   */
  getSecurityConfig(): unknown {
    return this.securityManager.getConfig();
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

let secureCodexManagerInstance: SecureCodexManager | null = null;

/**
 * 获取 SecureCodexManager 单例
 */
export function getSecureCodexManager(config?: SecureCodexManagerConfig): SecureCodexManager {
  if (!secureCodexManagerInstance) {
    secureCodexManagerInstance = new SecureCodexManager(config);
  }
  return secureCodexManagerInstance;
}

/**
 * 创建 SecureCodexManager 实例
 */
export function createSecureCodexManager(config: SecureCodexManagerConfig): SecureCodexManager {
  return new SecureCodexManager(config);
}

export default SecureCodexManager;
