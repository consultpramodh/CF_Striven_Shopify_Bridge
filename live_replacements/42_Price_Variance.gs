
/**
 * Build a Variance sheet showing ONLY SKUs where:
 *   Striven_Items.ItemNumber matches Shopify_products.Variant SKU
 *   AND Striven Price != Shopify Variant Price (within tolerance)
 *   AND Shopify product is eligible; public availability is not publication status
 *
 * Sheets expected:
 *  - Striven_Items
 *  - Shopify_products
 *
 * Headers expected:
 *  - Striven_Items: ItemNumber, Price
 *  - Shopify_products: Variant SKU, Variant Price (and optionally Published)
 */


function buildVarianceSheet_FromExport() {
  buildVarianceSheetCore_('Shopify_products');
}

function buildVarianceSheet_FromPublic() {
  buildVarianceSheetCore_('Shopify_products_public');
}


function buildVarianceSheetCore_(SHOPIFY_SHEET) {
  const STRIVEN_SHEET = 'Striven_Items';
  const OUT_SHEET     = 'Variance';
  const TOLERANCE = 0.01;

  priceBridgeRequireCompleteSource_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sSh = ss.getSheetByName(STRIVEN_SHEET);
  const pSh = ss.getSheetByName(SHOPIFY_SHEET);
  if (!sSh) throw new Error(`Missing sheet: ${STRIVEN_SHEET}`);
  if (!pSh) throw new Error(`Missing sheet: ${SHOPIFY_SHEET}`);

  const sData = sSh.getDataRange().getValues();
  const pData = pSh.getDataRange().getValues();
  if (sData.length < 2) throw new Error(`${STRIVEN_SHEET} has no data rows.`);
  if (pData.length < 2) throw new Error(`${SHOPIFY_SHEET} has no data rows.`);

  const sHeader = sData[0];
  const pHeader = pData[0];

  // Striven required
  const sSkuCol   = priceBridgeFindCol_(sHeader, 'ItemNumber');

  // Striven pricing: prefer MAP if present, else fall back to Price
  const sMapCol   = priceBridgeTryFindCol_(sHeader, 'MAPPricing'); // NEW
  const sPriceCol = priceBridgeFindCol_(sHeader, 'Price');         // keep as fallback

  // Striven optional (your new header is ItemName, so stop guessing)
  const sNameCol = priceBridgeFirstCol_(sHeader, ['ItemName', 'Item Name', 'Name']);
  const sPrefVendorCol = priceBridgeFirstCol_(sHeader, ['PreferredVendor', 'Preferred Vendor']);


  // Shopify SKU + Price support BOTH schemas
  const pSkuCol = priceBridgeFirstCol_(pHeader, ['Variant SKU', 'SKU']);
  if (pSkuCol === -1) throw new Error(`Missing Shopify SKU column in ${SHOPIFY_SHEET}: expected "Variant SKU" or "SKU"`);

  const pPriceCol = priceBridgeFirstCol_(pHeader, ['Variant Price', 'Price']);
  if (pPriceCol === -1) throw new Error(`Missing Shopify price column in ${SHOPIFY_SHEET}: expected "Variant Price" or "Price"`);

  const pCompareAtCol = priceBridgeFirstCol_(pHeader, [
    'Variant Compare At Price', 'CompareAtPrice', 'Compare At Price', 'Compare-at price'
  ]);

  // Optional identifiers
  const pHandleCol = priceBridgeFirstCol_(pHeader, ['Handle', 'handle']);
  const pTitleCol  = priceBridgeFirstCol_(pHeader, ['Title', 'ProductTitle', 'Product Title']);

  // Options (export only)
  const pO1NCol = priceBridgeTryFindCol_(pHeader, 'Option1 Name');
  const pO1VCol = priceBridgeTryFindCol_(pHeader, 'Option1 Value');
  const pO2NCol = priceBridgeTryFindCol_(pHeader, 'Option2 Name');
  const pO2VCol = priceBridgeTryFindCol_(pHeader, 'Option2 Value');
  const pO3NCol = priceBridgeTryFindCol_(pHeader, 'Option3 Name');
  const pO3VCol = priceBridgeTryFindCol_(pHeader, 'Option3 Value');

  // Variant ID (export or public)
  const pVarIdCol = priceBridgeFirstCol_(pHeader, ['Variant ID','Variant Id','variant_id','VariantID','Variant Id (ID)']);

  // Active/Published (export only)
  const pStatusCol = priceBridgeTryFindCol_(pHeader, 'Status');
  const pPublishedCol = priceBridgeTryFindCol_(pHeader, 'Published');
  const hasAdminFilters = (pStatusCol !== -1) || (pPublishedCol !== -1);

  // Build Striven map
  const strivenMap = new Map();
  const ambiguousStrivenSkus = new Set();
  for (let r = 1; r < sData.length; r++) {
    const sku = priceBridgeSku_(sData[r][sSkuCol]);
    if (!sku) continue;
    if (strivenMap.has(sku)) { ambiguousStrivenSkus.add(sku); continue; }

    const sPrice = priceBridgeNumber_(sData[r][sPriceCol]);
    const sMap   = (sMapCol !== -1) ? priceBridgeNumber_(sData[r][sMapCol]) : NaN;

    // Effective price rule: use MAP if valid, else use Price
    const effective = Number.isFinite(sMap) ? sMap : sPrice;

    strivenMap.set(sku, {
      price: sPrice,
      map: sMap,
      effective: effective,
      name: (sNameCol !== -1) ? (sData[r][sNameCol] ?? '') : '',
      prefVendor: (sPrefVendorCol !== -1) ? (sData[r][sPrefVendorCol] ?? '') : ''
    });
  }


  // Duplicate SKU counts (works for either sheet)
  const skuCounts = new Map();
  for (let r = 1; r < pData.length; r++) {
    const sku = priceBridgeSku_(pData[r][pSkuCol]);
    if (!sku) continue;
    skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
  }

  const now = new Date();

const headerRow = [
  'SKU','Item Name','PreferredVendor',
  'Striven Price (Effective)','Striven Price (Base)','Striven MAP',
  'Shopify Variant Price','Delta (Shopify - Striven)','Abs Delta',
  'Duplicate SKU in Shopify Export?','Run Timestamp',
  'Shopify Handle','Shopify Title',
  'Option1 Name','Option1 Value','Option2 Name','Option2 Value','Option3 Name','Option3 Value',
  'Shopify Status','Shopify Published',
  'Shopify Compare At Price',
  'On Sale? (Compare-at > Price)',
  'Update Shopify?','Target Price','Update Status','Last Attempt','Shopify Variant ID','Error'
];



  const rows = [];
  let scannedShopify = 0, matchedSku = 0, underpriced = 0, skippedNotActive = 0;

  for (let r = 1; r < pData.length; r++) {
    scannedShopify++;

    // ACTIVE filter only when the sheet actually has admin-style fields
    let isActive = true;
    if (hasAdminFilters) {
      if (pStatusCol !== -1) {
        isActive = String(pData[r][pStatusCol] ?? '').trim().toLowerCase() === 'active';
      } else if (pPublishedCol !== -1) {
        isActive = priceBridgeTrue_(pData[r][pPublishedCol]);

      }
    }
    if (!isActive) { skippedNotActive++; continue; }

    const sku = priceBridgeSku_(pData[r][pSkuCol]);
    if (!sku) continue;

    const s = strivenMap.get(sku);
    if (!s || ambiguousStrivenSkus.has(sku)) continue;

    const sPrice = s.effective; // NEW: MAP-first
    const shopPrice = priceBridgeNumber_(pData[r][pPriceCol]);

    const compareAt = (pCompareAtCol !== -1) ? priceBridgeNumber_(pData[r][pCompareAtCol]) : NaN;

    if (!Number.isFinite(sPrice) || sPrice <= 0 || !Number.isFinite(shopPrice) || shopPrice < 0) continue;

    const onSale = Number.isFinite(compareAt) && compareAt > shopPrice;
    if (onSale) continue;

    matchedSku++;

    // Underpriced-only (your rule)
    if (!((shopPrice + TOLERANCE) < sPrice)) continue;
    underpriced++;

    const delta = shopPrice - sPrice;
    const absDelta = Math.abs(delta);

    const dupCount = skuCounts.get(sku) || 0;
    const dupLabel = (dupCount > 1) ? `YES (${dupCount} rows)` : 'NO';
    const variantId = (pVarIdCol !== -1) ? (pData[r][pVarIdCol] ?? '') : '';

rows.push([
  sku,
  s.name ?? '',
  s.prefVendor ?? '',
  s.effective,
  s.price,
  Number.isFinite(s.map) ? s.map : '',
  shopPrice,
  delta,
  absDelta,
  dupLabel,
  now,
  pHandleCol !== -1 ? (pData[r][pHandleCol] ?? '') : '',
  pTitleCol  !== -1 ? (pData[r][pTitleCol] ?? '') : '',
  pO1NCol !== -1 ? (pData[r][pO1NCol] ?? '') : '',
  pO1VCol !== -1 ? (pData[r][pO1VCol] ?? '') : '',
  pO2NCol !== -1 ? (pData[r][pO2NCol] ?? '') : '',
  pO2VCol !== -1 ? (pData[r][pO2VCol] ?? '') : '',
  pO3NCol !== -1 ? (pData[r][pO3NCol] ?? '') : '',
  pO3VCol !== -1 ? (pData[r][pO3VCol] ?? '') : '',
  pStatusCol !== -1 ? (pData[r][pStatusCol] ?? '') : '',
  pPublishedCol !== -1 ? (pData[r][pPublishedCol] ?? '') : '',

  // ✅ NEW: store compare-at as a value (blank if not present)
  Number.isFinite(compareAt) ? compareAt : '',

  onSale ? 'YES' : 'NO',
  false,
  s.effective,
  '',
  '',
  variantId,
  ''
]);

  }

  // Sort biggest gaps first
  rows.sort((a, b) => Number(b[8]) - Number(a[8]));

  const out = [headerRow, ...rows];
  const outSh = ss.getSheetByName(OUT_SHEET) || ss.insertSheet(OUT_SHEET);
  outSh.clearContents();
  priceBridgeWriteValues_(outSh, 1, out[0].length, out);
  outSh.setFrozenRows(1);
  if (rows.length) outSh.getRange(2, 24, rows.length, 1).insertCheckboxes();

  // Optional: remove this if you ever hit “typed column” quirks again
  outSh.autoResizeColumns(1, out[0].length);

  Logger.log(
    `Variance complete (${SHOPIFY_SHEET}). ` +
    `Shopify scanned=${scannedShopify}, matchedSKU=${matchedSku}, underpricedRows=${underpriced}, skippedNotActive=${skippedNotActive}.`
  );
}



