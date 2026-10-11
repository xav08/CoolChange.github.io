import { useEffect, useRef, useState } from 'react';
import type { PlantingScenario } from '../utils/planting';
import type { WarmingLevel } from '../utils/projections';
import type { ReportItem, ReportSuburb } from '../utils/report';
import { loadReport } from '../utils/reportData';
import './report.css';

export function ReportPanel({ suburb, items, scenarios, warming, apiBase, disabled, onRemove }: {
  suburb: ReportSuburb | null; items: ReportItem[]; scenarios: PlantingScenario[]; warming: WarmingLevel;
  apiBase: string; disabled: boolean; onRemove: (code: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const suburbCode = suburb?.sa2_code16;
  useEffect(() => {
    setBusy(false); setMessage(''); setError('');
    return () => { request.current?.abort(); request.current = null; };
  }, [suburbCode]);

  async function exportPdf() {
    if (!suburb || !items.length || busy || disabled) return;
    // Copy at click time; later slider or selection changes cannot mix report inputs.
    const frozen = structuredClone({ suburb, codes: items.map(item => item.code), scenarios, warming });
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setMessage('Preparing your report…');
    const timer = window.setTimeout(() => controller.abort('timeout'), 60000);
    try {
      const snapshot = await loadReport({ ...frozen, apiBase, signal: controller.signal, createdAt: new Date().toISOString() });
      const { downloadReport } = await import('../utils/reportPdf');
      if (controller.signal.aborted) return;
      downloadReport(snapshot);
      setMessage('Your PDF download has started.');
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'The PDF could not be created. Please retry.');
        setMessage('');
      }
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) {
        setBusy(false); request.current = null;
        if (controller.signal.reason === 'timeout') { setMessage(''); setError('Report preparation timed out. Please retry.'); }
      }
    }
  }
  if (!suburb) return null;
  return <details className="report-panel">
    <summary>Report · {items.length} {items.length === 1 ? 'block' : 'blocks'}</summary>
    <p>Add blocks to compare their heat and saved planting in a PDF. Choosing another suburb clears this list.</p>
    {items.length > 0 ? <ul>{items.map(item => <li key={item.code}>
      <span><strong>{item.street}</strong><small>Block {item.code}</small></span>
      <button type="button" onClick={() => onRemove(item.code)} disabled={busy || disabled} aria-label={`Remove block ${item.code} from report`}>Remove</button>
    </li>)}</ul> : <p>Select a mesh block and choose “Add to report”.</p>}
    <button type="button" className="report-export" onClick={() => void exportPdf()} disabled={disabled || busy || !items.length}>
      {busy ? 'Preparing PDF…' : error ? 'Retry PDF export' : 'Export PDF'}
    </button>
    {busy && <button type="button" className="report-cancel" onClick={() => {
      request.current?.abort(); request.current = null; setBusy(false); setMessage('Export cancelled.');
    }}>Cancel</button>}
    <p role="status" className="report-status">{message}</p>
    {error && <p role="alert" className="report-error">{error}</p>}
  </details>;
}
