# Invoice import delivery dates

FuelNerve Intelligence defaults “Stock has been received” to the reviewed invoice calendar date. The owner sees the proposed day, can change it, can optionally enter an actual unloading time in IST, or can save an invoice without receiving stock. Future or invalid dates/times are rejected. Changing delivery details clears the final confirmation.

`receivedDate` on a purchase receipt means that only the physical delivery day is known. In that case `receivedAt` and the linked inventory movement use the India-day start as an internal sorting/accounting boundary, never as evidence of an actual midnight delivery. Operations and Inventory show “day only” or “unloading time not recorded”; date-only receipts are not assigned to an arbitrary shift. The original `createdAt` remains the actual entry timestamp. Existing receipts retain their original timing; the additive nullable column does not rewrite production history.

Stock includes the confirmed quantities on their delivery day. Posted receipts cover the corresponding confirmed DSR daily total rather than adding that total twice. Quantity mismatches and ambiguous tank allocation stay flagged. A later physical tank measurement already covers earlier-day receipts; same-day date-only receipts cannot be placed before/after an exact measurement and require review. Intraday balances with unconfirmed unloading time are labelled for review rather than silently claiming precision.

Confirmation that stock has been received also provides an upper bound: it arrived by the entry time. This can establish that a same-day receipt preceded a later measurement or shift opening, without inventing its exact time.

A selected historical shift opening on the delivery day requires a real arrival time. A delivery day wholly contained within a shift can contribute as a daily total; a date-only delivery crossing a shift’s opening or closing boundary requires an actual time before closing. No closed shift, original dip or nozzle reading is rewritten. Entering an actual received time through Purchases uses the existing correction reason, audit trail and linked inventory timestamp correction, clears date-only precision, and enables exact shift attribution. Supplier payments and balances are not changed by receiving stock.

Creating or recovering a missing receipt remains transactional and idempotent. A duplicate supplier invoice cannot create a second receipt. Invoice-only saves do not change stock.