/** Find a header column by exact header name (case-insensitive). Returns zero-based index. */
function priceBridgeFindCol_(headersRow, headerName) {
  const target = String(headerName).trim().toLowerCase();
  for (let i = 0; i < headersRow.length; i++) {
    const h = String(headersRow[i] ?? '').trim().toLowerCase();
    if (h === target) return i;
  }
  throw new Error(`Missing required header "${headerName}"`);
}

/** Try to find a header; returns -1 if missing (no throw). */
function priceBridgeTryFindCol_(headersRow, headerName) {
  const target = String(headerName).trim().toLowerCase();
  for (let i = 0; i < headersRow.length; i++) {
    const h = String(headersRow[i] ?? '').trim().toLowerCase();
    if (h === target) return i;
  }
  return -1;
}

/** Try multiple candidate headers; returns first match or -1 */
function priceBridgeFirstCol_(headersRow, candidates) {
  for (const name of candidates) {
    const idx = priceBridgeTryFindCol_(headersRow, name);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Normalize SKU for matching */
function priceBridgeSku_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^'/, '').trim().toUpperCase();
}

/** Convert to number, returning NaN if not numeric */
function priceBridgeNumber_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/^(?:CAD|USD)\s*/i, '').replace(/^\$\s*/, '').replace(/,/g, '');
  if (!s || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Truthy parser for Shopify exports: TRUE, true, Yes, 1, etc. */
function priceBridgeTrue_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}




