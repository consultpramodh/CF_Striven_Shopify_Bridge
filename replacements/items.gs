
function pullStrivenReport_Items_ToSheet_RESUMABLE(reset = false, timeBudgetMs) {
  const SHEET_NAME = 'Striven_Items';

  const reportUrl = PropertiesService.getScriptProperties().getProperty('STRIVEN_REPORT_URL');
  if (!reportUrl || !/^https:\/\/api\.striven\.com\/v2\/reports\//.test(reportUrl)) throw new Error('Set STRIVEN_REPORT_URL to the authorized Striven items report URL.');

  const token = typeof getValidStrivenToken_ === 'function' ? getValidStrivenToken_() : PropertiesService.getScriptProperties().getProperty('STRIVEN_ACCESS_TOKEN');
  if (!token) throw new Error('Missing Script Property STRIVEN_ACCESS_TOKEN');

  const WRITE_CHUNK_ROWS = 2500;
  const MAX_PAGES = 5000;
  const TIME_BUDGET_MS = Number(timeBudgetMs) || 5 * 60 * 1000;
  const STOP_BUFFER_MS = 25 * 1000;

  // Script property keys (so resume is stable)
  const PROP_PAGE   = 'INV_SYNC_PAGEINDEX';
  const PROP_ROW    = 'INV_SYNC_WRITEROW';
  const PROP_TOTAL  = 'INV_SYNC_TOTALROWS';
  const PROP_HDRS   = 'INV_SYNC_HEADERS_JSON';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('Could not acquire lock. Another sync may be running.');

  try {
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.getActive();
    const targetSheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const sh = ss.getSheetByName('Striven_Items_Refresh') || ss.insertSheet('Striven_Items_Refresh');
    props.setProperty('PRICE_BRIDGE_SOURCE_STATE', 'REFRESHING');

    let pageIndex = Number(props.getProperty(PROP_PAGE) || '0');
    let writeRow  = Number(props.getProperty(PROP_ROW)  || '2');
    let totalRows = Number(props.getProperty(PROP_TOTAL)|| '0');

    if (reset || !props.getProperty(PROP_PAGE)) {
      pageIndex = 0;
      writeRow  = 2;
      totalRows = 0;
      props.deleteProperty(PROP_PAGE);
      props.deleteProperty(PROP_ROW);
      props.deleteProperty(PROP_TOTAL);
      props.deleteProperty(PROP_HDRS);
    }

    // Load persisted headers if resuming
    let HEADERS = null;
    const savedHdrs = props.getProperty(PROP_HDRS);
    if (savedHdrs) {
      try { HEADERS = JSON.parse(savedHdrs); } catch (e) { HEADERS = null; }
      if (!Array.isArray(HEADERS) || !HEADERS.length) HEADERS = null;
    }

    const start = Date.now();
    let buffer = [];

    // typed-column safe coercion for “leading zero” candidates
    const needsText = (headerName) => /(^ItemNumber$|sku|upc)/i.test(String(headerName || ''));
    const toCellValue = (headerName, v) => {
      if (v == null || v === '') return '';
      if (needsText(headerName)) return "'" + String(v); // force text in Sheets
      return v;
    };

    // Fetch helper (keeps code tight)
    const fetchPage_ = (idx) => {
      const url = `${reportUrl}${reportUrl.includes('?') ? '&' : '?'}pageindex=${idx}`;
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      const body = res.getContentText();
      if (code < 200 || code > 299) {
        throw new Error(`Striven request failed (HTTP ${code}) pageindex=${idx}: ${body.slice(0, 500)}`);
      }
      let json;
      try { json = JSON.parse(body); }
      catch (e) { throw new Error(`Invalid JSON from Striven pageindex=${idx}: ${body.slice(0, 500)}`); }
      if (!Array.isArray(json && json.data)) throw new Error('Striven report response missing data array at page ' + idx);
      const data = json.data;
      return data;
    };

    // If we are at the start of a run (or headers missing), derive headers from first non-empty page
    if (!HEADERS) {
      // Keep scanning until we find a page with at least one row (or hit MAX_PAGES)
      let scanIndex = pageIndex;
      let firstData = [];
      while (scanIndex < MAX_PAGES) {
        if ((Date.now() - start) > (TIME_BUDGET_MS - STOP_BUFFER_MS)) {
          // Can't even establish headers within time budget; save state and stop
          props.setProperty(PROP_PAGE, String(pageIndex));
          props.setProperty(PROP_ROW, String(writeRow));
          props.setProperty(PROP_TOTAL, String(totalRows));
          Logger.log(`Paused before headers. Resume at pageIndex=${pageIndex}, writeRow=${writeRow}, totalRows=${totalRows}`);
          return;
        }

        firstData = fetchPage_(scanIndex);
        if (firstData.length > 0) {
          pageIndex = scanIndex; // important: don't skip the first data page
          break;
        }
        break;
      }

      if (!firstData.length) {
        // No data at all
        throw new Error('Striven report returned no data. Existing Striven_Items preserved.');
      }

      HEADERS = Object.keys(firstData[0] || {});
      if (!HEADERS.length) throw new Error('Could not derive headers: first data row has no keys.');

      props.setProperty(PROP_HDRS, JSON.stringify(HEADERS)); // persist for resume stability

      // Clear existing content (row2+) across previous used columns (not just new header count)
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow > 1 && lastCol > 0) {
        sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      }

      // Write header row
      sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // If starting fresh and headers exist (rare but possible), ensure header row is present
      if (pageIndex === 0 && writeRow === 2) {
        const lastRow = sh.getLastRow();
        const lastCol = sh.getLastColumn();
        if (lastRow > 1 && lastCol > 0) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
        sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
        sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
    }

    while (pageIndex < MAX_PAGES) {
      if ((Date.now() - start) > (TIME_BUDGET_MS - STOP_BUFFER_MS)) {
        props.setProperty(PROP_PAGE, String(pageIndex));
        props.setProperty(PROP_ROW, String(writeRow));
        props.setProperty(PROP_TOTAL, String(totalRows));
        Logger.log(`Paused to avoid timeout. Resume at pageIndex=${pageIndex}, writeRow=${writeRow}, totalRows=${totalRows}`);
        return;
      }

      const data = fetchPage_(pageIndex);
      if (!data.length) break;

      for (const r of data) {
        const row = HEADERS.map((h) => toCellValue(h, r?.[h]));
        buffer.push(row);

        if (buffer.length >= WRITE_CHUNK_ROWS) {
          writeChunk_(sh, writeRow, HEADERS.length, buffer);
          writeRow += buffer.length;
          totalRows += buffer.length;
          buffer = [];
        }
      }

      if (buffer.length) {
        writeChunk_(sh, writeRow, HEADERS.length, buffer);
        writeRow += buffer.length;
        totalRows += buffer.length;
        buffer = [];
      }
      SpreadsheetApp.flush();
      pageIndex++;
      props.setProperties({[PROP_PAGE]: String(pageIndex), [PROP_ROW]: String(writeRow), [PROP_TOTAL]: String(totalRows)});
    }

    if (buffer.length) {
      writeChunk_(sh, writeRow, HEADERS.length, buffer);
      writeRow += buffer.length;
      totalRows += buffer.length;
      buffer = [];
    }

    if (pageIndex >= MAX_PAGES) throw new Error('Striven refresh hit page limit; snapshot not published.');
    if (!totalRows) throw new Error('No items in completed Striven snapshot.');
    const snapshot = sh.getRange(1, 1, totalRows + 1, HEADERS.length).getValues();
    targetSheet.clearContents();
    writeChunk_(targetSheet, 1, HEADERS.length, snapshot);
    targetSheet.setFrozenRows(1);
    SpreadsheetApp.flush();
    props.setProperty('PRICE_BRIDGE_SOURCE_COMPLETED_AT', new Date().toISOString());
    props.setProperty('PRICE_BRIDGE_SOURCE_STATE', 'COMPLETE');

    // Clear resume state on success
    props.deleteProperty(PROP_PAGE);
    props.deleteProperty(PROP_ROW);
    props.deleteProperty(PROP_TOTAL);
    props.deleteProperty(PROP_HDRS);
    // keep PROP_HDRS? depends on preference:
    // - Keeping it makes future resumes stable even if header order changes mid-month
    // - Deleting it forces re-derivation next full run
    // I recommend keeping it unless you frequently change report columns.
    // props.deleteProperty(PROP_HDRS);

    Logger.log(`Done. Wrote ${totalRows} rows to "${SHEET_NAME}" across ${pageIndex} page(s).`);
  } catch (err) {
    PropertiesService.getScriptProperties().setProperty('PRICE_BRIDGE_SOURCE_STATE', 'ERROR');
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function writeChunk_(sh, startRow, numCols, rows) {
  if (!rows.length) return;
  const lastRow = startRow + rows.length - 1;
  if (lastRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), lastRow - sh.getMaxRows());
  if (numCols > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), numCols - sh.getMaxColumns());
  sh.getRange(startRow, 1, rows.length, numCols).setValues(rows);
}

