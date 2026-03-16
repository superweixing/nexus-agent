/**
 * Backup Scheduler
 */

import { BackupManager } from './backup-manager';

export class BackupScheduler {
  private manager: BackupManager;
  private intervalId?: NodeJS.Timeout;

  constructor(manager: BackupManager) {
    this.manager = manager;
  }

  start(intervalHours: number = 24): void {
    console.log(`[BackupScheduler] Starting with ${intervalHours}h interval`);
    this.intervalId = setInterval(() => {
      this.manager.createBackup('./');
    }, intervalHours * 60 * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