/** Google Apps Script — Price Bridge repair, 2026-10-05. */
function priceBridgeInvalidateOutput_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Shopify_Price_Import');
  if (sh) sh.clearContents();
}

function priceBridgeRefreshSource_() {
  const props = PropertiesService.getScriptProperties();
  const resuming = props.getProperty('PRICE_BRIDGE_ITEMS_STAGED') === 'YES' && !!props.getProperty('SBR_SYNC_ITEMS_PAGEINDEX');
  const result = pullStrivenReport_Items_ToSheet_RESUMABLE(!resuming, 120000);
  if (!result || result.status !== 'DONE' || props.getProperty('PRICE_BRIDGE_SOURCE_STATE') !== 'COMPLETE') {
    SpreadsheetApp.getActiveSpreadsheet().toast('Striven refresh paused. Run the same workflow again to resume. No price export generated.', 'Price Bridge', 10);
    return false;
  }
  return true;
}

function priceBridgeRequireCompleteSource_() {
  const props = PropertiesService.getScriptProperties();
  const completed = Date.parse(props.getProperty('PRICE_BRIDGE_SOURCE_COMPLETED_AT') || '');
  const maxAge = Number(props.getProperty('PRICE_BRIDGE_MAX_SOURCE_AGE_HOURS') || 24);
  if (props.getProperty('PRICE_BRIDGE_SOURCE_STATE') !== 'COMPLETE' || props.getProperty('SBR_SYNC_ITEMS_PAGEINDEX') || !Number.isFinite(completed) || !Number.isFinite(maxAge) || maxAge <= 0 || Date.now() - completed > maxAge * 3600000) {
    throw new Error('Complete a fresh Striven item refresh before calculating, exporting, or pushing prices.');
  }
}


