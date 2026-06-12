import {
  confirmBeforeActionPrompt,
  loc,
  readOnlyPrompt,
  smallFixesPrompt,
  withBoundary,
} from './template-copy';
import { type WorkflowTemplate, type WorkflowTemplateCategory } from './template-types';
import { type WorkflowMode, type WorkflowScheduleKind } from './types';

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
