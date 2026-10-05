# Striven → Shopify price bridge

Price-bridge repairs for the existing bound Apps Script project `Shopify/Striven SYNC`, Script ID `1MyiyvDaje6zAQgZcnPXLoDiGZoxSbs9Uq6eZC5VUIwnjIDsULgOuCAXa`. Maintain revisions on `fix/price-bridge`.

## Current source

Use **`live_replacements/`**. The older `replacements/` directory and its 28-test suite were prepared from the uploaded bundle and remain historical reference; do not install those files over the current live layout.

Only four existing files change:

| File | Result |
|---|---|
| `02. Menu.gs` | Preserves the operator menus and adds Push Checked Prices (Live). |
| `40. Report_Refresh.gs` | Retains multi-URL report support; items use durable page checkpoints and staging, with validated terminal-page detection. Non-item report behavior is preserved. |
| `42_Price_Variance.gs` | Requires a complete fresh source, excludes ambiguous source SKUs, keeps public availability separate from publication status, and adds guarded live updates and read-only diagnostics. |
| `43_Shopify_Price_Import.gs` | Respects checked candidates, resolves CSV identity strictly, preserves SKU capitalization, and omits compare-at writes. |

The manifest, OAuth handlers, order modules, compatibility wrappers, and Shopify catalog import are unchanged. Existing public function names remain available. `runVarianceThenBuildShopifyPriceImport()` still uses the existing variance and selections. The public full workflow refreshes Striven items first.

## Pricing and selection rules

- Prefer numeric `MAPPricing` over `Price`. Zero MAP remains the effective value; nonpositive targets are skipped rather than silently replaced with the base price.
- Raise underpriced variants only when the gap exceeds $0.01. Never lower prices.
- Exclude sale variants whose compare-at price exceeds the current price.
- Block duplicate Striven SKUs, ambiguous CSV variant matches, invalid numbers, and edited targets that differ from the effective source price.
- Start generated candidates unchecked. CSV building/export and direct updates honor **Update Shopify?** selections.
- CSV output does not contain a compare-at column, so importing a price update cannot clear compare-at values.
- Direct updates re-read variant identity, current price, product status, and sale status. They submit a price-only mutation and read back the result before logging success. A retry recognizes an already-applied target.

## Operation

Reopen the bound spreadsheet to load the updated **Shopify-Striven Bridge → Price Bridge** menu.

1. Refresh Striven Items, then Sync Public Shopify Products.
2. Build Variance from Public Products and review candidates.
3. Check only intended candidates. Build Shopify Price Import, then Export Shopify Price CSV, or use Push Checked Prices (Live).

The full public workflow performs refresh, public sync, variance, identity enrichment, and checked import generation. If the Striven refresh pauses, run the same workflow again to resume. Item pages are staged in `Striven_Items_Refresh`; only a complete snapshot replaces `Striven_Items`. Incomplete, failed, or stale snapshots block calculations and price writes. The default source-age limit is 24 hours.

For live updates, the Shopify app needs `read_products` and `write_products`. Direct updates require a Shopify variant ID; a public feed supplies it, while a standard Admin CSV may not. No SKU-only mutations are attempted. Each push handles at most 50 checked rows within its time budget.

## Configuration and installation

Private report URLs and tokens belong in Script Properties and must not enter GitHub. Existing authentication helpers and properties are reused. Shopify accepts `SHOPIFY_STORE_DOMAIN` (or `SHOPIFY_SHOP_DOMAIN`) and `SHOPIFY_ADMIN_ACCESS_TOKEN` (or legacy `Shopify_ID`). The price API defaults to `2026-07`; `PRICE_BRIDGE_SHOPIFY_API_VERSION` can override it. `PRICE_BRIDGE_MAX_SOURCE_AGE_HOURS` can override source freshness.

Before first replacement, privately back up all live project files. Run a temporary helper calling the original `sbrEnsureReportUrlProperties_()` to preserve embedded report defaults in properties; never log the URLs. Replace only the four existing files listed above. Remove the temporary helper. Reload and read back all 23 files, checking replacement hashes and unchanged-file hashes. Restore from the private backup if those checks fail. Do not publish that backup.

The user approved the existing CF Operations Console Drive/Sheets permissions. Configuration setup completed, and the four-file patch is installed. Live acceptance completed: 19,284 Striven items across 20 pages; 2,202 public Shopify variants scanned; 854 SKU matches and 74 underpriced candidates. All candidates are unchecked, and checked-only output contains zero rows. Shopify variant API read succeeded. Final reload/readback verified all 23 files: four exact replacements and 19 unchanged files. Results are recorded in `source_manifest.json`.

The existing Admin export resolved none of the 74 candidate identities. Refresh `Shopify_products` from a current Shopify Admin export before using the CSV path; then rebuild public variance and run Workflow: Variance -> Import to enrich identities. The direct-update path uses public variant IDs and does not require the Admin export; it still rechecks live identity and price. No price updates were performed. No Shopify price mutation is part of the acceptance checks.

## Verification

```bash
node tests/live_price_bridge.test.cjs
```

40 isolated tests cover candidate rules, checked CSV behavior, API identity/concurrency/sale guards, mutation rejection and readback, durable multi-URL pause/resume, failure recovery, malformed responses, and Striven terminal-page handling. All 22 server files and the combined live project parse successfully.

The live Striven API exposes `totalRecords`, `pageSize`, `pageIndex`, and `nextPage`; its final data page has `nextPage: null`. Requesting beyond the final page returns a JSON string. The repair validates the final record count and stops on the final data page while retaining strict rejection of malformed row envelopes and premature terminal pages.

The read and price-only mutation operations in `tests/price_bridge.graphql` were schema-validated against Shopify Admin API `2026-07`. Local tests use mocks and do not make external writes. Live read-only verification does not prove production mutation permission; a selected price update must still pass the runtime safeguards.


## Selection correction — 2026-10-05

CSV enrichment preserves checkbox selections, public handles, and variant IDs when the Admin export cannot resolve a candidate. CSV diagnostics use a separate `CSV Error` column; `Error` remains the live-update diagnostic. Only the two exact legacy CSV messages are migrated out of `Error`; unrelated live failures remain intact. A known public handle must match the export handle; a same-SKU row for a different product cannot silently replace it.

The existing variance/import workflow preserves selections. The full refresh/build workflow deliberately creates a new candidate set, so review and select candidates after rebuilding. CSV identity validation stays strict and still requires matching Admin-export data. Direct pushes use variant IDs and are independent of CSV errors.

This revision updates only the two existing price modules. Reload/readback verified all 23 files (two changed, 21 unchanged relative to the preceding live version). The current-sheet repair migrated diagnostics for 74 candidates, preserved their variant IDs, and retained the existing zero selected rows. All 40 mock regression tests pass, including a selected direct push despite a separate CSV error; no live mutation was executed.
