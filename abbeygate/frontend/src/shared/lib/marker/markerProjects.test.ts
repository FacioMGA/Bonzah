import { describe, expect, it } from 'vitest';

import { getMarkerProjectForHost } from '@/src/shared/lib/marker/markerProjects';

describe('getMarkerProjectForHost', () => {
  it('routes each live territory host to its own Marker.io project', () => {
    expect(getMarkerProjectForHost('cy.abbeygate.com')).toBe('6a5a7850f723addd97c777ce');
    expect(getMarkerProjectForHost('pt.abbeygate.com')).toBe('6a5a786bb6bdc4d78040331d');
    expect(getMarkerProjectForHost('gr.abbeygate.com')).toBe('6a5a788007e446f4a3cde575');
  });

  it('maps staging and legacy facio hosts to the same territory projects', () => {
    expect(getMarkerProjectForHost('cy.staging.abbeygate.com')).toBe('6a5a7850f723addd97c777ce');
    expect(getMarkerProjectForHost('abbeygate-pt.facio.io')).toBe('6a5a786bb6bdc4d78040331d');
    expect(getMarkerProjectForHost('abbeygate-gr.facio.io')).toBe('6a5a788007e446f4a3cde575');
  });

  it('returns null for ES (no online route / no project yet)', () => {
    expect(getMarkerProjectForHost('abbeygate-es.facio.io')).toBeNull();
  });

  it('returns null for non-territory hosts so the widget stays disabled', () => {
    expect(getMarkerProjectForHost('localhost')).toBeNull();
    expect(getMarkerProjectForHost('preview.vercel.app')).toBeNull();
    expect(getMarkerProjectForHost('')).toBeNull();
  });
});
