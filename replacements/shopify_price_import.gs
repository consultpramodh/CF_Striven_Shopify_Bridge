
/************************************************************
 * Shopify Price Import — Build CSV from Variance
 *
 * Variance columns expected (your sheet matches this):
 *  SKU
 *  Target Price
 *  Shopify Handle
 *  Shopify Title
 *  Option1 Name / Option1 Value
 *  Option2 Name / Option2 Value (optional)
 *  Option3 Name / Option3 Value (optional)
 *  Update Shopify? (optional safety gate)
 *
 * Output: STANDARD Shopify CSV headers:
 *  Handle, Title, Option*, Variant SKU, Variant Price
 ************************************************************/

const SHOPIFY_PRICE_IMPORT_CFG = {
  STRIVEN_SHEET: 'Striven_Items',
  SHOPIFY_SHEET: 'Shopify_products', // admin export sheet (used for enrichment + dup log)
  OUT_SHEET:     'Shopify_Price_Import',
  DUP_LOG_SHEET: 'Shopify_Duplicate_SKUs',
  LOG_SHEET:     'Shopify_Price_Import_Log',

  STRIVEN_SKU_FIELD: 'ItemNumber',
  SHOPIFY_SKU_FIELD: 'Variant SKU',
  STRIVEN_PRICE_FIELD: 'Price',

  INCLUDE_ONLY_MATCHES: true,
  ALLOW_DUPLICATE_SKUS: true,

  ONLY_ACTIVE_PRODUCTS: true,
  SHOPIFY_STATUS_FIELD: 'Status',
  SHOPIFY_PUBLISHED_FIELD: 'Published',

  // Safety: if true, only rows with Variance["Update Shopify?"] === TRUE are exported
  REQUIRE_UPDATE_CHECKBOX: true,

  EXPORT_CSV_TO_DRIVE: true,
  DRIVE_FOLDER_ID: '',
  FILE_PREFIX: 'Shopify_Price_Import',
  PRICE_DECIMALS: 2
};

/**
 * Pipeline:
 * 1) Sync public products (fast)
 * 2) Build variance from public (detect underpriced SKUs)
 * 3) Enrich variance identifiers from admin export (Handle/Options needed for CSV import)
 * 4) Build Shopify import sheet + optional CSV
 */
function runPublicVarianceThenBuildShopifyPriceImport() {
  priceBridgeInvalidateOutput_();
  if (!priceBridgeRefreshSource_()) return;
  syncShopifyPublicProductsToSheet();
  buildVarianceSheet_FromPublic();

  // Critical: public feed often lacks Handle/Options; admin export provides them
  enrichVarianceIdentifiersFromAdminExport_();

  buildShopifyPriceImportSheet();
}

/**
 * Build Shopify_Price_Import directly from Variance (no second join).
 */
