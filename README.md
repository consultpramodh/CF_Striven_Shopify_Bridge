# Classic Fireplace — Striven / Shopify price bridge repair

Google Apps Script replacement files, based on the supplied `ScriptBundle.txt` on 2026-10-05. This branch is limited to the price bridge; it is not a standalone Apps Script project. Keep subsequent price-bridge revisions on `fix/price-bridge`.

## Installation

1. Pull and back up the actual live bound Apps Script project before changing it. Record its Script ID and current source hashes. This repair has not been deployed to that project.
2. Replace only these five existing files with the complete files under `replacements/`: `items.gs`, `variance.gs`, `shopify_price_import.gs`, `shopify_import.gs`, and `menu.gs`. Do not append them as new copies; duplicate global definitions are unsafe.
3. Keep all other files, OAuth handlers, existing credentials, sheets, and deployment identity. `shopify_import.gs` only changes its catalog import logger name and call sites so it no longer collides with the price logger. `menu.gs` retains the original menus and adds price selection and push actions.
4. Set the required Script Properties below. Never put secret values in this public repository.
5. Push to the same project, pull again, compare changed-file hashes, and restore the backup if the comparison fails. Reopen the spreadsheet to refresh menus.
6. Run one read-only price workflow and inspect its candidates before selecting prices to export or push. A live acceptance test and rollback check remain required.

## Script Properties

| Property | Purpose |
|---|---|
| `STRIVEN_REPORT_URL` | Required authorized `/v2/reports/` items report URL; the embedded private URL was removed. The response must have a `data` array and support `pageindex`. |
| Existing Striven authentication properties | Existing `getValidStrivenToken_()` is reused when available; otherwise `STRIVEN_ACCESS_TOKEN` is required. |
| `SHOPIFY_STORE_DOMAIN` or `SHOPIFY_SHOP_DOMAIN` | Permanent `*.myshopify.com` domain for direct updates. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` or legacy `Shopify_ID` | Admin API token. Existing OAuth expiry handling runs before acquiring the price-push lock. A legacy token must remain valid. |
| `PRICE_BRIDGE_SHOPIFY_API_VERSION` | Optional; default `2026-07`, the schema version validated for this repair. |
| `PRICE_BRIDGE_MAX_SOURCE_AGE_HOURS` | Optional positive number; default `24`. |

Direct updates require `read_products` and `write_products`. A permission or expired-token failure is recorded rather than treated as success. This patch does not install triggers or change app permissions.

## Workflow

- **PUBLIC workflow:** refresh/resume Striven items, fetch the existing public Shopify feed, build variance, resolve CSV identity against the existing Admin export, and build price output.
- **EXPORT workflow:** refresh/resume Striven items, build variance using the existing Admin export, and build price output. It does not refresh the manually supplied Admin export.
- A Striven refresh stages into `Striven_Items_Refresh`. Only a completed snapshot is published to `Striven_Items`. If the refresh pauses after its two-minute workflow budget, run the same workflow again to resume. Standalone `Pull Items (Resume)` retains its longer budget.
- A new refresh clears generated price output. The existing published items remain available during staging, but price calculations, CSV creation, and direct pushes reject incomplete, failed, or older-than-configured source snapshots.
- Newly generated candidates start unchecked. Select rows or use **Check All Price Candidates**, then **Build Price Import** or **Export Price Import CSV**. Both respect the checkboxes by default. The configuration keeps an explicit `REQUIRE_UPDATE_CHECKBOX` setting.
- **Push Checked Prices (Live)** updates at most 50 checked rows per run, subject to a four-minute budget. It rechecks each variant's live SKU, price, active status, and sale status; it reads back the result before recording UPDATED. An already-applied target is recovered without another mutation.
- Direct pushes need a Shopify Variant ID. The public feed provides it; a standard Admin export may not. Missing IDs fail visibly; no SKU-only mutation is attempted.

## Pricing rules retained

- Normalize SKU only for matching; preserve the Admin export's exact SKU capitalization in the CSV.
- Prefer numeric `MAPPricing` over `Price`. A numeric zero MAP remains the effective source value, but no nonpositive target is exported or pushed. It does not silently fall back to base price.
- Raise underpriced variants only when the difference exceeds $0.01.
- Exclude variants with compare-at price greater than selling price.
- Exclude explicitly inactive Admin export products. Public variant availability is not treated as publication status.
- Block duplicate Striven SKU sources and ambiguous Shopify CSV identities instead of choosing the first match.
- Reject blank, malformed, negative, or nonfinite price targets and target edits that differ from the source effective price.

## Files and verification

| File | Change |
|---|---|
| `items.gs` | Staged publication, durable page checkpoints, fresh headers, grid growth, response validation, valid-token reuse, removal of embedded report URL. |
| `variance.gs` | Source-completion gate, isolated price helpers, availability fix, duplicate source guard, correct gap sorting, missing EXPORT workflow, live update client and checks. |
| `shopify_price_import.gs` | Checkbox-controlled output, strict identity resolution, source timestamp checks, SKU spelling preservation, dedicated price log, export-button revalidation, omission of compare-at writes. |
| `shopify_import.gs` | Only catalog logger name/call-site isolation. Existing catalog workflow preserved. |
| `menu.gs` | Two additional price actions; existing menus preserved. |

Run local verification with:

```bash
node tests/price_bridge.test.cjs
python3 tests/check_sources.py
```

28 regression tests passed against mocked Apps Script services. Tests execute variance generation, export controls, duplicate identity handling, source pause/resume and error paths, and live-update safeguards with simulated responses. They make no network calls and no live writes. Syntax checks cover all five replacements and the complete supplied bundle with those replacements applied. Shopify validated the read query and update mutation against API version `2026-07`.

## Remaining limits

No live sheet data, Script Properties, Striven report payload, OAuth grant, or Shopify write has been tested. The existing public-feed domain and retrieval mechanism are retained. Admin-export CSV identities are only as current as that export; import previews must be reviewed before applying CSV files. The direct API route rechecks the live variant immediately before updating, but it cannot guarantee exclusion of edits made concurrently after that read.

A very large snapshot publication can still fail midway through a spreadsheet write. Source state remains ERROR/REFRESHING in that case and blocks price operations; rerun/resume the sync to republish. Spreadsheet edits and CSV imports outside this script are not controlled by its lock.

Shopify documentation checked:
- https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productVariantsBulkUpdate
- https://help.shopify.com/en/manual/products/import-export/import-products

The CSV intentionally omits compare-at pricing because included blank optional columns can overwrite existing values.
