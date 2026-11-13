import { UPLOAD_MAX_BYTES } from '@laporan-proyek/shared';

/**
 * Unzipped size allowed for one .xlsx. Office workbooks unzip to 4–8× their file size (a 98 MB file to 744 MB), so
 * the cap is 10× the upload limit; a zip bomb is hundreds of times its size. Memory no longer follows the XML size
 * since the workbook is streamed (D-089), only the number of cells.
 */
export const MAX_XLSX_UNZIPPED_BYTES = 10 * UPLOAD_MAX_BYTES;

/**
 * Total unzipped size from the zip's central directory, read before ExcelJS inflates anything, so a
 * "zip bomb" (small file, gigabytes of XML) is refused instead of exhausting the API's memory.
 * Returns null when the directory cannot be read or uses ZIP64 (sizes beyond 4 GB): treat as too big.
 */
export function unzippedSize(buf: Buffer): number | null {
  // End of central directory: 22 bytes + comment (≤ 65 535), so it sits in the last 65 557 bytes.
  for (let eocd = buf.length - 22; eocd >= Math.max(0, buf.length - 65_557); eocd--) {
    if (buf.readUInt32LE(eocd) !== 0x06054b50) continue;
    const count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || at === 0xffffffff) return null;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null;
      const size = buf.readUInt32LE(at + 24);
      if (size === 0xffffffff) return null;
      total += size;
      at += 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    }
    return total;
  }
  return null;
}

/** Throws the caller's error when the workbook would unzip past the limit. */
export function checkXlsxSize(buf: Buffer, tooBig: () => Error): void {
  const size = unzippedSize(buf);
  if (size === null || size > MAX_XLSX_UNZIPPED_BYTES) throw tooBig();
}
