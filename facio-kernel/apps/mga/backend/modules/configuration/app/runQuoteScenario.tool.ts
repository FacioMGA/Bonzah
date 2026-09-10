import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { runQuoteScenario } from './runQuoteScenario.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        scenarioName: z.string().min(1),
        riskData: z.record(z.string(), z.unknown()),
    })
    .strict();

const ResultSchema = z.object({
    scenarioId: z.string(),
    outcome: z.enum(['accept', 'referral', 'decline']),
    referralTriggered: z.boolean(),
    referralReasons: z.array(z.string()),
    missingRequiredFields: z.array(z.string()),
    documentsRequiredAtBind: z.array(z.string()),
    billingSummary: z.string(),
});

const OutputSchema = z.object({
    scenarioId: z.string(),
    result: ResultSchema,
});

export const runQuoteScenarioTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.simulation.runQuoteScenario',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.simulate',
    description:
        'Run a single quote scenario against the draft: composes the staged overlay and dispatches through the canonical motor UW engine.',
    auditClass: 'simulate',
    run: async (input) => runQuoteScenario(input),
};
