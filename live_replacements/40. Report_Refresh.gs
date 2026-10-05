/************************************************************
 * FILE START: 40. Report_Refresh.gs
 ************************************************************/

/************************************************************
 * APPS SCRIPT: 40_Report_Refresh_Workflow.gs
 * PROJECT: Shopify → Striven Bridge
 *
 * Purpose:
 * One resumable Striven report refresh script for:
 * - Striven Items
 * - Striven Sales Order Details
 * - Striven Customers
 * - Striven Customer Locations
 *
 * Writes to Google Sheets only.
 * Does NOT create/update Striven data.
 *
 * IMPORTANT:
 * Replace the entire existing 40_Report_Refresh_Workflow.gs
 * file with this script. Do not append this under the old code.
 ************************************************************/


/************************************************************
 * APPS SCRIPT: Report Sync Config
 ************************************************************/

const STRIVEN_BRIDGE_REPORT_SYNC = {
  WRITE_CHUNK_ROWS: 2500,
  MAX_PAGES_PER_URL: 5000,
  TIME_BUDGET_MS: 5 * 60 * 1000,
  STOP_BUFFER_MS: 25 * 1000,

  // Do not stop after one empty page. Some Striven reports can
  // return an empty page/window before the true end.
  EMPTY_PAGE_STOP_AFTER: 5,

  // Striven may ignore this, but it is safe to send.
  PAGE_SIZE: 1000,

  ACTIVE_REPORT_INDEX_PROP: 'SBR_SYNC_ACTIVE_REPORT_INDEX',

  REPORTS: [
    {
      key: 'ITEMS',
      friendlyName: 'Items',
      sheetName: 'Striven_Items',
      propertyName: 'STRIVEN_REPORT_ITEMS_URL',
      urlListPropertyName: 'STRIVEN_REPORT_ITEMS_URLS_JSON',

      // Keeps compatibility with your old item-only script.
      legacyPropertyNames: ['STRIVEN_REPORT_URL'],

      defaultUrl: ''
    },
    /************************************************************
     * APPS SCRIPT: 40_Report_Refresh_Workflow.gs
     * SECTION: Sales Order Details Report Config
     *
     * Important:
     * - Do NOT use STRIVEN_REPORT_SALES_ORDERS_URL here.
     * - Sales Orders and Sales Order Details are separate reports.
     ************************************************************/

    {
      key: 'SALES_ORDER_DETAILS',
      friendlyName: 'Sales Order Details',
      sheetName: 'Striven Sales Order Details',

      // Dedicated Sales Order Details report URL.
      propertyName: 'STRIVEN_REPORT_SALES_ORDER_DETAILS_URL',

      // Optional multi-URL list for large filtered report chunks.
      urlListPropertyName: 'STRIVEN_REPORT_SALES_ORDER_DETAILS_URLS_JSON',

      legacyPropertyNames: [],

      defaultUrl: ''
    },
    {
      key: 'CUSTOMERS',
      friendlyName: 'Customers',
      sheetName: 'Striven_Customers',
      propertyName: 'STRIVEN_REPORT_CUSTOMERS_URL',
      urlListPropertyName: 'STRIVEN_REPORT_CUSTOMERS_URLS_JSON',
      legacyPropertyNames: [],
      defaultUrl: ''
    },
    {
      key: 'CUSTOMER_LOCATIONS',
      friendlyName: 'Customer Locations',
      sheetName: 'Striven Customer Locations',
      propertyName: 'STRIVEN_REPORT_CUSTOMER_LOCATIONS_URL',
      urlListPropertyName: 'STRIVEN_REPORT_CUSTOMER_LOCATIONS_URLS_JSON',
      legacyPropertyNames: [],
      defaultUrl: ''
    }
  ]
};


/************************************************************
 * APPS SCRIPT: Public Functions - All Reports
 ************************************************************/

function pullStrivenBridgeReports_All_RESUMABLE(reset) {
  return sbrWithLock_(function () {
    return sbrPullAllReports_(reset === true);
  });
}


function pullStrivenBridgeReports_All_RESET() {
  return pullStrivenBridgeReports_All_RESUMABLE(true);
}


function pullStrivenBridgeReports_All_Resume() {
  return pullStrivenBridgeReports_All_RESUMABLE(false);
}


/************************************************************
 * APPS SCRIPT: Public Functions - Single Reports
 ************************************************************/

