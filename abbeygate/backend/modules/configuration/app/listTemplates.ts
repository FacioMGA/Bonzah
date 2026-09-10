import { listTemplates as listTemplateRegistry } from '../infra/templates/index.js';

export interface TemplateSummary {
    templateId: string;
    name: string;
    vertical: string;
    description: string;
    supportedCapabilities: string[];
}

export async function listTemplates(): Promise<{ templates: TemplateSummary[] }> {
    const templates = listTemplateRegistry().map((t) => ({
        templateId: t.templateId,
        name: t.name,
        vertical: t.vertical,
        description: t.description,
        supportedCapabilities: t.supportedCapabilities,
    }));
    return { templates };
}
