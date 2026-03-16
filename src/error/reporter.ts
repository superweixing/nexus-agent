/**
 * 错误上报模块
 *
 * 支持多种上报方式：日志文件、控制台、飞书通知
 */

import * as fs from 'fs';
import * as path from 'path';
import { ErrorContext, ErrorSeverity } from './index';

// ============================================================================
// 配置
// ============================================================================

export interface ErrorReporterConfig {
  // 日志文件路径
  logFilePath?: string;
  // 是否启用控制台输出
  consoleOutput?: boolean;
  // 是否启用文件输出
  fileOutput?: boolean;
  // 错误上报阈值（低于此严重级别不上报）
  minSeverity?: ErrorSeverity;
  // 是否启用飞书通知
  feishuWebhook?: string;
  // 错误保留天数
  retentionDays?: number;
}

const DEFAULT_CONFIG: ErrorReporterConfig = {
  logFilePath: './logs/nexus-error.log',
  consoleOutput: true,
  fileOutput: true,
  minSeverity: ErrorSeverity.HIGH,
  retentionDays: 30,
};

// ============================================================================
// 错误日志类
// ============================================================================

export class ErrorReporter {
  private config: ErrorReporterConfig;
  private logStream?: fs.WriteStream;

  constructor(config: ErrorReporterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initLogFile();
  }

  /**
   * 初始化日志文件
   */
  private initLogFile(): void {
    if (!this.config.fileOutput || !this.config.logFilePath) {
      return;
    }

    try {
      // 确保目录存在
      const logDir = path.dirname(this.config.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // 创建写入流
      this.logStream = fs.createWriteStream(this.config.logFilePath, { flags: 'a' });

      console.log(`[ErrorReporter] 日志文件初始化: ${this.config.logFilePath}`);
    } catch (error) {
      console.error('[ErrorReporter] 初始化日志文件失败:', error);
    }
  }

  /**
   * 上报错误
   */
  async report(errorContext: ErrorContext, additionalInfo?: Record<string, any>): Promise<void> {
    // 检查严重级别
    if (!this.shouldReport(errorContext.severity)) {
      return;
    }

    const reportData = this.formatErrorReport(errorContext, additionalInfo);

    // 控制台输出
    if (this.config.consoleOutput) {
      this.logToConsole(reportData);
    }

    // 文件输出
    if (this.config.fileOutput && this.logStream) {
      this.logToFile(reportData);
    }

    // 飞书通知
    if (this.config.feishuWebhook && errorContext.severity === ErrorSeverity.CRITICAL) {
      await this.notifyFeishu(reportData);
    }
  }

  /**
   * 判断是否应该上报
   */
  private shouldReport(severity: ErrorSeverity): boolean {
    const severityOrder = [
      ErrorSeverity.LOW,
      ErrorSeverity.MEDIUM,
      ErrorSeverity.HIGH,
      ErrorSeverity.CRITICAL,
    ];

    const minIndex = severityOrder.indexOf(this.config.minSeverity || ErrorSeverity.HIGH);
    const currentIndex = severityOrder.indexOf(severity);

    return currentIndex >= minIndex;
  }

  /**
   * 格式化错误报告
   */
  private formatErrorReport(
    errorContext: ErrorContext,
    additionalInfo?: Record<string, any>
  ): string {
    const timestamp = new Date(errorContext.timestamp).toISOString();
    const severity = errorContext.severity;
    const category = errorContext.category;
    const message = errorContext.message;
    const context = { ...errorContext.context, ...additionalInfo };

    let report = '';
    report += `═══════════════════════════════════════════════════════\n`;
    report += `⏰ 时间: ${timestamp}\n`;
    report += `🔴 严重级别: ${severity}\n`;
    report += `📁 分类: ${category}\n`;
    report += `💬 消息: ${message}\n`;
    report += `🔄 可恢复: ${errorContext.recoverable ? '是' : '否'}\n`;
    report += `🔢 重试次数: ${errorContext.retries}\n`;

    if (errorContext.stack) {
      report += `\n📋 堆栈跟踪:\n${errorContext.stack}\n`;
    }

    if (context && Object.keys(context).length > 0) {
      report += `\n📝 上下文:\n${JSON.stringify(context, null, 2)}\n`;
    }

    report += `═══════════════════════════════════════════════════════\n`;

    return report;
  }

  /**
   * 输出到控制台
   */
  private logToConsole(report: string): void {
    console.error(report);
  }

  /**
   * 输出到文件
   */
  private logToFile(report: string): void {
    if (this.logStream) {
      this.logStream.write(report + '\n');
    }
  }

  /**
   * 飞书通知
   */
  private async notifyFeishu(report: string): Promise<void> {
    if (!this.config.feishuWebhook) {
      return;
    }

    try {
      // 截取关键信息
      const lines = report.split('\n');
      const time = lines.find(l => l.startsWith('⏰')) || '';
      const severity = lines.find(l => l.startsWith('🔴')) || '';
      const message = lines.find(l => l.startsWith('💬')) || '';

      const payload = {
        msg_type: 'post',
        content: {
          post: {
            zh_cn: {
              title: '🚨 Nexus Agent 严重错误',
              content: [
                [
                  { tag: 'text', text: time + '\n' },
                  { tag: 'text', text: severity + '\n' },
                  { tag: 'text', text: message + '\n' },
                  { tag: 'text', text: '详情请查看日志文件' },
                ],
              ],
            },
          },
        },
      };

      const response = await fetch(this.config.feishuWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error('[ErrorReporter] 飞书通知失败:', response.statusText);
      }
    } catch (error) {
      console.error('[ErrorReporter] 飞书通知异常:', error);
    }
  }

  /**
   * 清理过期日志
   */
  cleanOldLogs(): void {
    if (!this.config.logFilePath || !this.config.retentionDays) {
      return;
    }

    try {
      const logDir = path.dirname(this.config.logFilePath);
      const files = fs.readdirSync(logDir);

      const cutoffTime = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.log')) {
          continue;
        }

        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtimeMs < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log(`[ErrorReporter] 已删除过期日志: ${file}`);
        }
      }
    } catch (error) {
      console.error('[ErrorReporter] 清理日志失败:', error);
    }
  }

  /**
   * 获取错误日志文件路径
   */
  getLogFilePath(): string | undefined {
    return this.config.logFilePath;
  }

  /**
   * 关闭日志流
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = undefined;
    }
  }
}

// ============================================================================
// 单例
// ============================================================================

let errorReporterInstance: ErrorReporter | null = null;

/**
 * 获取错误上报器单例
 */
export function getErrorReporter(config?: ErrorReporterConfig): ErrorReporter {
  if (!errorReporterInstance) {
    errorReporterInstance = new ErrorReporter(config);
  }
  return errorReporterInstance;
}

export default ErrorReporter;
