import {
  WORKFLOW_TEMPLATE_CATEGORIES,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplateBoundary,
} from './templates';

const SUPPORTED_SCHEDULE_KINDS = new Set(['daily', 'weekly']);
const SUPPORTED_BOUNDARIES = new Set<WorkflowTemplateBoundary>([
  'read_only',
  'small_fixes',
  'confirm_before_action',
]);

describe('workflow templates', () => {
  it('ships exactly ten built-in templates', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(10);
  });

  it('uses unique template ids', () => {
    const ids = WORKFLOW_TEMPLATES.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines complete, non-empty template copy and prompts', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.category.trim()).not.toHaveLength(0);
      expect(template.title.trim()).not.toHaveLength(0);
      expect(template.description.trim()).not.toHaveLength(0);
      expect(template.boundary_label.trim()).not.toHaveLength(0);
      expect(template.boundary_description.trim()).not.toHaveLength(0);
      expect(template.initial_values.name.trim()).not.toHaveLength(0);
      expect(template.initial_values.prompt.trim()).not.toHaveLength(0);
      expect(template.initial_values.time_of_day).toMatch(/^\d{2}:\d{2}$/);
      expect(Object.prototype.hasOwnProperty.call(template.initial_values, 'day_of_week')).toBe(
        true,
      );
    }
  });

  it('uses supported schedule kinds and valid weekday values', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(SUPPORTED_SCHEDULE_KINDS.has(template.initial_values.schedule_kind)).toBe(true);

      if (template.initial_values.schedule_kind === 'daily') {
        expect(template.initial_values.day_of_week).toBeNull();
      } else {
        expect(template.initial_values.day_of_week).toBeGreaterThanOrEqual(1);
        expect(template.initial_values.day_of_week).toBeLessThanOrEqual(7);
      }
    }
  });

  it('covers all five workflow template categories', () => {
    const coveredCategories = new Set(WORKFLOW_TEMPLATES.map((template) => template.category));

    expect(coveredCategories).toEqual(new Set(WORKFLOW_TEMPLATE_CATEGORIES));
  });

  it('uses supported behavioral boundaries and states confirmation limits in prompts', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(SUPPORTED_BOUNDARIES.has(template.boundary)).toBe(true);
      expect(template.initial_values.prompt).toContain('行为边界');
      expect(template.initial_values.prompt).toContain('commit');
      expect(template.initial_values.prompt).toContain('push');
      expect(template.initial_values.prompt).toContain('merge');
      expect(template.initial_values.prompt).toContain('release');
      expect(template.initial_values.prompt).toContain('确认');
    }
  });
});
