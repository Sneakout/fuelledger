INSERT INTO "expense_categories" ("id", "organization_id", "name", "code", "active")
SELECT CONCAT('default_', MD5(o."id" || c.code)), o."id", c.name, c.code, TRUE
FROM "organizations" o
CROSS JOIN (VALUES
  ('STAFF-SALARY', 'Staff Salary'),
  ('ELECTRICITY', 'Electricity'),
  ('REPAIRS', 'Repairs & Maintenance'),
  ('BANK-CHARGES', 'Bank & POS Charges'),
  ('RENT', 'Rent & Lease'),
  ('LICENCES', 'Licences & Compliance'),
  ('HOUSEKEEPING', 'Cleaning & Housekeeping'),
  ('SECURITY', 'Security'),
  ('TRANSPORT', 'Transport & Freight'),
  ('COMMUNICATION', 'Phone & Internet'),
  ('OFFICE', 'Office & Administration'),
  ('MISC', 'Miscellaneous')
) AS c(code, name)
ON CONFLICT ("organization_id", "code") DO NOTHING;
