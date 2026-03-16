/**
 * Nexus Agent - 主入口
 * 简化版
 */

import { OpenClawManager } from './openclaw_manager';
import { EvolutionLoop, EvolutionConfig } from './evolution/evolution_loop';
import { Dashboard } from './web/dashboard';
import { NotificationManager, NotificationType } from './notification/notify';

const DEFAULT_PORT = 3000;

/**
 * Nexus Agent 主类
 */
export class NexusAgent {
  private openclawManager: OpenClawManager;
  private evolutionLoop?: EvolutionLoop;
  private dashboard?: Dashboard;
  private notificationManager: NotificationManager;
  private isRunning: boolean = false;

  constructor() {
    this.openclawManager = new OpenClawManager();
    this.notificationManager = new NotificationManager();
  }

  /**
   * 启动 Nexus Agent
   */
  async start(port: number = DEFAULT_PORT): Promise<void> {
    if (this.isRunning) {
      console.log('[NexusAgent] 已在运行中');
      return;
    }

    console.log('[NexusAgent] 启动中...');

    // 启动 OpenClaw 管理
    await this.openclawManager.start();

    // 启动进化循环
    const evolutionConfig: EvolutionConfig = {
      fetchInterval: 60 * 60 * 1000, // 1小时
      maxConcurrent: 2,
      minImportance: 0.5,
      maxDifficulty: 0.8,
      autoExecute: false, // 先不自动执行
      excludeLabels: ['wontfix', 'duplicate'],
      requireLabels: [],
    };
    this.evolutionLoop = new EvolutionLoop(evolutionConfig);
    await this.evolutionLoop.run();

    // 启动 Dashboard
    this.dashboard = new Dashboard(port);
    this.dashboard.start();

    this.isRunning = true;
    console.log('[NexusAgent] 启动完成');

    try {
      await this.notificationManager.notify(
        `Nexus Agent 已启动 - Dashboard: http://localhost:${port}`,
        NotificationType.EVOLUTION_STARTED
      );
    } catch (e) {
      console.log('[NexusAgent] 通知发送失败（正常，缺少配置）');
    }
  }

  /**
   * 停止 Nexus Agent
   */
  async stop(): Promise<void> {
    console.log('[NexusAgent] 停止中...');

    if (this.evolutionLoop) {
      await this.evolutionLoop.stop();
    }

    if (this.dashboard) {
      this.dashboard.stop();
    }

    await this.openclawManager.stop();

    this.isRunning = false;
    console.log('[NexusAgent] 已停止');
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      openclaw: this.openclawManager.getStatus(),
      evolution: this.evolutionLoop?.getStatus(),
    };
  }
}

/**
 * CLI 入口
 */
async function main() {
  const command = process.argv[2] || 'start';
  const nexus = new NexusAgent();

  switch (command) {
    case 'start':
      await nexus.start();
      break;
    case 'stop':
      await nexus.stop();
      break;
    case 'status':
      console.log(JSON.stringify(nexus.getStatus(), null, 2));
      break;
    default:
      console.log(`未知命令: ${command}`);
      console.log('用法: node dist/main.js [start|stop|status]');
  }
}

// 导出供测试用
export function createNexusAgent(): NexusAgent {
  return new NexusAgent();
}

// 运行 CLI
if (require.main === module) {
  main().catch(console.error);
}