function pullStrivenReport_Items_ToSheet_RESUMABLE(reset, timeBudgetMs) {
  return sbrWithLock_(function () {
    return sbrPullSingleReportByKey_('ITEMS', reset === true, timeBudgetMs);
  });
}


function pullStrivenReport_SalesOrderDetails_ToSheet_RESUMABLE(reset) {
  return sbrWithLock_(function () {
    return sbrPullSingleReportByKey_('SALES_ORDER_DETAILS', reset === true);
  });
}


function pullStrivenReport_Customers_ToSheet_RESUMABLE(reset) {
  return sbrWithLock_(function () {
    return sbrPullSingleReportByKey_('CUSTOMERS', reset === true);
  });
}


function pullStrivenReport_CustomerLocations_ToSheet_RESUMABLE(reset) {
  return sbrWithLock_(function () {
    return sbrPullSingleReportByKey_('CUSTOMER_LOCATIONS', reset === true);
  });
}


/************************************************************
 * APPS SCRIPT: Public Convenience Functions
 ************************************************************/

function pullStrivenReport_Items_RESET() {
  return pullStrivenReport_Items_ToSheet_RESUMABLE(true);
}


function pullStrivenReport_SalesOrderDetails_RESET() {
  return pullStrivenReport_SalesOrderDetails_ToSheet_RESUMABLE(true);
}


function pullStrivenReport_Customers_RESET() {
  return pullStrivenReport_Customers_ToSheet_RESUMABLE(true);
}


function pullStrivenReport_CustomerLocations_RESET() {
  return pullStrivenReport_CustomerLocations_ToSheet_RESUMABLE(true);
}


/**
 * Backward-compatible name from the earlier patch.
 */
function pullStrivenReport_SalesOrderDetails_MultiUrl_RESET() {
  return pullStrivenReport_SalesOrderDetails_ToSheet_RESUMABLE(true);
}


/************************************************************
 * APPS SCRIPT: All Reports Runner
 ************************************************************/

function sbrPullAllReports_(reset) {
  const props = PropertiesService.getScriptProperties();

  if (reset) {
    sbrClearAllResumeState_();
  }

  sbrEnsureReportUrlProperties_();

  let activeReportIndex = Number(
    props.getProperty(STRIVEN_BRIDGE_REPORT_SYNC.ACTIVE_REPORT_INDEX_PROP) || '0'
  );

  if (isNaN(activeReportIndex) || activeReportIndex < 0) {
    activeReportIndex = 0;
  }

  const reports = STRIVEN_BRIDGE_REPORT_SYNC.REPORTS;
  const summaries = [];

  for (let i = activeReportIndex; i < reports.length; i++) {
    const report = reports[i];

    props.setProperty(
      STRIVEN_BRIDGE_REPORT_SYNC.ACTIVE_REPORT_INDEX_PROP,
      String(i)
    );

    const result = sbrPullReport_(report, false);
    summaries.push(result);

    if (result.status === 'PAUSED') {
      const output = {
        status: 'PAUSED',
        activeReportIndex: i,
        activeReport: report.friendlyName,
        summaries: summaries
      };

      Logger.log(JSON.stringify(output, null, 2));
      return output;
    }
  }

  props.deleteProperty(STRIVEN_BRIDGE_REPORT_SYNC.ACTIVE_REPORT_INDEX_PROP);

  const output = {
    status: 'DONE',
    reportsProcessed: reports.length,
    summaries: summaries
  };

  Logger.log(JSON.stringify(output, null, 2));
  return output;
}


