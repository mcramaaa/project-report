'use client';

import Link from 'next/link';
import { Button } from './ui';

/** Toolbar above a printable report; hidden when printing. "Simpan sebagai PDF" happens in the browser's print dialog (D-082 butir 5). */
export function PrintBar({
  back,
  title,
  templateHref,
  excelHref,
}: {
  back: string;
  title: string;
  templateHref: string;
  /** D-084: same layout as an Excel file, built by the API. */
  excelHref?: string;
}) {
  return (
    <div className="print-bar">
      <div className="row-actions">
        <Link className="btn btn-secondary" href={back}>
          Kembali
        </Link>
        <span className="text-sm font-semibold text-slate-700">{title}</span>
      </div>
      <div className="row-actions">
        <Link className="btn btn-secondary" href={templateHref}>
          Atur template
        </Link>
        {excelHref && (
          <a className="btn btn-secondary" href={excelHref}>
            Unduh Excel
          </a>
        )}
        <Button type="button" onClick={() => window.print()}>
          Cetak / Simpan PDF
        </Button>
      </div>
    </div>
  );
}
