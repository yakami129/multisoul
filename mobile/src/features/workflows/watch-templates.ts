import { loc, watchPrompt, withBoundary } from './template-copy';
import { type WorkflowTemplate, type WorkflowTemplateCategory } from './template-types';
import { type WorkflowMode } from './types';

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
