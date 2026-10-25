export interface WorkbookPreviewDto {
  documentId: string;
  filename: string;
  sheets: string[];
  sheet: string;
  selected: {
    cell: string;
    value: string | null;
    formula: string | null;
    references: { sheet: string; cell: string; range?: string }[];
  };
  columns: string[];
  rows: {
    number: number;
    cells: { cell: string; value: string | null; formula: string | null }[];
  }[];
}
