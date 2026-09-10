// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommercialCoverageRows, CommercialSegmentField } from './CommercialCoverageRows';
const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/src/shared/api/http', () => ({ http }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const definition = (name: string) => ({ success: true, data: { id: name, version: 3, workflow: { insuranceConfiguration: { product: { coverageSections: [{ coverageName: name, maxLimit: '100000', deductible: '100', territorialLimit: 'Training only' }], details: { professions: [{ segmentId: 'segment-1', profession: 'Training business' }] } } } } } });
describe('published commercial selections', () => {
  it('keeps selected coverage visible without mutation buttons in read-only mode', async () => {
    http.request.mockResolvedValue(definition('Training liability'));
    render(<CommercialCoverageRows programId="p" binderProductAuthorityId="a" value={[{ coverage: 'Training liability', limit: 25000, excess: 100 }]} disabled onChange={vi.fn()} />);
    await screen.findByText(/Published definition 3/);
    expect(screen.getByLabelText('Coverage 1 limit').getAttribute('value')).toBe('25000');
    expect(screen.queryByRole('button', { name: /Add coverage|Remove coverage/ })).toBeNull();
  });
  it('loads exact mapped options and emits explicit editable amounts without inventing defaults', async () => {
    http.request.mockResolvedValue(definition('Training liability')); const onChange = vi.fn();
    const view = render(<CommercialCoverageRows programId="p" binderProductAuthorityId="a" value={[]} onChange={onChange} currency="GBP" />);
    await screen.findByText(/Published definition 3/); expect(http.request).toHaveBeenCalledWith('programs/p/definition/a');
    fireEvent.click(screen.getByRole('button', { name: 'Add coverage' })); expect(onChange).toHaveBeenLastCalledWith([{ coverage: '', limit: '', excess: '' }]);
    view.rerender(<CommercialCoverageRows programId="p" binderProductAuthorityId="a" value={[{ coverage: 'Training liability', limit: '', excess: '' }]} onChange={onChange} currency="GBP" />);
    fireEvent.change(screen.getByLabelText('Coverage 1 limit'), { target: { value: '25000' } }); expect(onChange).toHaveBeenLastCalledWith([{ coverage: 'Training liability', limit: 25000, excess: '' }]);
    expect(screen.getByText(/Configured maximum limit/).textContent).toContain('100000');
  });
  it('ignores old-authority responses and blocks selection without a mapped authority', async () => {
    let resolveOld!: (value: unknown) => void;
    http.request.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(definition('Current cover'));
    const view = render(<CommercialCoverageRows programId="p" binderProductAuthorityId="old" value={[]} onChange={vi.fn()} />);
    view.rerender(<CommercialCoverageRows programId="p" binderProductAuthorityId="new" value={[]} onChange={vi.fn()} />);
    await screen.findByText(/Published definition 3 · Current cover/); resolveOld(definition('Old cover')); await waitFor(() => expect(screen.queryByText(/Published definition 3 · Old cover/)).toBeNull());
    view.rerender(<CommercialCoverageRows programId="" binderProductAuthorityId="" value={[]} onChange={vi.fn()} />);
    await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Add coverage' }).closest('fieldset')?.disabled).toBe(true);
  });
  it('offers the exact Ready line trigger union, preserves profession labels and does not advertise draft routes', async () => {
    const response = definition('Cover');
    const details = { ...response.data.workflow.insuranceConfiguration.product.details, productLines: [
      { name: 'Line display is not the segment', status: 'Ready', triggerSegmentId: 'ready-only' },
      { status: 'Ready', triggerSegmentId: 'segment-1' },
      { status: 'Draft', triggerSegmentId: 'draft-only' },
      { status: 'Ready', triggerSegmentId: '  ' },
    ] };
    http.request.mockResolvedValue({ ...response, data: { ...response.data, workflow: { insuranceConfiguration: { product: { ...response.data.workflow.insuranceConfiguration.product, details } } } } });
    const onChange = vi.fn();
    const view = render(<CommercialSegmentField programId="p" binderProductAuthorityId="a" value="" onChange={onChange} />);
    await screen.findByRole('option', { name: 'ready-only' });
    const select = screen.getByLabelText('Configured business segment');
    expect(Array.from((select as HTMLSelectElement).options).map(option => [option.value, option.text])).toEqual([
      ['', 'Select a configured business segment'], ['segment-1', 'Training business'], ['ready-only', 'ready-only'],
    ]);
    expect(http.request).toHaveBeenCalledWith('programs/p/definition/a');
    fireEvent.change(select, { target: { value: 'ready-only' } });
    expect(onChange).toHaveBeenLastCalledWith('ready-only');
    view.rerender(<CommercialSegmentField programId="p" binderProductAuthorityId="a" value="ready-only" disabled onChange={onChange} />);
    expect(select).toBeDisabled();
    expect(select).toHaveValue('ready-only');
  });
  it('uses stable segment IDs, independently from display labels', async () => {
    http.request.mockResolvedValue(definition('Cover')); const onChange = vi.fn(); render(<CommercialSegmentField programId="p" binderProductAuthorityId="a" value="" onChange={onChange} />);
    await screen.findByRole('option', { name: 'Training business' }); fireEvent.change(screen.getByLabelText('Configured business segment'), { target: { value: 'segment-1' } }); expect(onChange).toHaveBeenCalledWith('segment-1');
  });
});