function buildShopifyPriceImportSheet() {
  priceBridgeInvalidateOutput_();
  priceBridgeRequireCompleteSource_();
  const cfg = SHOPIFY_PRICE_IMPORT_CFG;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const VAR_SHEET = 'Variance';
  const vSh = ss.getSheetByName(VAR_SHEET);
  if (!vSh) throw new Error(`Missing sheet: ${VAR_SHEET} (run buildVarianceSheet first)`);

  const pSh = ss.getSheetByName(cfg.SHOPIFY_SHEET); // used for duplicate SKU log + context
  if (!pSh) throw new Error(`Missing sheet: ${cfg.SHOPIFY_SHEET}`);

  const vData = vSh.getDataRange().getValues();
  const pData = pSh.getDataRange().getValues();

const OUT_HEADERS = [
  'Handle',
  'Title',
  'Option1 Name', 'Option1 Value',
  'Option2 Name', 'Option2 Value',
  'Option3 Name', 'Option3 Value',
  'Variant SKU',
  'Variant Price'
];


  // If Variance has no data rows, clear output + logs and exit safely
  if (vData.length < 2) {
    const outSh = ss.getSheetByName(cfg.OUT_SHEET) || ss.insertSheet(cfg.OUT_SHEET);
    outSh.clearContents();
    outSh.getRange(1, 1, 1, OUT_HEADERS.length).setValues([OUT_HEADERS]);
    outSh.setFrozenRows(1);

    const dupSh = ss.getSheetByName(cfg.DUP_LOG_SHEET);
    if (dupSh) dupSh.clearContents();

    writeShopifyImportLog_(cfg, {
      timestamp: new Date(),
      shopifySheet: cfg.SHOPIFY_SHEET,
      shopifyRows: Math.max(0, pData.length - 1),
      varianceRows: 0,
      exportedRows: 0,
      skippedNotChecked: 0,
      skippedMissingTarget: 0,
      skippedMissingHandle: 0
    });

    Logger.log('Variance is empty. Cleared Shopify_Price_Import. Nothing to export.');
    return;
  }

  const vHeader = vData[0];

  // ---- Variance required cols (YOUR actual names) ----
  const vSkuCol     = priceBridgeFindCol_(vHeader, 'SKU');
  const vTargetCol  = priceBridgeFindCol_(vHeader, 'Target Price');
  const vHandleCol  = priceBridgeFindCol_(vHeader, 'Shopify Handle');
  const vTitleCol   = priceBridgeFindCol_(vHeader, 'Shopify Title');
  const vO1NCol     = priceBridgeFindCol_(vHeader, 'Option1 Name');
  const vO1VCol     = priceBridgeFindCol_(vHeader, 'Option1 Value');
  const vO2NCol     = priceBridgeTryFindCol_(vHeader, 'Option2 Name');
  const vO2VCol     = priceBridgeTryFindCol_(vHeader, 'Option2 Value');
  const vO3NCol     = priceBridgeTryFindCol_(vHeader, 'Option3 Name');
  const vO3VCol     = priceBridgeTryFindCol_(vHeader, 'Option3 Value');

  const vUpdateCol = cfg.REQUIRE_UPDATE_CHECKBOX ? priceBridgeFindCol_(vHeader, 'Update Shopify?') : priceBridgeTryFindCol_(vHeader, 'Update Shopify?');

  const vCompareAtCol = priceBridgeTryFindCol_(vHeader, 'Shopify Compare At Price'); // new column in Variance


  // ---- Build output rows directly from Variance ----
  const outRows = [];
  let varianceRows = 0;
  let exportedRows = 0;
  let skippedNotChecked = 0;
  let skippedMissingTarget = 0;
  let skippedMissingHandle = 0;

  for (let r = 1; r < vData.length; r++) {
    varianceRows++;

    // Safety gate (common reason for "blank output")
    if (cfg.REQUIRE_UPDATE_CHECKBOX && vUpdateCol !== -1 && vData[r][vUpdateCol] !== true) {
      skippedNotChecked++;
      continue;
    }

    const sku = priceBridgeSku_(vData[r][vSkuCol]);
    if (!sku) continue;
    const identityError = priceBridgeValidateExportRow_(vData[r], vHeader, pData);
    if (identityError) throw new Error('CSV blocked for SKU ' + sku + ': ' + identityError);

    const target = priceBridgeNumber_(vData[r][vTargetCol]);
    if (!Number.isFinite(target) || target <= 0) {
      skippedMissingTarget++;
      continue;
    }

    const handle = vData[r][vHandleCol];
    if (handle == null || String(handle).trim() === '') {
      skippedMissingHandle++;
      continue;
    }

const pSkuIndex = priceBridgeFirstCol_(pData[0], ['Variant SKU','SKU']);
const pHandleIndex = priceBridgeFindCol_(pData[0], 'Handle');
const optionHeaders = ['Option1 Name','Option1 Value','Option2 Name','Option2 Value','Option3 Name','Option3 Value'];
const resolved = pData.slice(1).find(a => priceBridgeSku_(a[pSkuIndex]) === sku && String(a[pHandleIndex] || '').trim() === String(handle).trim() && optionHeaders.every(n => {const ai=priceBridgeTryFindCol_(pData[0],n), vi=priceBridgeTryFindCol_(vHeader,n); return String(ai < 0 ? '' : (a[ai] || '')).trim() === String(vi < 0 ? '' : (vData[r][vi] || '')).trim();}));
const originalSku = String(resolved[pSkuIndex]);

outRows.push([
  handle ?? '',
  vData[r][vTitleCol] ?? '',
  vData[r][vO1NCol] ?? '',
  vData[r][vO1VCol] ?? '',
  vO2NCol !== -1 ? (vData[r][vO2NCol] ?? '') : '',
  vO2VCol !== -1 ? (vData[r][vO2VCol] ?? '') : '',
  vO3NCol !== -1 ? (vData[r][vO3NCol] ?? '') : '',
  vO3VCol !== -1 ? (vData[r][vO3VCol] ?? '') : '',
  originalSku,
  target.toFixed(cfg.PRICE_DECIMALS)
]);


    exportedRows++;
  }

  // ---- Write output ----
  const outSh = ss.getSheetByName(cfg.OUT_SHEET) || ss.insertSheet(cfg.OUT_SHEET);
  outSh.clearContents();
  outSh.getRange(1, 1, 1, OUT_HEADERS.length).setValues([OUT_HEADERS]);
  if (outRows.length) writeChunk_(outSh, 2, OUT_HEADERS.length, outRows);
  outSh.setFrozenRows(1);

  // ---- Duplicate SKU log (from admin export Shopify sheet) ----
  if (pData.length >= 2) {
    const pHeader = pData[0];
    const pSkuCol = priceBridgeFirstCol_(pHeader, [cfg.SHOPIFY_SKU_FIELD, 'SKU']);
    if (pSkuCol !== -1) {
      const skuCounts = new Map();
      for (let r = 1; r < pData.length; r++) {
        const sku = priceBridgeSku_(pData[r][pSkuCol]);
        if (!sku) continue;
        skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
      }
      writeDuplicateSkuLog_ShopifyOnly_(ss, cfg, skuCounts);
    }
  }

  // ---- Log ----
  writeShopifyImportLog_(cfg, {
    timestamp: new Date(),
    shopifySheet: cfg.SHOPIFY_SHEET,
    shopifyRows: Math.max(0, pData.length - 1),
    varianceRows,
    exportedRows,
    skippedNotChecked,
    skippedMissingTarget,
    skippedMissingHandle
  });

  Logger.log(
    `Shopify_Price_Import built from Variance. ` +
    `varianceRows=${varianceRows}, exportedRows=${exportedRows}, ` +
    `skippedNotChecked=${skippedNotChecked}, skippedMissingTarget=${skippedMissingTarget}, skippedMissingHandle=${skippedMissingHandle}`
  );

  // ---- Optional export (ONCE) ----
  if (cfg.EXPORT_CSV_TO_DRIVE && outRows.length) {
    exportSheetToCsv_(outSh, cfg);
  } else if (cfg.EXPORT_CSV_TO_DRIVE) {
    Logger.log('No rows to export. Skipping CSV export.');
  }
}

