# FuelNerve privacy policy — review before publication

Draft: `privacy-policy-draft.md`
Prepared: 19 November 2026

## Owner confirmations needed

1. Confirm the actual operator's name. FuelNerve is a product name; do not name a registered company that does not exist.
2. Provide a monitored public email for privacy and deletion requests and the operator's contact address. The draft intentionally does not publish the account's personal email or invent a contact address.
3. Confirm the retention and account-closure process you can actually support, including handling customer requests, attachments, audit records, backups and local browser copies. No fixed retention period is promised in this draft.
4. Confirm the active hosting/database regions and provider arrangements before making any country-specific storage statement.
5. Review whether additional jurisdiction-specific notices or arrangements are required for the launch audience. This draft is not a claim of legal compliance.

## Implementation facts checked

- Account schema and authentication service: user name, email, phone, role, session information and hashed passwords; optional Google authentication.
- Business schemas: staff, customers, suppliers, operational records, accounting and attachments. Invoice/expense attachment bytes are stored in the database.
- Historical DSR extraction and Intelligence services: configured OpenAI API requests can include source documents/images, questions and verified facts. Browser OCR is not the only processing path.
- Historical draft store: IndexedDB can hold source documents and edited rows. Offline support also uses browser storage.
- WhatsApp: destinations, consent, message jobs, delivery outcomes and audit information. Customer consent is distinct from owner consent.
- Existing production-readiness documentation does not establish a universal backup/deletion retention policy. The draft avoids promising immediate erasure, guaranteed security or India-only processing.

## Publication sequence after review

1. Resolve the contact placeholders and approve the final wording.
2. Add an accessible public policy page that works without sign-in, with an effective date and links from sign-in/help/account settings.
3. Deploy only the approved changes and verify the public page.
4. Enter its HTTPS URL in Meta app settings and complete the remaining publish requirements shown by Meta.
5. Verify a real delivery callback using an authorised message. A dashboard-generated sample callback is not proof of delivery to a recipient.

## Callback check completed

On 19 November 2026, Meta's dashboard-generated status sample reached the production `/api/notifications/whatsapp/webhook` endpoint and returned HTTP 200 (observed in Vercel runtime logs at 10:45:29 IST). The sample used synthetic identifiers. This verifies signed test callback reachability, not the delivery state of an existing real message. Meta's configuration page states that production webhook data requires the app to be published.

The app remains unpublished pending the public privacy-policy URL. No policy was deployed or submitted to Meta as part of preparing this draft.
