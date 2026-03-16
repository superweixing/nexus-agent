/**
 * 通知类型枚举
 */
export enum NotificationType {
  EVOLUTION_STARTED = 'evolution_started',
  ISSUE_EVALUATED = 'issue_evaluated',
  MODIFICATION_DONE = 'modification_done',
  PR_CREATED = 'pr_created',
  TEST_PASSED = 'test_passed',
  TEST_FAILED = 'test_failed',
  ERROR = 'error',
}

/**
 * 通知消息结构
 */
export interface NotificationMessage {
  type: NotificationType;
  message: string;
  timestamp: Date;
  extra?: Record<string, any>;
}

/**
 * 飞书机器人配置
 */
export interface FeishuConfig {
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
}

/**
 * 通知管理器
 * 支持飞书机器人等多种通知方式
 */
export class NotificationManager {
  private feishuConfig: FeishuConfig;
  private enabled: boolean = true;

  constructor(config?: FeishuConfig) {
    // 从环境变量或配置加载飞书配置
    this.feishuConfig = config || {
      webhookUrl: process.env.FEISHU_WEBHOOK_URL,
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
    };

    // 如果没有配置任何飞书相关配置，尝试从环境变量获取
    if (!this.feishuConfig?.webhookUrl && !this.feishuConfig?.appId) {
      console.log('[Notification] 飞书机器人未配置，通知功能将不可用');
      this.enabled = false;
    }
  }

  /**
   * 发送通知
   */
  async notify(message: string, type: NotificationType): Promise<void> {
    if (!this.enabled) {
      console.log(`[Notification] 通知已禁用，跳过: ${type} - ${message}`);
      return;
    }

    const notification: NotificationMessage = {
      type,
      message,
      timestamp: new Date(),
    };

    // 发送到飞书
    if (this.feishuConfig.webhookUrl || this.feishuConfig.appId) {
      await this.sendToFeishu(notification);
    }
  }

  /**
   * 发送通知到飞书
   */
  private async sendToFeishu(notification: NotificationMessage): Promise<void> {
    try {
      // 优先使用 Webhook 方式
      if (this.feishuConfig.webhookUrl) {
        await this.sendViaWebhook(notification);
      } else if (this.feishuConfig.appId && this.feishuConfig.appSecret) {
        // 如果配置了 App ID 和 Secret，使用 Open API（需要实现 tenant_access_token 获取）
        // 这里简化处理，推荐使用 Webhook 方式
        console.log('[Notification] 建议使用 Webhook 方式配置飞书机器人');
      }
    } catch (error) {
      console.error('[Notification] 飞书通知发送失败:', error);
    }
  }

  /**
   * 通过 Webhook 发送飞书消息
   */
  private async sendViaWebhook(notification: NotificationMessage): Promise<void> {
    const { webhookUrl } = this.feishuConfig;
    if (!webhookUrl) return;

    const emoji = this.getEmojiForType(notification.type);
    const title = this.getTitleForType(notification.type);

    const payload = {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: `${emoji} ${title}`,
          },
          template: this.getTemplateForType(notification.type),
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'plain_text',
              content: notification.message,
            },
          },
          {
            tag: 'div',
            fields: [
              {
                is_short: true,
                text: {
                  tag: 'plain_text',
                  content: `**类型:** ${notification.type}`,
                },
              },
              {
                is_short: true,
                text: {
                  tag: 'plain_text',
                  content: `**时间:** ${notification.timestamp.toLocaleString('zh-CN')}`,
                },
              },
            ],
          },
        ],
      },
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`飞书通知失败: ${response.status}`);
    }

    console.log(`[Notification] 已发送 ${notification.type} 通知到飞书`);
  }

  /**
   * 根据通知类型获取标题
   */
  private getTitleForType(type: NotificationType): string {
    const titles: Record<NotificationType, string> = {
      [NotificationType.EVOLUTION_STARTED]: '🧬 开始进化',
      [NotificationType.ISSUE_EVALUATED]: '📋 Issue 评估完成',
      [NotificationType.MODIFICATION_DONE]: '✏️ 修改完成',
      [NotificationType.PR_CREATED]: '🔧 PR 已创建',
      [NotificationType.TEST_PASSED]: '✅ 测试通过',
      [NotificationType.TEST_FAILED]: '❌ 测试失败',
      [NotificationType.ERROR]: '🚨 错误',
    };
    return titles[type] || '通知';
  }

  /**
   * 根据通知类型获取 emoji
   */
  private getEmojiForType(type: NotificationType): string {
    const emojis: Record<NotificationType, string> = {
      [NotificationType.EVOLUTION_STARTED]: '🧬',
      [NotificationType.ISSUE_EVALUATED]: '📋',
      [NotificationType.MODIFICATION_DONE]: '✏️',
      [NotificationType.PR_CREATED]: '🔧',
      [NotificationType.TEST_PASSED]: '✅',
      [NotificationType.TEST_FAILED]: '❌',
      [NotificationType.ERROR]: '🚨',
    };
    return emojis[type] || '📢';
  }

  /**
   * 根据通知类型获取卡片颜色
   */
  private getTemplateForType(type: NotificationType): string {
    const templates: Record<NotificationType, string> = {
      [NotificationType.EVOLUTION_STARTED]: 'blue',
      [NotificationType.ISSUE_EVALUATED]: 'green',
      [NotificationType.MODIFICATION_DONE]: 'green',
      [NotificationType.PR_CREATED]: 'blue',
      [NotificationType.TEST_PASSED]: 'green',
      [NotificationType.TEST_FAILED]: 'red',
      [NotificationType.ERROR]: 'red',
    };
    return templates[type] || 'blue';
  }

  /**
   * 启用/禁用通知
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 检查通知是否可用
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * 创建默认通知管理器实例
 */
let defaultManager: NotificationManager | null = null;

export function getNotificationManager(config?: FeishuConfig): NotificationManager {
  if (!defaultManager) {
    defaultManager = new NotificationManager(config);
  }
  return defaultManager;
}
