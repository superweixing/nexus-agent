/**
 * Nexus Agent 进化流程测试脚本
 * 
 * 测试目标:
 * 1. 获取 OpenClaw GitHub Issues
 * 2. 评估第一个可执行的 Issue
 * 3. 生成修改建议（不需要真正修改，只输出建议）
 * 4. 输出完整的评估报告
 */

const fs = require('fs');
const path = require('path');

// API Key 从环境变量或配置获取
const API_KEY = process.env.MINIMAX_API_KEY || 'sk-cp-UfiAvPxGtW2mc3CaHoN7zprxujlN2Nsy-JpM0gzFtNZ49tudOqZmUzKDPKZqrV2msm4Id4v7_ifCbsjxMX612GDE3Mds9icNhIpynovfXu_yfatFpUAnr2E';
const BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';

// Issue Fetcher - 简化版
class IssueFetcher {
  constructor() {
    this.repoOwner = 'openclaw';
    this.repoName = 'openclaw';
    this.apiBase = 'https://api.github.com';
  }

  async fetchIssues(config = {}) {
    try {
      const url = `${this.apiBase}/repos/${this.repoOwner}/${this.repoName}/issues?state=open&per_page=30`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Nexus-Agent-Test'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      
      const issues = data
        .filter(item => !item.pull_request)
        .map(item => ({
          id: item.id,
          number: item.number,
          title: item.title,
          body: item.body || '',
          state: item.state,
          labels: item.labels.map(l => l.name),
          created_at: item.created_at,
          updated_at: item.updated_at,
          html_url: item.html_url,
          user: {
            login: item.user.login,
            avatar_url: item.user.avatar_url
          }
        }));

      return this.filterIssues(issues, config);
    } catch (error) {
      console.error('[IssueFetcher] 获取 issues 失败:', error.message);
      return [];
    }
  }

  filterIssues(issues, config) {
    const excludeLabels = config.excludeLabels || ['wontfix', 'duplicate', 'invalid', 'low-priority'];
    
    return issues.filter(issue => {
      // 排除指定标签
      if (issue.labels.some(label => excludeLabels.includes(label))) {
        return false;
      }
      return true;
    });
  }
}

// MiniMax LLM 客户端
class MiniMaxClient {
  constructor(apiKey, baseUrl = BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = 'MiniMax-M2.5';
  }

  async chat(systemPrompt, userPrompt) {
    const url = `${this.baseUrl}/text/chatcompletion_v2`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage
    };
  }
}

// Issue 评估器
class IssueEvaluator {
  constructor(llmClient) {
    this.llm = llmClient;
  }

  async evaluate(issue) {
    const systemPrompt = `你是一个专业的代码审查和 GitHub Issue 评估专家。
你的任务是评估 GitHub Issue 的重要性、难度，并判断是否可执行。
请基于以下标准进行评估：

1. 重要性 (0-1):
   - Bug 和安全问题: 0.8-1.0
   - 功能增强: 0.6-0.8
   - 文档改进: 0.3-0.5
   - 低优先级: 0.1-0.3

2. 难度 (0-1):
   - 简单修复 (typo, 简单bug): 0.1-0.3
   - 中等 (功能实现): 0.4-0.6
   - 复杂 (重构, 架构调整): 0.7-1.0

3. 可执行性:
   - 有明确解决方案: 可执行
   - 需要讨论或设计: 不可执行
   - 过于模糊: 不可执行

请严格按照以下格式输出评估结果：
重要程度：[0-1的数值]
难度：[0-1的数值]
是否可执行：[是/否]
执行策略：[简短描述修复策略]
需要修改的文件：[预估需要修改的文件路径]
修改建议：[具体的修改建议]`;

    const userPrompt = `请评估以下 GitHub Issue：

**编号**: #${issue.number}
**标题**: ${issue.title}
**内容**: ${issue.body || '(无详细描述)'}
**标签**: ${issue.labels.join(', ') || '无'}
**作者**: ${issue.user.login}
**链接**: ${issue.html_url}`;

    try {
      const response = await this.llm.chat(systemPrompt, userPrompt);
      return this.parseEvaluation(issue, response.content);
    } catch (error) {
      console.error('[Evaluator] LLM 评估失败:', error.message);
      return this.fallbackEvaluate(issue);
    }
  }

