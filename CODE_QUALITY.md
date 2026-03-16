# 代码质量检查配置

本项目已配置完整的代码质量检查工具链。

## 已安装工具

| 工具 | 版本 | 用途 |
|------|------|------|
| ESLint | ^8.57.0 | 代码规范检查 |
| Prettier | ^3.2.5 | 代码格式化 |
| TypeScript | ^5.0.0 | 类型检查 |
| Husky | ^9.0.11 | Git Hooks |
| lint-staged | ^15.2.2 | staged 文件检查 |

## 可用命令

```bash
# 代码格式化
npm run format        # 格式化所有代码
npm run format:check # 检查格式（不修改）

# 代码检查
npm run lint          # ESLint 检查
npm run lint:fix      # ESLint 自动修复

# 类型检查
npm run typecheck     # TypeScript 类型检查

# 完整验证
npm run validate      # 运行 typecheck + lint + format:check
```

## Git Hooks

已配置以下 Git Hooks：

### pre-commit
在每次提交前运行：
- TypeScript 类型检查
- ESLint 代码检查
- Prettier 格式检查

### pre-push
在每次推送前运行：
- 完整验证 (validate)
- 运行测试

## GitHub Actions CI/CD

配置文件：`.github/workflows/ci.yml`

自动在以下时机运行：
- 推送到 main/master 分支
- 提交 Pull Request

检查内容：
1. Prettier 格式检查
2. ESLint 代码检查
3. TypeScript 类型检查
4. 测试执行

## 注意事项

1. 首次使用需运行 `npm install` 安装依赖
2. Husky hooks 会在 `npm install` 时自动安装
3. 如果需要跳过 hooks，可以使用 `git commit --no-verify` 或 `git push --no-verify`
4. TypeScript 类型检查默认是严格模式，如有需要可调整 `tsconfig.json`

## IDE 集成

推荐安装 VSCode 插件：
- ESLint
- Prettier - Code formatter
- TypeScript Vue Plugin (Volar)
