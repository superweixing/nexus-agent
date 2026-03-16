import { OpenClawManager, OpenClawStatus } from './openclaw_manager';
import { CodexManager, getCodexManager, CodexStatus } from '../codex';
import { EvolutionLoop, EvolutionConfig, Evaluation, EvolutionResult } from './evolution';
import { Dashboard, createDashboard } from './web/dashboard';
import { NotificationManager, NotificationType, getNotificationManager } from './notification';
import { ErrorHandler, getErrorHandler, ErrorSeverity } from './error';
import { ErrorReporter, getErrorReporter } from './error/reporter';
import { getMetricsCollector } from './metrics';
import { startApiServer } from './api/server';
import { BackupManager } from './backup/backup-manager';
import { BackupScheduler } from './backup/backup-scheduler';
import { TaskScheduler, TaskType, getScheduler } from './scheduler';
import { initScheduler, DEFAULT_TASK_CONFIGS, ScheduledTaskConfig } from './scheduler/init';

/**
 * Nexus Agent 主入口
 * 自动管理 OpenClaw 生命周期
 */
export class NexusAgent {
  private openclawManager: OpenClawManager;
  private codexManager: CodexManager;
  private healthCheckInterval?: NodeJS.Timeout;
  private notificationManager: NotificationManager;
  private errorHandler: ErrorHandler;
  private errorReporter: ErrorReporter;
  public evolutionLoop?: EvolutionLoop;
  private dashboard?: Dashboard;
  private metricsCollector = getMetricsCollector();
  private apiServer?: any; // REST API 服务器实例
  private backupManager?: BackupManager;
  private backupScheduler?: BackupScheduler;
  private scheduler?: TaskScheduler;
  private schedulerConfigs: ScheduledTaskConfig[] = DEFAULT_TASK_CONFIGS;

  constructor() {
    this.openclawManager = new OpenClawManager();
    this.codexManager = getCodexManager({
      openclawPath: '/home/weixing/.openclaw/workspace/nexus-agent/openclaw',
      autoInstall: true,
    });
    this.notificationManager = getNotificationManager();

    // 初始化错误处理器
    this.errorHandler = getErrorHandler({
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 30000,
    });

    // 初始化错误上报器
    this.errorReporter = getErrorReporter({
      logFilePath: './logs/nexus-error.log',
      consoleOutput: true,
      fileOutput: true,
      minSeverity: ErrorSeverity.HIGH,
    });

    // 监听错误事件并自动上报
    this.setupErrorListeners();

    // 初始化备份管理器
    this.initBackupSystem();

    console.log('[NexusAgent] 指标收集器已初始化');
  }

  /**
   * 初始化备份系统
   */
  private initBackupSystem(): void {
    try {
      this.backupManager = new BackupManager({
        backupDir: './backups',
        intervalHours: 24,
        maxBackups: 7,
        autoBackup: true,
        include: {
          openclawCode: true,
          githubConfig: true,
          evolutionHistory: true,
          configs: true,
        },
        compress: true,
        encrypt: false,
      });

      this.backupScheduler = new BackupScheduler(this.backupManager);
      console.log('[NexusAgent] 备份系统已初始化');
    } catch (error) {
      console.warn('[NexusAgent] 备份系统初始化失败:', error);
    }
  }

  /**
   * 检查并执行必要备份
   */
  private async checkAndRunBackup(): Promise<void> {
    if (!this.backupScheduler) {
      return;
    }

    try {
      const backedUp = await this.backupScheduler.checkAndBackup();
      if (backedUp) {
        console.log('[NexusAgent] 启动备份已完成');
      } else {
        console.log('[NexusAgent] 备份检查完成，无需备份');
      }

      // 启动自动备份调度
      this.backupScheduler.start();
      const status = this.backupScheduler.getStatus();
      console.log('[NexusAgent] 备份调度器状态:', status.running ? '运行中' : '已停止');
    } catch (error) {
      console.warn('[NexusAgent] 备份检查失败:', error);
    }
  }

  /**
   * 设置错误监听器
   */
  private setupErrorListeners(): void {
    // 监听一般错误
    this.errorHandler.on('error', async errorContext => {
      console.warn(`[NexusAgent] 捕获到错误: ${errorContext.category} - ${errorContext.message}`);
      await this.errorReporter.report(errorContext);
    });

    // 监听严重错误
    this.errorHandler.on('criticalError', async errorContext => {
      console.error(`[NexusAgent] 严重错误: ${errorContext.message}`);
      await this.errorReporter.report(errorContext);

      // 发送通知
      await this.notificationManager.notify(
        `Nexus Agent 发生严重错误: ${errorContext.message}`,
        NotificationType.ERROR
      );
    });
  }