function sbrPullSingleReportByKey_(key, reset, timeBudgetMs) {
  sbrEnsureReportUrlProperties_();

  const report = STRIVEN_BRIDGE_REPORT_SYNC.REPORTS.find(function (item) {
    return item.key === key;
  });

  if (!report) {
    throw new Error('Unknown Striven report key: ' + key);
  }

  const result = sbrPullReport_(Object.assign({},report,{priceTimeBudgetMs:timeBudgetMs}), reset === true);

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


/************************************************************
 * APPS SCRIPT: Main Resumable Report Pull
 ************************************************************/

function sbrPullReport_(report, reset) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActive();
  const isItems=report.key==='ITEMS';
  const target=ss.getSheetByName(report.sheetName)||ss.insertSheet(report.sheetName);
  const stagingName=report.sheetName+'_Refresh';
  const sh=isItems ? (ss.getSheetByName(stagingName)||ss.insertSheet(stagingName)) : target;
  const checkpoint=sbrStateKeys_(report.key);
  if(isItems && (props.getProperty('PRICE_BRIDGE_ITEMS_STAGED')!=='YES'||!props.getProperty(checkpoint.pageIndex))) reset=true;
  if(isItems){props.setProperty('PRICE_BRIDGE_SOURCE_STATE','REFRESHING');props.setProperty('PRICE_BRIDGE_ITEMS_STAGED','YES');}
  try {
  const token = sbrGetStrivenAccessToken_();
  const urls = sbrResolveReportUrls_(report);
  const stateKeys = sbrStateKeys_(report.key);

  if (reset) {
    sbrClearReportResumeState_(report.key);
    sbrClearSheetCompletely_(sh);
  }

  let urlIndex = Number(props.getProperty(stateKeys.urlIndex) || '0');
  let pageIndex = Number(props.getProperty(stateKeys.pageIndex) || '0');
  let writeRow = Number(props.getProperty(stateKeys.writeRow) || '2');
  let totalRows = Number(props.getProperty(stateKeys.totalRows) || '0');
  let headers = sbrLoadHeaders_(stateKeys.headersJson);

  if (isNaN(urlIndex) || urlIndex < 0) urlIndex = 0;
  if (isNaN(pageIndex) || pageIndex < 0) pageIndex = 0;
  if (isNaN(writeRow) || writeRow < 2) writeRow = 2;
  if (isNaN(totalRows) || totalRows < 0) totalRows = 0;

  const start = Date.now();
  const parts = [];
  let buffer = [];
  let totalPagesReadThisRun = 0;
  let foundAnyDataThisRun = false;

  for (; urlIndex < urls.length; urlIndex++) {
    const reportUrl = urls[urlIndex];
    let consecutiveEmptyPages = 0;
    let rowsWrittenForThisUrl = 0;
    let pagesReadForThisUrl = 0;
    let lastNonEmptyPageIndex = -1;

    while (pageIndex < STRIVEN_BRIDGE_REPORT_SYNC.MAX_PAGES_PER_URL) {
      if (report.priceTimeBudgetMs ? Date.now()-start > report.priceTimeBudgetMs-STRIVEN_BRIDGE_REPORT_SYNC.STOP_BUFFER_MS : sbrShouldPause_(start)) {
        if (buffer.length) {
          sbrWriteChunk_(sh, writeRow, headers.length, buffer);
          writeRow += buffer.length;
          totalRows += buffer.length;
          rowsWrittenForThisUrl += buffer.length;
          buffer = [];
        }

        sbrSaveReportState_(stateKeys, {
          urlIndex: urlIndex,
          pageIndex: pageIndex,
          writeRow: writeRow,
          totalRows: totalRows,
          headers: headers
        });

        const pausedOutput = {
          status: 'PAUSED',
          report: report.friendlyName,
          sheetName: report.sheetName,
          urlIndex: urlIndex,
          urlCount: urls.length,
          pageIndex: pageIndex,
          writeRow: writeRow,
          totalRows: totalRows,
          totalPagesReadThisRun: totalPagesReadThisRun,
          note: 'Run the same function again to resume.'
        };

        Logger.log(JSON.stringify(pausedOutput, null, 2));
        return pausedOutput;
      }

      const pageResult = sbrFetchReportPage_(reportUrl, token, pageIndex, isItems);
      const rows = pageResult.rows || [];

      pagesReadForThisUrl++;
      totalPagesReadThisRun++;

      Logger.log(JSON.stringify({
        report: report.friendlyName,
        sheetName: report.sheetName,
        urlIndex: urlIndex,
        urlCount: urls.length,
        pageIndex: pageIndex,
        rowsReturned: rows.length,
        totalRowsWrittenSoFar: totalRows,
        responseKeys: pageResult.responseKeys
      }));

      if (!rows.length) {
        consecutiveEmptyPages++;

        if (consecutiveEmptyPages >= STRIVEN_BRIDGE_REPORT_SYNC.EMPTY_PAGE_STOP_AFTER) {
          break;
        }

        pageIndex++;
        continue;
      }

      foundAnyDataThisRun = true;
      consecutiveEmptyPages = 0;
      lastNonEmptyPageIndex = pageIndex;

      const headerUpdate = sbrMergeHeadersFromRows_(headers, rows);

      if (!headers || headerUpdate.changed) {
        if (buffer.length && headers && headers.length) {
          sbrWriteChunk_(sh, writeRow, headers.length, buffer);
          writeRow += buffer.length;
          totalRows += buffer.length;
          rowsWrittenForThisUrl += buffer.length;
          buffer = [];
        }

        headers = headerUpdate.headers;

        if (!headers.length) {
          throw new Error('Could not derive headers for ' + report.friendlyName + '.');
        }

        sbrWriteHeaderRow_(sh, headers);
        props.setProperty(stateKeys.headersJson, JSON.stringify(headers));
      }

      rows.forEach(function (item) {
        const row = headers.map(function (header) {
          return sbrToCellValue_(header, item ? item[header] : '');
        });

        buffer.push(row);

        if (buffer.length >= STRIVEN_BRIDGE_REPORT_SYNC.WRITE_CHUNK_ROWS) {
          sbrWriteChunk_(sh, writeRow, headers.length, buffer);
          writeRow += buffer.length;
          totalRows += buffer.length;
          rowsWrittenForThisUrl += buffer.length;
          buffer = [];
        }
      });

      if(isItems) {
        if(buffer.length){sbrWriteChunk_(sh,writeRow,headers.length,buffer);writeRow+=buffer.length;totalRows+=buffer.length;rowsWrittenForThisUrl+=buffer.length;buffer=[];}
        SpreadsheetApp.flush();
        sbrSaveReportState_(stateKeys,{urlIndex:urlIndex,pageIndex:pageIndex+1,writeRow:writeRow,totalRows:totalRows,headers:headers});
      }
      pageIndex++;
    }
    if(isItems && pageIndex>=STRIVEN_BRIDGE_REPORT_SYNC.MAX_PAGES_PER_URL) throw new Error('Item report reached page limit; snapshot not published.');

    parts.push({
      urlIndex: urlIndex,
      pagesRead: pagesReadForThisUrl,
      rowsWritten: rowsWrittenForThisUrl,
      lastNonEmptyPageIndex: lastNonEmptyPageIndex,
      stoppedAfterEmptyPages: consecutiveEmptyPages
    });

    if(isItems && buffer.length){sbrWriteChunk_(sh,writeRow,headers.length,buffer);writeRow+=buffer.length;totalRows+=buffer.length;buffer=[];SpreadsheetApp.flush();}

    // Move to next URL part.
    pageIndex = 0;

    sbrSaveReportState_(stateKeys, {
      urlIndex: urlIndex + 1,
      pageIndex: pageIndex,
      writeRow: writeRow,
      totalRows: totalRows,
      headers: headers
    });
  }

  if (buffer.length) {
    sbrWriteChunk_(sh, writeRow, headers.length, buffer);
    writeRow += buffer.length;
    totalRows += buffer.length;
    buffer = [];
  }

  if (!headers || !headers.length) {
    if(isItems) throw new Error('No item data returned; previous published snapshot preserved.');
    sh.clearContents();
    sh.getRange(1, 1).setValue('No data returned from report.');
    sh.setFrozenRows(0);

    sbrClearReportResumeState_(report.key);

    const emptyOutput = {
      status: 'DONE',
      report: report.friendlyName,
      sheetName: report.sheetName,
      urlCount: urls.length,
      rowsWritten: 0,
      totalPagesReadThisRun: totalPagesReadThisRun,
      note: foundAnyDataThisRun
        ? 'Data was found, but no headers were derived.'
        : 'No data returned from any configured report URL.'
    };

    Logger.log(JSON.stringify(emptyOutput, null, 2));
    return emptyOutput;
  }

  sbrFinalizeSheet_(sh, headers.length);
  if(isItems){
    if(!totalRows) throw new Error('Empty item snapshot; previous published snapshot preserved.');
    const snapshot=sh.getRange(1,1,totalRows+1,headers.length).getValues();
    target.clearContents();sbrWriteChunk_(target,1,headers.length,snapshot);sbrFinalizeSheet_(target,headers.length);SpreadsheetApp.flush();
    props.setProperty('PRICE_BRIDGE_SOURCE_COMPLETED_AT',new Date().toISOString());props.setProperty('PRICE_BRIDGE_SOURCE_STATE','COMPLETE');props.deleteProperty('PRICE_BRIDGE_ITEMS_STAGED');
  }
  sbrClearReportResumeState_(report.key);

  const output = {
    status: 'DONE',
    report: report.friendlyName,
    sheetName: report.sheetName,
    urlCount: urls.length,
    rowsWritten: totalRows,
    finalWriteRow: writeRow,
    totalPagesReadThisRun: totalPagesReadThisRun,
    parts: parts
  };

  Logger.log(JSON.stringify(output, null, 2));
  return output;
  } catch(err) {if(isItems) props.setProperty('PRICE_BRIDGE_SOURCE_STATE','ERROR');throw err;}
}


