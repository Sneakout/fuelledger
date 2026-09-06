# Accounting mismatch diagnosis and repair proposal
Date: 6 September 2026. Status: proposal only; no database writes performed.

## Scope and method

Configured database, organization `org_demo_fuelledger`, station `cmtid701o0001r0di000asjt6`. Findings concern this demo organization, not a verified production environment. Queries ran in read-only repeatable-read transactions. Separate query snapshots agreed on the affected amounts; recheck before any repair. Existing-record schema is older than the working tree: customer_ledger lacks shift_credit_allocation_id, and applied migrations stop at 20260904093000_effective_dated_selling_prices. No migration was applied.

## Complete receivables bridge

- Accounting Accounts Receivable (1100): ₹8,30,828.75.
- Customer register: ₹1,590.00.
- Difference: ₹8,29,238.75.
- Eleven DEMO_SALE postings without customer-ledger entries: ₹8,28,288.75.
- One named but unlinked fleet sale: ₹450.00.
- Customer repayment present in register but absent from accounting: ₹500.00.
- Exact bridge: 8,28,288.75 + 450 + 500 = 8,29,238.75. No unexplained remainder in this account comparison.

### Sales missing customer entries

| Date (UTC) | Sale/source ID | Method | Amount (₹) | Customer evidence |
|---|---|---|---:|---|
| 2026-08-26 | demo-real-sale-6-2 | CREDIT | 79,430.00 | No customer assigned |
| 2026-08-26 | demo-real-sale-6-3 | FLEET | 38,025.00 | No customer assigned |
| 2026-08-27 | demo-real-sale-5-3 | CREDIT | 41,793.75 | No customer assigned |
| 2026-08-28 | demo-real-sale-4-0 | FLEET | 88,995.00 | No customer assigned |
| 2026-08-29 | demo-real-sale-3-0 | CREDIT | 1,05,060.00 | No customer assigned |
| 2026-08-29 | demo-real-sale-3-1 | FLEET | 96,820.00 | No customer assigned |
| 2026-08-30 | demo-real-sale-2-1 | CREDIT | 90,945.00 | No customer assigned |
| 2026-08-30 | demo-real-sale-2-2 | FLEET | 90,945.00 | No customer assigned |
| 2026-08-31 | demo-real-sale-1-2 | CREDIT | 1,02,225.00 | No customer assigned |
| 2026-08-31 | demo-real-sale-1-3 | FLEET | 48,937.50 | No customer assigned |
| 2026-09-01 | demo-real-sale-0-3 | CREDIT | 45,112.50 | No customer assigned |
| 2026-09-01 | cmtif2yts000fr0dx9wcuyla4 | FLEET | 450.00 | Orion Fleet Services |

Every row has an existing debit to account 1100 for the same amount. Do not post sales revenue again. The eleven demo rows explicitly say “Demo metered sale”; the final ₹450 sale is a Car Wash sale with the typed name Orion Fleet Services but no customer_id. The only customer account currently returned in this organization is Acme Mobility. Do not assign Orion's sale or demo sales to Acme merely to balance the register.

### Matched entries — leave unchanged

- Engine Oil sale `cmtih66ze000hr0gitukcfvp7`: ₹620, matching sale journal and Acme customer ledger.
- Car Wash sale `cmtih6hxe000nr0gi7nqdh302`: ₹450, matching sale journal and Acme customer ledger.
- Petrol sale `cmtih6tv0000rr0gifubcyjxn`: ₹1,020, matching sale journal and Acme customer ledger.
- These total ₹2,090. The ₹500 receipt brings the Acme register to ₹1,590.

### Missing receipt journal

Receipt `cmtih6v1i000xr0gi4j6cxqaz`, 1 September 2026, ₹500 via UPI, customer `cmtih53dz0001r0gignaome0e`. Customer ledger `cmtih6v1n000zr0gio93t7kpb` already records −₹500. No journal was found for the receipt source.

Proposed action after validation: add the missing source-linked CUSTOMER_RECEIPT journal using the original receipt date: debit UPI Clearing ₹500, credit Accounts Receivable ₹500. Do not create another receipt or customer-ledger entry.

## Complete payables bridge

Invoice `cmtihtmj90003r0hk65iwtjal` / KLS-INV-001: ₹3,990, PART_PAID.
Payment `cmtihu1zb0001r0j5avplcdey`: ₹1,000 via UPI on 1 September 2026.
Register due = ₹3,990 − ₹1,000 = ₹2,990; accounting Accounts Payable = ₹0.

Neither source has a journal. No journal was found for its linked goods receipt `cmtihtmjh0007r0hkojyjr6vu` either, or in the additional receipt/payment-description check.

Received stock already exists: 10 Engine Oil units at ₹390, ledger movement `cmtihtmjj000br0hk4v8g999r`. Do not receive the stock again.

Proposed actions:
1. Verify the supplier document: subtotal ₹3,900, invoice-level tax ₹90, total ₹3,990. The line tax rate is zero, so the ₹90 classification is unresolved; do not automatically label it recoverable tax.
2. Once verified, add the missing PURCHASE_INVOICE journal: credit Accounts Payable ₹3,990, debit Inventory ₹3,900 and the confirmed account for the remaining ₹90.
3. Add the missing SUPPLIER_PAYMENT journal: debit Accounts Payable ₹1,000, credit UPI Clearing ₹1,000.
4. Preserve invoice quantity, receipt, payment amount/date and PART_PAID status.

## Why this happened

Confirmed seed-code defects:
- `prisma/demo-seed.ts:254` creates demo CREDIT/FLEET sales without customer links.
- `prisma/demo-seed.ts:288` posts those sales to accounting, including Accounts Receivable, without corresponding customer entries.
- `prisma/demo-seed.ts:445` backfills sale journals and later expense journals, but does not backfill the receipt/invoice/payment sources above.

The data is consistent with a partial historical accounting backfill. The precise execution sequence of older application versions is not provable from these records alone.

## Recommended repair order and safeguards

1. Preserve a verified backup and rehearse on a clone. Snapshot the exact IDs/amounts, and reject repair if any precondition changes.
2. Fix demo generation/backfill consistency before rerunning any seed. Do not run the current seed as a repair.
3. Add the missing ₹500 receipt journal; its register counterpart already exists.
4. Resolve the ₹90 invoice amount classification, then add the two missing supplier journals.
5. Resolve customer ownership for the twelve orphan credit/fleet sales. For the eleven confirmed synthetic demo rows, prefer explicitly labelled demo customer accounts, with one source-linked customer entry per sale. For Orion, confirm whether it was unpaid and the correct customer identity first. If already paid, propose the appropriate documented reclassification instead of inventing debt.
6. Use unique source identifiers and skip verified existing postings. Run atomically where appropriate and retain a repair batch audit trail. Never add a generic balancing entry.
7. Repeat account totals and transaction-level checks. Verify stock quantities, sale revenue and actual payment records were not changed by the journal repairs.

Conditional target if all twelve sales are confirmed unpaid and assigned:
- AR accounting and customer register both ₹8,30,328.75 (accounting less missing ₹500 receipt; register plus ₹8,28,738.75 missing sales).
- AP accounting and supplier register both ₹2,990.
- These targets are not approval to manufacture customer balances; attribution and payment status must be confirmed first.

Remaining release concerns: moving-average costing/opening-stock valuation, the ₹90 classification, older schema and wider release checks. This diagnosis explains these two account gaps; it does not certify all accounting or inventory.
