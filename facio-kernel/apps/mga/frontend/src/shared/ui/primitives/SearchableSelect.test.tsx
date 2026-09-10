/* @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchableSelect } from './SearchableSelect';

describe('SearchableSelect', () => {
  it('renders the open menu in a portal and commits the selected option', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { container } = render(
      <SearchableSelect
        value=""
        onChange={onChange}
        onBlur={onBlur}
        options={[
          { value: 'policy-1', label: 'Policy One' },
          { value: 'policy-2', label: 'Policy Two' },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Select...'));

    const portalOption = screen.getByText('Policy One');
    expect(container.contains(portalOption)).toBe(false);

    fireEvent.click(portalOption);

    expect(onChange).toHaveBeenCalledWith('policy-1');
    expect(onBlur).toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('only scrolls highlighted options for keyboard navigation, not mouse hover', () => {
    const onChange = vi.fn();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        options={[
          { value: 'audi', label: 'Audi' },
          { value: 'bmw', label: 'BMW' },
          { value: 'citroen', label: 'Citroën' },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Select...'));
    fireEvent.mouseEnter(screen.getByText('BMW'));
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('commits on click (so iOS can scroll the list with native touch)', () => {
    // ABY-47: previously each option committed on `pointerdown`, which
    // forced us to preventDefault() the touch and broke native scroll
    // momentum on iOS. We now commit on `click` and rely on the
    // browser's tap-to-click synthesis instead.
    const onChange = vi.fn();

    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        options={[{ value: 'audi', label: 'Audi' }]}
      />,
    );

    fireEvent.click(screen.getByText('Select...'));
    fireEvent.click(screen.getByText('Audi'));
    expect(onChange).toHaveBeenCalledWith('audi');
  });

  it('closes on outside pointer down', () => {
    const onBlur = vi.fn();

    render(
      <div>
        <SearchableSelect
          value=""
          onChange={vi.fn()}
          onBlur={onBlur}
          options={[{ value: 'audi', label: 'Audi' }]}
        />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByText('Select...'));
    expect(screen.getByText('Audi')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByText('Audi')).not.toBeInTheDocument();
    expect(onBlur).toHaveBeenCalled();
  });

  it('closes when focus leaves without a document click', async () => {
    const onBlur = vi.fn();

    render(
      <div>
        <SearchableSelect
          value=""
          onChange={vi.fn()}
          onBlur={onBlur}
          options={[{ value: 'audi', label: 'Audi' }]}
        />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByText('Select...'));
    expect(screen.getByText('Audi')).toBeInTheDocument();
    fireEvent.blur(screen.getByRole('textbox'));

    await waitFor(() => {
      expect(screen.queryByText('Audi')).not.toBeInTheDocument();
    });
    expect(onBlur).toHaveBeenCalled();
  });

  it('ABY-110: option mousedown calls preventDefault so the toggle input never blurs (no setTimeout(closeDropdown) race that would unmount the option before its click commit lands on desktop Chrome)', () => {
    // ABY-110 root cause: on desktop the toggle hosts a focused
    // <input> for the live search query. A plain mousedown on a
    // portal-rendered option would (1) blur that input, (2) the
    // input's onBlur schedules `setTimeout(closeDropdown, 0)`, and
    // (3) on certain Chrome desktop builds the setTimeout fires
    // before the synthesized click reaches the option's onClick —
    // unmounting the portal first and silently dropping the
    // selection. The customer sees the dropdown close empty and the
    // "Please select at least one option" validation error.
    //
    // The contract pinned here: option mousedown MUST call
    // preventDefault. That keeps focus on the toggle input, the blur
    // never fires, the setTimeout is never scheduled, and the click
    // commit always lands. This is the same canonical menu-option
    // pattern used by Radix UI and Headless UI.
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        options={[
          { value: 'europe', label: 'Europe' },
          { value: 'worldwide', label: 'Worldwide' },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Select...'));
    const europeOption = screen.getByText('Europe');
    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    europeOption.dispatchEvent(mouseDownEvent);

    expect(mouseDownEvent.defaultPrevented).toBe(true);
  });

  it('ABY-110: full mousedown→click sequence on an option commits the selection (regression: dropdown closing empty on desktop Chrome)', () => {
    // The realistic browser sequence for a desktop-mouse selection
    // is: option receives mousedown, then mouseup, then click. With
    // the ABY-110 fix the mousedown is preventDefault'd (no input
    // blur, no setTimeout race), and the click that follows still
    // dispatches commitSelection. This pins the end-to-end commit
    // path that was silently broken in production.
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        onBlur={onBlur}
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

    expect(onChange).toHaveBeenCalledWith('europe');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