function priceBridgeValidateExportRow_(row, headers, adminData) {
  const cell = name => row[priceBridgeFindCol_(headers, name)];
  const runAt = new Date(cell('Run Timestamp')).getTime();
  const sourceAt = Date.parse(PropertiesService.getScriptProperties().getProperty('PRICE_BRIDGE_SOURCE_COMPLETED_AT') || '');
  if (!Number.isFinite(runAt) || runAt < sourceAt) return 'Source refreshed after variance; rebuild variance.';
  const csvErrorCol=priceBridgeTryFindCol_(headers,'CSV Error');
  if (csvErrorCol >= 0 && row[csvErrorCol]) return String(row[csvErrorCol]);
  if (cell('Error')) return String(cell('Error'));
  const target = priceBridgeNumber_(cell('Target Price'));
  const current = priceBridgeNumber_(cell('Shopify Variant Price'));
  const effective = priceBridgeNumber_(cell('Striven Price (Effective)'));
  const compare = priceBridgeNumber_(cell('Shopify Compare At Price'));
  if (!Number.isFinite(target) || target <= 0 || Math.abs(target - effective) > 0.005) return 'Target differs from verified Striven effective price.';
  if (!Number.isFinite(current) || !(current + 0.01 < target)) return 'Candidate is no longer an underpriced row.';
  if (Number.isFinite(compare) && compare > current) return 'Sale variant excluded.';
  if (adminData.length < 2) return 'Admin export empty.';
  const ah = adminData[0];
  const skuCol = priceBridgeFirstCol_(ah, ['Variant SKU','SKU']);
  const handleCol = priceBridgeFindCol_(ah, 'Handle');
  const optionNames = ['Option1 Name','Option1 Value','Option2 Name','Option2 Value','Option3 Name','Option3 Value'];
  const norm = v => String(v == null ? '' : v).trim();
  const matches = adminData.slice(1).filter(a => skuCol >= 0 && priceBridgeSku_(a[skuCol]) === priceBridgeSku_(cell('SKU')) && norm(a[handleCol]) === norm(cell('Shopify Handle')) && optionNames.every(n => {const i=priceBridgeTryFindCol_(ah,n); return norm(i < 0 ? '' : a[i]) === norm(cell(n));}));
  if (matches.length !== 1) return 'Handle/options/SKU must identify exactly one Admin export row.';
  const statusCol = priceBridgeTryFindCol_(ah, 'Status');
  const status = statusCol < 0 ? '' : norm(matches[0][statusCol]).toLowerCase();
  if (status && status !== 'active') return 'Admin export product is not active.';
  return '';
}

