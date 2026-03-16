/**
 * GitHub Issue 类型定义
 */
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  created_at: string;
  updated_at: string;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
}

/**
 * Issue 过滤器配置
 */
export interface IssueFilterConfig {
  // 排除的标签
  excludeLabels?: string[];
  // 必须包含的标签
  requireLabels?: string[];
  // 排除的作者
  excludeAuthors?: string[];
  // 状态过滤
  state?: 'open' | 'closed' | 'all';
  // 是否只看 bug
  bugsOnly?: boolean;
  // 是否只看 enhancement
  enhancementsOnly?: boolean;
}

// ============================================================================
// 错误处理集成
// ============================================================================

import {
  ErrorHandler,
  getErrorHandler,
  withRetry,
  NetworkError,
  APIError,
  ErrorCategory,
  DEFAULT_RETRY_CONFIG,
} from '../error';

/**
 * Issue 获取器
 * 从 OpenClaw GitHub 仓库获取 Issues
 * 带错误处理和缓存重试机制
 */
export class IssueFetcher {
  private readonly repoOwner = 'openclaw';
  private readonly repoName = 'openclaw';
  private readonly apiBase = 'https://api.github.com';

  // 可配置的检查间隔（毫秒）
  private fetchInterval: number = 60 * 60 * 1000; // 默认 1 小时

  // 缓存
  private issueCache: Map<number, { issue: GitHubIssue; timestamp: number }> = new Map();
  private issuesListCache: { issues: GitHubIssue[]; timestamp: number } | null = null;
  private cacheTTL: number = 5 * 60 * 1000; // 5 分钟缓存

  // 错误处理器
  private errorHandler: ErrorHandler;

  constructor(fetchInterval?: number) {
    if (fetchInterval) {
      this.fetchInterval = fetchInterval;
    }
    this.errorHandler = getErrorHandler();
  }

  /**
   * 获取 OpenClaw GitHub Issues（带重试和缓存）
   */
  async fetchIssues(config?: IssueFilterConfig): Promise<GitHubIssue[]> {
    // 尝试从缓存获取
    if (this.issuesListCache && Date.now() - this.issuesListCache.timestamp < this.cacheTTL) {
      console.log('[IssueFetcher] 使用缓存的 issues 列表');
      const cached = this.issuesListCache.issues;
      return config ? this.filterIssues(cached, config) : cached;
    }

    try {
      const issues = await withRetry(
        () => this.fetchIssuesFromGitHub(config),
        {
          ...DEFAULT_RETRY_CONFIG,
          maxRetries: 3,
          initialDelayMs: 1000,
        },
        this.errorHandler,
        { module: 'IssueFetcher', action: 'fetchIssues' }
      );

      // 更新缓存
      this.issuesListCache = { issues, timestamp: Date.now() };

      return issues;
    } catch (error: any) {
      // 如果有缓存，返回过期缓存
      if (this.issuesListCache) {
        console.warn('[IssueFetcher] 使用过期缓存（API 失败）');
        const cached = this.issuesListCache.issues;
        return config ? this.filterIssues(cached, config) : cached;
      }

      // 处理错误
      this.errorHandler.handleError(error, {
        module: 'IssueFetcher',
        action: 'fetchIssues',
        config,
      });

      console.error('[IssueFetcher] 获取 issues 失败，返回空数组');
      return [];
    }
  }