/************************************************************
 * APPS SCRIPT: Report URL Property Setup
 ************************************************************/

function sbrEnsureReportUrlProperties_() {
  const props = PropertiesService.getScriptProperties();
  const saved = [];

  STRIVEN_BRIDGE_REPORT_SYNC.REPORTS.forEach(function (report) {
    const existing = props.getProperty(report.propertyName);

    if (!existing && report.defaultUrl) {
      props.setProperty(report.propertyName, report.defaultUrl);
      saved.push(report.propertyName);
    }

    if (report.key === 'ITEMS') {
      const legacyUrl = props.getProperty('STRIVEN_REPORT_URL');
      const itemUrl = props.getProperty(report.propertyName);

      if (!legacyUrl && itemUrl) {
        props.setProperty('STRIVEN_REPORT_URL', itemUrl);
        saved.push('STRIVEN_REPORT_URL');
      }
    }
  });

  return {
    savedProperties: saved
  };
}


function sbrResolveReportUrls_(report) {
  const props = PropertiesService.getScriptProperties();

  if (report.urlListPropertyName) {
    const rawList = String(props.getProperty(report.urlListPropertyName) || '').trim();

    if (rawList) {
      let parsed;

      try {
        parsed = JSON.parse(rawList);
      } catch (err) {
        throw new Error(
          'Invalid JSON in Script Property ' +
          report.urlListPropertyName +
          ': ' +
          err.message
        );
      }

      if (!Array.isArray(parsed) || !parsed.length) {
        throw new Error(
          'Script Property ' +
          report.urlListPropertyName +
          ' must be a JSON array of report URLs.'
        );
      }

      return sbrUniqueStrings_(
        parsed
          .map(function (url) {
            return String(url || '').trim();
          })
          .filter(Boolean)
      );
    }
  }

  return [sbrResolveSingleReportUrl_(report)];
}


