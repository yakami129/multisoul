import { type WorkflowMode, type WorkflowScheduleKind } from './types';

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

const BOUNDARY_COPY: Record<
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

function readOnlyPrompt(goal: string, output: string): string {
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Read-only report. Inspect and summarize only. Do not modify files or run commands that change repository, service, database, or remote state.',
    'Do not: commit, push, merge, release, create tags, delete files, or run migrations. If any of those actions appear necessary, explain why and ask the user to confirm.',
    `Output: ${output}`,
  ].join('\n');
}

function smallFixesPrompt(goal: string, output: string): string {
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Small fixes + verification. You may make clear, low-risk, local fixes and run relevant verification commands. Avoid architecture changes or fixes with unclear scope.',
    'Confirm first: commit, push, merge, release, create tags, delete files, database migrations, dependency upgrades, or any action that affects remote or production state.',
    `Output: ${output}`,
  ].join('\n');
}

function confirmBeforeActionPrompt(goal: string, output: string): string {
  return [
    `Goal: ${goal}`,
    'Behavior boundary: Confirm before action. Inspect first and report status. Do not directly publish, commit, delete, migrate, or perform remote changes.',
    'Confirm first: commit, push, merge, release, create tags, delete files, database migrations, version publishing, uploading build artifacts, or any irreversible or production-impacting action.',
    `Output: ${output}`,
  ].join('\n');
}

function watchPrompt(goal: string, stopConditionHint: string): string {
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
  return {
    boundary,
    ...BOUNDARY_COPY[boundary],
  };
}