  /**
   * 启动 Nexus Agent 及 OpenClaw
   */
  async start(): Promise<void> {
    console.log('[NexusAgent] 正在启动...');

    // 检查并执行必要备份
    await this.checkAndRunBackup();

    // 检查 Codex 可用性
    console.log('[NexusAgent] 检查 Codex 状态...');
    const codexAvailable = await this.codexManager.checkAvailable();
    if (codexAvailable) {
      const codexStatus = await this.codexManager.getStatus();
      console.log('[NexusAgent] Codex 状态:', codexStatus);
    } else {
      console.log('[NexusAgent] Codex 不可用，尝试安装...');
      try {
        await this.codexManager.install();
        console.log('[NexusAgent] Codex 安装完成');
      } catch (error) {
        console.warn('[NexusAgent] Codex 安装失败:', error);
      }
    }

    // 启动 OpenClaw
    await this.openclawManager.start();

    // 验证 OpenClaw 状态
    const status = await this.openclawManager.getStatus();
    console.log('[NexusAgent] OpenClaw 状态:', status);

    // 启动健康检查
    this.startHealthCheck();

    // 初始化并启动进化循环
    await this.initEvolutionLoop();

    // 初始化并启动定时任务调度器
    this.initScheduler();

    console.log('[NexusAgent] 启动完成');

    // 启动 Web 状态面板
    this.startDashboard();

    // 启动 REST API 服务器
    await this.startApiServer();

    // 发送启动通知
    await this.notificationManager.notify(
      'Nexus Agent 已启动，进化循环正在运行',
      NotificationType.EVOLUTION_STARTED
    );
  }

