/**
 * Nexus Agent - Codex Module
 * 代码修改和管理模块
 * 
 * 提供两个版本：
 * - CodexManager: 原始版本
 * - SecureCodexManager: 带安全增强的版本（推荐）
 */

import { 
  CodexManager, 
  getCodexManager, 
  createCodexManager 
} from './codex_manager';

import { 
  SecureCodexManager as SecureCodex,
  getSecureCodexManager, 
  createSecureCodexManager 
} from './secure_codex_manager';

export { 
  CodexManager, 
  getCodexManager, 
  createCodexManager,
  SecureCodex,
  getSecureCodexManager, 
  createSecureCodexManager 
};

export type { 
  CodexTask, 
  ModificationResult, 
  TaskResult, 
  CodexStatus,
  CodexManagerConfig 
} from './codex_manager';

export type {
  SecureCodexManagerConfig
} from './secure_codex_manager';
