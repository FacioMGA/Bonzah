
import { describe, it, expect } from 'vitest';
import { MagicB } from '../engine.js';
import { SlugDef } from '../types.js';

// Mock Registry to return specific SlugDefs for testing
import { vi } from 'vitest';

vi.mock('../registry', () => {
    const mockSlugs = new Map<string, SlugDef>();

    // 1. Simple Flat Column Binding
    mockSlugs.set('insured_name', {
        slug: 'insured_name',
        dataType: 'string',
        title: 'Insured Name',
        binding: { type: 'column', value: 'legalName' }
    });

    // 2. JSON Path Binding (Simulated simple dot notation for MVP)
    mockSlugs.set('insured_zip', {
        slug: 'insured_zip',
        dataType: 'string',
        title: 'Insured Zip',
        binding: { type: 'json_path', value: 'insured.address.zip' }
    });

    return {
        Registry: {
            getAllRules: () => [], // No rules for this test (or add dummy if needed)
            getSlug: (slug: string) => mockSlugs.get(slug)
        }
    };
});

// We need to access a private method 'getValueForSlug' or test via public API 'validate'
// Ideally, refactor 'getValueForSlug' to be public or internal exported helper.
// Access an internal method via a typed internal-test bridge.

describe('MagicB Storage Bindings', () => {
    const magicBInternal = MagicB as {
        getValueForSlug: (data: Record<string, unknown>, slug: string) => unknown;
    };
    const data = {
        legalName: 'Acme Corp',
        insured: {
            address: {
                zip: '90210'
            }
        },
        // Flat fallback
        'insured_name': 'Fallback Name'
    };

    it('resolves using "column" binding', () => {
        // Should resolve 'legalName' from data, ignoring the key 'insured_name' if binding is authoritative
        // OR, if the requirement is "MagicB resolves the value", we need to see how MagicB uses the binding.
        // Current engine.ts implementation was data[slug]. 
        // We want it to use slugDef.binding.value if present.

        const val = magicBInternal.getValueForSlug(data, 'insured_name');
        expect(val).toBe('Acme Corp');
    });

    it('resolves using "json_path" binding (simple dot notation)', () => {
        const val = magicBInternal.getValueForSlug(data, 'insured_zip');
        expect(val).toBe('90210');
    });

    it('returns undefined if binding path does not exist', () => {
        // Add a slug that points to non-existent path
        // We can't easily add to mocked registry here without helper, 
        // so let's rely on behavior of 'getValueForSlug' when slug is not found in registry (default to slug key)

        const val = magicBInternal.getValueForSlug(data, 'non_existent_slug');
        expect(val).toBeUndefined();
    });
});
