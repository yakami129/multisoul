import { type WorkflowTemplate, type WorkflowTemplateBoundary } from './template-types';
import i18n from '../../i18n';

export function loc(en: string, zh: string): string {
  return i18n.language === 'zh' ? zh : en;
}

export function getBoundaryCopy(
  boundary: WorkflowTemplateBoundary,
): Pick<WorkflowTemplate, 'boundary_label' | 'boundary_description'> {
  if (i18n.language === 'zh') {
    const zh: Record<
      WorkflowTemplateBoundary,
      Pick<WorkflowTemplate, 'boundary_label' | 'boundary_description'>
    > = {
      read_only: { boundary_label: '只读报告', boundary_description: '仅检查和汇总，不修改文件' },
      small_fixes: {
        boundary_label: '小修复 + 验证',
        boundary_description: '可进行低风险本地修复并运行检查；不 commit 或发布',
      },
      confirm_before_action: {
        boundary_label: '行动前确认',
        boundary_description: 'commit、发布、删除、migration 和远程变更需要审批',
      },
    };
    return zh[boundary];
  }
  const en: Record<
    WorkflowTemplateBoundary,
    Pick<WorkflowTemplate, 'boundary_label' | 'boundary_description'>
  > = {
    read_only: {
      boundary_label: 'Read-only report',
      boundary_description: 'Inspect and summarize only; do not modify files',
    },
    small_fixes: {
      boundary_label: 'Small fixes + verification',
      boundary_description: 'May make low-risk local fixes and run checks; no commit or release',
    },
    confirm_before_action: {
      boundary_label: 'Confirm before action',
      boundary_description:
        'Commits, releases, deletes, migrations, and remote changes need approval',
    },
  };
  return en[boundary];
}

export function readOnlyPrompt(goal: string, output: string): string {
  if (i18n.language === 'zh') {
    return [
      `目标：${goal}`,
      'Behavior boundary: Read-only report. 仅检查和汇总，不修改文件或执行任何会改变仓库、服务、数据库或远程状态的命令。',
      '禁止：commit、push、merge、release、创建 tag、删除文件或执行 migration。如需上述操作，请解释原因并征得用户确认。',
      `输出：${output}`,
    ].join('\n');
  }
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Read-only report. Inspect and summarize only. Do not modify files or run commands that change repository, service, database, or remote state.',
    'Do not: commit, push, merge, release, create tags, delete files, or run migrations. If any of those actions appear necessary, explain why and ask the user to confirm.',
    `Output: ${output}`,
  ].join('\n');
}

export function smallFixesPrompt(goal: string, output: string): string {
  if (i18n.language === 'zh') {
    return [
      `目标：${goal}`,
      'Behavior boundary: Small fixes + verification. 可进行明确、低风险的本地修复，并运行相关验证命令。避免架构变更或范围不明的修复。',
      '需确认后再执行：commit、push、merge、release、创建 tag、删除文件、数据库 migration、依赖升级，或任何影响远程或生产状态的操作。',
      `输出：${output}`,
    ].join('\n');
  }
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Small fixes + verification. You may make clear, low-risk, local fixes and run relevant verification commands. Avoid architecture changes or fixes with unclear scope.',
    'Confirm first: commit, push, merge, release, create tags, delete files, database migrations, dependency upgrades, or any action that affects remote or production state.',
    `Output: ${output}`,
  ].join('\n');
}

export function confirmBeforeActionPrompt(goal: string, output: string): string {
  if (i18n.language === 'zh') {
    return [
      `目标：${goal}`,
      'Behavior boundary: Confirm before action. 先检查并汇报状态，不直接发布、commit、删除、migration 或执行远程变更。',
      '需确认后再执行：commit、push、merge、release、创建 tag、删除文件、数据库 migration、版本发布、上传构建产物，或任何不可逆或影响生产的操作。',
      `输出：${output}`,
    ].join('\n');
  }
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Confirm before action. Inspect first and report status. Do not directly publish, commit, delete, migrate, or perform remote changes.',
    'Confirm first: commit, push, merge, release, create tags, delete files, database migrations, version publishing, uploading build artifacts, or any irreversible or production-impacting action.',
    `Output: ${output}`,
  ].join('\n');
}

export function watchPrompt(goal: string, stopConditionHint: string): string {
  if (i18n.language === 'zh') {
    return [
      `目标：${goal}`,
      'Behavior boundary: Watch mode. 仅只读检查和状态汇报。',
      '在执行 commit、push、merge、release、回滚、删除、migration、创建 tag、依赖升级、影响生产的命令或远程状态变更之前，必须通过 AskUserQuestion / msctl ask-question 先询问用户。',
      `停止条件提示：${stopConditionHint}`,
      '输出：简洁的状态摘要、自上次运行以来的变化，以及停止条件是否已满足。',
    ].join('\n');
  }
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Watch mode. Read-only inspection and status reporting only.',
    'Before commit, push, merge, release, rollback, delete, migration, tag creation, dependency upgrade, production-impacting command, or remote state change, ask the user first through AskUserQuestion / msctl ask-question.',
    `Stop condition hint: ${stopConditionHint}`,
    'Output: Concise status summary, changes observed since last run, and whether the stop condition is satisfied.',
  ].join('\n');
}

export function withBoundary(
  boundary: WorkflowTemplateBoundary,
): Pick<WorkflowTemplate, 'boundary' | 'boundary_label' | 'boundary_description'> {
  return { boundary, ...getBoundaryCopy(boundary) };
}
