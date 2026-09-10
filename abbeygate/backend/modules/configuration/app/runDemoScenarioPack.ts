import { McpToolError } from '../../mcp/domain/toolError.js';
import { classicCarScenarioPack } from '../infra/fixtures/classicCarScenarioPack.js';
import { findDraft, updateStatus } from '../infra/repositories/productLaunchDraftRepo.js';
import { runQuoteScenario, type ScenarioResult } from './runQuoteScenario.js';

export interface RunDemoScenarioPackInput {
    draftId: string;
}

export interface ScenarioPackEntry {
    scenarioName: string;
    expected: 'accept' | 'referral' | 'decline';
    actual: 'accept' | 'referral' | 'decline';
    outcome: 'passed' | 'failed';
    summary: string;
}

export interface RunDemoScenarioPackOutput {
    draftId: string;
    scenariosRun: number;
    passed: number;
    failed: number;
    results: ScenarioPackEntry[];
}

export async function runDemoScenarioPack(
    input: RunDemoScenarioPackInput,
): Promise<RunDemoScenarioPackOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
    }

    const results: ScenarioPackEntry[] = [];
    for (const scenario of classicCarScenarioPack) {
        const { result } = await runQuoteScenario({
            draftId: draft.id,
            scenarioName: scenario.name,
            riskData: scenario.quoteData,
        });
        const passed = result.outcome === scenario.expectedOutcome;
        results.push({
            scenarioName: scenario.name,
            expected: scenario.expectedOutcome,
            actual: result.outcome,
            outcome: passed ? 'passed' : 'failed',
            summary: summarizeScenarioResult(scenario.description, result, passed),
        });
    }

    const passed = results.filter((r) => r.outcome === 'passed').length;
    const failed = results.length - passed;
    if (failed === 0 && draft.status !== 'sandbox_published') {
        await updateStatus(draft.id, 'simulated');
    }

    return {
        draftId: draft.id,
        scenariosRun: results.length,
        passed,
        failed,
        results,
    };
}

function summarizeScenarioResult(description: string, result: ScenarioResult, passed: boolean): string {
    const marker = passed ? '✓' : '✗';
    const reasons = result.referralReasons.length > 0 ? ` (${result.referralReasons.slice(0, 2).join('; ')})` : '';
    return `${marker} ${description} → ${result.outcome}${reasons}`;
}