function priceBridgeGraphql_(query, variables) {
  const props = PropertiesService.getScriptProperties();
  const domain = String(props.getProperty('SHOPIFY_STORE_DOMAIN') || props.getProperty('SHOPIFY_SHOP_DOMAIN') || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) throw new Error('Set SHOPIFY_STORE_DOMAIN to the permanent myshopify.com domain.');
  const version = props.getProperty('PRICE_BRIDGE_SHOPIFY_API_VERSION') || '2026-07';
  if (!/^\d{4}-(01|04|07|10)$/.test(version)) throw new Error('Invalid PRICE_BRIDGE_SHOPIFY_API_VERSION.');
  let token;
  if (props.getProperty('SHOPIFY_ADMIN_ACCESS_TOKEN')) token = props.getProperty('SHOPIFY_ADMIN_ACCESS_TOKEN');
  else token = props.getProperty('Shopify_ID');
  if (!token) throw new Error('Missing Shopify Admin token.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = UrlFetchApp.fetch('https://' + domain + '/admin/api/' + version + '/graphql.json', {
      method: 'post', contentType: 'application/json', headers: {'X-Shopify-Access-Token': token},
      payload: JSON.stringify({query: query, variables: variables || {}}), muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    let parsed;
    try { parsed = JSON.parse(response.getContentText()); } catch (e) { throw new Error('Shopify returned non-JSON. HTTP ' + code); }
    if ((code === 429 || (parsed.errors && parsed.errors.some(e => e.extensions && e.extensions.code === 'THROTTLED'))) && attempt < 2) {Utilities.sleep((attempt + 1) * 1500); continue;}
    if (code < 200 || code >= 300 || parsed.errors || !parsed.data) throw new Error('Shopify request failed: HTTP ' + code + ' ' + JSON.stringify(parsed.errors || []));
    return parsed.data;
  }
  throw new Error('Shopify request exhausted retries.');
}

function priceBridgeReadVariant_(variantId) {
  const id = String(variantId || '').trim();
  const gid = /^\d+$/.test(id) ? 'gid://shopify/ProductVariant/' + id : id;
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(gid)) throw new Error('Invalid Shopify Variant ID.');
  const query = `query PriceBridgeVariant($id: ID!) { node(id: $id) { ... on ProductVariant { id sku price compareAtPrice product { id status } } } }`;
  const variant = priceBridgeGraphql_(query, {id: gid}).node;
  if (!variant || !variant.product) throw new Error('Shopify variant not found.');
  return variant;
}

