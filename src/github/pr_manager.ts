import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 创建 PR 的选项
 */
export interface CreatePROptions {
  // 仓库 owner
  owner: string;
  // 仓库名称
  repo: string;
  // PR 标题
  title: string;
  // PR 描述
  body: string;
  // 源分支
  head: string;
  // 目标分支
  base: string;
}

/**
 * 创建 PR 的结果
 */
export interface PRResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  message: string;
  error?: string;
}

/**
 * PR 状态
 */
export interface PRStatus {
  number: number;
  state: 'open' | 'closed' | 'merged';
  title: string;
  body: string;
  head: string;
  base: string;
  url: string;
  merged?: boolean;
  mergeable?: boolean;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

/**
 * PR 管理器配置
 */
export interface PRManagerConfig {
  // GitHub Token
  token: string;
  // 默认目标分支
  defaultBase?: string;
  // API 请求超时（毫秒）
  timeout?: number;
}

/**
 * GitHub PR 管理器
 * 负责创建和管理 Pull Request
 */
export class PRManager {
  private token: string;
  private defaultBase: string;
  private timeout: number;
  private baseUrl = 'https://api.github.com';

  constructor(config: PRManagerConfig) {
    this.token = config.token;
    this.defaultBase = config.defaultBase || 'main';
    this.timeout = config.timeout || 30000;
  }

  /**
   * 创建 Pull Request
   */
  async createPR(options: CreatePROptions): Promise<PRResult> {
    const { owner, repo, title, body, head, base } = options;

    console.log(`[PRManager] 创建 PR: ${owner}/${repo} - ${title}`);

    try {
      const response = await this.fetch(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          head,
          base: base || this.defaultBase,
        }),
      });

      if (response.id) {
        const prUrl = response.html_url;
        const prNumber = response.number;

        console.log(`[PRManager] PR 创建成功: #${prNumber} - ${prUrl}`);

        return {
          success: true,
          prNumber,
          prUrl,
          message: `PR 创建成功: #${prNumber}`,
        };
      } else {
        return {
          success: false,
          message: 'PR 创建失败',
          error: response.message || '未知错误',
        };
      }
    } catch (error: any) {
      console.error('[PRManager] 创建 PR 失败:', error);
      return {
        success: false,
        message: '创建 PR 失败',
        error: error.message,
      };
    }
  }

  /**
   * 获取 PR 状态
   */
  async getPRStatus(owner: string, repo: string, prNumber: number): Promise<PRStatus | null> {
    console.log(`[PRManager] 获取 PR #${prNumber} 状态`);

    try {
      const response = await this.fetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
        method: 'GET',
      });

      if (response.number) {
        return {
          number: response.number,
          state: response.state,
          title: response.title,
          body: response.body || '',
          head: response.head?.ref || '',
          base: response.base?.ref || '',
          url: response.html_url,
          merged: response.merged || false,
          mergeable: response.mergeable,
          additions: response.additions,
          deletions: response.deletions,
          changedFiles: response.changed_files,
        };
      }

      return null;
    } catch (error: any) {
      console.error('[PRManager] 获取 PR 状态失败:', error);
      return null;
    }
  }

  /**
   * 获取分支列表
   */
  async getBranches(owner: string, repo: string): Promise<string[]> {
    try {
      const response = await this.fetch(`/repos/${owner}/${repo}/branches`, {
        method: 'GET',
      });

      return Array.isArray(response) ? response.map((b: any) => b.name) : [];
    } catch (error) {
      console.error('[PRManager] 获取分支列表失败:', error);
      return [];
    }
  }

  /**
   * 检查分支是否存在
   */
  async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    try {
      await this.fetch(`/repos/${owner}/${repo}/branches/${branch}`, {
        method: 'GET',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建分支
   */
  async createBranch(
    owner: string,
    repo: string,
    branch: string,
    fromBranch?: string
  ): Promise<boolean> {
    try {
      // 获取基础分支的 SHA
      const baseBranch = fromBranch || this.defaultBase;
      const refResponse = await this.fetch(`/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`, {
        method: 'GET',
      });

      if (!refResponse.object?.sha) {
        console.error('[PRManager] 无法获取基础分支 SHA');
        return false;
      }

      // 创建新分支
      await this.fetch(`/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: refResponse.object.sha,
        }),
      });

      console.log(`[PRManager] 分支 ${branch} 创建成功`);
      return true;
    } catch (error: any) {
      // 分支可能已存在
      if (error.message?.includes('already exists')) {
        return true;
      }
      console.error('[PRManager] 创建分支失败:', error);
      return false;
    }
  }

  /**
   * 通过 gh CLI 创建 PR（如果可用）
   */
  async createPRWithCLI(options: CreatePROptions): Promise<PRResult> {
    const { owner, repo, title, body, head, base } = options;

    try {
      // 检查 gh 是否可用
      const { stdout } = await execAsync('which gh', { timeout: 5000 });

      if (!stdout.trim()) {
        return this.createPR(options);
      }

      // 使用 gh 创建 PR
      const cmd = `cd /tmp && gh pr create --owner ${owner} --repo ${repo} --title "${title}" --body "${body.replace(/"/g, '\\"')}" --base ${base || this.defaultBase} --head ${head}`;

      const { stdout: prUrl } = await execAsync(cmd, { timeout: this.timeout });

      // 从 URL 中提取 PR 编号
      const prMatch = prUrl.match(/\/pull\/(\d+)$/);
      const prNumber = prMatch ? parseInt(prMatch[1]) : undefined;

      return {
        success: true,
        prNumber,
        prUrl: prUrl.trim(),
        message: `PR 创建成功`,
      };
    } catch (error: any) {
      console.error('[PRManager] gh CLI 创建 PR 失败:', error.message);
      // 回退到 API
      return this.createPR(options);
    }
  }

  /**
   * 发起 GitHub API 请求
   */
  private async fetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Nexus-Agent/PR-Manager',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('请求超时');
      }

      throw error;
    }
  }
}

export default PRManager;
