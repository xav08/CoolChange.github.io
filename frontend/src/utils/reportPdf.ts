import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { ReportBlock, ReportSnapshot } from './report.ts';

const INK = '#183d30';
const MUTED = '#52635c';
const BEFORE = '#aa563a';
const AFTER = '#347657';
const num = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value)
  ? 'Not available' : value.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
// Built-in PDF fonts support Latin text; use explicit words for mathematical symbols.
const text = (value: string) => value.replace(/[–—−]/g, '-').replace(/≥/g, '>=').replace(/→/g, ' to ')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const heat = (value: number | null) => value === null ? 'Not available' : `${num(value)} °C`;
const percent = (value: number | null) => value === null ? 'Not available' : `${num(value, 1)}%`;
const location = (block: ReportBlock) => `${block.code}\n${block.street}`;

export function reportFilename(report: ReportSnapshot) {
  const suburb = report.suburb.sa2_name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || report.suburb.sa2_code16;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(report.createdAt));
  return `cool-change-${suburb}-${date}.pdf`;
}

export function createReportPdf(report: ReportSnapshot) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${report.suburb.sa2_name} - heat and planting report`, author: 'Cool Change', subject: 'Selected mesh blocks and mature-tree scenarios' });
  let y = 22;
  function page() { doc.addPage(); y = 22; }
  function space(height: number) { if (y + height > 273) page(); }
  function heading(label: string, size = 17) {
    space(17); doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(INK);
    const lines = doc.splitTextToSize(text(label), 178) as string[];
    doc.text(lines, 16, y); y += lines.length * size * 0.42 + 5;
  }
  function paragraph(label: string, size = 10) {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(MUTED);
    const lines = doc.splitTextToSize(text(label), 178) as string[];
    for (const line of lines) { space(5); doc.text(line, 16, y); y += size * 0.45; }
    y += 3;
  }
  function table(head: string[], body: string[][], widths?: Record<number, { cellWidth: number }>) {
    autoTable(doc, { startY: y, margin: { left: 16, right: 16, top: 22, bottom: 22 }, head: [head],
      body: body.map(row => row.map(text)), theme: 'striped', rowPageBreak: 'avoid', showHead: 'everyPage',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: INK, overflow: 'linebreak' },
      headStyles: { fillColor: INK, fontStyle: 'bold', textColor: '#ffffff' },
      alternateRowStyles: { fillColor: '#f0f5f1' }, columnStyles: widths,
      didDrawPage: data => { y = (data.cursor?.y ?? 22) + 10; },
    });
  }

  doc.setFillColor(INK).rect(0, 0, 210, 5, 'F');
  paragraph('COOL CHANGE / EXPLORE THE MAP', 10);
  heading(`${report.suburb.sa2_name}`, 26);
  heading('Heat & planting report');
  paragraph(`${report.blocks.length} selected mesh ${report.blocks.length === 1 ? 'block' : 'blocks'}`);
  paragraph(`Exported ${new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'long', timeStyle: 'short' }).format(new Date(report.createdAt))} (Melbourne time)`);
  table(['Population context', '2016 Census persons'], [
    ['Whole suburb (SA2)', num(report.suburb.persons, 0)],
    [`Selected blocks${report.populationIncluded < report.blocks.length ? ' (known subtotal)' : ''}`, num(report.population, 0)],
    ['Selected blocks with population data', `${report.populationIncluded} of ${report.blocks.length}`],
  ]);
  heading('Your planting scenario');
  paragraph(`${num(report.trees, 0)} simulated mature trees across the selected blocks.`);
  const overall = report.overall;
  table(['Area-weighted surface heat', 'Selected blocks'], [
    ['Before planting', heat(overall?.baseline ?? null)], ['After planting', heat(overall?.simulated ?? null)],
    ['Estimated reduction', heat(overall?.cooling ?? null)],
  ]);
  paragraph(`Based on ${overall?.included ?? 0} of ${report.blocks.length} selected blocks with both heat values and a valid area. Weighted by block area; this is not a whole-suburb result. Reductions are not added together.`, 9);

  page(); heading('Selected blocks / surface heat');
  paragraph('Heat is the 2018 surface-temperature deviation above non-urban land, in °C. It is not live weather or air temperature. After-planting values describe mature trees under the same baseline climate.', 9);
  table(['Block / associated street', 'Persons', 'Trees', 'Before °C', 'After °C', 'Reduction °C'], report.blocks.map(block => [
    location(block), num(block.population, 0), num(block.trees, 0), num(block.baselineHeat), num(block.simulatedHeat), num(block.cooling),
  ]), { 0: { cellWidth: 53 }, 1: { cellWidth: 23 }, 2: { cellWidth: 18 } });
  heading('Canopy coverage');
  paragraph('Coverage is the percentage of block area beneath tree canopy. Change is measured in percentage points (pp).', 9);
  table(['Block / associated street', 'Before %', 'After %', 'Change (pp)'], report.blocks.map(block => [location(block),
    percent(block.baselineCanopy), percent(block.simulatedCanopy), num(block.canopyChange, 1)]), { 0: { cellWidth: 53 } });

  // Use one common axis across all chart pages, including the non-urban zero reference.
  const values = report.blocks.flatMap(block => [block.baselineHeat, block.simulatedHeat]).filter((v): v is number => v !== null);
  const low = Math.floor(Math.min(0, ...values));
  const high = Math.max(low + 1, Math.ceil(Math.max(0, ...values)));
  const x = (value: number) => 64 + (value - low) / (high - low) * 103;
  const rows = report.blocks.map(block => {
    doc.setFont('helvetica', 'normal').setFontSize(8);
    const streetLines = doc.splitTextToSize(text(block.street), 43) as string[];
    return { block, streetLines, height: Math.max(20, 12 + streetLines.length * 3.6 + 4) };
  });
  for (let offset = 0; offset < rows.length;) {
    const shown: typeof rows = [];
    let chartHeight = 0;
    while (offset + shown.length < rows.length) {
      const row = rows[offset + shown.length];
      if (shown.length && chartHeight + row.height > 180) break;
      shown.push(row); chartHeight += row.height;
    }
    page(); heading('Before and after planting');
    paragraph(`Surface heat (°C above non-urban land). Blocks ${offset + 1}-${offset + shown.length} of ${report.blocks.length}.`, 9);
    doc.setFillColor(BEFORE).rect(16, y - 3, 4, 3, 'F');
    doc.setFontSize(9).setTextColor(INK).text('Before', 22, y);
    doc.setFillColor(AFTER).rect(50, y - 3, 4, 3, 'F'); doc.text('After', 56, y);
    y += 13;
    const top = y;
    for (let i = 0; i <= 4; i++) {
      const tick = low + (high - low) * i / 4;
      doc.setDrawColor('#dce4de').setLineWidth(0.2).line(x(tick), top, x(tick), top + chartHeight);
      doc.setFontSize(8).setTextColor(MUTED).text(num(tick, 1), x(tick), top - 3, { align: 'center' });
    }
    doc.setDrawColor('#82948b').line(x(0), top, x(0), top + chartHeight);
    shown.forEach(({ block, streetLines, height }) => {
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK).text(block.code, 16, y + 7);
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
      streetLines.forEach((line, index) => doc.text(line, 16, y + 12 + index * 3.6));
      [block.baselineHeat, block.simulatedHeat].forEach((value, index) => {
        const lineY = y + 3 + index * 6;
        const color = index === 0 ? BEFORE : AFTER;
        if (value !== null) doc.setFillColor(color).rect(Math.min(x(0), x(value)), lineY, Math.max(0.3, Math.abs(x(value) - x(0))), 4, 'F');
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(color).text(value === null ? 'Unavailable' : num(value), 194, lineY + 3, { align: 'right' });
      });
      y += height;
    });
    y += 10;
    paragraph('Each pair uses the same scale. Negative values mean cooler surface temperatures than the non-urban reference. Numeric values remain available when a bar is zero or too small to see.', 9);
    offset += shown.length;
  }

  page(); heading('Planting locations & model details');
  paragraph('Planting locations are the mesh blocks and associated streets listed in this report.', 9);
  const planted = report.blocks.filter(block => block.trees > 0);
  if (!planted.length) paragraph('No trees have been added to the selected blocks. No planting uncertainty interval applies.');
  else table(['Block / associated street', 'Model source', 'After-heat range °C', 'Mature crown m²/tree', 'Estimate limit'], planted.map(block => [
    location(block),
    block.model?.source_kind === 'local' ? 'Local' : `${block.model?.source_kind === 'adjacent' ? 'Adjoining' : 'Nearest usable'}\n${block.model?.source_mb_code16}`,
    block.range ? `${num(block.range[0])} to ${num(block.range[1])}` : 'Not available',
    num(block.model?.crown_area_m2, 1), `${num(block.model?.max_trees, 0)} trees\n${percent(block.model?.canopy_ceiling_pct ?? null)} canopy`,
  ]), { 0: { cellWidth: 42 }, 1: { cellWidth: 29 }, 2: { cellWidth: 38 } });
  paragraph('Ranges are approximate nominal 95% model intervals for the conditional mean association. Their coverage has not been validated. They are not future-temperature prediction intervals or guaranteed cooling. No combined interval is calculated.', 9);
  const releases = [...new Set(planted.map(block => block.release).filter((value): value is string => !!value))];
  for (const release of releases) paragraph(`Model release: ${release}`, 8);
  heading('Limitations & assumptions');
  [
    'Historical context: heat and canopy use 2018 data; population uses 2016 Census counts. These do not describe current weather, vegetation or population.',
    'Statistical areas: the suburb is the app\'s SA2 area. Mesh-block averages do not describe individual homes or people. The first available associated street is shown, not every street.',
    'Tree growth: results assume mature trees, full survival and non-overlapping crowns. Weather, species, growth and local conditions affect actual outcomes. No time-to-maturity prediction is made.',
    'Planting feasibility: the estimate limit reflects supported canopy values, not available planting space. Soil, utilities, ownership, clearances and suitable sites have not been assessed.',
    'Model limits: canopy and heat are statistically associated; the model does not establish a causal cooling guarantee. Ranges omit growth and survival uncertainty, observation noise and spatial error correlation.',
    'Borrowed estimates: adjoining or nearest usable models retain the selected block\'s baseline and area. Additional uncertainty from borrowing is not included.',
    'Missing data: unavailable values are labelled. Overall heat uses only blocks with a valid area and both heat values; population totals disclose their coverage.',
  ].forEach((item, index) => paragraph(`${index + 1}. ${item}`, 9));
  space(36);
  heading('Data sources');
  paragraph('Victorian Department of Transport and Planning: Metropolitan Melbourne Urban Heat Islands and Urban Vegetation 2018. Australian Bureau of Statistics: Census Mesh Block Counts 2016 (2074.0).', 9);
  const sources = [
    ['Victorian heat and vegetation dataset', 'https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/CoolingGreening/CoolingGreening/MapServer/55'],
    ['Australian Bureau of Statistics', 'https://www.abs.gov.au/'],
  ];
  for (const [label, url] of sources) { space(8); doc.setFontSize(9).setTextColor(AFTER).textWithLink(label, 16, y, { url }); y += 7; }
  for (let index = 1; index <= doc.getNumberOfPages(); index++) {
    doc.setPage(index);
    doc.setDrawColor('#c7d5cc').line(16, 280, 194, 280);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    doc.text('Cool Change | Selected-block report', 16, 286);
    doc.text(`${index} / ${doc.getNumberOfPages()}`, 194, 286, { align: 'right' });
  }
  return doc;
}

export function downloadReport(report: ReportSnapshot) {
  createReportPdf(report).save(reportFilename(report));
}