function shopifyUpdateVariantPrice_(variantId, price, expected) {
  if (!expected || !expected.sku || !Number.isFinite(expected.currentPrice)) throw new Error('Expected SKU and current price required.');
  const target = priceBridgeNumber_(price);
  if (!Number.isFinite(target) || target <= 0) throw new Error('Invalid target price.');
  const live = priceBridgeReadVariant_(variantId);
  if (priceBridgeSku_(live.sku) !== priceBridgeSku_(expected.sku)) throw new Error('Live SKU changed; rebuild variance.');
  if (live.product.status !== 'ACTIVE') throw new Error('Live product is not active.');
  const current = priceBridgeNumber_(live.price), compare = priceBridgeNumber_(live.compareAtPrice);
  if (Number.isFinite(compare) && compare > current) throw new Error('Live variant is on sale; excluded.');
  if (Math.abs(current - target) <= 0.005) return live; // recover an earlier successful write
  if (Math.abs(current - expected.currentPrice) > 0.005) throw new Error('Live price changed; rebuild variance.');
  if (!(current + 0.01 < target)) throw new Error('Only underpriced variants may be raised.');
  const mutation = `mutation PriceBridgeUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) { productVariants { id price } userErrors { field message } } }`;
  const result = priceBridgeGraphql_(mutation, {productId: live.product.id, variants: [{id: live.id, price: target.toFixed(2)}]}).productVariantsBulkUpdate;
  if (!result || (result.userErrors || []).length) throw new Error('Shopify update rejected: ' + JSON.stringify(result && result.userErrors));
  const verified = priceBridgeReadVariant_(live.id);
  if (Math.abs(priceBridgeNumber_(verified.price) - target) > 0.005) throw new Error('Price write could not be verified. Recheck live variant before retry.');
  return verified;
}

function pushVariancePrices_ToShopify() {
  priceBridgeRequireCompleteSource_();
  if (PropertiesService.getScriptProperties().getProperty('SHOPIFY_ADMIN_ACCESS_TOKEN')) getValidShopifyAdminAccessToken_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync or price push is running.');
  try {
    priceBridgeRequireCompleteSource_();
    const ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('Variance');
    if (!sh) throw new Error('Missing Variance sheet.');
    const data = sh.getDataRange().getValues(), h = data[0];
    const col = n => priceBridgeFindCol_(h, n);
    const cols = {}; ['Update Shopify?','Target Price','Update Status','Last Attempt','Shopify Variant ID','Error','SKU','Shopify Variant Price','Striven Price (Effective)','Run Timestamp'].forEach(n => cols[n]=col(n));
    const started=Date.now(); let processed=0;
    for (let r=1; r<data.length && processed<50 && Date.now()-started<240000; r++) {
      const row=data[r];
      if (row[cols['Update Shopify?']] !== true || row[cols['Update Status']] === 'UPDATED') continue;
      processed++;
      try {
        const target=priceBridgeNumber_(row[cols['Target Price']]);
        const effective=priceBridgeNumber_(row[cols['Striven Price (Effective)']]);
        const runAt=new Date(row[cols['Run Timestamp']]).getTime();
        const sourceAt=Date.parse(PropertiesService.getScriptProperties().getProperty('PRICE_BRIDGE_SOURCE_COMPLETED_AT'));
        if (!Number.isFinite(runAt) || runAt<sourceAt) throw new Error('Striven refreshed after variance; rebuild variance.');
        if (!Number.isFinite(target) || !Number.isFinite(effective) || Math.abs(target-effective)>0.005) throw new Error('Target must match Striven effective price.');
        shopifyUpdateVariantPrice_(row[cols['Shopify Variant ID']], target, {sku: row[cols['SKU']],currentPrice: priceBridgeNumber_(row[cols['Shopify Variant Price']])});
        sh.getRange(r+1,cols['Update Status']+1).setValue('UPDATED');
        sh.getRange(r+1,cols['Update Shopify?']+1).setValue(false);
        sh.getRange(r+1,cols['Error']+1).clearContent();
      } catch (err) {
        sh.getRange(r+1,cols['Update Status']+1).setValue('FAILED');
        sh.getRange(r+1,cols['Error']+1).setValue(err.message);
      }
      sh.getRange(r+1,cols['Last Attempt']+1).setValue(new Date());
    }
    Logger.log('Price push completed. Attempted rows: ' + processed);
    return {attempted:processed};
  } finally {lock.releaseLock();}
}