function sbrResolveSingleReportUrl_(report) {
  const props = PropertiesService.getScriptProperties();
  const candidates = [report.propertyName].concat(report.legacyPropertyNames || []);

  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i];
    const value = String(props.getProperty(key) || '').trim();

    if (value) {
      if (key !== report.propertyName) {
        props.setProperty(report.propertyName, value);
      }

      return value;
    }
  }

  if (report.defaultUrl) {
    props.setProperty(report.propertyName, report.defaultUrl);
    return report.defaultUrl;
  }

  throw new Error(
    'Missing Striven report URL for ' +
    report.friendlyName +
    '. Expected Script Property: ' +
    report.propertyName
  );
}


/************************************************************
 * APPS SCRIPT: Fetch Helpers
 ************************************************************/

function sbrFetchReportPage_(reportUrl, token, pageIndex, strictRows) {
  const url = sbrBuildPagedReportUrl_(reportUrl, pageIndex);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code > 299) {
    throw new Error(
      'Striven report request failed. HTTP ' +
      code +
      ', pageindex=' +
      pageIndex +
      ': ' +
      String(body || '').slice(0, 1000)
    );
  }

  const json = sbrParseJson_(body, pageIndex);
  if(strictRows && !Array.isArray(json)) {
    const candidates=[json&&json.data,json&&json.Data,json&&json.items,json&&json.Items,json&&json.results,json&&json.Results,json&&json.rows,json&&json.Rows,json&&json.data&&json.data.items,json&&json.data&&json.data.Items,json&&json.data&&json.data.rows,json&&json.data&&json.data.Rows,json&&json.Data&&json.Data.items,json&&json.Data&&json.Data.Items,json&&json.Data&&json.Data.rows,json&&json.Data&&json.Data.Rows,json&&json.result&&json.result.items,json&&json.result&&json.result.rows,json&&json.Report&&json.Report.Rows,json&&json.Report&&json.Report.Items];
    if(!candidates.some(Array.isArray)) throw new Error('Item report response missing a recognized row array; snapshot not published.');
  }
  const rows = sbrExtractRows_(json);

  return {
    pageIndex: pageIndex,
    rows: rows,
    rowCount: rows.length,
    responseKeys: json && typeof json === 'object' && !Array.isArray(json)
      ? Object.keys(json)
      : []
  };
}


