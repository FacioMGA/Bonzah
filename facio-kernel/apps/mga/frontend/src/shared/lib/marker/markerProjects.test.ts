import { expect, it } from 'vitest';
import { getMarkerProjectForHost } from './markerProjects';
it('never sends a new workspace to an inherited customer feedback project', () => {
  for (const host of [
    'cy.abbeygate.com',
    'pt.abbeygate.com',
    'gr.abbeygate.com',
    'platform.facio.io',
    'localhost',
  ])
    expect(getMarkerProjectForHost(host)).toBeNull();
});
