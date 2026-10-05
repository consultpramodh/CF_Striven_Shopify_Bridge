
/************************************************************
 * APPS SCRIPT: 02_Menu.gs
 * PROJECT: Existing Striven / Shopify / Shopify → Striven Bridge
 *
 * Purpose:
 * Single source of truth for spreadsheet menus.
 *
 * Rule:
 * This project should have only ONE global onOpen() function.
 ************************************************************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  /************************************************************
   * STRIVEN MENU
   ************************************************************/
  ui.createMenu('🔵 Striven')
    .addItem('Pull Items (Resume)', 'pullStrivenReport_Items_ToSheet_RESUMABLE')
    .addSeparator()
    .addItem('Refresh Token', 'refreshStrivenToken')
    .addToUi();


  /************************************************************
   * SHOPIFY PRICE / PRODUCT MENU
   ************************************************************/
  ui.createMenu('🟢 Shopify')
    // Live-ish public pull, no admin access
    .addItem('Sync PUBLIC Shopify Products → Sheet', 'syncShopifyPublicProductsToSheet')
    .addSeparator()

    // Workflows
    .addItem('Workflow: PUBLIC (Sync → Variance → Import)', 'runPublicVarianceThenBuildShopifyPriceImport')
    .addItem('Workflow: EXPORT (Variance → Import)', 'runVarianceThenBuildShopifyPriceImport')
    .addSeparator()

    // Variance builders
    .addItem('Build Variance: from PUBLIC sheet', 'buildVarianceSheet_FromPublic')
    .addItem('Build Variance: from EXPORT paste', 'buildVarianceSheet_FromExport')
    .addSeparator()

    // Import tools
    .addItem('Build Price Import (from Variance)', 'buildShopifyPriceImportSheet')
    .addItem('Export Price Import CSV', 'exportShopifyPriceImportCsv')
    .addSeparator()
    .addItem('Check All Price Candidates', 'variance_checkAllUpdateShopify')
    .addItem('Push Checked Prices (Live)', 'pushVariancePrices_ToShopify')
    .addToUi();


  /************************************************************
   * SHOPIFY → STRIVEN BRIDGE MENU
   ************************************************************/
  ui.createMenu('🟣 Shopify → Striven')
    .addItem('1. Setup Bridge Sheets', 'setupShopifyStrivenBridgeSheets')
    .addSeparator()

    // Import
    .addItem('2. Import Latest Shopify Order', 'importLatestShopifyOrderToStrivenQueue')
    .addItem('3. Import Recent Shopify Orders', 'importRecentShopifyOrdersToStrivenQueue')
    .addSeparator()

    // Checkpoints
    .addItem('4. Run Checkpoints - Queued Orders', 'runShopifyStrivenCheckpointsForQueuedOrders')
    .addItem('Run Checkpoints - Selected Row', 'runShopifyStrivenCheckpointsForActiveRow')
    .addSeparator()

    // Push
    .addItem('5. Push Approved Rows to Striven', 'pushReadyShopifyOrdersToStriven')
    .addItem('Push Selected Approved Row', 'pushSelectedShopifyOrderToStriven')
    .addSeparator()

    // Diagnostics
    .addSubMenu(
      ui.createMenu('Diagnostics')
        .addItem('Audit Bridge Config', 'DIAG_AuditConfig')
        .addItem('Test Sheet Setup', 'DIAG_TestSheetSetup')
        .addItem('Test Shopify Token', 'DIAG_TestShopifyToken')
        .addItem('Test Striven Token', 'DIAG_TestStrivenToken')
        .addItem('Test Backend Report Lookups', 'DIAG_TestBackendReportLookups')
        .addSeparator()
        .addItem('Diagnose Shopify Import Access', 'DIAG_DiagnoseShopifyImportAccess')
        .addItem('Fetch Recent Shopify Orders Only', 'DIAG_FetchRecentShopifyOrdersOnly')
        .addSeparator()
        .addItem('Debug Active Queue Row', 'DIAG_DebugActiveQueueRow')
        .addItem('Debug Active Row Contact Search', 'DIAG_DebugActiveRowContactSearch')
        .addItem('Debug Active Row Customer Search', 'DIAG_DebugActiveRowCustomerSearch')
        .addItem('Debug Active Row Duplicate SO Search', 'DIAG_DebugActiveRowSalesOrderSearch')
        .addSeparator()
        .addItem('Dry Run Selected Push', 'DIAG_DryRunSelectedPush')
        .addItem('Dry Run Ready Push Batch', 'DIAG_DryRunReadyPushBatch')
    )
    .addToUi();
}
