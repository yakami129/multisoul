import { type WorkflowScheduleKind } from './types';

export const WORKFLOW_TEMPLATE_CATEGORIES = [
  '项目状态',
  'PR/CI/Review',
  '本地健康',
  '需求计划',
  '发布回归',
] as const;

export type WorkflowTemplateCategory = (typeof WORKFLOW_TEMPLATE_CATEGORIES)[number];

export type WorkflowTemplateBoundary = 'read_only' | 'small_fixes' | 'confirm_before_action';

export interface WorkflowTemplateInitialValues {
  name: string;
  prompt: string;
  schedule_kind: WorkflowScheduleKind;
  time_of_day: string;
  day_of_week: number | null;
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
    boundary_label: '只读汇报',
    boundary_description: '只检查并总结，不修改文件',
  },
  small_fixes: {
    boundary_label: '允许小修并验证',
    boundary_description: '可做低风险修改并跑验证，不提交、不发布',
  },
  confirm_before_action: {
    boundary_label: '需要确认后行动',
    boundary_description: '涉及发布、提交、删除、迁移等动作必须先问用户',
  },
};

function readOnlyPrompt(goal: string, output: string): string {
  return [
    `目标：${goal}`,
    '行为边界：只读汇报。只检查并总结，不修改文件，不运行会改变仓库、服务、数据库或远程状态的命令。',
    '禁止：本次运行不要 commit、push、merge、release、打 tag、删除文件或执行迁移；如果发现需要这些动作，只说明原因并请求用户确认。',
    `输出：${output}`,
  ].join('\n');
}

function smallFixesPrompt(goal: string, output: string): string {
  return [
    `目标：${goal}`,
    '行为边界：允许小修并验证。可以做明确、低风险、局部的小修改，并运行相关验证命令；不要做架构性改动或范围不清的修改。',
    '必须先确认：commit、push、merge、release、打 tag、删除文件、数据库迁移、依赖升级，或任何会影响远程/生产状态的动作。',
    `输出：${output}`,
  ].join('\n');
}

