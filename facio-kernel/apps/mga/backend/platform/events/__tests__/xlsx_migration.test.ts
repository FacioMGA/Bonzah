import { describe, it, expect } from 'vitest';
import { readFirstSheetRowsFromBuffer } from '../../../modules/reporting/infra/xlsx/readWorkbookRows.js';
import { writeBdxWorkbookBuffer } from '../../../modules/reporting/infra/xlsx/writeBdxWorkbook.js';

describe('XLSX Migration Verification', () => {
    it('should parse XLSX buffer to JSON correctly', async () => {
        const rows = [
            { 'Insured Name': 'Alice', 'Vehicle Value': 30000, 'Inception Date': '2026-01-01' },
            { 'Insured Name': 'Bob', 'Vehicle Value': 25000, 'Inception Date': '2026-01-02' },
        ];
        const headers = ['Insured Name', 'Vehicle Value', 'Inception Date'];
        const buf = await writeBdxWorkbookBuffer({
            stream: 'risk',
            rows,
            headers,
            sheetName: 'RISK',
        });
        const parsed = await readFirstSheetRowsFromBuffer(buf, 'xlsx-migration-test');
        expect(parsed).toHaveLength(2);
        expect(parsed[0]?.['Insured Name']).toBe('Alice');
        expect(parsed[0]?.['Vehicle Value']).toBe(30000);
        expect(parsed[0]?.['Inception Date']).toBeInstanceOf(Date);
    });

    it('should generate XLSX buffer from JSON correctly', async () => {
        const data = [
            { 'Insured Name': 'foo', 'Vehicle Value': 1, 'Inception Date': '2026-03-01' },
            { 'Insured Name': 'bar', 'Vehicle Value': 2, 'Inception Date': '2026-03-02' },
        ];
        const buf = await writeBdxWorkbookBuffer({
            stream: 'risk',
            rows: data,
            headers: ['Insured Name', 'Vehicle Value', 'Inception Date'],
            sheetName: 'Export',
        });
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
        const parsed = await readFirstSheetRowsFromBuffer(buf, 'xlsx-migration-test');
        expect(parsed).toHaveLength(2);
        expect(parsed[1]?.['Insured Name']).toBe('bar');
        expect(parsed[1]?.['Vehicle Value']).toBe(2);
    });
});
