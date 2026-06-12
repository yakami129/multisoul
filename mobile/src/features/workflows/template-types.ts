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
