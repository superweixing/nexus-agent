import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 导入错误处理模块
import { ErrorHandler, getErrorHandler, withRetry, ErrorCategory } from './error';

export interface OpenClawStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  version?: string;
  memory?: number;
  cpu?: number;
}

export class OpenClawManager {
  private openclawPath: string;
  private pidFile: string;
  private isRunning: boolean = false;
  private startTime?: number;
  private errorHandler: ErrorHandler;

  constructor(openclawPath: string = '/home/weixing/.openclaw/workspace/nexus-agent/openclaw') {
    this.openclawPath = openclawPath;
    this.pidFile = `${openclawPath}/.openclaw.pid`;

    // 初始化错误处理器
    this.errorHandler = getErrorHandler({
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 30000,
      retryableErrors: [ErrorCategory.NETWORK, ErrorCategory.TIMEOUT],
    });
  }

  /**
   * 启动 OpenClaw（带重试机制）
   */
  async start(): Promise<void> {
    const status = await this.getStatus();
    if (status.running) {
      console.log('[OpenClawManager] OpenClaw 已在运行中');
      return;
    }

    console.log('[OpenClawManager] 正在启动 OpenClaw...');

    try {
      // 使用重试机制启动服务
      await withRetry(
        async () => {
          const { stderr } = await execAsync('openclaw gateway start', {
            cwd: this.openclawPath,
            env: { ...process.env },
          });

          if (stderr && !stderr.includes('warn')) {
            console.warn('[OpenClawManager] 启动警告:', stderr);
          }
        },
        {
          maxRetries: 3,
          initialDelayMs: 2000,
          backoffMultiplier: 2,
          maxDelayMs: 30000,
        },
        this.errorHandler,
        { module: 'OpenClawManager', action: 'start' }
      );

      console.log('[OpenClawManager] OpenClaw 启动成功');
      this.isRunning = true;
      this.startTime = Date.now();
    } catch (error: any) {
      // 处理错误
      this.errorHandler.handleError(error, { module: 'OpenClawManager', action: 'start' });
      console.error('[OpenClawManager] 启动失败:', error.message);
      throw new Error(`OpenClaw 启动失败: ${error.message}`);
    }
  }

  /**
   * 停止 OpenClaw（带重试机制）
   */
  async stop(): Promise<void> {
    const status = await this.getStatus();
    if (!status.running) {
      console.log('[OpenClawManager] OpenClaw 未在运行');
      return;
    }

    console.log('[OpenClawManager] 正在停止 OpenClaw...');

    try {
      await withRetry(
        async () => {
          await execAsync('openclaw gateway stop', {
            cwd: this.openclawPath,
          });
        },
        {
          maxRetries: 2,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
        },
        this.errorHandler,
        { module: 'OpenClawManager', action: 'stop' }
      );

      console.log('[OpenClawManager] OpenClaw 已停止');
      this.isRunning = false;
      this.startTime = undefined;
    } catch (error: any) {
      this.errorHandler.handleError(error, { module: 'OpenClawManager', action: 'stop' });
      console.error('[OpenClawManager] 停止失败:', error.message);
      throw new Error(`OpenClaw 停止失败: ${error.message}`);
    }
  }

  /**
   * 重启 OpenClaw
   */
  async restart(): Promise<void> {
    console.log('[OpenClawManager] 正在重启 OpenClaw...');
    await this.stop();
    await this.start();
    console.log('[OpenClawManager] OpenClaw 重启完成');
  }

  /**
   * 获取 OpenClaw 状态
   */
  async getStatus(): Promise<OpenClawStatus> {
    try {
      const { stdout } = await execAsync('openclaw gateway status', {
        cwd: this.openclawPath,
      });

      // 解析状态输出
      const output = stdout.toLowerCase();
      const running =
        output.includes('running') || output.includes('started') || output.includes('active');

      // 尝试获取 PID
      let pid: number | undefined;
      const pidMatch = stdout.match(/pid[:\s]+(\d+)/i);
      if (pidMatch) {
        pid = parseInt(pidMatch[1], 10);
      }

      // 尝试获取版本
      let version: string | undefined;
      const versionMatch = stdout.match(/version[:\s]+([\d.]+)/i);
      if (versionMatch) {
        version = versionMatch[1];
      }

      this.isRunning = running;

      return {
        running,
        pid,
        uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : undefined,
        version,
      };
    } catch (error: any) {
      // 命令执行失败，可能未安装
      return {
        running: false,
      };
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const status = await this.getStatus();

      if (!status.running) {
        console.log('[OpenClawManager] 健康检查: OpenClaw 未运行');
        return false;
      }

      // 尝试执行一个简单的命令验证服务可用性
      await execAsync('openclaw gateway status', {
        cwd: this.openclawPath,
        timeout: 5000,
      });

      console.log('[OpenClawManager] 健康检查: 通过');
      return true;
    } catch (error) {
      console.log('[OpenClawManager] 健康检查: 失败');
      return false;
    }
  }

  /**
   * 获取 OpenClaw 路径
   */
  getOpenClawPath(): string {
    return this.openclawPath;
  }
}

export default OpenClawManager;