/************************************************************
 * Enrich Variance identifiers from Shopify admin export
 * This fixes the "public feed has no Handle/Options" problem.
 ************************************************************/
function enrichVarianceIdentifiersFromAdminExport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const vSh = ss.getSheetByName('Variance');
  const pSh = ss.getSheetByName('Shopify_products'); // admin export
  if (!vSh) throw new Error('Missing sheet: Variance');
  if (!pSh) throw new Error('Missing sheet: Shopify_products (admin export)');

  const vData = vSh.getDataRange().getValues();
  if (vData.length < 2) return;

  const pData = pSh.getDataRange().getValues();

  if (pData.length < 2) throw new Error('Shopify_products has no data rows.');

  const vHeader = vData[0];
  const pHeader = pData[0];

  // Variance columns
  const vSkuCol    = priceBridgeFindCol_(vHeader, 'SKU');
  const vHandleCol = priceBridgeFindCol_(vHeader, 'Shopify Handle');
  const vTitleCol  = priceBridgeFindCol_(vHeader, 'Shopify Title');
  const vO1NCol    = priceBridgeFindCol_(vHeader, 'Option1 Name');
  const vO1VCol    = priceBridgeFindCol_(vHeader, 'Option1 Value');
  const vO2NCol    = priceBridgeTryFindCol_(vHeader, 'Option2 Name');
  const vO2VCol    = priceBridgeTryFindCol_(vHeader, 'Option2 Value');
  const vO3NCol    = priceBridgeTryFindCol_(vHeader, 'Option3 Name');
  const vO3VCol    = priceBridgeTryFindCol_(vHeader, 'Option3 Value');

  // Shopify export columns
  const pSkuCol = priceBridgeFirstCol_(pHeader, ['Variant SKU', 'SKU']);
  if (pSkuCol === -1) throw new Error('Shopify_products missing Variant SKU / SKU');

  const pHandleCol = priceBridgeFindCol_(pHeader, 'Handle');
  const pTitleCol  = priceBridgeFindCol_(pHeader, 'Title');
  const pO1NCol    = priceBridgeFindCol_(pHeader, 'Option1 Name');
  const pO1VCol    = priceBridgeFindCol_(pHeader, 'Option1 Value');
  const pO2NCol    = priceBridgeTryFindCol_(pHeader, 'Option2 Name');
  const pO2VCol    = priceBridgeTryFindCol_(pHeader, 'Option2 Value');
  const pO3NCol    = priceBridgeTryFindCol_(pHeader, 'Option3 Name');
  const pO3VCol    = priceBridgeTryFindCol_(pHeader, 'Option3 Value');

  // Map SKU -> identifiers (first wins)
  const idx = new Map();
  for (let r = 1; r < pData.length; r++) {
    const sku = priceBridgeSku_(pData[r][pSkuCol]);
    if (!sku) continue;
    if (!idx.has(sku)) idx.set(sku, []);
    idx.get(sku).push({
      handle: pData[r][pHandleCol] ?? '',
      title:  pData[r][pTitleCol] ?? '',
      o1n:    pData[r][pO1NCol] ?? '',
      o1v:    pData[r][pO1VCol] ?? '',
      o2n:    pO2NCol !== -1 ? (pData[r][pO2NCol] ?? '') : '',
      o2v:    pO2VCol !== -1 ? (pData[r][pO2VCol] ?? '') : '',
      o3n:    pO3NCol !== -1 ? (pData[r][pO3NCol] ?? '') : '',
      o3v:    pO3VCol !== -1 ? (pData[r][pO3VCol] ?? '') : ''
    });
  }

  // Fill Variance rows
  let filled = 0, missing = 0;
  const out = [];

  for (let r = 1; r < vData.length; r++) {
    const row = vData[r].slice();
    const sku = priceBridgeSku_(row[vSkuCol]);
    const candidates = idx.get(sku) || [];
    const handle = String(row[vHandleCol] || '').trim();
    const byHandle = candidates.filter(c => String(c.handle).trim() === handle);
    let matching = byHandle.length ? byHandle : candidates;
    if (matching.length > 1 && row[vO1VCol]) matching = matching.filter(c => [c.o1n,c.o1v,c.o2n,c.o2v,c.o3n,c.o3v].join('|') === [row[vO1NCol],row[vO1VCol],vO2NCol < 0 ? '' : row[vO2NCol],vO2VCol < 0 ? '' : row[vO2VCol],vO3NCol < 0 ? '' : row[vO3NCol],vO3VCol < 0 ? '' : row[vO3VCol]].join('|'));
    const s = matching.length === 1 ? matching[0] : null;

    if (s) {
      row[vHandleCol] = s.handle;
      row[vTitleCol]  = s.title;
      row[vO1NCol]    = s.o1n;
      row[vO1VCol]    = s.o1v;
      if (vO2NCol !== -1) row[vO2NCol] = s.o2n;
      if (vO2VCol !== -1) row[vO2VCol] = s.o2v;
      if (vO3NCol !== -1) row[vO3NCol] = s.o3n;
      if (vO3VCol !== -1) row[vO3VCol] = s.o3v;
      filled++;
    } else {
      missing++;
      row[vHandleCol] = '';
      row[priceBridgeFindCol_(vHeader, 'Update Shopify?')] = false;
      row[priceBridgeFindCol_(vHeader, 'Error')] = candidates.length ? 'Ambiguous export identity. Refresh Admin export; do not use first SKU match.' : 'SKU missing from Admin export.';
    }

    out.push(row);
  }

  vSh.getRange(2, 1, out.length, vHeader.length).setValues(out);

  Logger.log(`Variance enriched from Shopify_products. filled=${filled}, missing=${missing}`);
  ss.toast(`Variance enriched: filled=${filled}, missing=${missing}`, 'Variance', 8);
}