function confirmBeforeActionPrompt(goal: string, output: string): string {
  return [
    `目标：${goal}`,
    '行为边界：需要确认后行动。先检查并汇报状态，不要直接执行发布、提交、删除、迁移或远程变更。',
    '必须先确认：commit、push、merge、release、打 tag、删除文件、数据库迁移、版本发布、上传构建产物，或任何不可逆/影响生产的动作。',
    `输出：${output}`,
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

export const WORKFLOW_TEMPLATES = [
  {
    id: 'project-daily-report',
    category: '项目状态',
    title: '项目日报',
    description: '汇总项目状态、最近变更、风险和今日建议',
    ...withBoundary('read_only'),
    initial_values: {
      name: '项目日报',
      prompt: readOnlyPrompt(
        '每天汇总当前项目状态、最近变更、风险和今日建议。',
        '项目概况、最近重要变化、风险/阻塞、建议今天优先处理的事项。',
      ),
      schedule_kind: 'daily',
      time_of_day: '09:00',
      day_of_week: null,
    },
  },
  {
    id: 'project-weekly-report',
    category: '项目状态',
    title: '项目周报',
    description: '输出本周进展、阻塞、下周建议',
    ...withBoundary('read_only'),
    initial_values: {
      name: '项目周报',
      prompt: readOnlyPrompt(
        '每周总结项目进展、阻塞、风险和下周建议。',
        '本周完成事项、仍在进行的工作、阻塞/风险、下周建议计划。',
      ),
      schedule_kind: 'weekly',
      time_of_day: '17:00',
      day_of_week: 5,
    },
  },
  {
    id: 'pr-status-check',
    category: 'PR/CI/Review',
    title: 'PR 状态巡检',
    description: '检查 PR、CI、review comment 和合并阻塞',
    ...withBoundary('read_only'),
    initial_values: {
      name: 'PR 状态巡检',
      prompt: readOnlyPrompt(
        '检查当前项目相关 PR、CI 状态、review comment 和合并阻塞。',
        'PR 列表、CI 结果、待处理 review comment、阻塞合并的原因和建议下一步。',
      ),
      schedule_kind: 'daily',
      time_of_day: '10:00',
      day_of_week: null,
    },
  },
  {
    id: 'ci-failure-triage',
    category: 'PR/CI/Review',
    title: 'CI 失败排查',
    description: '定位 CI 失败，修复明确且低风险的问题',
    ...withBoundary('small_fixes'),
    initial_values: {
      name: 'CI 失败排查',
      prompt: smallFixesPrompt(
        '定位最近 CI 失败原因；如果修复明确、低风险且局部，可以修改并运行验证。',
        '失败原因、已做的小修、验证命令和结果、仍需用户确认或人工处理的事项。',
      ),
      schedule_kind: 'daily',
      time_of_day: '11:00',
      day_of_week: null,
    },
  },
  {
    id: 'local-service-health',
    category: '本地健康',
    title: '本地服务健康检查',
    description: '检查本机服务、端口、daemon 和最近错误',
    ...withBoundary('read_only'),
    initial_values: {
      name: '本地服务健康检查',
      prompt: readOnlyPrompt(
        '检查本机服务、监听端口、daemon 状态和最近错误信号。',
        '服务健康状态、异常端口或进程、最近错误、建议排查方向。',
      ),
      schedule_kind: 'daily',
      time_of_day: '09:30',
      day_of_week: null,
    },
  },
  {
    id: 'log-anomaly-summary',
    category: '本地健康',
    title: '日志异常摘要',
    description: '汇总最近日志中的错误、频率和疑似原因',
    ...withBoundary('read_only'),
    initial_values: {
      name: '日志异常摘要',
      prompt: readOnlyPrompt(
        '汇总最近日志中的错误、异常频率和疑似原因。',
        '错误类型、出现频率、首次/最近出现时间、可能原因、建议下一步。',
      ),
      schedule_kind: 'daily',
      time_of_day: '18:00',
      day_of_week: null,
    },
  },
  {
    id: 'product-spec-check',
    category: '需求计划',
    title: '需求规格检查',
    description: '检查 product spec 是否有目标、范围、验收和边界遗漏',
    ...withBoundary('read_only'),
    initial_values: {
      name: '需求规格检查',
      prompt: readOnlyPrompt(
        '检查 product spec 是否清楚描述目标、范围、验收标准和行为边界。',
        '缺失或含糊的目标、范围漏洞、验收标准缺口、需要用户澄清的问题。',
      ),
      schedule_kind: 'weekly',
      time_of_day: '10:00',
      day_of_week: 1,
    },
  },
  {
    id: 'exec-plan-check',
    category: '需求计划',
    title: '执行计划检查',
    description: '检查 exec plan 是否任务清晰、验证路径完整',
    ...withBoundary('read_only'),
    initial_values: {
      name: '执行计划检查',
      prompt: readOnlyPrompt(
        '检查 exec plan 是否任务边界清晰、顺序合理、验证路径完整。',
        '任务拆分问题、依赖或并发风险、遗漏的验证命令、建议调整点。',
      ),
      schedule_kind: 'weekly',
      time_of_day: '11:00',
      day_of_week: 1,
    },
  },
  {
    id: 'pre-release-check',
    category: '发布回归',
    title: '发布前检查',
    description: '检查版本、验证、文档和发布阻塞项',
    ...withBoundary('confirm_before_action'),
    initial_values: {
      name: '发布前检查',
      prompt: confirmBeforeActionPrompt(
        '检查版本状态、验证结果、文档更新和发布阻塞项。',
        '发布准备状态、缺失验证、文档/版本风险、必须确认后才能执行的发布动作。',
      ),
      schedule_kind: 'weekly',
      time_of_day: '15:00',
      day_of_week: 4,
    },
  },
  {
    id: 'regression-sweep',
    category: '发布回归',
    title: '回归巡检',
    description: '运行关键检查，发现回归风险',
    ...withBoundary('small_fixes'),
    initial_values: {
      name: '回归巡检',
      prompt: smallFixesPrompt(
        '运行关键检查并识别回归风险；如果问题明确、低风险且局部，可以小修并验证。',
        '检查范围、发现的回归风险、已做的小修、验证结果、仍需用户确认的动作。',
      ),
      schedule_kind: 'weekly',
      time_of_day: '16:00',
      day_of_week: 4,
    },
  },
] satisfies readonly WorkflowTemplate[];
