
/************************************************************
 * shopify_import.gs — Build Shopify Import CSV from:
 *   - Striven_Items (source of truth for price/cost/upc)
 *   - Shopify_products (source of truth for handles/variants)
 *
 * Output:
 *   - Sheet: Shopify_Import
 *   - (Optional) Drive CSV: Shopify_Import_<YYYYMMDD_HHMM>.csv
 *
 * Safety:
 *   - Only updates fields you explicitly enable in CONFIG
 *   - Never touches inventory quantities (Shopify CSV is wrong tool for that)
 ************************************************************/

const SHOPIFY_IMPORT_CONFIG = {
  STRIVEN_SHEET: 'Striven_Items',
  SHOPIFY_SHEET: 'Shopify_products',
  OUT_SHEET:     'Shopify_Import',
  LOG_SHEET:     'Shopify_Import_Log',

  // Join keys
  STRIVEN_SKU_FIELD: 'ItemNumber',     // change to 'ItemsSKU' if needed
  SHOPIFY_SKU_FIELD: 'Variant SKU',

  // Which fields to overwrite from Striven → Shopify
  UPDATE_PRICE:   true,   // Variant Price
  UPDATE_COST:    true,   // Cost per item
  UPDATE_BARCODE: true,   // Variant Barcode

  // Optional: only include published Shopify variants
  ONLY_PUBLISHED: false,  // set true if you want active-only

  // Shopify export field names (from Shopify_products)
  SHOPIFY_PUBLISHED_FIELD: 'Published',

  // Export to Drive?
  EXPORT_CSV_TO_DRIVE: true,
  DRIVE_FOLDER_ID: '', // blank = My Drive root. Put folder id to control location.

  // CSV filename prefix
  FILE_PREFIX: 'Shopify_Import',

  // Price formatting
  PRICE_DECIMALS: 2
};

/**
 * Main entry: build the Shopify_Import sheet, and optionally export CSV to Drive.
 */
function buildShopifyImportSheet() {
  const cfg = SHOPIFY_IMPORT_CONFIG;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sSh = ss.getSheetByName(cfg.STRIVEN_SHEET);
  const pSh = ss.getSheetByName(cfg.SHOPIFY_SHEET);
  if (!sSh) throw new Error(`Missing sheet: ${cfg.STRIVEN_SHEET}`);
  if (!pSh) throw new Error(`Missing sheet: ${cfg.SHOPIFY_SHEET}`);

  const sData = sSh.getDataRange().getValues();
  const pData = pSh.getDataRange().getValues();
  if (sData.length < 2) throw new Error(`${cfg.STRIVEN_SHEET} has no data rows.`);
  if (pData.length < 2) throw new Error(`${cfg.SHOPIFY_SHEET} has no data rows.`);

  const sHeader = sData[0];
  const pHeader = pData[0];

  // --- Column lookups ---
  const sSkuCol   = findCol_(sHeader, cfg.STRIVEN_SKU_FIELD);
  const sPriceCol = cfg.UPDATE_PRICE   ? findCol_(sHeader, 'Price')    : -1;
  const sCostCol  = cfg.UPDATE_COST    ? findCol_(sHeader, 'Cost')     : -1;
  const sUpcCol   = cfg.UPDATE_BARCODE ? firstColOrMinus1_(sHeader, ['ItemsUPC', 'UPC', 'Barcode', 'Variant Barcode']) : -1;

  const pSkuCol     = findCol_(pHeader, cfg.SHOPIFY_SKU_FIELD);
  const pPubCol     = cfg.ONLY_PUBLISHED ? tryFindCol_(pHeader, cfg.SHOPIFY_PUBLISHED_FIELD) : -1;

  // Fields we will copy through from Shopify export (minimum identifiers)
  // Keep this list tight. More columns = more accidental overwrites.
  const OUT_HEADERS = [
    'Handle',
    'Title',
    'Option1 Name',
    'Option1 Value',
    'Option2 Name',
    'Option2 Value',
    'Option3 Name',
    'Option3 Value',
    'Variant SKU',

    // Updated fields (if enabled)
    ...(cfg.UPDATE_PRICE   ? ['Variant Price']   : []),
    ...(cfg.UPDATE_COST    ? ['Cost per item']   : []),
    ...(cfg.UPDATE_BARCODE ? ['Variant Barcode'] : [])
  ];

  // Map Shopify header -> index
  const pCol = name => tryFindCol_(pHeader, name);

  // Ensure Shopify has required identifiers
  const requiredShopFields = [
    'Handle','Title',
    'Option1 Name','Option1 Value',
    'Option2 Name','Option2 Value',
    'Option3 Name','Option3 Value',
    'Variant SKU'
  ];
  for (const f of requiredShopFields) {
    const idx = pCol(f);
    if (idx === -1) throw new Error(`Shopify sheet missing required column "${f}"`);
  }

  // --- Build Striven map: SKU -> { price, cost, upc } ---
  const strivenMap = new Map();
  let strivenRows = 0;

  for (let r = 1; r < sData.length; r++) {
    const sku = normSku_(sData[r][sSkuCol]);
    if (!sku) continue;

    if (!strivenMap.has(sku)) {
      strivenMap.set(sku, {
        price: cfg.UPDATE_PRICE ? toMoney_(sData[r][sPriceCol], cfg.PRICE_DECIMALS) : '',
        cost:  cfg.UPDATE_COST  ? toMoney_(sData[r][sCostCol],  cfg.PRICE_DECIMALS) : '',
        upc:   cfg.UPDATE_BARCODE && sUpcCol !== -1 ? asPlain_(sData[r][sUpcCol]) : ''
      });
    }
    strivenRows++;
  }

  // --- Build output rows from Shopify export (only those with Striven match) ---
  const outRows = [];
  let shopRows = 0, matched = 0, skippedUnmatched = 0, skippedUnpublished = 0;

  for (let r = 1; r < pData.length; r++) {
    shopRows++;

    if (cfg.ONLY_PUBLISHED) {
      const pubIdx = (pPubCol !== -1) ? pPubCol : -1;
      if (pubIdx !== -1 && !isTrue_(pData[r][pubIdx])) {
        skippedUnpublished++;
        continue;
      }
    }

    const sku = normSku_(pData[r][pSkuCol]);
    if (!sku) continue;

    const s = strivenMap.get(sku);
    if (!s) { skippedUnmatched++; continue; }

    matched++;

    const row = [];
    // Copy identifiers
    row.push(pData[r][pCol('Handle')] ?? '');
    row.push(pData[r][pCol('Title')] ?? '');
    row.push(pData[r][pCol('Option1 Name')] ?? '');
    row.push(pData[r][pCol('Option1 Value')] ?? '');
    row.push(pData[r][pCol('Option2 Name')] ?? '');
    row.push(pData[r][pCol('Option2 Value')] ?? '');
    row.push(pData[r][pCol('Option3 Name')] ?? '');
    row.push(pData[r][pCol('Option3 Value')] ?? '');
    row.push(pData[r][pCol('Variant SKU')] ?? '');

    // Overlay updates
    if (cfg.UPDATE_PRICE)   row.push(s.price);
    if (cfg.UPDATE_COST)    row.push(s.cost);
    if (cfg.UPDATE_BARCODE) row.push(s.upc);

    outRows.push(row);
  }

  // --- Write output sheet ---
  const outSh = ss.getSheetByName(cfg.OUT_SHEET) || ss.insertSheet(cfg.OUT_SHEET);
  outSh.clearContents();
  outSh.getRange(1, 1, 1, OUT_HEADERS.length).setValues([OUT_HEADERS]);
  if (outRows.length) {
    outSh.getRange(2, 1, outRows.length, OUT_HEADERS.length).setValues(outRows);
  }
  outSh.setFrozenRows(1);

  // --- Log sheet ---
  writeShopifyCatalogImportLog_(cfg, {
    timestamp: new Date(),
    shopRows,
    strivenRows,
    matched,
    skippedUnmatched,
    skippedUnpublished,
    outRows: outRows.length
  });

  // --- Optional export ---
  if (cfg.EXPORT_CSV_TO_DRIVE) {
    exportSheetToCsv_(outSh, cfg);
  }

  Logger.log(`Shopify import built: ${outRows.length} rows (matched SKUs).`);
}

