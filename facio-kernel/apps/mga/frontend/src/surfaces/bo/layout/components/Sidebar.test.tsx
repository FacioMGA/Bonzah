/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import Sidebar from './Sidebar';
import { BoModeProvider } from '@/src/surfaces/bo/mode';

const internalUser = {
  name: 'Taylor',
  role: 'ADMIN',
  email: 'taylor@example.com',
  effectivePermissions: ['users.view', 'roles.view', 'audit.view'],
};

const adminWithoutPermissions = {
  name: 'Taylor',
  role: 'ADMIN',
  email: 'taylor@example.com',
};

function renderSidebar(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BoModeProvider>
        <Sidebar user={internalUser} />
      </BoModeProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('keeps operate navigation clean and exposes workspace settings from the footer', () => {
    renderSidebar('/');

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Workspace Settings')).toBeInTheDocument();
    expect(screen.queryByText('System')).not.toBeInTheDocument();
    expect(screen.queryByText('Access Control')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('still exposes workspace settings for admins before permission hydration completes', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BoModeProvider>
          <Sidebar user={adminWithoutPermissions} />
        </BoModeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Workspace Settings')).toBeInTheDocument();
  });

  it('renders configure mode sections and a return link', () => {
    renderSidebar('/configure/users');

    expect(screen.getByText('Identity & Access')).toBeInTheDocument();
    expect(screen.getByText('Product Configuration')).toBeInTheDocument();
    expect(screen.getByText('Back to Operations')).toBeInTheDocument();
    expect(screen.queryByText('Return')).not.toBeInTheDocument();
    expect(screen.queryByText('Policies')).not.toBeInTheDocument();
  });
});
