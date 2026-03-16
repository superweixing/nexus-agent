/**
 * Nexus Agent - Security Manager
 *
 * 安全管理器，负责安全边界、沙箱限制和操作审计
 * 整合到 CodexManager 以确保代码修改的安全性
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { OperationLogger, OperationType, OperationResult } from './operation_logger';

export interface SecurityConfig {
  allowedDirectories: string[];
  forbiddenDirectories: string[];
  allowedExtensions: string[];
  forbiddenPatterns: string[];
  enabled: boolean;
  sandboxMode: boolean;
  logOperations: boolean;
}

export interface SandboxConfig {
  forbidDangerousCommands: boolean;
  forbidDelete: {
    enabled: boolean;
    exceptions: string[];
  };
  forbidSystemFiles: boolean;
  restrictNetwork: boolean;
}

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  blockedPattern?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Security Manager Class
// ============================================================================

export class SecurityManager {
  private securityConfig: SecurityConfig;
  private sandboxConfig: SandboxConfig;
  private operationLogger: OperationLogger;
  private basePath: string;

  constructor(
    securityConfig: SecurityConfig,
    sandboxConfig: SandboxConfig,
    basePath: string = '/home/weixing/.openclaw/workspace/nexus-agent'
  ) {
    this.securityConfig = securityConfig;
    this.sandboxConfig = sandboxConfig;
    this.basePath = basePath;
    this.operationLogger = new OperationLogger();
  }

  // ========================================================================
  // Security Check Methods
  // ========================================================================

  /**
   * 检查文件路径是否在允许的目录范围内
   */
  checkDirectoryAccess(filePath: string): SecurityCheckResult {
    if (!this.securityConfig.enabled) {
      return { allowed: true };
    }

    const normalizedPath = path.normalize(filePath);
    const absolutePath = path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.resolve(this.basePath, normalizedPath);

    // 检查是否在允许的目录中
    for (const allowedDir of this.securityConfig.allowedDirectories) {
      const normalizedAllowed = path.normalize(allowedDir);
      if (absolutePath.startsWith(normalizedAllowed) || absolutePath === normalizedAllowed) {
        return { allowed: true };
      }
    }

    // 检查是否在禁止的目录中
    for (const forbiddenDir of this.securityConfig.forbiddenDirectories) {
      const normalizedForbidden = path.normalize(forbiddenDir);
      if (absolutePath.startsWith(normalizedForbidden)) {
        return {
          allowed: false,
          reason: `路径位于禁止目录: ${forbiddenDir}`,
          blockedPattern: forbiddenDir,
        };
      }
    }

    return {
      allowed: false,
      reason: `路径不在允许的目录范围内: ${filePath}`,
      blockedPattern: 'directory_whitelist',
    };
  }

  /**
   * 检查文件扩展名是否允许
   */
  checkFileExtension(filePath: string): SecurityCheckResult {
    if (!this.securityConfig.enabled) {
      return { allowed: true };
    }

    const ext = path.extname(filePath).toLowerCase();

    if (this.securityConfig.allowedExtensions.includes(ext)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `不允许的文件扩展名: ${ext}`,
      blockedPattern: ext,
    };
  }

  /**
   * 检查文件是否匹配禁止的模式
   */
  checkForbiddenPatterns(filePath: string): SecurityCheckResult {
    if (!this.securityConfig.enabled) {
      return { allowed: true };
    }

    const normalizedPath = path.normalize(filePath);
    const filename = path.basename(normalizedPath).toLowerCase();

    for (const pattern of this.securityConfig.forbiddenPatterns) {
      // 支持通配符模式
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        if (regex.test(filename) || regex.test(normalizedPath)) {
          return {
            allowed: false,
            reason: `文件匹配禁止模式: ${pattern}`,
            blockedPattern: pattern,
          };
        }
      } else if (normalizedPath.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          allowed: false,
          reason: `文件包含禁止内容: ${pattern}`,
          blockedPattern: pattern,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 综合安全检查
   */
  validateFileAccess(filePath: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 目录检查
    const dirCheck = this.checkDirectoryAccess(filePath);
    if (!dirCheck.allowed) {
      errors.push(dirCheck.reason || '目录检查失败');
    }

    // 扩展名检查
    const extCheck = this.checkFileExtension(filePath);
    if (!extCheck.allowed) {
      errors.push(extCheck.reason || '扩展名检查失败');
    }

    // 禁止模式检查
    const patternCheck = this.checkForbiddenPatterns(filePath);
    if (!patternCheck.allowed) {
      errors.push(patternCheck.reason || '模式检查失败');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查多个文件
   */
  validateMultipleFiles(filePaths: string[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const filePath of filePaths) {
      const result = this.validateFileAccess(filePath);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ========================================================================
  // Command Validation
  // ========================================================================

  /**
   * 检查命令是否危险
   */
  checkDangerousCommand(command: string): SecurityCheckResult {
    if (!this.sandboxConfig.forbidDangerousCommands) {
      return { allowed: true };
    }

    const dangerousPatterns = [
      /rm\s+-rf/i,
      /dd\s+if=/i,
      /mkfs/i,
      /format/i,
      />:?\s*\/dev\//i,
      /chmod\s+-R\s+777/i,
      /chown\s+-R/i,
      /wget.*\|.*sh/i,
      /curl.*\|.*sh/i,
      /;\s*rm\s+/i,
      /\|\s*rm\s+/i,
      /fork\(\)/i,
      /:\(\)\{.*:\|:&\}/i, // fork 炸弹
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: `检测到危险命令: ${command.substring(0, 50)}...`,
          blockedPattern: pattern.source,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 检查删除操作是否允许
   */
  checkDeleteOperation(filePath: string): SecurityCheckResult {
    if (!this.sandboxConfig.forbidDelete.enabled) {
      return { allowed: true };
    }

    // 检查是否在例外列表中
    for (const exception of this.sandboxConfig.forbidDelete.exceptions) {
      if (filePath.startsWith(exception)) {
        return { allowed: true };
      }
    }

    // 检查系统文件
    if (this.sandboxConfig.forbidSystemFiles) {
      const systemPaths = ['/etc', '/usr', '/bin', '/sbin', '/var', '/boot'];
      for (const sysPath of systemPaths) {
        if (filePath.startsWith(sysPath)) {
          return {
            allowed: false,
            reason: `禁止删除系统文件: ${filePath}`,
            blockedPattern: 'system_file',
          };
        }
      }
    }

    return { allowed: true };
  }

  // ========================================================================
  // Operation Logging
  // ========================================================================

  /**
   * 记录操作
   */
  async logOperation(
    operationType: OperationType,
    filePath: string,
    details: Record<string, unknown>,
    result: OperationResult
  ): Promise<void> {
    if (this.securityConfig.logOperations) {
      await this.operationLogger.log({
        type: operationType,
        filePath,
        details,
        result,
        timestamp: new Date(),
      });
    }
  }

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
    return this.operationLogger.query(options);
  }

  // ========================================================================
  // Rollback Support
  // ========================================================================

  /**
   * 创建文件快照（用于回滚）
   */
  async createSnapshot(filePath: string, operationId: string): Promise<boolean> {
    return this.operationLogger.createSnapshot(filePath, operationId);
  }

  /**
   * 回滚到指定快照
   */
  async rollbackToSnapshot(snapshotId: string): Promise<boolean> {
    return this.operationLogger.rollbackToSnapshot(snapshotId);
  }

  /**
   * 获取可用的快照列表
   */
  async listSnapshots(filePath?: string): Promise<unknown[]> {
    return this.operationLogger.listSnapshots(filePath);
  }

  // ========================================================================
  // Config Update
  // ========================================================================

  /**
   * 更新安全配置
   */
  updateSecurityConfig(config: Partial<SecurityConfig>): void {
    this.securityConfig = { ...this.securityConfig, ...config };
  }

  /**
   * 更新沙箱配置
   */
  updateSandboxConfig(config: Partial<SandboxConfig>): void {
    this.sandboxConfig = { ...this.sandboxConfig, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): { security: SecurityConfig; sandbox: SandboxConfig } {
    return {
      security: this.securityConfig,
      sandbox: this.sandboxConfig,
    };
  }
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let securityManagerInstance: SecurityManager | null = null;

/**
 * 加载 YAML 配置
 */
function loadYamlConfig(filePath: string): Record<string, unknown> {
  try {
    const fs = require('fs');
    const yaml = require('js-yaml');
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) as Record<string, unknown>;
  } catch (error) {
    console.error('[SecurityManager] 加载配置文件失败:', error);
    return {};
  }
}

/**
 * 创建 SecurityManager 实例
 */
export function createSecurityManager(configPath?: string): SecurityManager {
  const configFile = configPath || path.join(__dirname, '../../configs/security.yaml');

  const config = loadYamlConfig(configFile);

  const security = (config.security as SecurityConfig) || {
    allowedDirectories: ['/home/weixing/.openclaw/workspace/nexus-agent/openclaw'],
    forbiddenDirectories: ['/etc', '/usr', '/bin', '/sbin', '/var', '/root'],
    allowedExtensions: ['.ts', '.js', '.json', '.md', '.yaml', '.yml'],
    forbiddenPatterns: ['*.env', '*.key', '*.pem', 'credentials.json'],
    enabled: true,
    sandboxMode: true,
    logOperations: true,
  };

  const sandbox = (config.sandbox as SandboxConfig) || {
    forbidDangerousCommands: true,
    forbidDelete: { enabled: true, exceptions: [] },
    forbidSystemFiles: true,
    restrictNetwork: false,
  };

  return new SecurityManager(security, sandbox);
}

/**
 * 获取 SecurityManager 单例
 */
export function getSecurityManager(configPath?: string): SecurityManager {
  if (!securityManagerInstance) {
    securityManagerInstance = createSecurityManager(configPath);
  }
  return securityManagerInstance;
}

export default SecurityManager;