export const RECURRING_TEMPLATES = [
  {
    id: 'project-daily-report',
    category: 'Project Status' as WorkflowTemplateCategory,
    title: 'Daily Project Brief',
    description: 'Summarize project status, recent changes, risks, and suggested priorities',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Daily Project Brief',
      prompt: readOnlyPrompt(
        'Summarize the current project status, recent changes, risks, and recommended priorities for today.',
        'Project overview, important recent changes, risks or blockers, and recommended priorities for today.',
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
    title: 'Weekly Project Review',
    description: 'Summarize weekly progress, blockers, risks, and next-week priorities',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Weekly Project Review',
      prompt: readOnlyPrompt(
        'Summarize project progress, blockers, risks, and recommended priorities for next week.',
        'Completed work, in-progress work, blockers or risks, and next-week recommendations.',
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
    title: 'PR Status Sweep',
    description: 'Check PRs, CI status, review comments, and merge blockers',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'PR Status Sweep',
      prompt: readOnlyPrompt(
        'Check project-related PRs, CI status, review comments, and merge blockers.',
        'PR list, CI results, pending review comments, merge blockers, and recommended next steps.',
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
    title: 'CI Failure Triage',
    description: 'Find CI failure causes and fix clear low-risk issues',
    ...withBoundary('small_fixes'),
    initial_values: {
      name: 'CI Failure Triage',
      prompt: smallFixesPrompt(
        'Find the cause of recent CI failures. If the fix is clear, low-risk, and local, apply it and run verification.',
        'Failure cause, small fixes made, verification commands and results, and items that still require user confirmation or manual handling.',
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
    title: 'Local Service Health',
    description: 'Check local services, ports, daemons, and recent errors',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Local Service Health',
      prompt: readOnlyPrompt(
        'Check local services, listening ports, daemon status, and recent error signals.',
        'Service health status, abnormal ports or processes, recent errors, and recommended investigation steps.',
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
    title: 'Log Anomaly Summary',
    description: 'Summarize recent log errors, frequency, and likely causes',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Log Anomaly Summary',
      prompt: readOnlyPrompt(
        'Summarize recent log errors, anomaly frequency, and likely causes.',
        'Error types, frequency, first and latest occurrence, possible causes, and recommended next steps.',
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
    title: 'Product Spec Review',
    description: 'Check whether product specs cover goals, scope, acceptance, and boundaries',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Product Spec Review',
      prompt: readOnlyPrompt(
        'Review product specs for clear goals, scope, acceptance criteria, and behavior boundaries.',
        'Missing or ambiguous goals, scope gaps, acceptance criteria gaps, and questions that need user clarification.',
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
    title: 'Execution Plan Review',
    description: 'Check whether execution plans have clear tasks and complete verification paths',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Execution Plan Review',
      prompt: readOnlyPrompt(
        'Review execution plans for clear task boundaries, reasonable sequencing, and complete verification paths.',
        'Task breakdown issues, dependency or parallelism risks, missing verification commands, and recommended adjustments.',
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
    title: 'Pre-Release Check',
    description: 'Check version state, verification, documentation, and release blockers',
    ...withBoundary('confirm_before_action'),
    initial_values: {
      name: 'Pre-Release Check',
      prompt: confirmBeforeActionPrompt(
        'Check version status, verification results, documentation updates, and release blockers.',
        'Release readiness, missing verification, documentation or version risks, and release actions that require confirmation.',
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
    title: 'Regression Sweep',
    description: 'Run key checks and identify regression risks',
    ...withBoundary('small_fixes'),
    initial_values: {
      name: 'Regression Sweep',
      prompt: smallFixesPrompt(
        'Run key checks and identify regression risks. If an issue is clear, low-risk, and local, apply a small fix and verify it.',
        'Check scope, regression risks found, small fixes made, verification results, and actions that still require user confirmation.',
      ),
      mode: 'recurring' as WorkflowMode,
      schedule_kind: 'weekly' as WorkflowScheduleKind,
      time_of_day: '16:00',
      day_of_week: 4,
    },
  },
] satisfies readonly WorkflowTemplate[];

export const WATCH_TEMPLATES = [
  {
    id: 'watch-ci',
    category: 'PR/CI/Review' as WorkflowTemplateCategory,
    title: 'CI Watch',
    description: 'Monitor CI status every 10 minutes until all checks pass',
    ...withBoundary('confirm_before_action'),
    initial_values: {
      name: 'CI Watch',
      prompt: watchPrompt(
        'Check CI status for the current PR or branch. Report failing checks, error logs, and blocking items.',
        'All required CI checks pass with no new failures.',
      ),
      mode: 'watch' as WorkflowMode,
      interval_minutes: 10,
      max_runs: 6,
      duration_minutes: 60,
      stop_condition: 'All required CI checks pass with no new failures',
    },
  },
  {
    id: 'watch-local-health',
    category: 'Local Health' as WorkflowTemplateCategory,
    title: 'Local Health Watch',
    description: 'Monitor local services every 5 minutes until stable',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'Local Health Watch',
      prompt: watchPrompt(
        'Check local services, ports, daemon status, and recent error logs. Report any instability or new critical errors.',
        'Target service health check stable, no new critical errors in recent logs.',
      ),
      mode: 'watch' as WorkflowMode,
      interval_minutes: 5,
      max_runs: 6,
      duration_minutes: 30,
      stop_condition: 'Target service health check stable, no new critical errors in recent logs',
    },
  },
  {
    id: 'watch-release-window',
    category: 'Release & Regression' as WorkflowTemplateCategory,
    title: 'Release Window Watch',
    description: 'Monitor release health every 10 minutes during a 2-hour window',
    ...withBoundary('confirm_before_action'),
    initial_values: {
      name: 'Release Window Watch',
      prompt: watchPrompt(
        'Check release logs, key metrics, build status, and blocking error signals. Report changes and anomalies.',
        'Release window closed, key metrics stable, no new blocking errors.',
      ),
      mode: 'watch' as WorkflowMode,
      interval_minutes: 10,
      max_runs: 12,
      duration_minutes: 120,
      stop_condition: 'Release window closed, key metrics stable, no new blocking errors',
    },
  },
  {
    id: 'watch-pr-review',
    category: 'PR/CI/Review' as WorkflowTemplateCategory,
    title: 'PR Review Watch',
    description: 'Monitor PR review progress every 10 minutes',
    ...withBoundary('confirm_before_action'),
    initial_values: {
      name: 'PR Review Watch',
      prompt: watchPrompt(
        'Check new review comments, CI status, approval state, and merge blockers. Summarize what needs attention.',
        'No unresolved review comments, required checks pass, no merge blockers.',
      ),
      mode: 'watch' as WorkflowMode,
      interval_minutes: 10,
      max_runs: 6,
      duration_minutes: 60,
      stop_condition: 'No unresolved review comments, required checks pass, no merge blockers',
    },
  },
] satisfies readonly WorkflowTemplate[];

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  ...RECURRING_TEMPLATES,
  ...WATCH_TEMPLATES,
];
