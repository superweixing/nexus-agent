import { Dashboard, createDashboard } from './src/web/dashboard';

// 创建并启动 Dashboard
const dashboard = createDashboard(3001);

console.log('Dashboard started at http://localhost:3001');

// 模拟添加历史记录
dashboard.addHistoryEntry({
  issueNumber: 123,
  success: true,
  message: '成功修复登录问题',
  prNumber: 45,
  timestamp: new Date().toISOString()
});

dashboard.updateEvolutionStatus({
  running: true,
  historyCount: 1
});

// 保持运行
setTimeout(() => {
  console.log('Stopping...');
  dashboard.stop();
  process.exit(0);
}, 10000);
