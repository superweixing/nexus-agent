import * as http from 'http';
import * as os from 'os';
import { getMetricsCollector, MetricsCollector, MetricsData } from '../metrics';

/**
 * 系统状态信息
 */
export interface SystemStatus {
  // 运行时间
  uptime: number;
  uptimeFormatted: string;
  // 内存使用
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  // CPU 信息
  cpu: {
    count: number;
    model: string;
    loadAvg: number[];
  };
  // 系统平台
  platform: string;
  hostname: string;
  // 时间戳
  timestamp: string;
}

/**
 * 进化状态
 */
export interface EvolutionStatus {
  running: boolean;
  historyCount: number;
  lastRun?: string;
  totalSuccess: number;
  totalFailed: number;
  recentResults: Array<{
    issueNumber: number;
    success: boolean;
    message: string;
    timestamp?: string;
  }>;
}

/**
 * 修改历史条目
 */
export interface HistoryEntry {
  issueNumber: number;
  success: boolean;
  message: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  timestamp: string;
}

/**
 * 完整的系统状态
 */
export interface DashboardData {
  system: SystemStatus;
  evolution: EvolutionStatus;
  history: HistoryEntry[];
  stats: {
    totalEvolutions: number;
    successRate: number;
    avgExecutionTime?: number;
  };
  // 新增：监控指标
  metrics?: MetricsData;
}

/**
 * 监控指标摘要（用于前端显示）
 */
export interface MetricsSummary {
  runtime: {
    llmCalls: number;
    llmCost: string;
    llmTokens: number;
    codexExecutions: number;
    codexSuccessRate: string;
    githubCalls: number;
    githubErrorRate: string;
    evolutionAttempts: number;
    evolutionSuccessRate: string;
  };
  performance: {
    avgProcessingTime: string;
    minProcessingTime: string;
    maxProcessingTime: string;
    memoryPercent: string;
    memoryTrend: Array<{ timestamp: number; percent: number }>;
    avgLatency: string;
  };
  business: {
    issuesProcessed: number;
    issuesOpen: number;
    issuesClosed: number;
    prsCreated: number;
    prsMerged: number;
    prsOpen: number;
    testsTotal: number;
    testsPassed: number;
    testsFailed: number;
    testPassRate: string;
  };
  lastUpdate: string;
}

/**
 * Web 状态面板
 */
export class Dashboard {
  private port: number = 3001;
  private server?: http.Server;
  private startTime: number;
  private evolutionStatus: EvolutionStatus = {
    running: false,
    historyCount: 0,
    totalSuccess: 0,
    totalFailed: 0,
    recentResults: []
  };
  private history: HistoryEntry[] = [];
  private metricsCollector: MetricsCollector;
  private memorySamplingInterval?: NodeJS.Timeout;

  constructor(port: number = 3001) {
    this.port = port;
    this.startTime = Date.now();
    this.metricsCollector = getMetricsCollector();
    
    // 启动内存采样定时器（每 30 秒采样一次）
    this.startMemorySampling();
  }
  
  /**
   * 启动内存采样
   */
  private startMemorySampling(): void {
    this.memorySamplingInterval = setInterval(() => {
      this.metricsCollector.recordMemoryUsage();
    }, 30000);
    
    // 立即执行一次
    this.metricsCollector.recordMemoryUsage();
  }
  