function priceBridgeWriteValues_(sh, startRow, numCols, rows) {
  if (!rows || !rows.length) return;
  const lastRow=startRow+rows.length-1;
  if(lastRow>sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(),lastRow-sh.getMaxRows());
  if(numCols>sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(),numCols-sh.getMaxColumns());
  sh.getRange(startRow,1,rows.length,numCols).setValues(rows);
}
function varianceFindCol_(h,n) { return priceBridgeFindCol_(h,n); }
function varianceTryFindCol_(h,n) { return priceBridgeTryFindCol_(h,n); }
function varianceFirstColOrMinus1_(h,n) { return priceBridgeFirstCol_(h,n); }
function varianceNormSku_(v) { return priceBridgeSku_(v); }
function varianceToNumber_(v) { return priceBridgeNumber_(v); }
function varianceIsTrue_(v) { return priceBridgeTrue_(v); }

function priceBridgeCheckInstalledConfiguration() {
  const props=PropertiesService.getScriptProperties();
  const report=STRIVEN_BRIDGE_REPORT_SYNC.REPORTS.find(r=>r.key==='ITEMS');
  const urls=sbrResolveReportUrls_(report);
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const result={scriptId:ScriptApp.getScriptId(),itemReportUrls:urls.length,strivenAuthConfigured:!!(props.getProperty('STRIVEN_ACCESS_TOKEN')||props.getProperty('striven_token')),shopifyAuthConfigured:!!(props.getProperty('SHOPIFY_ADMIN_ACCESS_TOKEN')||props.getProperty('Shopify_ID')),shopifyDomainConfigured:!!(props.getProperty('SHOPIFY_STORE_DOMAIN')||props.getProperty('SHOPIFY_SHOP_DOMAIN')),strivenSheetPresent:!!ss.getSheetByName('Striven_Items'),publicShopifySheetPresent:!!ss.getSheetByName('Shopify_products_public'),adminExportSheetPresent:!!ss.getSheetByName('Shopify_products'),sourceState:props.getProperty('PRICE_BRIDGE_SOURCE_STATE')||'NOT_REFRESHED'};
  Logger.log(JSON.stringify(result));return result;
}

/** Read API access and generated-sheet counts without mutating Shopify. */
function priceBridgeVerifyReadOnly() {
  priceBridgeRequireCompleteSource_();
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames=['Striven_Items','Shopify_products_public','Variance','Shopify_Price_Import'];
  const result={sourceState:PropertiesService.getScriptProperties().getProperty('PRICE_BRIDGE_SOURCE_STATE'),rows:{},checkedCandidates:0,shopifyVariantRead:'NOT_TESTED',shopifyMutations:0};
  sheetNames.forEach(n=>{const sh=ss.getSheetByName(n);result.rows[n]=sh?Math.max(0,sh.getLastRow()-1):0;});
  const variance=ss.getSheetByName('Variance');
  if(variance && variance.getLastRow()>1){const data=variance.getDataRange().getValues();const col=priceBridgeFindCol_(data[0],'Update Shopify?');result.checkedCandidates=data.slice(1).filter(r=>priceBridgeTrue_(r[col])).length;}
  const pub=ss.getSheetByName('Shopify_products_public');
  if(pub && pub.getLastRow()>1){
    if(typeof getValidShopifyAdminAccessToken_==='function')getValidShopifyAdminAccessToken_();
    const data=pub.getDataRange().getValues();const col=priceBridgeFindCol_(data[0],'VariantID');const row=data.slice(1).find(r=>r[col]);
    if(row){const live=priceBridgeReadVariant_(row[col]);if(!live || !live.id)throw new Error('Shopify read returned no variant.');result.shopifyVariantRead='OK';}
  }
  Logger.log(JSON.stringify(result));return result;
}