  parseEvaluation(issue, response) {
    const result = {
      issue,
      importance: 0.5,
      difficulty: 0.5,
      actionable: false,
      strategy: '',
      estimatedFiles: [],
      modificationSuggestions: '',
      reason: ''
    };

    // 解析重要程度
    const importanceMatch = response.match(/重要程度[：:]\s*([0-9.]+)/i);
    if (importanceMatch) {
      result.importance = Math.max(0, Math.min(1, parseFloat(importanceMatch[1])));
    }

    // 解析难度
    const difficultyMatch = response.match(/难度[：:]\s*([0-9.]+)/i);
    if (difficultyMatch) {
      result.difficulty = Math.max(0, Math.min(1, parseFloat(difficultyMatch[1])));
    }

    // 解析是否可执行
    const actionableMatch = response.match(/是否可执行[：:]?\s*(是|否|yes|no|true|false|可以|不可以)/i);
    if (actionableMatch) {
      const value = actionableMatch[1].toLowerCase();
      result.actionable = value === '是' || value === 'yes' || value === 'true' || value === '可以';
    }

    // 解析执行策略
    const strategyMatch = response.match(/执行策略[：:]\s*([^\n]+)/i);
    if (strategyMatch) {
      result.strategy = strategyMatch[1].trim();
    } else {
      // 尝试从内容中提取
      const execStrategyMatch = response.match(/\*\*执行策略[：:]\*\*\s*([^\n]+)/i) ||
                               response.match(/### 执行策略\s*([\s\S]*?)(?:###|$)/i);
      if (execStrategyMatch) {
        result.strategy = execStrategyMatch[1].trim().substring(0, 200);
      }
    }

    // 解析预估文件
    const filesMatch = response.match(/需要修改的文件[：:]\s*([\s\S]*?)(?:###|修改建议|$)/i);
    if (filesMatch) {
      result.estimatedFiles = filesMatch[1].split('\n').filter(f => f.trim().startsWith('-')).map(f => f.trim().substring(1).trim());
    }

    // 解析修改建议
    const suggestionsMatch = response.match(/修改建议[：:]\s*([\s\S]*?)(?:```|$)/i);
    if (suggestionsMatch) {
      result.modificationSuggestions = suggestionsMatch[1].trim().substring(0, 500);
    }

    result.reason = `LLM 智能评估: ${response.substring(0, 300)}...`;

    return result;
  }

  fallbackEvaluate(issue) {
    // 简单的规则回退评估
    let importance = 0.5;
    let difficulty = 0.3;
    const labels = issue.labels;

    if (labels.includes('urgent') || labels.includes('critical')) {
      importance = 0.9;
    } else if (labels.includes('bug')) {
      importance = 0.7;
    } else if (labels.includes('enhancement')) {
      importance = 0.6;
    }

    const content = (issue.title + ' ' + issue.body).toLowerCase();
    if (content.includes('refactor') || content.includes('architecture')) {
      difficulty = 0.7;
    }

    const actionable = !labels.includes('wontfix') && 
                       !labels.includes('duplicate') && 
                       !labels.includes('invalid') &&
                       difficulty < 0.8;

    return {
      issue,
      importance,
      difficulty,
      actionable,
      strategy: labels.includes('bug') ? '修复 bug' : '分析并处理',
      estimatedFiles: [],
      modificationSuggestions: '需要进一步分析',
      reason: '基于规则的回退评估'
    };
  }
}

// 报告生成器
function generateReport(evaluation) {
  const issue = evaluation.issue;
  
  const report = `
╔══════════════════════════════════════════════════════════════════╗
║              Nexus Agent 进化流程测试报告                         ║
╚══════════════════════════════════════════════════════════════════╝

📋 Issue 信息
────────────────────────────────────────────────────────────────────
  编号:   #${issue.number}
  标题:   ${issue.title}
  作者:   ${issue.user.login}
  标签:   ${issue.labels.join(', ') || '无'}
  链接:   ${issue.html_url}
  创建时间: ${new Date(issue.created_at).toLocaleString('zh-CN')}

📝 Issue 内容
────────────────────────────────────────────────────────────────────
${issue.body ? issue.body.substring(0, 500) + (issue.body.length > 500 ? '...' : '') : '(无详细描述)'}

📊 评估结果
────────────────────────────────────────────────────────────────────
  重要性:   ${(evaluation.importance * 100).toFixed(0)}% ${getImportanceLevel(evaluation.importance)}
  难度:     ${(evaluation.difficulty * 100).toFixed(0)}% ${getDifficultyLevel(evaluation.difficulty)}
  可执行:   ${evaluation.actionable ? '✅ 是' : '❌ 否'}
  
  评估理由:
  ${evaluation.reason}

🎯 执行策略
────────────────────────────────────────────────────────────────────
  ${evaluation.strategy || '待确定'}

📁 预估修改文件
────────────────────────────────────────────────────────────────────
${evaluation.estimatedFiles?.length ? evaluation.estimatedFiles.map(f => `  - ${f}`).join('\n') : '  (需要进一步分析)'}

💡 修改建议
────────────────────────────────────────────────────────────────────
${evaluation.modificationSuggestions || '需要 LLM 进一步分析给出具体建议'}

════════════════════════════════════════════════════════════════════
  评估时间: ${new Date().toLocaleString('zh-CN')}
  API: MiniMax-M2.5
════════════════════════════════════════════════════════════════════
`;
  
  return report;
}

function getImportanceLevel(importance) {
  if (importance >= 0.8) return '🔴 紧急';
  if (importance >= 0.6) return '🟠 高';
  if (importance >= 0.4) return '🟡 中';
  return '🟢 低';
}

function getDifficultyLevel(difficulty) {
  if (difficulty >= 0.7) return '🔴 困难';
  if (difficulty >= 0.5) return '🟠 中等';
  if (difficulty >= 0.3) return '🟡 简单';
  return '🟢 很容易';
}

// 主函数
async function main() {
  console.log('\n🚀 开始 Nexus Agent 进化流程测试\n');
  console.log('═'.repeat(60));

  // 1. 获取 Issues
  console.log('\n📥 步骤 1: 获取 OpenClaw GitHub Issues...\n');
  
  const fetcher = new IssueFetcher();
  const issues = await fetcher.fetchIssues({
    excludeLabels: ['wontfix', 'duplicate', 'invalid', 'low-priority']
  });

  console.log(`✅ 成功获取 ${issues.length} 个 Open Issues`);

  if (issues.length === 0) {
    console.log('\n❌ 没有找到可处理的 Issues\n');
    process.exit(1);
  }

  // 显示前 5 个 Issues
  console.log('\n📋 可处理的 Issues 列表:');
  issues.slice(0, 5).forEach((issue, i) => {
    console.log(`  ${i + 1}. #${issue.number} - ${issue.title.substring(0, 50)}`);
    console.log(`     标签: ${issue.labels.join(', ') || '无'}`);
  });

  // 2. 评估第一个可执行的 Issue
  console.log('\n\n📊 步骤 2: 评估第一个可执行的 Issue...\n');

  // 初始化 LLM 客户端
  const llm = new MiniMaxClient(API_KEY);
  const evaluator = new IssueEvaluator(llm);

  // 评估第一个 Issue
  const firstIssue = issues[0];
  console.log(`正在评估 Issue #${firstIssue.number}: ${firstIssue.title}`);
  
  const evaluation = await evaluator.evaluate(firstIssue);

  // 3. 生成评估报告
  console.log('\n📝 步骤 3: 生成评估报告...\n');

  const report = generateReport(evaluation);
  console.log(report);

  // 保存报告到文件
  const reportPath = path.join(__dirname, 'evolution-test-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`📄 报告已保存到: ${reportPath}`);

  // 返回评估结果
  return {
    success: true,
    issue: firstIssue,
    evaluation
  };
}

// 运行
main()
  .then(result => {
    console.log('\n✅ 测试完成!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  });
