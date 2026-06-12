export {
  WORKFLOW_TEMPLATE_CATEGORIES,
  type WorkflowTemplateCategory,
  type WorkflowTemplateBoundary,
  type WorkflowTemplateInitialValues,
  type WorkflowTemplate,
} from './template-types';

export { getRecurringTemplates } from './recurring-templates';
export { getWatchTemplates } from './watch-templates';

import { getRecurringTemplates } from './recurring-templates';
import { type WorkflowTemplate } from './template-types';
import { getWatchTemplates } from './watch-templates';

export function getWorkflowTemplates(): readonly WorkflowTemplate[] {
  return [...getRecurringTemplates(), ...getWatchTemplates()];
}
