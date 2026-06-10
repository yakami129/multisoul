import { type WorkflowMode, type WorkflowScheduleKind } from './types';
import i18n from '../../i18n';

export const WORKFLOW_TEMPLATE_CATEGORIES = [
  'Project Status',
  'PR/CI/Review',
  'Local Health',
  'Specs & Planning',
  'Release & Regression',
] as const;

export type WorkflowTemplateCategory = (typeof WORKFLOW_TEMPLATE_CATEGORIES)[number];

export type WorkflowTemplateBoundary = 'read_only' | 'small_fixes' | 'confirm_before_action';

export interface WorkflowTemplateInitialValues {
  name: string;
  prompt: string;
  mode: WorkflowMode;
  // recurring only
  schedule_kind?: WorkflowScheduleKind;
  time_of_day?: string;
  day_of_week?: number | null;
  // watch only
  interval_minutes?: number;
  max_runs?: number | null;
  duration_minutes?: number;
  stop_condition?: string;
}

export interface WorkflowTemplate {
  id: string;
  category: WorkflowTemplateCategory;
  title: string;
  description: string;
  boundary: WorkflowTemplateBoundary;
  boundary_label: string;
  boundary_description: string;
  initial_values: WorkflowTemplateInitialValues;
}

function loc(en: string, zh: string): string {
  return i18n.language === 'zh' ? zh : en;
}