/***********************
 * Duplicate SKU Log
 ***********************/
function writeDuplicateSkuLog_ShopifyOnly_(ss, cfg, skuCounts) {
  const sh = ss.getSheetByName(cfg.DUP_LOG_SHEET) || ss.insertSheet(cfg.DUP_LOG_SHEET);
  sh.clearContents();

  const headers = ['SKU', 'Shopify Variant Rows'];
  const rows = [];

  const entries = Array.from(skuCounts.entries())
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  for (const [sku, count] of entries) rows.push([sku, count]);

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
}

/***********************
 * Log Sheet (new, correct)
 ***********************/
function writeShopifyImportLog_(cfg, stats) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(cfg.LOG_SHEET) || ss.insertSheet(cfg.LOG_SHEET);

  const headers = [
    'Timestamp',
    'Shopify Sheet',
    'Shopify Rows',
    'Variance Rows',
    'Exported Rows',
    'Skipped (Not Checked)',
    'Skipped (Missing Target)',
    'Skipped (Missing Handle)'
  ];

  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  sh.appendRow([
    stats.timestamp,
    stats.shopifySheet || '',
    stats.shopifyRows || 0,
    stats.varianceRows || 0,
    stats.exportedRows || 0,
    stats.skippedNotChecked || 0,
    stats.skippedMissingTarget || 0,
    stats.skippedMissingHandle || 0
  ]);
}

