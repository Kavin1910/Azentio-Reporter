-- =============================================================================
-- test_project_seed.sql — sample "customer" database for testing Connect Supabase
--
-- Run this in the SQL editor of a SEPARATE Supabase project (not the one the
-- reporter itself uses). It creates three tables and two views of Indian retail
-- lending data — 600 loan accounts, ~1,800 repayments, 120 monthly branch
-- targets — then exposes them through the REST layer so the reporter can read
-- them with either the service_role key or the anon key.
--
-- Idempotent: safe to run again; it drops and recreates its own objects only.
-- Deterministic: the same data every time, so results are comparable.
-- =============================================================================

drop view  if exists public.loan_summary_by_branch;
drop view  if exists public.active_loans;
drop table if exists public.repayments;
drop table if exists public.branch_targets;
drop table if exists public.loan_accounts;
drop function if exists public.seed_rnd(int, text);

-- Small deterministic pseudo-random helper: 0..999999 from (seed, salt).
create or replace function public.seed_rnd(seed int, salt text)
returns int language sql immutable as $$
  select (('x' || substr(md5(seed::text || ':' || salt), 1, 8))::bit(32)::int & 2147483647) % 1000000
$$;

-- ---------------------------------------------------------------- accounts
create table public.loan_accounts (
  loan_account_no      text primary key,
  customer_id          text not null,
  borrower_name        text not null,
  date_of_birth        date,
  gender               text,
  city                 text,
  branch               text not null,
  region               text not null,
  product              text not null,
  sanctioned_amount    numeric(14,2) not null,
  disbursed_amount     numeric(14,2),
  sanction_date        date not null,
  disbursed_on         date,
  interest_rate        numeric(5,2) not null,
  tenure_months        int not null,
  cibil_score          int,                       -- null = no bureau history
  monthly_income       numeric(12,2),
  existing_emi         numeric(12,2) default 0,
  outstanding_amount   numeric(14,2),
  dpd                  int not null default 0,
  asset_classification text not null,
  remarks              text,
  created_at           timestamptz not null default now()
);

with base as (
  select g,
    (array['Rajesh','Priya','Anil','Sunita','Vikram','Meera','Arjun','Kavya','Sandeep','Fatima','Imran','Deepa','Rohit','Ananya','Suresh','Lakshmi','Manoj','Pooja','Ganesh','Nisha','Ravi','Shalini','Karthik','Divya','Amit','Rekha','Prakash','Sneha','Venkat','Aarti'])[1 + seed_rnd(g,'fn') % 30] as first_name,
    (array['Kumar','Sharma','Reddy','Nair','Iyer','Patel','Desai','Menon','Shetty','Rao','Gupta','Joshi','Malhotra','Bhat','Chauhan','Pillai','Krishnan','Deshpande','Qureshi','Sheikh','Bose','Mehta'])[1 + seed_rnd(g,'ln') % 22] as last_name,
    (array['Pune - Kothrud','Pune - Hinjewadi','Mumbai - Andheri','Mumbai - Bandra','Bengaluru - Indiranagar','Bengaluru - Whitefield','Chennai - T Nagar','Hyderabad - Gachibowli','Jaipur - Malviya Nagar','Lucknow - Hazratganj'])[1 + seed_rnd(g,'br') % 10] as branch,
    (array['Home Loan - Prime','Affordable Housing','Personal Loan','Vehicle Loan','Business Loan - MSME','Loan Against Property','Gold Loan'])[1 + seed_rnd(g,'pr') % 7] as product,
    (array['Pune','Bengaluru','Mumbai','Chennai','Hyderabad','Coimbatore','Nashik','Thane','Jaipur','Kochi','Indore','Nagpur'])[1 + seed_rnd(g,'ct') % 12] as city,
    seed_rnd(g,'dpd') as r_dpd,
    seed_rnd(g,'cib') as r_cib
  from generate_series(1, 600) g
),
shaped as (
  select *,
    case product
      when 'Home Loan - Prime'      then 1500000 + (seed_rnd(g,'amt') % 8500) * 1000
      when 'Affordable Housing'     then  500000 + (seed_rnd(g,'amt') % 3000) * 1000
      when 'Personal Loan'          then   80000 + (seed_rnd(g,'amt') % 1400) * 1000
      when 'Vehicle Loan'           then  200000 + (seed_rnd(g,'amt') % 2500) * 1000
      when 'Business Loan - MSME'   then  300000 + (seed_rnd(g,'amt') % 4000) * 1000
      when 'Loan Against Property'  then 1000000 + (seed_rnd(g,'amt') % 9000) * 1000
      else                                50000 + (seed_rnd(g,'amt') %  900) * 1000
    end as sanctioned,
    case product
      when 'Home Loan - Prime'      then 8.35 + (seed_rnd(g,'roi') % 140) / 100.0
      when 'Affordable Housing'     then 8.75 + (seed_rnd(g,'roi') % 175) / 100.0
      when 'Personal Loan'          then 10.99 + (seed_rnd(g,'roi') % 700) / 100.0
      when 'Vehicle Loan'           then 8.90 + (seed_rnd(g,'roi') % 360) / 100.0
      when 'Business Loan - MSME'   then 13.00 + (seed_rnd(g,'roi') % 700) / 100.0
      when 'Loan Against Property'  then 9.50 + (seed_rnd(g,'roi') % 250) / 100.0
      else                               9.00 + (seed_rnd(g,'roi') % 600) / 100.0
    end as roi,
    case product
      when 'Home Loan - Prime'      then (array[120,180,240,300])[1 + seed_rnd(g,'ten') % 4]
      when 'Affordable Housing'     then (array[120,180,240])[1 + seed_rnd(g,'ten') % 3]
      when 'Personal Loan'          then (array[12,24,36,48,60])[1 + seed_rnd(g,'ten') % 5]
      when 'Vehicle Loan'           then (array[36,48,60,84])[1 + seed_rnd(g,'ten') % 4]
      when 'Business Loan - MSME'   then (array[12,24,36,60])[1 + seed_rnd(g,'ten') % 4]
      when 'Loan Against Property'  then (array[60,120,180])[1 + seed_rnd(g,'ten') % 3]
      else                               (array[6,12,18,24,36])[1 + seed_rnd(g,'ten') % 5]
    end as tenure,
    date '2024-01-01' + (seed_rnd(g,'sd') % 700) as sanction_dt,
    -- ~72% current; the rest spread across early, mid and deep delinquency
    case when r_dpd % 100 < 72 then 0
         when r_dpd % 100 < 86 then 1 + r_dpd % 30
         when r_dpd % 100 < 95 then 31 + r_dpd % 60
         else 91 + r_dpd % 310 end as dpd_days
  from base
)
insert into public.loan_accounts
  (loan_account_no, customer_id, borrower_name, date_of_birth, gender, city, branch, region, product,
   sanctioned_amount, disbursed_amount, sanction_date, disbursed_on, interest_rate, tenure_months,
   cibil_score, monthly_income, existing_emi, outstanding_amount, dpd, asset_classification, remarks)
