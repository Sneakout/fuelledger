# Accounting model

Milestone 9 introduces a double-entry accounting foundation without making daily station work feel like bookkeeping. Every posting is organization-scoped, optionally station-scoped, balanced, and linked to one immutable operational source.

## Chart of accounts

The system-provisioned chart includes cash, UPI/card/other collection clearing, accounts receivable, inventory, input tax credit, goods in transit, accounts payable, product/service revenue, cost of goods sold, inventory variance, and operating expenses. It is organization-scoped and can be extended later without changing operational workflows.

## Journals and ledger

`Journal` is the posting header; `JournalLine` records a positive debit or credit against a chart account. A database uniqueness constraint on `(sourceType, sourceId)` prevents duplicate posting for the same operational event. The ledger and trial balance are calculated from journal lines rather than maintained as mutable balances.

## Automatic postings

- Sales debit the appropriate cash, clearing, or receivable account and credit product or service revenue. Inventory-tracked sales also debit COGS and credit inventory using the product’s configured purchase price.
- Customer receipts debit the collection account and credit accounts receivable.
- Purchase invoices debit inventory when received immediately, or goods in transit when not yet received; input tax is debited separately and accounts payable is credited.
- Supplier payments debit accounts payable and credit the selected payment/clearing account.
- Expenses debit operating expenses and credit the selected payment/clearing account.
- Direct inventory receipts and documented adjustments create matching inventory/payable or inventory-variance postings.

All entries balance before they are persisted in the same database transaction as their source event. The accounting screen exposes the chart, trial totals, and expandable source-linked journal entries.

## Customer subledger

Customer credit/fleet sales and receipts remain in their existing append-only customer ledger as the operational subledger; Milestone 9 additionally maps those same facts to accounts receivable. Outstanding and ageing continue to be calculated from source ledger activity.
