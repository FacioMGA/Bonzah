/* @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiSearchableSelect } from './MultiSearchableSelect';

describe('MultiSearchableSelect', () => {
  it('closes on outside pointer down', () => {
    const onBlur = vi.fn();

    render(
      <div>
        <MultiSearchableSelect
          values={[]}
          onChange={vi.fn()}
          onBlur={onBlur}
          options={[{ value: 'europe', label: 'Europe' }]}
        />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByText('Select...'));
    expect(screen.getByText('Europe')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByText('Europe')).not.toBeInTheDocument();
    expect(onBlur).toHaveBeenCalled();
  });

  it('ABY-110: option mousedown calls preventDefault (parity with single-select; prevents the blur→setTimeout race that silently drops desktop selections on Chrome)', () => {
    render(
      <MultiSearchableSelect
        values={[]}
        onChange={vi.fn()}
        options={[{ value: 'europe', label: 'Europe' }]}
      />,
    );

    fireEvent.click(screen.getByText('Select...'));
    const europeOption = screen.getByText('Europe');
    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    europeOption.dispatchEvent(mouseDownEvent);

    expect(mouseDownEvent.defaultPrevented).toBe(true);
  });

  it('ABY-110: full mousedown→click sequence toggles the option (regression: selection dropped on desktop Chrome)', () => {
    const onChange = vi.fn();
    render(
      <MultiSearchableSelect
        values={[]}
        onChange={onChange}
        options={[
          { value: 'europe', label: 'Europe' },
          { value: 'worldwide', label: 'Worldwide' },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Select...'));
    const europeOption = screen.getByText('Europe');

    fireEvent.mouseDown(europeOption);
    fireEvent.mouseUp(europeOption);
    fireEvent.click(europeOption);

    expect(onChange).toHaveBeenCalledWith(['europe']);
  });
});