  /**
   * 初始化进化循环
   */
  private async initEvolutionLoop(): Promise<void> {
    // 创建 Codex 执行器适配器
    const codexExecutor = {
      execute: async (issueNumber: number, instruction: string) => {
        try {
          // 使用 CodexManager 执行任务
          const result = await this.codexManager.executeTask(
            `处理 GitHub Issue #${issueNumber}: ${instruction}`
          );
          return {
            success: result.success,
            changes: result.output ? [result.output] : [],
            error: result.error,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    };

    // 进化循环配置
    const evolutionConfig: Partial<EvolutionConfig> = {
      fetchInterval: 60 * 60 * 1000, // 1 小时检查一次
      maxConcurrent: 1,
      minImportance: 0.5,
      maxDifficulty: 0.7,
      autoExecute: false, // 默认不自动执行，需要确认
      excludeLabels: ['wontfix', 'duplicate', 'invalid', 'low-priority'],
    };

    this.evolutionLoop = new EvolutionLoop(evolutionConfig, codexExecutor);

    console.log('[NexusAgent] 启动进化循环...');
    await this.evolutionLoop.run();
    console.log('[NexusAgent] 进化循环已启动');
  }

  /**
   * 初始化并启动定时任务调度器
   */
  private initScheduler(): void {
    console.log('[NexusAgent] 初始化定时任务调度器...');

    // 初始化调度器
    this.scheduler = initScheduler({
      useDefaultConfig: true,
      customConfigs: this.schedulerConfigs,
      evolutionLoop: this.evolutionLoop,
      openclawManager: this.openclawManager,
      currentVersion: '1.0.0',
      healthCheckCallback: async () => {
        return await this.openclawManager.healthCheck();
      },
    });

    // 启动调度器
    this.scheduler.start();
    console.log('[NexusAgent] 定时任务调度器已启动');
  }

  /**
   * 获取调度器实例
   */
  getScheduler(): TaskScheduler | undefined {
    return this.scheduler;
  }

  /**
   * 停止 Nexus Agent 及 OpenClaw
   */
  async stop(): Promise<void> {
    console.log('[NexusAgent] 正在停止...');

    // 停止健康检查
    this.stopHealthCheck();

    // 停止 Web 状态面板
    this.stopDashboard();

    // 停止 REST API 服务器
    this.stopApiServer();

    // 停止定时任务调度器
    if (this.scheduler) {
      this.scheduler.stop();
      console.log('[NexusAgent] 定时任务调度器已停止');
    }

    // 停止进化循环
    if (this.evolutionLoop) {
      await this.evolutionLoop.stop();
    }

    // 停止 OpenClaw
    await this.openclawManager.stop();

    console.log('[NexusAgent] 停止完成');
  }

  /**
   * 重启 Nexus Agent 及 OpenClaw
   */
  async restart(): Promise<void> {
    console.log('[NexusAgent] 正在重启...');
    await this.stop();
    await this.start();
    console.log('[NexusAgent] 重启完成');
  }

  /**
   * 获取 OpenClaw 状态
   */
  async getOpenClawStatus(): Promise<OpenClawStatus> {
    return await this.openclawManager.getStatus();
  }

  /**
   * 获取 Codex 状态
   */
  async getCodexStatus(): Promise<CodexStatus> {
    return await this.codexManager.getStatus();
  }

  /**
   * 修改 OpenClaw 代码
   */
  async modifyOpenClawCode(targetPath: string, instruction: string) {
    return await this.codexManager.modifyCode(targetPath, instruction);
  }

  /**
   * 执行 Codex 任务
   */
  async executeCodexTask(task: string) {
    return await this.codexManager.executeTask(task);
  }

  /**
   * 启动健康检查定时器
   */
  private startHealthCheck(): void {
    // 每 30 秒检查一次
    this.healthCheckInterval = setInterval(async () => {
      const healthy = await this.openclawManager.healthCheck();

      if (!healthy) {
        console.warn('[NexusAgent] OpenClaw 健康检查失败，尝试重启...');
        try {
          await this.openclawManager.restart();
        } catch (error) {
          console.error('[NexusAgent] OpenClaw 重启失败:', error);
        }
      }
    }, 30000);
  }

  /**
   * 停止健康检查定时器
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * 启动 Web 状态面板
   */
  private startDashboard(): void {
    try {
      this.dashboard = createDashboard(3001);
      console.log('[NexusAgent] Web 状态面板已启动: http://localhost:3001');
    } catch (error) {
      console.error('[NexusAgent] 启动 Web 状态面板失败:', error);
    }
  }

  /**
   * 停止 Web 状态面板
   */
  private stopDashboard(): void {
    if (this.dashboard) {
      this.dashboard.stop();
      this.dashboard = undefined;
    }
  }

  /**
   * 启动 REST API 服务器
   */
  private async startApiServer(): Promise<void> {
    try {
      const apiPort = parseInt(process.env.NEXUS_API_PORT || '3000');
      const apiKey = process.env.NEXUS_API_KEY || 'nexus_default_key_change_me';

      const { server } = await startApiServer(this, {
        port: apiPort,
        apiKey,
      });

      this.apiServer = server;
      console.log(`[NexusAgent] REST API 服务器已启动: http://localhost:${apiPort}`);
    } catch (error: any) {
      console.error('[NexusAgent] REST API 启动失败:', error.message);
    }
  }

  /**
   * 停止 REST API 服务器
   */
  private stopApiServer(): void {
    if (this.apiServer) {
      this.apiServer.close();
      this.apiServer = undefined;
      console.log('[NexusAgent] REST API 服务器已停止');
    }
  }

  /**
   * 获取 Dashboard 实例
   */
  getDashboard(): Dashboard | undefined {
    return this.dashboard;
  }
}

// 导出单例
export const nexusAgent = new NexusAgent();

// 如果直接运行此文件
if (require.main === module) {
  const command = process.argv[2] || 'start';

  switch (command) {
    case 'start':
      nexusAgent
        .start()
        .then(() => {
          console.log('[NexusAgent] 已启动');
          process.exit(0);
        })
        .catch(error => {
          console.error('[NexusAgent] 启动失败:', error);
          process.exit(1);
        });
      break;

    case 'stop':
      nexusAgent
        .stop()
        .then(() => {
          console.log('[NexusAgent] 已停止');
          process.exit(0);
        })
        .catch(error => {
          console.error('[NexusAgent] 停止失败:', error);
          process.exit(1);
        });
      break;

    case 'restart':
      nexusAgent
        .restart()
        .then(() => {
          console.log('[NexusAgent] 已重启');
          process.exit(0);
        })
        .catch(error => {
          console.error('[NexusAgent] 重启失败:', error);
          process.exit(1);
        });
      break;

    case 'status':
      Promise.all([nexusAgent.getOpenClawStatus(), nexusAgent.getCodexStatus()])
        .then(([openclawStatus, codexStatus]) => {
          console.log('[NexusAgent] ========== 状态汇总 ==========');
          console.log('OpenClaw 状态:', JSON.stringify(openclawStatus, null, 2));
          console.log('Codex 状态:', JSON.stringify(codexStatus, null, 2));
          process.exit(openclawStatus.running ? 0 : 1);
        })
        .catch(error => {
          console.error('[NexusAgent] 获取状态失败:', error);
          process.exit(1);
        });
      break;

    case 'codex:status':
      nexusAgent
        .getCodexStatus()
        .then(status => {
          console.log('[NexusAgent] Codex 状态:', JSON.stringify(status, null, 2));
          process.exit(status.installed ? 0 : 1);
        })
        .catch(error => {
          console.error('[NexusAgent] 获取 Codex 状态失败:', error);
          process.exit(1);
        });
      break;

    case 'codex:modify':
      // 用法: node main.ts codex:modify <文件路径> "<修改指令>"
      const targetPath = process.argv[3];
      const instruction = process.argv[4];
      if (!targetPath || !instruction) {
        console.log('用法: node main.ts codex:modify <文件路径> "<修改指令>"');
        process.exit(1);
      }
      nexusAgent
        .modifyOpenClawCode(targetPath, instruction)
        .then(result => {
          console.log('[NexusAgent] 修改结果:', JSON.stringify(result, null, 2));
          process.exit(result.success ? 0 : 1);
        })
        .catch(error => {
          console.error('[NexusAgent] 修改失败:', error);
          process.exit(1);
        });
      break;

    case 'codex:task':
      // 用法: node main.ts codex:task "<任务描述>"
      const task = process.argv[3];
      if (!task) {
        console.log('用法: node main.ts codex:task "<任务描述>"');
        process.exit(1);
      }
      nexusAgent
        .executeCodexTask(task)
        .then(result => {
          console.log('[NexusAgent] 任务结果:', JSON.stringify(result, null, 2));
          process.exit(result.success ? 0 : 1);
        })
        .catch(error => {
          console.error('[NexusAgent] 任务执行失败:', error);
          process.exit(1);
        });
      break;

    case 'evolution:status':
      if (nexusAgent.evolutionLoop) {
        const status = nexusAgent.evolutionLoop.getStatus();
        console.log('[NexusAgent] 进化循环状态:', JSON.stringify(status, null, 2));
        process.exit(0);
      } else {
        console.log('[NexusAgent] 进化循环未初始化');
        process.exit(1);
      }
      break;

    case 'evolution:trigger':
      if (nexusAgent.evolutionLoop) {
        nexusAgent.evolutionLoop
          .trigger()
          .then(results => {
            console.log('[NexusAgent] 进化结果:', JSON.stringify(results, null, 2));
            process.exit(results.some(r => r.success) ? 0 : 1);
          })
          .catch(error => {
            console.error('[NexusAgent] 触发进化失败:', error);
            process.exit(1);
          });
      } else {
        console.log('[NexusAgent] 进化循环未初始化');
        process.exit(1);
      }
      break;

    case 'evolution:history':
      if (nexusAgent.evolutionLoop) {
        const history = nexusAgent.evolutionLoop.getHistory();
        console.log('[NexusAgent] 进化历史:', JSON.stringify(history, null, 2));
        process.exit(0);
      } else {
        console.log('[NexusAgent] 进化循环未初始化');
        process.exit(1);
      }
      break;

    case 'scheduler:status': {
      const scheduler = nexusAgent.getScheduler();
      if (scheduler) {
        const status = scheduler.getStatus();
        console.log('[NexusAgent] 调度器状态:', JSON.stringify(status, null, 2));
        process.exit(0);
      } else {
        console.log('[NexusAgent] 调度器未初始化');
        process.exit(1);
      }
      break;
    }

    case 'scheduler:trigger': {
      const taskType = process.argv[3] as TaskType;
      const scheduler = nexusAgent.getScheduler();
      if (scheduler && taskType) {
        scheduler
          .triggerTask(taskType)
          .then(result => {
            console.log('[NexusAgent] 任务触发结果:', JSON.stringify(result, null, 2));
            process.exit(result?.success ? 0 : 1);
          })
          .catch(error => {
            console.error('[NexusAgent] 触发任务失败:', error);
            process.exit(1);
          });
      } else {
        console.log('用法: node main.ts scheduler:trigger <task_type>');
        console.log('可用任务类型: fetch_issues, check_updates, backup, health_check');
        process.exit(1);
      }
      break;
    }

    case 'scheduler:next': {
      const taskType = process.argv[3] as TaskType;
      const scheduler = nexusAgent.getScheduler();
      if (scheduler && taskType) {
        const nextTime = scheduler.getNextExecutionTime(taskType);
        console.log(`[NexusAgent] 任务 ${taskType} 下次执行时间:`, nextTime);
        process.exit(0);
      } else {
        console.log('用法: node main.ts scheduler:next <task_type>');
        console.log('可用任务类型: fetch_issues, check_updates, backup, health_check');
        process.exit(1);
      }
      break;
    }

    default:
      console.log(
        '用法: node main.ts [start|stop|restart|status|codex:status|codex:modify|codex:task|evolution:status|evolution:trigger|evolution:history|scheduler:status|scheduler:trigger|scheduler:next]'
      );
      process.exit(1);
  }
}
