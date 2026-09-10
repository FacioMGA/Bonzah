import type { ProductLaunchTemplate } from '../../domain/templateDefinition.js';
import { classicCarTemplate } from './classicCarTemplate.js';
import { motorTemplate } from './motorTemplate.js';

/**
 * Single registry of code-defined product launch templates. Adding a
 * template here is currently a code change — the V1 demo only ships
 * two: the base motor template (sanity baseline) and the Classic Car
 * variant (the live demo target).
 */
const TEMPLATES: ProductLaunchTemplate[] = [motorTemplate, classicCarTemplate];

export function listTemplates(): ProductLaunchTemplate[] {
    return TEMPLATES.slice();
}

export function getTemplate(templateId: string): ProductLaunchTemplate | undefined {
    return TEMPLATES.find((t) => t.templateId === templateId);
}