/**
 * Export OUT_SHEET to Drive as CSV.
 */
function exportShopifyImportCsv() {
  const cfg = SHOPIFY_IMPORT_CONFIG;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(cfg.OUT_SHEET);
  if (!sh) throw new Error(`Missing sheet: ${cfg.OUT_SHEET}`);
  exportSheetToCsv_(sh, cfg);
}

/***********************
 * Helpers
 ***********************/

function exportSheetToCsv_(sh, cfg) {
  const values = sh.getDataRange().getDisplayValues();
  const csv = values.map(r => r.map(escapeCsv_).join(',')).join('\n');

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  const name = `${cfg.FILE_PREFIX}_${stamp}.csv`;

  let folder = null;
  if (cfg.DRIVE_FOLDER_ID) {
    folder = DriveApp.getFolderById(cfg.DRIVE_FOLDER_ID);
  }
  const file = folder ? folder.createFile(name, csv, MimeType.CSV)
                      : DriveApp.createFile(name, csv, MimeType.CSV);

  Logger.log(`CSV exported: ${file.getName()} (Drive file ID: ${file.getId()})`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Exported CSV: ${file.getName()}`, 'Shopify Import', 8);
}

function escapeCsv_(v) {
  const s = (v == null) ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeShopifyCatalogImportLog_(cfg, stats) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(cfg.LOG_SHEET) || ss.insertSheet(cfg.LOG_SHEET);

  const headers = ['Timestamp','Shopify Rows','Striven Rows','Matched','Skipped Unmatched','Skipped Unpublished','Output Rows'];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);

  sh.appendRow([
    stats.timestamp,
    stats.shopRows,
    stats.strivenRows,
    stats.matched,
    stats.skippedUnmatched,
    stats.skippedUnpublished,
    stats.outRows
  ]);
}

function asPlain_(v) {
  if (v === null || v === undefined) return '';
  // Strip leading apostrophe used for typed-column safe text in Striven sheet
  return String(v).replace(/^'/, '').trim();
}

function normSku_(v) {
  if (v === null || v === undefined) return '';
  return asPlain_(v).trim().toUpperCase();
}

function toMoney_(v, decimals) {
  const n = toNumber_(v);
  if (!Number.isFinite(n)) return '';
  const factor = Math.pow(10, decimals);
  return (Math.round(n * factor) / factor).toFixed(decimals);
}

function toNumber_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function findCol_(headersRow, headerName) {
  const target = String(headerName).trim().toLowerCase();
  for (let i = 0; i < headersRow.length; i++) {
    const h = String(headersRow[i] ?? '').trim().toLowerCase();
    if (h === target) return i;
  }
  throw new Error(`Missing required header "${headerName}"`);
}

function tryFindCol_(headersRow, headerName) {
  const target = String(headerName).trim().toLowerCase();
  for (let i = 0; i < headersRow.length; i++) {
    const h = String(headersRow[i] ?? '').trim().toLowerCase();
    if (h === target) return i;
  }
  return -1;
}

function firstColOrMinus1_(headersRow, candidates) {
  for (const name of candidates) {
    const idx = tryFindCol_(headersRow, name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function isTrue_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

