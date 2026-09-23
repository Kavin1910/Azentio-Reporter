-- =============================================================================
-- 0003_seed_templates.sql — Report template catalogue
--
-- Each field carries a `role` so the mapper knows what it is looking for:
--   dimension — something to group by (branch, product)
--   measure   — something to aggregate (amounts, counts)
--   date      — a timeline column; the date-range filter binds to one of these
--
-- `derivable` marks a field the mapper may satisfy with a computed formula when
-- no source column matches — this is what makes `age` work off date_of_birth.
-- =============================================================================

insert into public.report_templates (code, name, description, category, icon, position, fields) values

('PORTFOLIO_SUMMARY', 'Loan Portfolio Summary',
 'Total book by branch and product — sanctioned, disbursed and outstanding, with account counts.',
 'Portfolio', 'layers', 1,
 '[{"key":"disbursed_on","label":"Disbursement Date","type":"date","role":"date","required":true},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":true},
   {"key":"product","label":"Product","type":"text","role":"dimension","required":true},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"disbursed_amount","label":"Disbursed","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"outstanding_amount","label":"Outstanding","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"loan_count","label":"Accounts","type":"number","role":"measure","aggregation":"count","required":false,"derivable":true}]'),

('DISBURSEMENT', 'Disbursement Report',
 'Every loan disbursed in the period, with sanctioned versus actual amounts.',
 'Operations', 'send', 2,
 '[{"key":"disbursed_on","label":"Disbursement Date","type":"date","role":"date","required":true},
   {"key":"loan_account_no","label":"Loan Account","type":"text","role":"dimension","required":true},
   {"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":true},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":false},
   {"key":"product","label":"Product","type":"text","role":"dimension","required":false},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"disbursed_amount","label":"Disbursed","type":"currency","role":"measure","aggregation":"sum","required":true}]'),

