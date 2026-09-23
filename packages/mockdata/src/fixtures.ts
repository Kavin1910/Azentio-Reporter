/**
 * Source values for the generated mock files.
 *
 * Deliberately Indian retail-banking shaped: real branch cities, real product
 * names, plausible amounts in rupees. The names are invented.
 */

export const FIRST_NAMES: Array<{ name: string; gender: 'm' | 'f' }> = [
  { name: 'Rajesh',  gender: 'm' }, { name: 'Priya',    gender: 'f' },
  { name: 'Anil',    gender: 'm' }, { name: 'Sunita',   gender: 'f' },
  { name: 'Vikram',  gender: 'm' }, { name: 'Meera',    gender: 'f' },
  { name: 'Arjun',   gender: 'm' }, { name: 'Kavya',    gender: 'f' },
  { name: 'Sandeep', gender: 'm' }, { name: 'Fatima',   gender: 'f' },
  { name: 'Imran',   gender: 'm' }, { name: 'Deepa',    gender: 'f' },
  { name: 'Rohit',   gender: 'm' }, { name: 'Ananya',   gender: 'f' },
  { name: 'Suresh',  gender: 'm' }, { name: 'Lakshmi',  gender: 'f' },
  { name: 'Manoj',   gender: 'm' }, { name: 'Pooja',    gender: 'f' },
  { name: 'Ganesh',  gender: 'm' }, { name: 'Nisha',    gender: 'f' },
  { name: 'Ravi',    gender: 'm' }, { name: 'Shalini',  gender: 'f' },
  { name: 'Karthik', gender: 'm' }, { name: 'Divya',    gender: 'f' },
  { name: 'Amit',    gender: 'm' }, { name: 'Rekha',    gender: 'f' },
  { name: 'Prakash', gender: 'm' }, { name: 'Sneha',    gender: 'f' },
  { name: 'Venkat',  gender: 'm' }, { name: 'Aarti',    gender: 'f' },
];

export const LAST_NAMES = [
  'Kumar', 'Sharma', 'Reddy', 'Nair', 'Iyer', 'Patel', 'Desai', 'Menon',
  'Shetty', 'Rao', 'Gupta', 'Joshi', 'Malhotra', 'Bhat', 'Chauhan', 'Pillai',
  'Krishnan', 'Deshpande', 'Qureshi', 'Sheikh', 'Bose', 'Mehta',
];

export const CITIES = [
  'Pune', 'Bengaluru', 'Mumbai', 'Chennai', 'Hyderabad', 'Coimbatore',
  'Nashik', 'Thane', 'Jaipur', 'Kochi', 'Indore', 'Nagpur', 'Surat', 'Lucknow',
];

export const BRANCHES = [
  { name: 'Pune - Kothrud',        region: 'West'  },
  { name: 'Pune - Hinjewadi',      region: 'West'  },
  { name: 'Mumbai - Andheri',      region: 'West'  },
  { name: 'Mumbai - Bandra',       region: 'West'  },
  { name: 'Bengaluru - Indiranagar', region: 'South' },
  { name: 'Bengaluru - Whitefield',  region: 'South' },
  { name: 'Chennai - T Nagar',     region: 'South' },
  { name: 'Hyderabad - Gachibowli', region: 'South' },
  { name: 'Jaipur - Malviya Nagar', region: 'North' },
  { name: 'Lucknow - Hazratganj',  region: 'North' },
];

export const PRODUCTS = [
  { name: 'Home Loan - Prime',     rateMin: 8.35,  rateMax: 9.75,  min: 500000,  max: 15000000, tenures: [120, 180, 240, 300] },
  { name: 'Affordable Housing',    rateMin: 8.75,  rateMax: 10.50, min: 300000,  max: 3500000,  tenures: [120, 180, 240] },
  { name: 'Personal Loan',         rateMin: 10.99, rateMax: 18.00, min: 50000,   max: 2500000,  tenures: [12, 24, 36, 48, 60] },
  { name: 'Vehicle Loan',          rateMin: 8.90,  rateMax: 12.50, min: 100000,  max: 4000000,  tenures: [36, 48, 60, 84] },
  { name: 'Business Loan - MSME',  rateMin: 13.00, rateMax: 20.00, min: 200000,  max: 5000000,  tenures: [12, 24, 36, 60] },
  { name: 'Loan Against Property', rateMin: 9.50,  rateMax: 12.00, min: 500000,  max: 12000000, tenures: [60, 120, 180] },
  { name: 'Gold Loan',             rateMin: 9.00,  rateMax: 15.00, min: 25000,   max: 2000000,  tenures: [6, 12, 18, 24, 36] },
];

export const OCCUPATIONS = [
  'Salaried - IT', 'Salaried - Government', 'Salaried - Manufacturing',
  'Self Employed Professional', 'Business Owner', 'Retired', 'Agriculturist',
];

export const ASSET_CLASSES = ['Standard', 'Sub-Standard', 'Doubtful', 'Loss'];

/**
 * The same value spelled differently from row to row — the inconsistency the
 * Structure step has to reconcile. Keyed by actual gender so the spelling varies
 * while the fact stays consistent with the borrower's name.
 */
export const GENDER_VARIANTS = {
  m: ['M', 'Male', 'm', 'MALE'],
  f: ['F', 'Female', 'f', 'FEMALE'],
} as const;

/** Blank-ish values that appear in real exports instead of an empty cell. */
export const NULLISH = ['', 'N/A', 'NA', '-', '--', 'NULL', 'n/a', ' '];
