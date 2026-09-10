import { describe, expect, it } from 'vitest';
import { classifyWildfireRisk } from '../wildfireRisk.js';

describe('classifyWildfireRisk', () => {
  it('classifies explicit red towns by normalized name', () => {
    const result = classifyWildfireRisk({ country: 'Portugal', town: 'Pedrógão Grande' });
    expect(result.tier).toBe('red');
    expect(result.matchedOn).toBe('name');
  });

  it('lets Portugal ICNF Alta/Muito Alta override a lower territory match', () => {
    const result = classifyWildfireRisk({
      country: 'Portugal',
      town: 'Lisbon',
      officialHazardClass: 'Muito Alta',
    });
    expect(result.tier).toBe('red');
    expect(result.matchedOn).toBe('official');
  });

  it('classifies explicit amber territory by keyword', () => {
    const result = classifyWildfireRisk({ country: 'Cyprus', town: 'Village on steep access road' });
    expect(result.tier).toBe('amber');
    expect(result.matchedOn).toBe('keyword');
  });

  it('classifies explicit yellow territory by keyword', () => {
    const result = classifyWildfireRisk({ country: 'Spain', town: 'Developed coastal area not adjacent to forest' });
    expect(result.tier).toBe('yellow');
  });

  it('classifies explicit green cities by name', () => {
    const result = classifyWildfireRisk({ country: 'Greece', town: 'Athens' });
    expect(result.tier).toBe('green');
    expect(result.matchedOn).toBe('name');
  });

  it('does not silently classify unknown in-scope locations as green', () => {
    const result = classifyWildfireRisk({ country: 'Cyprus', town: 'Unknown Village' });
    expect(result.tier).toBe('unclassified');
    expect(result.matchedOn).toBe('none');
  });
});