select
  'LN' || (300000 + g),
  'CUST' || (70000 + g),
  first_name || ' ' || last_name,
  date '1962-01-01' + (seed_rnd(g,'dob') % 15000),
  case when first_name in ('Priya','Sunita','Meera','Kavya','Fatima','Deepa','Ananya','Lakshmi','Pooja','Nisha','Shalini','Divya','Rekha','Sneha','Aarti') then 'F' else 'M' end,
  city,
  branch,
  case when branch like 'Pune%' or branch like 'Mumbai%' then 'West'
       when branch like 'Jaipur%' or branch like 'Lucknow%' then 'North' else 'South' end,
  product,
  sanctioned,
  -- most disburse in full; some partially; a few (still 'sanctioned') not yet
  case when seed_rnd(g,'disb') % 100 < 78 then sanctioned
       when seed_rnd(g,'disb') % 100 < 94 then round(sanctioned * (0.60 + (seed_rnd(g,'part') % 35) / 100.0) / 1000) * 1000
       else null end,
  sanction_dt,
  case when seed_rnd(g,'disb') % 100 < 94 then sanction_dt + 1 + seed_rnd(g,'lag') % 45 else null end,
  round(roi::numeric, 2),
  tenure,
  case when r_cib % 100 < 6 then null else 540 + r_cib % 321 end,          -- 6% thin files
  20000 + (seed_rnd(g,'inc') % 330) * 1000,
  case when seed_rnd(g,'emi') % 100 < 45 then 2000 + (seed_rnd(g,'emi') % 116) * 500 else 0 end,
  round(sanctioned * (0.30 + (seed_rnd(g,'os') % 65) / 100.0) / 1000) * 1000,
  dpd_days,
  case when dpd_days <= 90 then 'Standard' when dpd_days <= 180 then 'Sub-Standard' when dpd_days <= 365 then 'Doubtful' else 'Loss' end,
  case when seed_rnd(g,'rem') % 100 < 12 then (array['Co-applicant income clubbed','Property valuation pending','Salary account with us','Restructured under RBI framework','Top-up requested','Insurance assigned','NACH mandate re-registered'])[1 + seed_rnd(g,'rm2') % 7] else null end
from shaped;

