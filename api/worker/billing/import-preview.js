import * as XLSX from 'xlsx';
import { authorizeTenantRequest } from '../../../lib/control-plane.js';
import { requestTenant } from '../../../lib/sandbox-runtime.js';
import { normalizeHistoricalSheet } from '../../../tools/historical-spreadsheet-import.mjs';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    await authorizeTenantRequest(req, requestTenant(req));
    const fileName = String(req.body?.fileName || '').slice(0, 180);
    const base64 = String(req.body?.base64 || '');
    if (!/\.xlsx?$/i.test(fileName)) return res.status(400).json({ error: 'invalid_file_type', message: 'Envie uma planilha Excel .xlsx.' });
    if (!base64 || base64.length > 8_000_000) return res.status(400).json({ error: 'invalid_file_size', message: 'A planilha está vazia ou é muito grande.' });
    const workbook = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer', cellDates: false, raw: true });
    const previews = workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true });
      return normalizeHistoricalSheet({ fileName, sheetName, rows });
    }).filter((item) => item.records.length || item.headerRow);
    const preview = previews.sort((a, b) => b.records.length - a.records.length)[0];
    if (!preview?.records?.length) return res.status(422).json({ error: 'no_valid_calls', message: 'Não encontrei corridas válidas nessa planilha.' });
    return res.json({ ok: true, preview, sheetsFound: previews.length });
  } catch (error) {
    return res.status(error.status || 400).json({ error: 'spreadsheet_parse_failed', message: String(error?.message || error) });
  }
}