function sbrBuildPagedReportUrl_(reportUrl, pageIndex) {
  let cleanUrl = String(reportUrl || '').trim();

  if (!cleanUrl) {
    throw new Error('Report URL is blank.');
  }

  cleanUrl = sbrRemoveQueryParam_(cleanUrl, 'pageindex');
  cleanUrl = sbrRemoveQueryParam_(cleanUrl, 'pagesize');

  const separator = cleanUrl.indexOf('?') === -1 ? '?' : '&';

  return cleanUrl +
    separator +
    'pageindex=' +
    encodeURIComponent(pageIndex) +
    '&pagesize=' +
    encodeURIComponent(STRIVEN_BRIDGE_REPORT_SYNC.PAGE_SIZE);
}


function sbrRemoveQueryParam_(url, paramName) {
  const pattern = new RegExp('([?&])' + paramName + '=[^&]*', 'ig');
  let output = String(url || '').replace(pattern, function (match, prefix) {
    return prefix === '?' ? '?' : '';
  });

  output = output.replace(/[?&]$/, '');
  output = output.replace('?&', '?');

  return output;
}


function sbrParseJson_(text, pageIndex) {
  try {
    return JSON.parse(text || '{}');
  } catch (err) {
    throw new Error(
      'Invalid JSON from Striven report pageindex=' +
      pageIndex +
      ': ' +
      String(text || '').slice(0, 1000)
    );
  }
}


function sbrExtractRows_(json) {
  if (!json) return [];

  if (Array.isArray(json)) return json;

  const directCandidates = [
    json.data,
    json.Data,
    json.items,
    json.Items,
    json.results,
    json.Results,
    json.rows,
    json.Rows
  ];

  for (let i = 0; i < directCandidates.length; i++) {
    if (Array.isArray(directCandidates[i])) {
      return directCandidates[i];
    }
  }

  const nestedCandidates = [
    json.data && json.data.items,
    json.data && json.data.Items,
    json.data && json.data.rows,
    json.data && json.data.Rows,
    json.Data && json.Data.items,
    json.Data && json.Data.Items,
    json.Data && json.Data.rows,
    json.Data && json.Data.Rows,
    json.result && json.result.items,
    json.result && json.result.rows,
    json.Report && json.Report.Rows,
    json.Report && json.Report.Items
  ];

  for (let j = 0; j < nestedCandidates.length; j++) {
    if (Array.isArray(nestedCandidates[j])) {
      return nestedCandidates[j];
    }
  }

  return sbrFindFirstArrayOfObjects_(json);
}


function sbrFindFirstArrayOfObjects_(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const keys = Object.keys(value);

  for (let i = 0; i < keys.length; i++) {
    const current = value[keys[i]];

    if (
      Array.isArray(current) &&
      current.length &&
      typeof current[0] === 'object' &&
      current[0] !== null
    ) {
      return current;
    }
  }

  for (let j = 0; j < keys.length; j++) {
    const nested = value[keys[j]];

    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = sbrFindFirstArrayOfObjects_(nested);

      if (found.length) {
        return found;
      }
    }
  }

  return [];
}


/************************************************************
 * APPS SCRIPT: Header Helpers
 ************************************************************/

function sbrMergeHeadersFromRows_(existingHeaders, rows) {
  const output = Array.isArray(existingHeaders) ? existingHeaders.slice() : [];
  const seen = {};

  output.forEach(function (header) {
    seen[String(header)] = true;
  });

  let changed = false;

  (rows || []).forEach(function (row) {
    Object.keys(row || {}).forEach(function (key) {
      const cleanKey = String(key || '').trim();

      if (!cleanKey) return;

      if (!seen[cleanKey]) {
        seen[cleanKey] = true;
        output.push(cleanKey);
        changed = true;
      }
    });
  });

  return {
    headers: output,
    changed: changed || !existingHeaders
  };
}