create index loan_accounts_branch_idx  on public.loan_accounts (branch);
create index loan_accounts_product_idx on public.loan_accounts (product);
create index loan_accounts_disb_idx    on public.loan_accounts (disbursed_on);

-- -------------------------------------------------------------- repayments
create table public.repayments (
  receipt_no      text primary key,
  loan_account_no text not null references public.loan_accounts(loan_account_no) on delete cascade,
  payment_date    date not null,
  emi_amount      numeric(12,2) not null,
  amount_paid     numeric(12,2) not null,
  payment_mode    text not null,
  branch          text not null,
  is_bounced      boolean not null default false
);

insert into public.repayments
select
  'RCP' || (900000 + row_number() over ()),
  l.loan_account_no,
  l.disbursed_on + k * 30,
  emi,
  case when l.dpd > 60 and seed_rnd((k * 7919 + rn)::int, 'miss') % 100 < 50 then 0
       when seed_rnd((k * 7919 + rn)::int, 'part') % 100 < 12 then round(emi * 0.5)
       else emi end,
  (array['NEFT','UPI','Auto Debit','Cheque','Cash','ACH'])[1 + seed_rnd((k * 7919 + rn)::int, 'mode') % 6],
  l.branch,
  seed_rnd((k * 7919 + rn)::int, 'bnc') % 100 < 4
from (
  select *, row_number() over (order by loan_account_no) as rn,
    round(disbursed_amount * (interest_rate/1200) * power(1 + interest_rate/1200, tenure_months)
          / (power(1 + interest_rate/1200, tenure_months) - 1)) as emi
  from public.loan_accounts where disbursed_on is not null
) l
cross join generate_series(1, 3) k
where l.disbursed_on + k * 30 <= date '2025-12-31';

create index repayments_acct_idx on public.repayments (loan_account_no);
create index repayments_date_idx on public.repayments (payment_date);

-- ---------------------------------------------------------- branch targets
create table public.branch_targets (
  id                  bigserial primary key,
  branch              text not null,
  region              text not null,
  month               date not null,               -- first day of month
  disbursement_target numeric(14,2) not null,
  collection_target   numeric(14,2) not null,
  unique (branch, month)
);

insert into public.branch_targets (branch, region, month, disbursement_target, collection_target)
select b.branch,
  case when b.branch like 'Pune%' or b.branch like 'Mumbai%' then 'West' when b.branch like 'Jaipur%' or b.branch like 'Lucknow%' then 'North' else 'South' end,
  m,
  25000000 + (seed_rnd((extract(month from m) * 100 + b.i)::int, 'dt') % 30000)::numeric * 1000,   -- ₹2.5–5.5 crore
   3000000 + (seed_rnd((extract(month from m) * 100 + b.i)::int, 'ct') %  4000)::numeric * 1000    -- ₹30–70 lakh
from unnest(array['Pune - Kothrud','Pune - Hinjewadi','Mumbai - Andheri','Mumbai - Bandra','Bengaluru - Indiranagar','Bengaluru - Whitefield','Chennai - T Nagar','Hyderabad - Gachibowli','Jaipur - Malviya Nagar','Lucknow - Hazratganj']) with ordinality as b(branch, i)
cross join generate_series(date '2025-01-01', date '2025-12-01', interval '1 month') m;

-- ------------------------------------------------------------------- views
create view public.active_loans as
  select * from public.loan_accounts where dpd = 0 and disbursed_on is not null;

create view public.loan_summary_by_branch as
  select branch, region,
         count(*)                         as accounts,
         sum(sanctioned_amount)           as sanctioned,
         sum(disbursed_amount)            as disbursed,
         sum(outstanding_amount)          as outstanding,
         count(*) filter (where dpd > 90) as npa_accounts
    from public.loan_accounts
   group by branch, region;

-- ---------------------------------------------------------- REST exposure
-- With the service_role key everything is readable regardless. These make the
-- anon key work too, so either key pasted into the reporter lists all five.
alter table public.loan_accounts  enable row level security;
alter table public.repayments     enable row level security;
alter table public.branch_targets enable row level security;

create policy read_all on public.loan_accounts  for select to anon, authenticated using (true);
create policy read_all on public.repayments     for select to anon, authenticated using (true);
create policy read_all on public.branch_targets for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.loan_accounts, public.repayments, public.branch_targets,
                public.active_loans, public.loan_summary_by_branch to anon, authenticated;

-- Tell PostgREST the schema changed so the tables appear immediately.
notify pgrst, 'reload schema';

select 'loan_accounts'  as table_name, count(*) from public.loan_accounts
union all select 'repayments',     count(*) from public.repayments
union all select 'branch_targets', count(*) from public.branch_targets
union all select 'active_loans',   count(*) from public.active_loans;