/************************************************************
 * LEGACY LOG FUNCTION (kept, but renamed so it doesn't
 * overwrite the correct logger above)
 ************************************************************/
function writeShopifyImportLog_LEGACY_(cfg, stats) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(cfg.LOG_SHEET) || ss.insertSheet(cfg.LOG_SHEET);

  const headers = ['Timestamp','Shopify Rows','Striven Rows','Matched','Skipped Unmatched','Skipped Unpublished','Output Rows'];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);

  sh.appendRow([
    stats.timestamp,
    stats.shopifyScanned,
    stats.varianceRows,
    stats.matched,
    stats.vSkippedNotActive,
    stats.vSkippedNotUnderpriced,
    stats.shopifySkippedNotActive,
    stats.outRows
  ]);
}



function variance_checkAllUpdateShopify() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Variance');
  if (!sh) throw new Error('Missing Variance sheet');

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  const header = data[0].map(String);
  const col = header.indexOf('Update Shopify?');
  if (col === -1) throw new Error('Variance missing "Update Shopify?" column');

  // set TRUE for all rows
  sh.getRange(2, col + 1, data.length - 1, 1).setValue(true);
  ss.toast('Checked Update Shopify? for all variance rows', 'Variance', 6);
}


function exportShopifyPriceImportCsv() {
  // Rebuild and revalidate checked candidates; never export stale output blindly.
  buildShopifyPriceImportSheet();
}
