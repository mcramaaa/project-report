import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { unzippedSize } from './xlsx-guard';

describe('unzippedSize', () => {
  it('sums the unzipped sizes of a real workbook and rejects what is not a zip', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('A').addRow(['x'.repeat(10_000)]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const size = unzippedSize(buf);
    expect(size).toBeGreaterThan(10_000); // the sheet XML alone holds the 10 000 characters
    expect(size).toBeGreaterThan(buf.length); // compressed file is smaller than its content
    expect(unzippedSize(Buffer.from('not a zip at all, just text'))).toBeNull();
  });

  it('reads a declared size larger than the file, as a zip bomb declares', () => {
    // Minimal zip: one central directory entry claiming 3 GB unzipped, then the end record.
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(3_000_000_000, 24);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(0, 16);
    expect(unzippedSize(Buffer.concat([cd, eocd]))).toBe(3_000_000_000);
  });
});