  /**
   * 从 GitHub 获取 Issues
   */
  private async fetchIssuesFromGitHub(config?: IssueFilterConfig): Promise<GitHubIssue[]> {
    const url = `${this.apiBase}/repos/${this.repoOwner}/${this.repoName}/issues?state=${config?.state || 'open'}&per_page=50`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Nexus-Agent-Evolution',
      },
    });

    if (!response.ok) {
      const statusCode = response.status;
      const statusText = response.statusText;

      // 处理速率限制
      if (statusCode === 403) {
        const remaining = response.headers.get('X-RateLimit-Remaining');
        if (remaining === '0') {
          throw new APIError('GitHub API 速率限制已达到', statusCode, { remaining: 0 }, { url });
        }
      }

      throw new APIError(`GitHub API 错误: ${statusCode} ${statusText}`, statusCode, { url });
    }

    const data = (await response.json()) as any[];

    // 过滤掉 PR，只保留 Issues
    const issues: GitHubIssue[] = data
      .filter((item: any) => !item.pull_request)
      .map((item: any) => ({
        id: item.id,
        number: item.number,
        title: item.title,
        body: item.body || '',
        state: item.state as 'open' | 'closed',
        labels: item.labels.map((l: any) => l.name),
        created_at: item.created_at,
        updated_at: item.updated_at,
        html_url: item.html_url,
        user: {
          login: item.user.login,
          avatar_url: item.user.avatar_url,
        },
      }));

    console.log(`[IssueFetcher] 获取到 ${issues.length} 个 issues`);

    // 应用过滤
    if (config) {
      return this.filterIssues(issues, config);
    }

    return issues;
  }

  /**
   * 过滤可处理的 Issues
   */
  async filterActionable(
    issues: GitHubIssue[],
    config?: IssueFilterConfig
  ): Promise<GitHubIssue[]> {
    return this.filterIssues(
      issues,
      config || {
        state: 'open',
        excludeLabels: ['wontfix', 'duplicate', 'invalid'],
        bugsOnly: false,
        enhancementsOnly: false,
      }
    );
  }

  /**
   * 过滤 Issues
   */
  private filterIssues(issues: GitHubIssue[], config: IssueFilterConfig): GitHubIssue[] {
    return issues.filter(issue => {
      // 排除指定标签
      if (config.excludeLabels?.length) {
        const hasExcludedLabel = issue.labels.some(label => config.excludeLabels!.includes(label));
        if (hasExcludedLabel) return false;
      }

      // 必须包含指定标签
      if (config.requireLabels?.length) {
        const hasRequiredLabel = config.requireLabels.some(label => issue.labels.includes(label));
        if (!hasRequiredLabel) return false;
      }

      // 排除指定作者
      if (config.excludeAuthors?.length) {
        if (config.excludeAuthors.includes(issue.user.login)) return false;
      }

      // 只看 bug
      if (config.bugsOnly && !issue.labels.includes('bug')) {
        return false;
      }

      // 只看 enhancement
      if (config.enhancementsOnly && !issue.labels.includes('enhancement')) {
        return false;
      }

      return true;
    });
  }

  /**
   * 获取单个 Issue 详情（带缓存和重试）
   */
  async getIssue(number: number): Promise<GitHubIssue | null> {
    // 尝试从缓存获取
    const cached = this.issueCache.get(number);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[IssueFetcher] 使用缓存的 issue #${number}`);
      return cached.issue;
    }

    try {
      const issue = await withRetry(
        () => this.getIssueFromGitHub(number),
        {
          ...DEFAULT_RETRY_CONFIG,
          maxRetries: 2,
          initialDelayMs: 500,
        },
        this.errorHandler,
        { module: 'IssueFetcher', action: 'getIssue', issueNumber: number }
      );

      // 更新缓存
      if (issue) {
        this.issueCache.set(number, { issue, timestamp: Date.now() });
      }

      return issue;
    } catch (error: any) {
      // 如果有缓存，返回过期缓存
      if (cached) {
        console.warn(`[IssueFetcher] 使用过期缓存的 issue #${number}`);
        return cached.issue;
      }

      this.errorHandler.handleError(error, {
        module: 'IssueFetcher',
        action: 'getIssue',
        issueNumber: number,
      });

      console.error(`[IssueFetcher] 获取 issue #${number} 失败:`, error.message);
      return null;
    }
  }

  /**
   * 从 GitHub 获取单个 Issue
   */
  private async getIssueFromGitHub(number: number): Promise<GitHubIssue | null> {
    const url = `${this.apiBase}/repos/${this.repoOwner}/${this.repoName}/issues/${number}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Nexus-Agent-Evolution',
      },
    });

    if (!response.ok) {
      throw new APIError(`GitHub API 错误: ${response.status}`, response.status, {
        url,
        issueNumber: number,
      });
    }

    const item = (await response.json()) as any;

    return {
      id: item.id,
      number: item.number,
      title: item.title,
      body: item.body || '',
      state: item.state as 'open' | 'closed',
      labels: item.labels.map((l: any) => l.name),
      created_at: item.created_at,
      updated_at: item.updated_at,
      html_url: item.html_url,
      user: {
        login: item.user.login,
        avatar_url: item.user.avatar_url,
      },
    };
  }

  /**
   * 设置检查间隔
   */
  setFetchInterval(intervalMs: number): void {
    this.fetchInterval = intervalMs;
  }

  /**
   * 获取检查间隔
   */
  getFetchInterval(): number {
    return this.fetchInterval;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.issueCache.clear();
    this.issuesListCache = null;
    console.log('[IssueFetcher] 缓存已清除');
  }
}

export default IssueFetcher;