function sbrWriteHeaderRow_(sh, headers) {
  if (!headers || !headers.length) return;

  sbrWriteChunk_(sh,1,headers.length,[headers]);

  sh
    .getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setWrap(true);

  sh.setFrozenRows(1);
}


/************************************************************
 * APPS SCRIPT: Sheet Write Helpers
 ************************************************************/

function sbrWriteChunk_(sh, startRow, numCols, rows) {
  if (!rows || !rows.length) return;
  const lastRow=startRow+rows.length-1;
  if(lastRow>sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(),lastRow-sh.getMaxRows());
  if(numCols>sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(),numCols-sh.getMaxColumns());

  sh
    .getRange(startRow, 1, rows.length, numCols)
    .setValues(rows);
}


function sbrClearSheetCompletely_(sh) {
  const existingFilter = sh.getFilter();

  if (existingFilter) {
    try {
      existingFilter.remove();
    } catch (err) {
      Logger.log('Could not remove filter before clearing sheet "' + sh.getName() + '": ' + err.message);
    }
  }

  sh.clearContents();
  sh.clearFormats();
}


function sbrFinalizeSheet_(sh, numCols) {
  try {
    const lastRow = Math.max(sh.getLastRow(), 1);
    const width = Math.max(numCols || sh.getLastColumn() || 1, 1);

    const existingFilter = sh.getFilter();

    if (existingFilter) {
      existingFilter.remove();
    }

    sh.getRange(1, 1, lastRow, width).createFilter();
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, width);
  } catch (err) {
    Logger.log('Sheet final formatting skipped for "' + sh.getName() + '": ' + err.message);
  }
}


/************************************************************
 * APPS SCRIPT: Resume State Helpers
 ************************************************************/

function sbrStateKeys_(reportKey) {
  const safeKey = String(reportKey || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');

  return {
    urlIndex: 'SBR_SYNC_' + safeKey + '_URLINDEX',
    pageIndex: 'SBR_SYNC_' + safeKey + '_PAGEINDEX',
    writeRow: 'SBR_SYNC_' + safeKey + '_WRITEROW',
    totalRows: 'SBR_SYNC_' + safeKey + '_TOTALROWS',
    headersJson: 'SBR_SYNC_' + safeKey + '_HEADERS_JSON'
  };
}


function sbrSaveReportState_(stateKeys, state) {
  const props = PropertiesService.getScriptProperties();

  props.setProperty(stateKeys.urlIndex, String(state.urlIndex || 0));
  props.setProperty(stateKeys.pageIndex, String(state.pageIndex || 0));
  props.setProperty(stateKeys.writeRow, String(state.writeRow || 2));
  props.setProperty(stateKeys.totalRows, String(state.totalRows || 0));

  if (state.headers && state.headers.length) {
    props.setProperty(stateKeys.headersJson, JSON.stringify(state.headers));
  }
}


function sbrLoadHeaders_(propertyName) {
  const raw = String(
    PropertiesService.getScriptProperties().getProperty(propertyName) || ''
  ).trim();

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed) && parsed.length) {
      return parsed;
    }

    return null;
  } catch (err) {
    return null;
  }
}


function sbrClearReportResumeState_(reportKey) {
  const props = PropertiesService.getScriptProperties();
  const keys = sbrStateKeys_(reportKey);

  props.deleteProperty(keys.urlIndex);
  props.deleteProperty(keys.pageIndex);
  props.deleteProperty(keys.writeRow);
  props.deleteProperty(keys.totalRows);
  props.deleteProperty(keys.headersJson);
}


function sbrClearAllResumeState_() {
  const props = PropertiesService.getScriptProperties();

  STRIVEN_BRIDGE_REPORT_SYNC.REPORTS.forEach(function (report) {
    sbrClearReportResumeState_(report.key);
  });

  props.deleteProperty(STRIVEN_BRIDGE_REPORT_SYNC.ACTIVE_REPORT_INDEX_PROP);
}


/************************************************************
 * APPS SCRIPT: Value Normalization
 ************************************************************/

function sbrNeedsText_(headerName) {
  return /(^ItemNumber$|item\s*number|sku|upc|barcode|postal|zip|phone|order\s*number|sales\s*order\s*#|customer\s*po|customer\s*number|location\s*id|customer\s*id|contact\s*id|item\s*id)/i
    .test(String(headerName || ''));
}


function sbrToCellValue_(headerName, value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }

  if (sbrNeedsText_(headerName)) {
    return "'" + String(value);
  }

  return value;
}


