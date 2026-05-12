const STORAGE_KEY = 'tether:slash-cmd-counts';

export type SlashCommand = {
  name: string;
  description: string;
};

// Static list — general usefulness order, overridden at runtime by localStorage counts
export const SLASH_COMMANDS: SlashCommand[] = [
  // ── GSD 核心工作流 ──────────────────────────────────────────────
  { name: 'gsd-help',              description: '显示可用的 GSD 命令和使用指南' },
  { name: 'gsd-progress',          description: '检查进度、推进工作流或分派自由意图' },
  { name: 'gsd-discuss-phase',     description: '在规划前通过自适应问答收集阶段上下文' },
  { name: 'gsd-plan-phase',        description: '创建详细阶段计划 (PLAN.md)' },
  { name: 'gsd-execute-phase',     description: '执行阶段中的所有计划（并行波次）' },
  { name: 'gsd-verify-work',       description: '通过会话式 UAT 验证已构建的功能' },
  { name: 'gsd-quick',             description: '使用 GSD 保证执行快速任务，跳过可选代理' },
  { name: 'gsd-fast',              description: '内联执行简单任务，无子代理、无规划开销' },
  { name: 'gsd-debug',             description: '跨上下文重置的持久状态系统化调试' },
  { name: 'gsd-ship',              description: '创建 PR、运行审查，并在验证通过后准备合并' },
  // ── GSD 项目生命周期 ─────────────────────────────────────────────
  { name: 'gsd-new-project',       description: '通过深度上下文收集初始化新项目' },
  { name: 'gsd-new-milestone',     description: '开始新的里程碑周期，更新 PROJECT.md' },
  { name: 'gsd-complete-milestone',description: '归档已完成的里程碑并准备下一个版本' },
  { name: 'gsd-phase',             description: 'ROADMAP.md 中阶段的增删改查' },
  { name: 'gsd-spec-phase',        description: '通过歧义评分澄清阶段交付内容' },
  // ── GSD 审查 & 质量 ──────────────────────────────────────────────
  { name: 'gsd-code-review',       description: '审查源文件，检查错误、安全问题和代码质量' },
  { name: 'gsd-ui-review',         description: '已实现前端代码的回顾性六维视觉审计' },
  { name: 'gsd-secure-phase',      description: '回顾性验证已完成阶段的威胁缓解措施' },
  { name: 'gsd-validate-phase',    description: '回顾性审计并填充已完成阶段的验证缺口' },
  { name: 'gsd-add-tests',         description: '根据 UAT 标准和实现为已完成阶段生成测试' },
  { name: 'gsd-audit-fix',         description: '自主审计修复流水线：发现问题、修复、提交' },
  { name: 'gsd-review',            description: '向外部 AI CLI 请求阶段计划的跨 AI 同行审查' },
  // ── GSD 上下文 & 文档 ────────────────────────────────────────────
  { name: 'gsd-map-codebase',      description: '使用并行映射代理分析代码库，生成文档' },
  { name: 'gsd-docs-update',       description: '生成或更新经代码库验证的项目文档' },
  { name: 'gsd-pause-work',        description: '在阶段中途暂停时创建上下文交接文档' },
  { name: 'gsd-resume-work',       description: '从上一个会话恢复工作并还原上下文' },
  { name: 'gsd-thread',            description: '管理跨会话工作的持久上下文线程' },
  { name: 'gsd-extract-learnings', description: '从已完成阶段提取决策、经验教训和模式' },
  { name: 'gsd-capture',           description: '将想法、任务、笔记捕获到目标位置' },
  // ── GSD 工具 ─────────────────────────────────────────────────────
  { name: 'gsd-stats',             description: '显示项目统计：阶段、计划、需求、git 指标' },
  { name: 'gsd-health',            description: '诊断规划目录健康状况并可选修复问题' },
  { name: 'gsd-undo',              description: '安全 git 回滚，使用阶段清单和依赖检查' },
  { name: 'gsd-update',            description: '更新 GSD 到最新版本并显示更新日志' },
  { name: 'gsd-config',            description: '配置 GSD 设置：工作流开关、集成和模型配置' },
  { name: 'gsd-spike',             description: '通过体验性探索验证想法（前沿模式）' },
  { name: 'gsd-sketch',            description: '用一次性 HTML 模型草图绘制 UI/设计想法' },
  { name: 'gsd-inbox',             description: '分类审查开放的 GitHub 问题和 PR' },
  { name: 'gsd-import',            description: '摄取外部计划并检测与项目决策的冲突' },
  { name: 'gsd-ingest-docs',       description: '从现有 ADR、PRD、SPEC 引导或合并 .planning/' },
  { name: 'gsd-forensics',         description: '失败 GSD 工作流的事后调查' },
  { name: 'gsd-autonomous',        description: '自主运行所有剩余阶段：讨论→计划→执行' },
  // ── Claude Code 内置 ─────────────────────────────────────────────
  { name: 'init',                  description: '初始化 CLAUDE.md，写入代码库文档' },
  { name: 'review',                description: '审查当前分支的 Pull Request' },
  { name: 'security-review',       description: '对当前分支的变更进行安全审查' },
];

function readCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function recordUsage(name: string): void {
  try {
    const counts = readCounts();
    counts[name] = (counts[name] ?? 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // ignore storage errors
  }
}

export function getFilteredCommands(query: string): SlashCommand[] {
  const counts = readCounts();
  const q = query.toLowerCase();
  return SLASH_COMMANDS
    .filter((c) => !q || c.name.includes(q) || c.description.includes(q))
    .sort((a, b) => (counts[b.name] ?? 0) - (counts[a.name] ?? 0));
}