function getBoundaryCopy(
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

function readOnlyPrompt(goal: string, output: string): string {
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

function smallFixesPrompt(goal: string, output: string): string {
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

function confirmBeforeActionPrompt(goal: string, output: string): string {
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

function watchPrompt(goal: string, stopConditionHint: string): string {
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

function withBoundary(
  boundary: WorkflowTemplateBoundary,
): Pick<WorkflowTemplate, 'boundary' | 'boundary_label' | 'boundary_description'> {
  return { boundary, ...getBoundaryCopy(boundary) };
}

export function getRecurringTemplates(): readonly WorkflowTemplate[] {
  return [
    {
      id: 'project-daily-report',
      category: 'Project Status' as WorkflowTemplateCategory,
      title: loc('Daily Project Brief', '每日项目简报'),
      description: loc(
        'Summarize project status, recent changes, risks, and suggested priorities',
        '汇总项目状态、近期变更、风险及推荐优先级',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Daily Project Brief', '每日项目简报'),
        prompt: readOnlyPrompt(
          loc(
            'Summarize the current project status, recent changes, risks, and recommended priorities for today.',
            '汇总当前项目状态、近期变更、风险及今日推荐优先级。',
          ),
          loc(
            'Project overview, important recent changes, risks or blockers, and recommended priorities for today.',
            '项目概览、重要近期变更、风险或阻塞项，以及今日推荐优先级。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'daily' as WorkflowScheduleKind,
        time_of_day: '09:00',
        day_of_week: null,
      },
    },
    {
      id: 'project-weekly-report',
      category: 'Project Status' as WorkflowTemplateCategory,
      title: loc('Weekly Project Review', '每周项目回顾'),
      description: loc(
        'Summarize weekly progress, blockers, risks, and next-week priorities',
        '汇总每周进展、阻塞项、风险及下周优先级',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Weekly Project Review', '每周项目回顾'),
        prompt: readOnlyPrompt(
          loc(
            'Summarize project progress, blockers, risks, and recommended priorities for next week.',
            '汇总项目进展、阻塞项、风险及下周推荐优先级。',
          ),
          loc(
            'Completed work, in-progress work, blockers or risks, and next-week recommendations.',
            '已完成工作、进行中工作、阻塞项或风险，以及下周建议。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'weekly' as WorkflowScheduleKind,
        time_of_day: '17:00',
        day_of_week: 5,
      },
    },
    {
      id: 'pr-status-check',
      category: 'PR/CI/Review' as WorkflowTemplateCategory,
      title: loc('PR Status Sweep', 'PR 状态扫描'),
      description: loc(
        'Check PRs, CI status, review comments, and merge blockers',
        '检查 PR、CI 状态、评审评论及合并阻塞项',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('PR Status Sweep', 'PR 状态扫描'),
        prompt: readOnlyPrompt(
          loc(
            'Check project-related PRs, CI status, review comments, and merge blockers.',
            '检查项目相关 PR、CI 状态、评审评论及合并阻塞项。',
          ),
          loc(
            'PR list, CI results, pending review comments, merge blockers, and recommended next steps.',
            'PR 列表、CI 结果、待处理评审评论、合并阻塞项及推荐下一步操作。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'daily' as WorkflowScheduleKind,
        time_of_day: '10:00',
        day_of_week: null,
      },
    },
    {
      id: 'ci-failure-triage',
      category: 'PR/CI/Review' as WorkflowTemplateCategory,
      title: loc('CI Failure Triage', 'CI 失败诊断'),
      description: loc(
        'Find CI failure causes and fix clear low-risk issues',
        '查找 CI 失败原因，修复明确的低风险问题',
      ),
      ...withBoundary('small_fixes'),
      initial_values: {
        name: loc('CI Failure Triage', 'CI 失败诊断'),
        prompt: smallFixesPrompt(
          loc(
            'Find the cause of recent CI failures. If the fix is clear, low-risk, and local, apply it and run verification.',
            '查找近期 CI 失败原因。若修复方案明确、低风险且为本地操作，可直接修复并运行验证。',
          ),
          loc(
            'Failure cause, small fixes made, verification commands and results, and items that still require user confirmation or manual handling.',
            '失败原因、已进行的小修复、验证命令及结果，以及仍需用户确认或手动处理的事项。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'daily' as WorkflowScheduleKind,
        time_of_day: '11:00',
        day_of_week: null,
      },
    },
    {
      id: 'local-service-health',
      category: 'Local Health' as WorkflowTemplateCategory,
      title: loc('Local Service Health', '本地服务健康检查'),
      description: loc(
        'Check local services, ports, daemons, and recent errors',
        '检查本地服务、端口、守护进程及近期错误',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Local Service Health', '本地服务健康检查'),
        prompt: readOnlyPrompt(
          loc(
            'Check local services, listening ports, daemon status, and recent error signals.',
            '检查本地服务、监听端口、守护进程状态及近期错误信号。',
          ),
          loc(
            'Service health status, abnormal ports or processes, recent errors, and recommended investigation steps.',
            '服务健康状态、异常端口或进程、近期错误，以及推荐排查步骤。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'daily' as WorkflowScheduleKind,
        time_of_day: '09:30',
        day_of_week: null,
      },
    },
    {
      id: 'log-anomaly-summary',
      category: 'Local Health' as WorkflowTemplateCategory,
      title: loc('Log Anomaly Summary', '日志异常摘要'),
      description: loc(
        'Summarize recent log errors, frequency, and likely causes',
        '汇总近期日志错误、频率及可能原因',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Log Anomaly Summary', '日志异常摘要'),
        prompt: readOnlyPrompt(
          loc(
            'Summarize recent log errors, anomaly frequency, and likely causes.',
            '汇总近期日志错误、异常频率及可能原因。',
          ),
          loc(
            'Error types, frequency, first and latest occurrence, possible causes, and recommended next steps.',
            '错误类型、频率、首次和最近出现时间、可能原因，以及推荐下一步操作。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'daily' as WorkflowScheduleKind,
        time_of_day: '18:00',
        day_of_week: null,
      },
    },
    {
      id: 'product-spec-check',
      category: 'Specs & Planning' as WorkflowTemplateCategory,
      title: loc('Product Spec Review', '产品规格审查'),
      description: loc(
        'Check whether product specs cover goals, scope, acceptance, and boundaries',
        '检查产品规格是否涵盖目标、范围、验收标准及边界',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Product Spec Review', '产品规格审查'),
        prompt: readOnlyPrompt(
          loc(
            'Review product specs for clear goals, scope, acceptance criteria, and behavior boundaries.',
            '审查产品规格，检查目标是否清晰、范围是否明确、验收标准是否完整、行为边界是否合理。',
          ),
          loc(
            'Missing or ambiguous goals, scope gaps, acceptance criteria gaps, and questions that need user clarification.',
            '缺失或模糊的目标、范围缺口、验收标准缺口，以及需要用户澄清的问题。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'weekly' as WorkflowScheduleKind,
        time_of_day: '10:00',
        day_of_week: 1,
      },
    },
    {
      id: 'exec-plan-check',
      category: 'Specs & Planning' as WorkflowTemplateCategory,
      title: loc('Execution Plan Review', '执行计划审查'),
      description: loc(
        'Check whether execution plans have clear tasks and complete verification paths',
        '检查执行计划的任务划分及验证路径是否完整',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Execution Plan Review', '执行计划审查'),
        prompt: readOnlyPrompt(
          loc(
            'Review execution plans for clear task boundaries, reasonable sequencing, and complete verification paths.',
            '审查执行计划，检查任务边界是否清晰、排序是否合理、验证路径是否完整。',
          ),
          loc(
            'Task breakdown issues, dependency or parallelism risks, missing verification commands, and recommended adjustments.',
            '任务拆分问题、依赖或并行风险、缺失的验证命令，以及推荐调整方案。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'weekly' as WorkflowScheduleKind,
        time_of_day: '11:00',
        day_of_week: 1,
      },
    },
    {
      id: 'pre-release-check',
      category: 'Release & Regression' as WorkflowTemplateCategory,
      title: loc('Pre-Release Check', '发布前检查'),
      description: loc(
        'Check version state, verification, documentation, and release blockers',
        '检查版本状态、验证结果、文档及发布阻塞项',
      ),
      ...withBoundary('confirm_before_action'),
      initial_values: {
        name: loc('Pre-Release Check', '发布前检查'),
        prompt: confirmBeforeActionPrompt(
          loc(
            'Check version status, verification results, documentation updates, and release blockers.',
            '检查版本状态、验证结果、文档更新及发布阻塞项。',
          ),
          loc(
            'Release readiness, missing verification, documentation or version risks, and release actions that require confirmation.',
            '发布就绪状态、缺失的验证、文档或版本风险，以及需要确认的发布操作。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'weekly' as WorkflowScheduleKind,
        time_of_day: '15:00',
        day_of_week: 4,
      },
    },
    {
      id: 'regression-sweep',
      category: 'Release & Regression' as WorkflowTemplateCategory,
      title: loc('Regression Sweep', '回归扫描'),
      description: loc(
        'Run key checks and identify regression risks',
        '运行关键检查，识别回归风险',
      ),
      ...withBoundary('small_fixes'),
      initial_values: {
        name: loc('Regression Sweep', '回归扫描'),
        prompt: smallFixesPrompt(
          loc(
            'Run key checks and identify regression risks. If an issue is clear, low-risk, and local, apply a small fix and verify it.',
            '运行关键检查，识别回归风险。若问题明确、低风险且为本地操作，可进行小修复并验证。',
          ),
          loc(
            'Check scope, regression risks found, small fixes made, verification results, and actions that still require user confirmation.',
            '检查范围、发现的回归风险、已进行的小修复、验证结果，以及仍需用户确认的操作。',
          ),
        ),
        mode: 'recurring' as WorkflowMode,
        schedule_kind: 'weekly' as WorkflowScheduleKind,
        time_of_day: '16:00',
        day_of_week: 4,
      },
    },
  ];
}

export function getWatchTemplates(): readonly WorkflowTemplate[] {
  return [
    {
      id: 'watch-ci',
      category: 'PR/CI/Review' as WorkflowTemplateCategory,
      title: loc('CI Watch', 'CI 监控'),
      description: loc(
        'Monitor CI status every 10 minutes until all checks pass',
        '每 10 分钟监控 CI 状态，直到所有检查通过',
      ),
      ...withBoundary('confirm_before_action'),
      initial_values: {
        name: loc('CI Watch', 'CI 监控'),
        prompt: watchPrompt(
          loc(
            'Check CI status for the current PR or branch. Report failing checks, error logs, and blocking items.',
            '检查当前 PR 或分支的 CI 状态。汇报失败的检查、错误日志及阻塞项。',
          ),
          loc(
            'All required CI checks pass with no new failures.',
            '所有必需的 CI 检查通过，无新增失败。',
          ),
        ),
        mode: 'watch' as WorkflowMode,
        interval_minutes: 10,
        max_runs: 6,
        duration_minutes: 60,
        stop_condition: loc(
          'All required CI checks pass with no new failures',
          '所有必需的 CI 检查通过，无新增失败',
        ),
      },
    },
    {
      id: 'watch-local-health',
      category: 'Local Health' as WorkflowTemplateCategory,
      title: loc('Local Health Watch', '本地服务监控'),
      description: loc(
        'Monitor local services every 5 minutes until stable',
        '每 5 分钟监控本地服务，直到稳定',
      ),
      ...withBoundary('read_only'),
      initial_values: {
        name: loc('Local Health Watch', '本地服务监控'),
        prompt: watchPrompt(
          loc(
            'Check local services, ports, daemon status, and recent error logs. Report any instability or new critical errors.',
            '检查本地服务、端口、守护进程状态及近期错误日志。汇报任何不稳定情况或新的严重错误。',
          ),
          loc(
            'Target service health check stable, no new critical errors in recent logs.',
            '目标服务健康检查稳定，近期日志无新增严重错误。',
          ),
        ),
        mode: 'watch' as WorkflowMode,
        interval_minutes: 5,
        max_runs: 6,
        duration_minutes: 30,
        stop_condition: loc(
          'Target service health check stable, no new critical errors in recent logs',
          '目标服务健康检查稳定，近期日志无新增严重错误',
        ),
      },
    },
    {
      id: 'watch-release-window',
      category: 'Release & Regression' as WorkflowTemplateCategory,
      title: loc('Release Window Watch', '发布窗口监控'),
      description: loc(
        'Monitor release health every 10 minutes during a 2-hour window',
        '2 小时发布窗口内每 10 分钟监控发布健康状态',
      ),
      ...withBoundary('confirm_before_action'),
      initial_values: {
        name: loc('Release Window Watch', '发布窗口监控'),
        prompt: watchPrompt(
          loc(
            'Check release logs, key metrics, build status, and blocking error signals. Report changes and anomalies.',
            '检查发布日志、关键指标、构建状态及阻塞错误信号。汇报变化和异常。',
          ),
          loc(
            'Release window closed, key metrics stable, no new blocking errors.',
            '发布窗口关闭，关键指标稳定，无新增阻塞错误。',
          ),
        ),
        mode: 'watch' as WorkflowMode,
        interval_minutes: 10,
        max_runs: 12,
        duration_minutes: 120,
        stop_condition: loc(
          'Release window closed, key metrics stable, no new blocking errors',
          '发布窗口关闭，关键指标稳定，无新增阻塞错误',
        ),
      },
    },
    {
      id: 'watch-pr-review',
      category: 'PR/CI/Review' as WorkflowTemplateCategory,
      title: loc('PR Review Watch', 'PR 评审监控'),
      description: loc('Monitor PR review progress every 10 minutes', '每 10 分钟监控 PR 评审进展'),
      ...withBoundary('confirm_before_action'),
      initial_values: {
        name: loc('PR Review Watch', 'PR 评审监控'),
        prompt: watchPrompt(
          loc(
            'Check new review comments, CI status, approval state, and merge blockers. Summarize what needs attention.',
            '检查新的评审评论、CI 状态、审批状态及合并阻塞项。汇总需要关注的内容。',
          ),
          loc(
            'No unresolved review comments, required checks pass, no merge blockers.',
            '无未解决的评审评论，必需检查通过，无合并阻塞项。',
          ),
        ),
        mode: 'watch' as WorkflowMode,
        interval_minutes: 10,
        max_runs: 6,
        duration_minutes: 60,
        stop_condition: loc(
          'No unresolved review comments, required checks pass, no merge blockers',
          '无未解决的评审评论，必需检查通过，无合并阻塞项',
        ),
      },
    },
  ];
}

export function getWorkflowTemplates(): readonly WorkflowTemplate[] {
  return [...getRecurringTemplates(), ...getWatchTemplates()];
}
