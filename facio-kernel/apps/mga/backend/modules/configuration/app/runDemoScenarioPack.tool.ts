import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { runDemoScenarioPack } from './runDemoScenarioPack.js';

const InputSchema = z.object({ draftId: z.string().min(1) }).strict();

const EntrySchema = z.object({
    scenarioName: z.string(),
    expected: z.enum(['accept', 'referral', 'decline']),
    actual: z.enum(['accept', 'referral', 'decline']),
    outcome: z.enum(['passed', 'failed']),
    summary: z.string(),
});

const OutputSchema = z.object({
    draftId: z.string(),
    scenariosRun: z.number(),
    passed: z.number(),
    failed: z.number(),
    results: z.array(EntrySchema),
});

export const runDemoScenarioPackTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.simulation.runDemoScenarioPack',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.simulate',
    description:
        'Run the canned Classic Car scenario pack against the draft. On full pass the draft flips to status=simulated, gating sandbox publish.',
    auditClass: 'simulate',
    run: async (input) => runDemoScenarioPack(input),
};
