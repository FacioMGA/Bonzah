import { describe, expect, it } from 'vitest';

import { parseListQueryStateFromUrl, writeListQueryStateToUrl } from './urlState';
import type { RecordListConfig } from './types';

type Row = { id: string };

const config: RecordListConfig<Row> = {
  id: 'demo',
  entityLabel: 'Demo',
  getRowId: (r) => r.id,
  columns: [
    {
      id: 'id',
      header: 'ID',
      render: (r) => r.id,
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      sortable: true,
      sortField: 'updatedAt',
      render: () => '',
    },
    {
      id: 'expiryDate',
      header: 'Expiry',
      sortable: true,
      sortField: 'expiryDate',
      render: () => '',
    },
  ],
  filters: [
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      defaultValue: '',
      urlKey: 'status',
      options: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Draft', value: 'DRAFT' },
      ],
    },
  ],
};

describe('recordList urlState', () => {
  it('parses search + filters + sort from URL', () => {
    const sp = new URLSearchParams('q=abc&status=ACTIVE&sort=updatedAt&dir=asc&sort2=expiryDate&dir2=desc');
    const q = parseListQueryStateFromUrl(config, sp);
    expect(q.search).toBe('abc');
    expect(q.filters.status).toBe('ACTIVE');
    expect(q.sort).toEqual({ field: 'updatedAt', direction: 'asc' });
    expect(q.sorts).toEqual([
      { field: 'updatedAt', direction: 'asc' },
      { field: 'expiryDate', direction: 'desc' },
    ]);
  });

  it('writes search/filters/sort back to URL (and removes empties)', () => {
    const sp = new URLSearchParams('foo=bar&q=old&status=ACTIVE&sort=createdAt&dir=desc');
    const out = writeListQueryStateToUrl(
      config,
      { search: '', filters: { status: '' }, sorts: [], sort: null },
      sp
    );
    expect(out.get('foo')).toBe('bar');
    expect(out.get('q')).toBe(null);
    expect(out.get('status')).toBe(null);
    expect(out.get('sort')).toBe(null);
    expect(out.get('dir')).toBe(null);
    expect(out.get('sort2')).toBe(null);
    expect(out.get('dir2')).toBe(null);
  });

  it('drops unknown sort fields from URL and serialization', () => {
    const sp = new URLSearchParams('q=abc&sort=unknownField&dir=asc&sort2=name&dir2=desc');
    const parsed = parseListQueryStateFromUrl(config, sp);
    expect(parsed.sort).toEqual(null);
    expect(parsed.sorts).toEqual([]);

    const out = writeListQueryStateToUrl(
      config,
      {
        search: 'abc',
        filters: { status: 'ACTIVE' },
        sorts: [
          { field: 'unknownField', direction: 'asc' },
          { field: 'updatedAt', direction: 'desc' },
        ],
        sort: { field: 'unknownField', direction: 'asc' },
      },
      new URLSearchParams()
    );
    expect(out.get('sort')).toBe('updatedAt');
    expect(out.get('dir')).toBe('desc');
  });
});

