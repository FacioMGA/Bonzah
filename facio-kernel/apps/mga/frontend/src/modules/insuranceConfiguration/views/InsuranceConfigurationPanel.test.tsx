// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { insuranceConfigurationSchema } from '../../../../../backend/modules/insuranceConfiguration/domain/runtimeConfiguration';
import { InsuranceConfigurationPanel } from './InsuranceConfigurationPanel';
const api = vi.hoisted(() => ({ schema: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('../api/insuranceConfigurationApi', () => ({ insuranceConfigurationApi: api }));
const process = { businessDescription: 'Synthetic', considerations: [], recommendedPackage: 'QUOTE_SYMPHONY', customers: { forms: true, approve: true, docs: false, portal: false, pay: true, claim: false, cancel: false }, agents: { enabled: false, contractTypes: [], deltaBonus: [], commissionMode: 'none', showExpectedCommission: false, cancellationRule: 'proRata', permissions: [] } };
const product = { name: 'Sample', classOfBusinessKey: null, status: 'Active', active: true, coverageSections: [], details: { proposalQuestionGroups: [] } };
const base = { programId: 'programme-a', definitionId: 'definition-a', version: 1, definitionHash: 'a'.repeat(64), status: 'PUBLISHED', process, product, publicationIssues: [], runtimeSupport: [] };
beforeEach(() => { vi.clearAllMocks(); api.schema.mockResolvedValue({ schemaVersion: 1, schemaJson: JSON.stringify(z.toJSONSchema(insuranceConfigurationSchema)), sourceRevision: 'source-commit' }); api.read.mockResolvedValue(base); api.save.mockImplementation(async (_id, input) => ({ ...base, ...input, definitionId: 'definition-next', definitionHash: 'b'.repeat(64), version: 2, status: 'DRAFT' })); });

describe('existing BO programme insurance configuration panel', () => {
  it('edits full typed workflow settings through the canonical command, pins the hash and reports dirty state', async () => {
    const onSaved = vi.fn(), onDirtyChange = vi.fn();
    render(<InsuranceConfigurationPanel programId="programme-a" canEdit onSaved={onSaved} onDirtyChange={onDirtyChange} />);
    const forms = await screen.findByLabelText('process.customers.forms');
    expect(forms).toBeChecked();
    fireEvent.click(forms);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByText('Save programme definition draft'));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('programme-a', expect.objectContaining({ baseDefinitionId: 'definition-a', expectedDefinitionHash: 'a'.repeat(64), process: expect.objectContaining({ customers: expect.objectContaining({ forms: false, pay: true, portal: false }) }) })));
    expect(await screen.findByText(/Draft version 2 saved/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith('definition-next');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('renders the full source coverage/question/rating fields as controls instead of a JSON textarea', async () => {
    render(<InsuranceConfigurationPanel programId="programme-a" canEdit />);
    await screen.findByLabelText('process.customers.forms');
    fireEvent.click(screen.getByText('Product, coverage and questions'));
    expect(screen.getByLabelText('product.name')).toHaveValue('Sample');
    expect(screen.getByText(/^Coverage Sections/)).toBeInTheDocument();
    expect(screen.getByText('Calculations By Coverage')).toBeInTheDocument();
    expect(screen.getByText('Product Lines')).toBeInTheDocument();
    expect(screen.getByText(/^Proposal Question Groups/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/JSON/i)).not.toBeInTheDocument();
  });
  it('discards stale async programme reads and prevents unauthorized edits', async () => {
    let resolveOld: (value: typeof base) => void = () => {};
    api.read.mockImplementation((id) => id === 'old' ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ ...base, programId: 'new', process: { ...process, businessDescription: 'Tenant B only' } }));
    const { rerender } = render(<InsuranceConfigurationPanel programId="old" canEdit />);
    rerender(<InsuranceConfigurationPanel programId="new" canEdit={false} />);
    expect(await screen.findByLabelText('process.businessDescription')).toHaveValue('Tenant B only');
    resolveOld(base);
    await waitFor(() => expect(screen.getByLabelText('process.businessDescription')).toHaveValue('Tenant B only'));
    expect(screen.getByLabelText('process.businessDescription')).toBeDisabled();
    expect(screen.getByText('Save programme definition draft')).toBeDisabled();
    expect(api.save).not.toHaveBeenCalled();
  });
});
