/**
 * Nexus Agent - Operation Logger
 *
 * 操作日志模块，负责记录所有代码修改操作
 * 支持审计追踪和回滚功能
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export type OperationType =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'file_modify'
  | 'directory_create'
  | 'directory_delete'
  | 'command_execute'
  | 'codex_task'
  | 'rollback';

export type OperationResult = 'success' | 'failure' | 'blocked' | 'partial';

export interface OperationLog {
  id: string;
  type: OperationType;
  filePath: string;
  details: Record<string, unknown>;
  result: OperationResult;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  checksum?: string;
}

export interface Snapshot {
  id: string;
  filePath: string;
  content: string;
  operationId: string;
  timestamp: Date;
  checksum: string;
}

export interface LogQueryOptions {
  filePath?: string;
  operationType?: OperationType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Operation Logger Class
// ============================================================================

export class OperationLogger {
  private logDir: string;
  private snapshotDir: string;
  private currentLogFile: string;
  private maxLogSize: number;
  private maxSnapshots: number;

  constructor(
    logDir: string = './logs/security',
    snapshotDir: string = './logs/security/snapshots'
  ) {
    this.logDir = logDir;
    this.snapshotDir = snapshotDir;
    this.maxLogSize = 10 * 1024 * 1024; // 10MB
    this.maxSnapshots = 10;
    this.currentLogFile = path.join(logDir, `operations-${this.getDateString()}.jsonl`);
  }

  // ========================================================================
  // Initialization
  // ========================================================================

  /**
   * 初始化日志目录
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    await fs.mkdir(this.snapshotDir, { recursive: true });
  }

  // ========================================================================
  // Logging Methods
  // ========================================================================

  /**
   * 记录操作
   */
  async log(operation: Omit<OperationLog, 'id' | 'checksum'>): Promise<OperationLog> {
    const fullOperation: OperationLog = {
      ...operation,
      id: this.generateId(),
      checksum: '',
    };

    // 计算校验和
    fullOperation.checksum = this.calculateChecksum(fullOperation);

    // 写入日志文件
    await this.writeLog(fullOperation);

    // 检查日志文件大小，必要时轮转
    await this.rotateLogIfNeeded();

    return fullOperation;
  }

  /**
   * 批量记录操作
   */
  async logBatch(operations: Omit<OperationLog, 'id' | 'checksum'>[]): Promise<OperationLog[]> {
    const results: OperationLog[] = [];

    for (const operation of operations) {
      const logged = await this.log(operation);
      results.push(logged);
    }

    return results;
  }

  // ========================================================================
  // Query Methods
  // ========================================================================

  /**
   * 查询操作日志
   */
  async query(options: LogQueryOptions = {}): Promise<OperationLog[]> {
    const logs: OperationLog[] = [];
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    // 读取最近几天的日志文件
    const dates = this.getRecentDateStrings(7);

    for (const date of dates) {
      const logFile = path.join(this.logDir, `operations-${date}.jsonl`);

      try {
        const content = await fs.readFile(logFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as OperationLog;

            // 应用过滤条件
            if (options.filePath && !this.matchPath(entry.filePath, options.filePath)) {
              continue;
            }
            if (options.operationType && entry.type !== options.operationType) {
              continue;
            }
            if (options.startDate && new Date(entry.timestamp) < options.startDate) {
              continue;
            }
            if (options.endDate && new Date(entry.timestamp) > options.endDate) {
              continue;
            }

            logs.push(entry);
          } catch {
            // 跳过解析失败的行
          }
        }
      } catch {
        // 文件不存在，跳过
      }
    }

    // 按时间倒序排序
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return logs.slice(offset, offset + limit);
  }

  /**
   * 获取特定文件的操作历史
   */
  async getFileHistory(filePath: string, limit: number = 50): Promise<OperationLog[]> {
    return this.query({ filePath, limit }) as Promise<OperationLog[]>;
  }

  // ========================================================================
  // Snapshot Methods
  // ========================================================================

  /**
   * 创建文件快照
   */
  async createSnapshot(filePath: string, operationId: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8');

      const snapshot: Snapshot = {
        id: this.generateId(),
        filePath,
        content,
        operationId,
        timestamp: new Date(),
        checksum: this.calculateChecksum({ content }),
      };

      // 保存快照
      const snapshotFile = path.join(this.snapshotDir, `${snapshot.id}.json`);
      await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));

      // 清理旧快照
      await this.cleanupOldSnapshots(filePath);

      return true;
    } catch (error) {
      console.error('[OperationLogger] 创建快照失败:', error);
      return false;
    }
  }

  /**
   * 回滚到指定快照
   */
  async rollbackToSnapshot(snapshotId: string): Promise<boolean> {
    try {
      const snapshotFile = path.join(this.snapshotDir, `${snapshotId}.json`);
      const content = await fs.readFile(snapshotFile, 'utf8');
      const snapshot = JSON.parse(content) as Snapshot;

      // 写入原文件
      await fs.writeFile(snapshot.filePath, snapshot.content);

      // 记录回滚操作
      await this.log({
        type: 'rollback',
        filePath: snapshot.filePath,
        details: { snapshotId, originalOperationId: snapshot.operationId },
        result: 'success',
        timestamp: new Date(),
      });

      return true;
    } catch (error) {
      console.error('[OperationLogger] 回滚失败:', error);
      return false;
    }
  }

  /**
   * 获取快照列表
   */
  async listSnapshots(filePath?: string): Promise<Snapshot[]> {
    const snapshots: Snapshot[] = [];

    try {
      const files = await fs.readdir(this.snapshotDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await fs.readFile(path.join(this.snapshotDir, file), 'utf8');
          const snapshot = JSON.parse(content) as Snapshot;

          if (!filePath || snapshot.filePath === filePath) {
            snapshots.push(snapshot);
          }
        } catch {
          // 跳过解析失败的文件
        }
      }
    } catch (error) {
      console.error('[OperationLogger] 列出快照失败:', error);
    }

    // 按时间倒序排序
    snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return snapshots;
  }

  /**
   * 获取快照详情
   */
  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    try {
      const snapshotFile = path.join(this.snapshotDir, `${snapshotId}.json`);
      const content = await fs.readFile(snapshotFile, 'utf8');
      return JSON.parse(content) as Snapshot;
    } catch {
      return null;
    }
  }

  // ========================================================================
  // Statistics & Reports
  // ========================================================================

  /**
   * 获取操作统计
   */
  async getStatistics(startDate?: Date, endDate?: Date): Promise<Record<string, unknown>> {
    const logs = await this.query({ startDate, endDate, limit: 10000 });

    const stats = {
      total: logs.length,
      byType: {} as Record<string, number>,
      byResult: {} as Record<string, number>,
      byFile: {} as Record<string, number>,
      timeRange: {
        start: startDate || (logs.length > 0 ? logs[logs.length - 1].timestamp : null),
        end: endDate || (logs.length > 0 ? logs[0].timestamp : null),
      },
    };

    for (const log of logs) {
      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
      stats.byResult[log.result] = (stats.byResult[log.result] || 0) + 1;
      stats.byFile[log.filePath] = (stats.byFile[log.filePath] || 0) + 1;
    }

    return stats;
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async writeLog(operation: OperationLog): Promise<void> {
    await this.initialize();

    const logLine = JSON.stringify(operation) + '\n';
    await fs.appendFile(this.currentLogFile, logLine, 'utf8');
  }

  private async rotateLogIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.currentLogFile);

      if (stats.size > this.maxLogSize) {
        const archiveName = `operations-${this.getDateString()}-${this.generateId(8)}.jsonl`;
        const archivePath = path.join(this.logDir, 'archive', archiveName);

        await fs.mkdir(path.dirname(archivePath), { recursive: true });
        await fs.rename(this.currentLogFile, archivePath);

        this.currentLogFile = path.join(this.logDir, `operations-${this.getDateString()}.jsonl`);
      }
    } catch (error) {
      // 文件不存在，无需轮转
    }
  }

  private async cleanupOldSnapshots(filePath: string): Promise<void> {
    const snapshots = await this.listSnapshots(filePath);

    if (snapshots.length > this.maxSnapshots) {
      const toDelete = snapshots.slice(this.maxSnapshots);

      for (const snapshot of toDelete) {
        try {
          const snapshotFile = path.join(this.snapshotDir, `${snapshot.id}.json`);
          await fs.unlink(snapshotFile);
        } catch {
          // 忽略删除失败
        }
      }
    }
  }

  private matchPath(logPath: string, queryPath: string): boolean {
    return logPath.includes(queryPath) || queryPath.includes(logPath);
  }

  private generateId(length: number = 16): string {
    return crypto.randomBytes(length).toString('hex');
  }

  private calculateChecksum(data: unknown): string {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  private getDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private getRecentDateStrings(days: number): string[] {
    const dates: string[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      dates.push(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      );
    }

    return dates;
  }
}

export default OperationLogger;
