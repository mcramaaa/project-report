import { escapeXml, Xlsx } from './workbook-xml';

/** A line on the chart: its cells on the sheet plus cached values, so viewers that do not recalculate still draw it. */
export type ChartLine = { name: string; ref: string; values: (number | null)[]; color: string; dash?: boolean; width?: number };

/**
 * D-085: native Excel line chart laid over a cell range (the Curva S of the time schedule). ExcelJS cannot write
 * charts, so the chart, its drawing and their relationships are added to the generated package directly.
 * Axes are hidden and the plot fills the anchor, so point k sits on the right edge of week column k ("midCat").
 */
export async function addLineChart(
  buf: Buffer,
  sheetName: string,
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number },
  lines: ChartLine[],
): Promise<Buffer> {
  const x = await Xlsx.open(buf);
  const sheet = x.sheet(sheetName);
  if (!sheet) return buf;
  const zip = x.zip;
  const free = (dir: string, base: string) => {
    let k = 1;
    while (zip.file(`${dir}/${base}${k}.xml`)) k++;
    return k;
  };
  const chartNo = free('xl/charts', 'chart');
  const drawingNo = free('xl/drawings', 'drawing');
  const chartPath = `xl/charts/chart${chartNo}.xml`;
  const drawingPath = `xl/drawings/drawing${drawingNo}.xml`;

  zip.file(chartPath, chartXml(lines));
  zip.file(
    drawingPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${anchor.fromCol - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.fromRow - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Kurva S"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
  );
  zip.file(
    `xl/drawings/_rels/drawing${drawingNo}.xml.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/></Relationships>`,
  );

  // The sheet points to the drawing; a sheet has at most one drawing, and the generated time schedule has none.
  const relsPath = sheet.path.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels =
    (await zip.file(relsPath)?.async('string')) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let id = 1;
  while (rels.includes(`Id="rIdChart${id}"`)) id++;
  zip.file(
    relsPath,
    rels.replace(
      '</Relationships>',
      `<Relationship Id="rIdChart${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`,
    ),
  );
  const sheetXml = await x.read(sheetName);
  if (/<drawing\b/.test(sheetXml)) return buf;
  const tag = `<drawing r:id="rIdChart${id}"/>`;
  const at = ['<legacyDrawing', '<tableParts', '<extLst', '</worksheet>'].map((t) => sheetXml.indexOf(t)).filter((i) => i >= 0)[0]!;
  let next = sheetXml.slice(0, at) + tag + sheetXml.slice(at);
  if (!/xmlns:r=/.test(next.slice(0, next.indexOf('>', next.indexOf('<worksheet')))))
    next = next.replace('<worksheet', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  x.write(sheetName, next);

  const types = await zip.file('[Content_Types].xml')!.async('string');
  zip.file(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
    ),
  );
  return x.save();
}

function chartXml(lines: ChartLine[]): string {
  const series = lines
    .map((l, i) => {
      const pts = l.values.map((v, k) => (v === null ? '' : `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`)).join('');
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${escapeXml(l.name)}</c:v></c:tx><c:spPr><a:ln w="${(l.width ?? 2) * 12700}" cap="rnd"><a:solidFill><a:srgbClr val="${l.color}"/></a:solidFill>${l.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:val><c:numRef><c:f>${escapeXml(l.ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${l.values.length}"/>${pts}</c:numCache></c:numRef></c:val><c:smooth val="0"/></c:ser>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0"/><c:y val="0"/><c:w val="1"/><c:h val="1"/></c:manualLayout></c:layout><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="50010"/><c:axId val="50020"/></c:lineChart><c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/><c:max val="100"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}