('REPAYMENT', 'Repayment & Collection',
 'Collections against demand for the period, with efficiency by branch.',
 'Operations', 'inbox', 3,
 '[{"key":"payment_date","label":"Payment Date","type":"date","role":"date","required":true},
   {"key":"loan_account_no","label":"Loan Account","type":"text","role":"dimension","required":true},
   {"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":false},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":false},
   {"key":"emi_amount","label":"EMI Due","type":"currency","role":"measure","aggregation":"sum","required":true,"derivable":true},
   {"key":"amount_paid","label":"Collected","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"collection_efficiency","label":"Efficiency %","type":"number","role":"measure","aggregation":"avg","required":false,"derivable":true}]'),

('DELINQUENCY', 'Delinquency Aging',
 'Overdue accounts bucketed by days past due — 0-30, 31-60, 61-90 and 90+.',
 'Risk', 'alert', 4,
 '[{"key":"as_of_date","label":"As Of","type":"date","role":"date","required":true},
   {"key":"loan_account_no","label":"Loan Account","type":"text","role":"dimension","required":true},
   {"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":false},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":false},
   {"key":"dpd","label":"Days Past Due","type":"number","role":"measure","aggregation":"max","required":true},
   {"key":"dpd_bucket","label":"Aging Bucket","type":"text","role":"dimension","required":true,"derivable":true},
   {"key":"outstanding_amount","label":"Overdue Amount","type":"currency","role":"measure","aggregation":"sum","required":true}]'),

('DEMOGRAPHICS', 'Borrower Demographics',
 'Who the borrowers are — age bands, gender, location and occupation mix.',
 'Portfolio', 'users', 5,
 '[{"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":true},
   {"key":"date_of_birth","label":"Date of Birth","type":"date","role":"date","required":false},
   {"key":"age","label":"Age","type":"number","role":"measure","aggregation":"avg","required":true,"derivable":true},
   {"key":"age_band","label":"Age Band","type":"text","role":"dimension","required":false,"derivable":true},
   {"key":"gender","label":"Gender","type":"text","role":"dimension","required":false},
   {"key":"city","label":"City","type":"text","role":"dimension","required":false},
   {"key":"occupation","label":"Occupation","type":"text","role":"dimension","required":false},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":false}]'),

('BRANCH_PERFORMANCE', 'Branch Performance',
 'Disbursement, collection and delinquency ranked by branch.',
 'Performance', 'building', 6,
 '[{"key":"disbursed_on","label":"Date","type":"date","role":"date","required":true},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":true},
   {"key":"disbursed_amount","label":"Disbursed","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"amount_paid","label":"Collected","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"outstanding_amount","label":"Outstanding","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"loan_count","label":"Accounts","type":"number","role":"measure","aggregation":"count","required":false,"derivable":true}]'),

('PRODUCT_PERFORMANCE', 'Product Performance',
 'How each loan product is selling and pricing — volume, value and average rate.',
 'Performance', 'package', 7,
 '[{"key":"disbursed_on","label":"Date","type":"date","role":"date","required":true},
   {"key":"product","label":"Product","type":"text","role":"dimension","required":true},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"disbursed_amount","label":"Disbursed","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"interest_rate","label":"Avg Rate %","type":"number","role":"measure","aggregation":"avg","required":false},
   {"key":"tenure_months","label":"Avg Tenure","type":"number","role":"measure","aggregation":"avg","required":false},
   {"key":"loan_count","label":"Accounts","type":"number","role":"measure","aggregation":"count","required":false,"derivable":true}]'),

('CREDIT_SCORE', 'Credit Score Distribution',
 'CIBIL score spread across the book, banded, against sanctioned value.',
 'Risk', 'gauge', 8,
 '[{"key":"disbursed_on","label":"Date","type":"date","role":"date","required":false},
   {"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":false},
   {"key":"cibil_score","label":"CIBIL Score","type":"number","role":"measure","aggregation":"avg","required":true},
   {"key":"score_band","label":"Score Band","type":"text","role":"dimension","required":true,"derivable":true},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"loan_count","label":"Accounts","type":"number","role":"measure","aggregation":"count","required":false,"derivable":true}]'),

('EMI_AFFORDABILITY', 'EMI & Affordability',
 'EMI against income, with FOIR computed where the source has income and obligations.',
 'Risk', 'scale', 9,
 '[{"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":true},
   {"key":"monthly_income","label":"Monthly Income","type":"currency","role":"measure","aggregation":"avg","required":true},
   {"key":"existing_emi","label":"Existing EMI","type":"currency","role":"measure","aggregation":"avg","required":false},
   {"key":"emi_amount","label":"Proposed EMI","type":"currency","role":"measure","aggregation":"avg","required":true,"derivable":true},
   {"key":"foir","label":"FOIR %","type":"number","role":"measure","aggregation":"avg","required":true,"derivable":true},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":false},
   {"key":"tenure_months","label":"Tenure","type":"number","role":"measure","aggregation":"avg","required":false}]'),

('NPA_SUMMARY', 'NPA & Provisioning',
 'Non-performing assets by classification, with provisioning and NPA ratio.',
 'Risk', 'shield', 10,
 '[{"key":"as_of_date","label":"As Of","type":"date","role":"date","required":true},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":false},
   {"key":"asset_classification","label":"Classification","type":"text","role":"dimension","required":true,"derivable":true},
   {"key":"outstanding_amount","label":"Outstanding","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"provision_amount","label":"Provision","type":"currency","role":"measure","aggregation":"sum","required":false,"derivable":true},
   {"key":"npa_ratio","label":"NPA %","type":"number","role":"measure","aggregation":"avg","required":false,"derivable":true}]'),

('SANCTION_VARIANCE', 'Sanction vs Disbursement',
 'Where sanctioned value did not convert — variance in amount and in days.',
 'Operations', 'diff', 11,
 '[{"key":"sanction_date","label":"Sanction Date","type":"date","role":"date","required":true},
   {"key":"disbursed_on","label":"Disbursement Date","type":"date","role":"date","required":false},
   {"key":"loan_account_no","label":"Loan Account","type":"text","role":"dimension","required":true},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":false},
   {"key":"sanctioned_amount","label":"Sanctioned","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"disbursed_amount","label":"Disbursed","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"variance_amount","label":"Variance","type":"currency","role":"measure","aggregation":"sum","required":false,"derivable":true},
   {"key":"variance_pct","label":"Variance %","type":"number","role":"measure","aggregation":"avg","required":false,"derivable":true}]'),

('CONCENTRATION', 'Customer Concentration',
 'Largest exposures and what share of the book they represent.',
 'Risk', 'target', 12,
 '[{"key":"borrower_name","label":"Borrower","type":"text","role":"dimension","required":true},
   {"key":"customer_id","label":"Customer ID","type":"text","role":"dimension","required":false},
   {"key":"branch","label":"Branch","type":"text","role":"dimension","required":false},
   {"key":"disbursed_on","label":"Date","type":"date","role":"date","required":false},
   {"key":"outstanding_amount","label":"Exposure","type":"currency","role":"measure","aggregation":"sum","required":true},
   {"key":"loan_count","label":"Accounts","type":"number","role":"measure","aggregation":"count","required":false,"derivable":true},
   {"key":"exposure_share","label":"Share of Book %","type":"number","role":"measure","aggregation":"sum","required":false,"derivable":true}]')

on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  category = excluded.category, icon = excluded.icon,
  fields = excluded.fields, position = excluded.position;