  /**
   * 获取指标收集器
   */
  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * 启动 HTTP 服务器
   */
  start(): void {
    if (this.server) {
      console.log('[Dashboard] 服务器已在运行');
      return;
    }

    this.server = http.createServer(async (req, res) => {
      // 设置 CORS 头
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // 处理预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 路由处理
      const url = req.url || '/';
      
      try {
        if (url === '/status') {
          await this.handleStatus(req, res);
        } else if (url === '/evolution') {
          await this.handleEvolution(req, res);
        } else if (url === '/history') {
          await this.handleHistory(req, res);
        } else if (url === '/metrics') {
          await this.handleMetrics(req, res);
        } else if (url === '/metrics/summary') {
          await this.handleMetricsSummary(req, res);
        } else if (url === '/' || url === '/index.html') {
          await this.handleIndex(req, res);
        } else if (url === '/data') {
          await this.handleData(req, res);
        } else {
          this.sendJson(res, 404, { error: 'Not Found' });
        }
      } catch (error: any) {
        console.error('[Dashboard] 请求处理错误:', error);
        this.sendJson(res, 500, { error: 'Internal Server Error', message: error.message });
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[Dashboard] Web 状态面板已启动: http://localhost:${this.port}`);
    });
  }

  /**
   * 停止 HTTP 服务器
   */
  stop(): void {
    // 停止内存采样定时器
    if (this.memorySamplingInterval) {
      clearInterval(this.memorySamplingInterval);
      this.memorySamplingInterval = undefined;
    }
    
    if (this.server) {
      this.server.close(() => {
        console.log('[Dashboard] 服务器已停止');
      });
      this.server = undefined;
    }
  }

  /**
   * 更新进化状态
   */
  updateEvolutionStatus(status: Partial<EvolutionStatus>): void {
    this.evolutionStatus = { ...this.evolutionStatus, ...status };
  }

  /**
   * 添加历史记录
   */
  addHistoryEntry(entry: HistoryEntry): void {
    this.history.unshift(entry);
    // 只保留最近 100 条
    if (this.history.length > 100) {
      this.history = this.history.slice(0, 100);
    }
  }

  /**
   * 处理 /status 端点
   */
  private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const status = this.getSystemStatus();
    this.sendJson(res, 200, status);
  }

  /**
   * 处理 /evolution 端点
   */
  private async handleEvolution(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const evolutionStatus: EvolutionStatus = {
      ...this.evolutionStatus,
      recentResults: this.history.slice(0, 10).map(h => ({
        issueNumber: h.issueNumber,
        success: h.success,
        message: h.message,
        timestamp: h.timestamp
      }))
    };
    this.sendJson(res, 200, evolutionStatus);
  }

  /**
   * 处理 /history 端点
   */
  private async handleHistory(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 支持分页参数
    const url = new URL(req.url || '/', `http://localhost`);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    const paginatedHistory = this.history.slice(offset, offset + limit);
    
    this.sendJson(res, 200, {
      entries: paginatedHistory,
      total: this.history.length,
      limit,
      offset
    });
  }

  /**
   * 处理 /metrics 端点 - 返回完整指标数据
   */
  private async handleMetrics(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const metrics = this.metricsCollector.getMetrics();
    this.sendJson(res, 200, metrics);
  }

  /**
   * 处理 /metrics/summary 端点 - 返回简化指标摘要
   */
  private async handleMetricsSummary(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const summary = this.getMetricsSummary();
    this.sendJson(res, 200, summary);
  }

  /**
   * 获取指标摘要
   */
  private getMetricsSummary(): MetricsSummary {
    const metrics = this.metricsCollector.getMetrics();
    
    return {
      runtime: {
        llmCalls: metrics.runtime.llmCalls,
        llmCost: `$${metrics.runtime.llmTotalCost.toFixed(4)}`,
        llmTokens: metrics.runtime.llmTotalTokens,
        codexExecutions: metrics.runtime.codexExecutions,
        codexSuccessRate: `${((metrics.runtime.codexSuccessCount / Math.max(metrics.runtime.codexExecutions, 1)) * 100).toFixed(1)}%`,
        githubCalls: metrics.runtime.githubApiCalls,
        githubErrorRate: `${((metrics.runtime.githubApiErrors / Math.max(metrics.runtime.githubApiCalls, 1)) * 100).toFixed(1)}%`,
        evolutionAttempts: metrics.runtime.evolutionAttempts,
        evolutionSuccessRate: `${metrics.runtime.evolutionSuccessRate.toFixed(1)}%`
      },
      performance: {
        avgProcessingTime: `${metrics.performance.avgProcessingTime.toFixed(0)}ms`,
        minProcessingTime: `${metrics.performance.minProcessingTime.toFixed(0)}ms`,
        maxProcessingTime: `${metrics.performance.maxProcessingTime.toFixed(0)}ms`,
        memoryPercent: `${this.metricsCollector.getCurrentMemoryPercent().toFixed(1)}%`,
        memoryTrend: metrics.performance.memoryTrend.map(m => ({
          timestamp: m.timestamp,
          percent: m.percent
        })),
        avgLatency: `${metrics.performance.avgResponseLatency.toFixed(0)}ms`
      },
      business: {
        issuesProcessed: metrics.business.issuesProcessed,
        issuesOpen: metrics.business.issuesOpen,
        issuesClosed: metrics.business.issuesClosed,
        prsCreated: metrics.business.prsCreated,
        prsMerged: metrics.business.prsMerged,
        prsOpen: metrics.business.prsOpen,
        testsTotal: metrics.business.testsTotal,
        testsPassed: metrics.business.testsPassed,
        testsFailed: metrics.business.testsFailed,
        testPassRate: `${metrics.business.testPassRate.toFixed(1)}%`
      },
      lastUpdate: metrics.lastUpdate
    };
  }

