/************************************************************
 * APPS SCRIPT: 02_Menu.gs
 * PROJECT: Shopify-Striven Bridge
 *
 * Purpose:
 * One operator menu for the full bridge:
 * - Order Bridge: Shopify -> Striven
 * - Price Bridge: Striven -> Shopify
 * - Admin / Diagnostics
 *
 * Rule:
 * This project must have only ONE global onOpen() function.
 ************************************************************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const orderBridgeMenu = ui.createMenu('Order Bridge')
    .addItem('Import Recent Shopify Orders + Check', 'runOrderBridge_ImportAndCheck')
    .addItem('Import Only', 'importRecentShopifyOrdersToStrivenQueue')
    .addItem('Import Latest Order Only', 'importLatestShopifyOrderToStrivenQueue')
    .addSeparator()
    .addItem('Run Order Checkpoints', 'runShopifyStrivenCheckpointsForQueuedOrders')
    .addItem('Run Checkpoints - Selected Row', 'runShopifyStrivenCheckpointsForActiveRow')
    .addSeparator()
    .addItem('Dry Run Approved Orders', 'dryRunReadyShopifyOrdersToStriven')
    .addItem('Dry Run Selected Order', 'dryRunSelectedShopifyOrderToStriven')
    .addSeparator()
    .addItem('Push Approved Orders', 'pushReadyShopifyOrdersToStriven')
    .addItem('Push Selected Approved Order', 'pushSelectedShopifyOrderToStriven');

  const priceBridgeMenu = ui.createMenu('Price Bridge')
    .addItem('Refresh Striven Items', 'pullStrivenReport_Items_ToSheet_RESUMABLE')
    .addItem('Sync Public Shopify Products', 'syncShopifyPublicProductsToSheet')
    .addSeparator()
    .addItem('Build Variance from Public Products', 'buildVarianceSheet_FromPublic')
    .addItem('Build Variance from Shopify Export', 'buildVarianceSheet_FromExport')
    .addItem('Check All Update Shopify?', 'variance_checkAllUpdateShopify')
    .addSeparator()
    .addItem('Build Shopify Price Import', 'buildShopifyPriceImportSheet')
    .addItem('Export Shopify Price CSV', 'exportShopifyPriceImportCsv')
    .addItem('Push Checked Prices (Live)', 'pushVariancePrices_ToShopify')
    .addSeparator()
    .addItem('Full Price Workflow: Public Sync -> Variance -> Import', 'runPublicVarianceThenBuildShopifyPriceImport')
    .addItem('Workflow: Variance -> Import', 'runVarianceThenBuildShopifyPriceImport');

  const diagnosticsMenu = ui.createMenu('Admin / Diagnostics')
    .addItem('Setup / Repair Bridge Sheets', 'setupShopifyStrivenBridgeSheets')
    .addItem('Health Check', 'runOrderBridge_HealthCheck')
    .addSeparator()
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
    .addSeparator()
    .addItem('Code Audit', 'auditShopifyStrivenBridgeCodebase');

  ui.createMenu('🟣 Shopify-Striven Bridge')
    .addSubMenu(orderBridgeMenu)
    .addSubMenu(priceBridgeMenu)
    .addSubMenu(diagnosticsMenu)
    .addToUi();
}