/************************************************************
 * APPS SCRIPT: Token + Lock Helpers
 ************************************************************/

function sbrGetStrivenAccessToken_() {
  const props = PropertiesService.getScriptProperties();

  const configuredPropName =
    typeof SHOPIFY_STRIVEN_PROPS !== 'undefined' &&
    SHOPIFY_STRIVEN_PROPS &&
    SHOPIFY_STRIVEN_PROPS.STRIVEN_ACCESS_TOKEN
      ? SHOPIFY_STRIVEN_PROPS.STRIVEN_ACCESS_TOKEN
      : 'STRIVEN_ACCESS_TOKEN';

  const token =
    props.getProperty(configuredPropName) ||
    props.getProperty('STRIVEN_ACCESS_TOKEN') ||
    props.getProperty('striven_token');

  if (!token) {
    throw new Error('Missing Script Property STRIVEN_ACCESS_TOKEN.');
  }

  return token;
}


function sbrWithLock_(callback) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30 * 1000)) {
    throw new Error('Could not acquire lock. Another Striven report sync may be running.');
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}


function sbrShouldPause_(startTime) {
  return (
    Date.now() - startTime >
    STRIVEN_BRIDGE_REPORT_SYNC.TIME_BUDGET_MS -
    STRIVEN_BRIDGE_REPORT_SYNC.STOP_BUFFER_MS
  );
}


/************************************************************
 * APPS SCRIPT: General Helpers
 ************************************************************/

function sbrUniqueStrings_(values) {
  const seen = {};
  const output = [];

  (values || []).forEach(function (value) {
    const clean = String(value || '').trim();

    if (!clean) return;

    if (!seen[clean]) {
      seen[clean] = true;
      output.push(clean);
    }
  });

  return output;
}



/************************************************************
 * APPS SCRIPT: 40_Report_Refresh_Workflow.gs
 * FUNCTION: diagnoseStrivenSalesOrderDetailsReportAccess
 *
 * Purpose:
 * Tests Sales Order Details report URLs only.
 *
 * Important:
 * Does NOT test STRIVEN_REPORT_SALES_ORDERS_URL.
 ************************************************************/

function diagnoseStrivenSalesOrderDetailsReportAccess() {
  const props = PropertiesService.getScriptProperties();

  const singleUrl = String(
    props.getProperty('STRIVEN_REPORT_SALES_ORDER_DETAILS_URL') || ''
  ).trim();

  const urlListRaw = String(
    props.getProperty('STRIVEN_REPORT_SALES_ORDER_DETAILS_URLS_JSON') || ''
  ).trim();

  const urls = [];

  if (urlListRaw) {
    let parsed;

    try {
      parsed = JSON.parse(urlListRaw);
    } catch (err) {
      throw new Error(
        'STRIVEN_REPORT_SALES_ORDER_DETAILS_URLS_JSON is not valid JSON: ' +
        err.message
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        'STRIVEN_REPORT_SALES_ORDER_DETAILS_URLS_JSON must be a JSON array.'
      );
    }

    parsed.forEach(function(url) {
      const clean = String(url || '').trim();
      if (clean) urls.push(clean);
    });
  }

  if (singleUrl) {
    urls.push(singleUrl);
  }

  if (!urls.length) {
    throw new Error(
      'No Sales Order Details report URL found. Set STRIVEN_REPORT_SALES_ORDER_DETAILS_URL first.'
    );
  }

  const results = urls.map(function(url, index) {
    const testUrl =
      url +
      (url.indexOf('?') === -1 ? '?' : '&') +
      'pageindex=0&pagesize=10';

    const response = UrlFetchApp.fetch(testUrl, {
      method: 'get',
      muteHttpExceptions: true
    });

    return {
      index: index + 1,
      propertyUsed: urlListRaw
        ? 'STRIVEN_REPORT_SALES_ORDER_DETAILS_URLS_JSON'
        : 'STRIVEN_REPORT_SALES_ORDER_DETAILS_URL',
      baseUrlPreview: url.slice(0, 140),
      statusCode: response.getResponseCode(),
      responsePreview: response.getContentText().slice(0, 1000)
    };
  });

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

/************************************************************
 * FILE END: 40. Report_Refresh.gs
 ************************************************************/