  /**
   * 处理 /data 端点 - 返回完整数据
   */
  private async handleData(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const data = this.getDashboardData();
    this.sendJson(res, 200, data);
  }

  /**
   * 处理首页
   */
  private async handleIndex(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const html = this.generateDashboardHTML();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /**
   * 获取系统状态
   */
  private getSystemStatus(): SystemStatus {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    const cpuCount = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'Unknown';
    
    const uptime = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptime / 1000);
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeFormatted = `${days}天 ${hours}时 ${minutes}分 ${seconds}秒`;

    return {
      uptime,
      uptimeFormatted,
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usagePercent: (usedMem / totalMem) * 100
      },
      cpu: {
        count: cpuCount,
        model: cpuModel,
        loadAvg: os.loadavg()
      },
      platform: os.platform(),
      hostname: os.hostname(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 获取完整仪表盘数据
   */
  private getDashboardData(): DashboardData {
    const successCount = this.history.filter(h => h.success).length;
    const totalCount = this.history.length;
    
    return {
      system: this.getSystemStatus(),
      evolution: {
        ...this.evolutionStatus,
        recentResults: this.history.slice(0, 10).map(h => ({
          issueNumber: h.issueNumber,
          success: h.success,
          message: h.message,
          timestamp: h.timestamp
        }))
      },
      history: this.history.slice(0, 50),
      stats: {
        totalEvolutions: totalCount,
        successRate: totalCount > 0 ? (successCount / totalCount) * 100 : 0
      },
      // 包含监控指标
      metrics: this.metricsCollector.getMetrics()
    };
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * 生成仪表盘 HTML
   */
  private generateDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexus Agent 状态面板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { 
      text-align: center; 
      margin-bottom: 30px;
      font-size: 2rem;
      background: linear-gradient(90deg, #00d4ff, #7c3aed);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
      gap: 20px;
      margin-bottom: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 20px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .card h2 {
      font-size: 1.1rem;
      margin-bottom: 15px;
      color: #00d4ff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: #888; }
    .stat-value { font-weight: bold; color: #fff; }
    .progress-bar {
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 5px;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00d4ff, #7c3aed);
      transition: width 0.3s ease;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
    }
    .status-running { background: #10b981; color: #fff; }
    .status-stopped { background: #ef4444; color: #fff; }
    .history-table {
      width: 100%;
      border-collapse: collapse;
    }
    .history-table th, .history-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .history-table th { color: #888; font-weight: 500; }
    .success { color: #10b981; }
    .failed { color: #ef4444; }
    .timestamp { color: #666; font-size: 0.85rem; }
    .refresh-btn {
      display: block;
      margin: 20px auto;
      padding: 12px 30px;
      background: linear-gradient(90deg, #00d4ff, #7c3aed);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .refresh-btn:hover { transform: scale(1.05); }
    .last-update { text-align: center; color: #666; margin-top: 10px; }
    
    /* 新增：指标卡片的特殊样式 */
    .metric-card {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 15px;
      text-align: center;
    }
    .metric-value {
      font-size: 1.8rem;
      font-weight: bold;
      color: #00d4ff;
    }
    .metric-label {
      font-size: 0.85rem;
      color: #888;
      margin-top: 5px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .section-title {
      font-size: 1.2rem;
      color: #fff;
      margin: 30px 0 15px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid rgba(0, 212, 255, 0.3);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Nexus Agent 状态面板</h1>
    
    <div class="grid">
      <div class="card">
        <h2>💻 系统状态</h2>
        <div class="stat">
          <span class="stat-label">运行时间</span>
          <span class="stat-value" id="uptime">加载中...</span>
        </div>
        <div class="stat">
          <span class="stat-label">主机名</span>
          <span class="stat-value" id="hostname">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">平台</span>
          <span class="stat-value" id="platform">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">CPU 核心</span>
          <span class="stat-value" id="cpuCount">-</span>
        </div>
      </div>

      <div class="card">
        <h2>🧠 内存使用</h2>
        <div class="stat">
          <span class="stat-label">总内存</span>
          <span class="stat-value" id="totalMem">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">已使用</span>
          <span class="stat-value" id="usedMem">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">可用</span>
          <span class="stat-value" id="freeMem">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">使用率</span>
          <span class="stat-value" id="memPercent">-</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="memBar" style="width: 0%"></div>
        </div>
      </div>

      <div class="card">
        <h2>🔄 进化状态</h2>
        <div class="stat">
          <span class="stat-label">运行状态</span>
          <span class="stat-value"><span class="status-badge" id="evoStatus">-</span></span>
        </div>
        <div class="stat">
          <span class="stat-label">总进化次数</span>
          <span class="stat-value" id="totalEvo">0</span>
        </div>
        <div class="stat">
          <span class="stat-label">成功次数</span>
          <span class="stat-value success" id="successCount">0</span>
        </div>
        <div class="stat">
          <span class="stat-label">成功率</span>
          <span class="stat-value" id="successRate">0%</span>
        </div>
      </div>
    </div>

    <!-- 新增：运行指标面板 -->
    <h3 class="section-title">📊 运行指标</h3>
    <div class="grid">
      <div class="card">
        <h2>🤖 LLM 调用</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="llmCalls">0</div>
            <div class="metric-label">调用次数</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="llmTokens">0</div>
            <div class="metric-label">消耗 Token</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="llmCost">$0</div>
            <div class="metric-label">调用成本</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>⚡ Codex 执行</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="codexExecutions">0</div>
            <div class="metric-label">执行次数</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="codexSuccessRate">0%</div>
            <div class="metric-label">成功率</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>🐙 GitHub API</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="githubCalls">0</div>
            <div class="metric-label">API 调用</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="githubErrorRate">0%</div>
            <div class="metric-label">错误率</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>🧬 进化统计</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="evolutionAttempts">0</div>
            <div class="metric-label">进化次数</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="evolutionSuccessRate">0%</div>
            <div class="metric-label">成功率</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增：性能指标面板 -->
    <h3 class="section-title">⚡ 性能指标</h3>
    <div class="grid">
      <div class="card">
        <h2>⏱️ 处理时间</h2>
        <div class="stat">
          <span class="stat-label">平均处理时间</span>
          <span class="stat-value" id="avgProcessingTime">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">最短处理时间</span>
          <span class="stat-value" id="minProcessingTime">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">最长处理时间</span>
          <span class="stat-value" id="maxProcessingTime">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">平均响应延迟</span>
          <span class="stat-value" id="avgLatency">-</span>
        </div>
      </div>

      <div class="card">
        <h2>📈 内存趋势</h2>
        <canvas id="memoryChart" width="400" height="150" style="width:100%;height:150px;"></canvas>
        <div class="stat">
          <span class="stat-label">当前使用率</span>
          <span class="stat-value" id="currentMemoryPercent">-</span>
        </div>
      </div>
    </div>

    <!-- 新增：业务指标面板 -->
    <h3 class="section-title">📋 业务指标</h3>
    <div class="grid">
      <div class="card">
        <h2>📝 Issue 处理</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="issuesProcessed">0</div>
            <div class="metric-label">已处理</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="issuesOpen">0</div>
            <div class="metric-label">开放</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="issuesClosed">0</div>
            <div class="metric-label">已关闭</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>🔧 PR 创建</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="prsCreated">0</div>
            <div class="metric-label">已创建</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="prsMerged">0</div>
            <div class="metric-label">已合并</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="prsOpen">0</div>
            <div class="metric-label">开放</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>✅ 测试结果</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value" id="testsTotal">0</div>
            <div class="metric-label">总测试</div>
          </div>
          <div class="metric-card">
            <div class="metric-value success" id="testsPassed">0</div>
            <div class="metric-label">通过</div>
          </div>
          <div class="metric-card">
            <div class="metric-value failed" id="testsFailed">0</div>
            <div class="metric-label">失败</div>
          </div>
        </div>
        <div class="stat" style="margin-top: 15px;">
          <span class="stat-label">测试通过率</span>
          <span class="stat-value" id="testPassRate">0%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="testPassBar" style="width: 0%"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📜 修改历史</h2>
      <table class="history-table">
        <thead>
          <tr>
            <th>Issue #</th>
            <th>状态</th>
            <th>消息</th>
            <th>PR</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody id="historyBody">
          <tr><td colspan="5" style="text-align:center">加载中...</td></tr>
        </tbody>
      </table>
    </div>

    <button class="refresh-btn" onclick="refresh()">🔄 刷新数据</button>
    <div class="last-update">最后更新: <span id="lastUpdate">-</span></div>
  </div>

  <script>
    function formatBytes(bytes) {
      const gb = bytes / (1024 * 1024 * 1024);
      return gb.toFixed(2) + ' GB';
    }

    function formatTime(timestamp) {
      return new Date(timestamp).toLocaleString('zh-CN');
    }

    // 内存趋势数据
    let memoryTrendData = [];

    async function refresh() {
      try {
        const [statusRes, evoRes, historyRes, metricsRes] = await Promise.all([
          fetch('/status'),
          fetch('/evolution'),
          fetch('/history?limit=20'),
          fetch('/metrics/summary')
        ]);
        
        const status = await statusRes.json();
        const evolution = await evoRes.json();
        const history = await historyRes.json();
        const metrics = await metricsRes.json();

        // 系统状态
        document.getElementById('uptime').textContent = status.uptimeFormatted;
        document.getElementById('hostname').textContent = status.hostname;
        document.getElementById('platform').textContent = status.platform;
        document.getElementById('cpuCount').textContent = status.cpu.count;

        // 内存
        document.getElementById('totalMem').textContent = formatBytes(status.memory.total);
        document.getElementById('usedMem').textContent = formatBytes(status.memory.used);
        document.getElementById('freeMem').textContent = formatBytes(status.memory.free);
        document.getElementById('memPercent').textContent = status.memory.usagePercent.toFixed(1) + '%';
        document.getElementById('memBar').style.width = status.memory.usagePercent + '%';

        // 进化状态
        const evoStatus = document.getElementById('evoStatus');
        evoStatus.textContent = evolution.running ? '运行中' : '已停止';
        evoStatus.className = 'status-badge ' + (evolution.running ? 'status-running' : 'status-stopped');
        
        document.getElementById('totalEvo').textContent = evolution.historyCount || 0;
        
        const successCount = history.entries.filter(e => e.success).length;
        const totalCount = history.entries.length;
        const successRate = totalCount > 0 ? (successCount / totalCount * 100).toFixed(1) : 0;
        
        document.getElementById('successCount').textContent = successCount;
        document.getElementById('successRate').textContent = successRate + '%';

        // ===== 运行指标 =====
        // LLM 调用
        document.getElementById('llmCalls').textContent = metrics.runtime.llmCalls;
        document.getElementById('llmTokens').textContent = metrics.runtime.llmTokens.toLocaleString();
        document.getElementById('llmCost').textContent = metrics.runtime.llmCost;
        
        // Codex 执行
        document.getElementById('codexExecutions').textContent = metrics.runtime.codexExecutions;
        document.getElementById('codexSuccessRate').textContent = metrics.runtime.codexSuccessRate;
        
        // GitHub API
        document.getElementById('githubCalls').textContent = metrics.runtime.githubCalls;
        document.getElementById('githubErrorRate').textContent = metrics.runtime.githubErrorRate;
        
        // 进化统计
        document.getElementById('evolutionAttempts').textContent = metrics.runtime.evolutionAttempts;
        document.getElementById('evolutionSuccessRate').textContent = metrics.runtime.evolutionSuccessRate;

        // ===== 性能指标 =====
        document.getElementById('avgProcessingTime').textContent = metrics.performance.avgProcessingTime;
        document.getElementById('minProcessingTime').textContent = metrics.performance.minProcessingTime;
        document.getElementById('maxProcessingTime').textContent = metrics.performance.maxProcessingTime;
        document.getElementById('avgLatency').textContent = metrics.performance.avgLatency;
        document.getElementById('currentMemoryPercent').textContent = metrics.performance.memoryPercent;
        
        // 更新内存趋势图表
        memoryTrendData = metrics.performance.memoryTrend;
        drawMemoryChart();

        // ===== 业务指标 =====
        // Issue 处理
        document.getElementById('issuesProcessed').textContent = metrics.business.issuesProcessed;
        document.getElementById('issuesOpen').textContent = metrics.business.issuesOpen;
        document.getElementById('issuesClosed').textContent = metrics.business.issuesClosed;
        
        // PR 创建
        document.getElementById('prsCreated').textContent = metrics.business.prsCreated;
        document.getElementById('prsMerged').textContent = metrics.business.prsMerged;
        document.getElementById('prsOpen').textContent = metrics.business.prsOpen;
        
        // 测试结果
        document.getElementById('testsTotal').textContent = metrics.business.testsTotal;
        document.getElementById('testsPassed').textContent = metrics.business.testsPassed;
        document.getElementById('testsFailed').textContent = metrics.business.testsFailed;
        document.getElementById('testPassRate').textContent = metrics.business.testPassRate;
        document.getElementById('testPassBar').style.width = metrics.business.testPassRate;

        // 历史记录
        const tbody = document.getElementById('historyBody');
        if (history.entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">暂无记录</td></tr>';
        } else {
          tbody.innerHTML = history.entries.map(e => \`
            <tr>
              <td>#\${e.issueNumber}</td>
              <td class="\${e.success ? 'success' : 'failed'}">\${e.success ? '✓ 成功' : '✗ 失败'}</td>
              <td>\${e.message}</td>
              <td>\${e.prUrl ? '<a href="' + e.prUrl + '" target="_blank" style="color:#00d4ff">#' + e.prNumber + '</a>' : '-'}</td>
              <td class="timestamp">\${e.timestamp ? formatTime(e.timestamp) : '-'}</td>
            </tr>
          \`).join('');
        }

        document.getElementById('lastUpdate').textContent = formatTime(Date.now());
      } catch (err) {
        console.error('刷新失败:', err);
      }
    }

    // 绘制内存趋势图表
    function drawMemoryChart() {
      const canvas = document.getElementById('memoryChart');
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      
      // 清空画布
      ctx.clearRect(0, 0, width, height);
      
      if (memoryTrendData.length < 2) {
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('等待更多数据...', width / 2, height / 2);
        return;
      }
      
      // 绘制网格线
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      
      // 绘制趋势线
      const maxVal = 100;
      const dataPoints = memoryTrendData.slice(-60); // 最多显示60个点
      
      // 填充区域
      ctx.beginPath();
      ctx.moveTo(0, height);
      
      dataPoints.forEach((point, index) => {
        const x = (index / (dataPoints.length - 1)) * width;
        const y = height - (point.percent / maxVal) * height;
        if (index === 0) {
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.lineTo(width, height);
      ctx.closePath();
      
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
      gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // 绘制线条
      ctx.beginPath();
      dataPoints.forEach((point, index) => {
        const x = (index / (dataPoints.length - 1)) * width;
        const y = height - (point.percent / maxVal) * height;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 自动刷新
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;
  }
}

/**
 * 创建并启动 Dashboard
 */
export function createDashboard(port: number = 3001): Dashboard {
  const dashboard = new Dashboard(port);
  dashboard.start();
  return dashboard;
}

export default Dashboard;

// 直接运行此文件时启动 Dashboard
if (require.main === module) {
  const port = parseInt(process.argv[2]) || 3001;
  console.log(`Starting Dashboard on port ${port}...`);
  createDashboard(port);
}
