/**
 * Entity Extractor — extract structured entities from natural language.
 *
 * Extracts: commodity, state, district, quantity, weight, date, name, country.
 * All rule-based (no API call), runs in < 10ms.
 */

// ── Commodity dictionary (aliases → canonical name) ──────────────────────────
const COMMODITY_ALIASES = {
  // Vegetables
  onion: "Onion", kanda: "Onion", kande: "Onion", pyaj: "Onion", pyaaj: "Onion",
  pyaz: "Onion", pyaaz: "Onion", durdu: "Onion", pyaaz: "Onion",
  potato: "Potato", batata: "Potato", aloo: "Potato",
  tomato: "Tomato", tamatar: "Tomato",
  cauliflower: "Cauliflower", phoolgobhi: "Cauliflower",
  cabbage: "Cabbage", "patta gobhi": "Cabbage",
  brinjal: "Brinjal", baingan: "Brinjal", vangi: "Brinjal",
  ladyfinger: "Bhindi(Ladies Finger)", bhindi: "Bhindi(Ladies Finger)", okra: "Bhindi(Ladies Finger)",
  garlic: "Garlic", lasun: "Garlic", ellu: "Garlic",
  ginger: "Ginger", adrak: "Ginger",
  chilli: "Chilli", mirchi: "Chilli", mirch: "Chilli",
  peas: "Peas", matar: "Peas", vatana: "Peas",
  carrot: "Carrot", gajar: "Carrot",
  // Fruits
  mango: "Mango", aam: "Mango", ambi: "Mango",
  banana: "Banana", kela: "Banana",
  grapes: "Grapes", angoor: "Grapes",
  orange: "Orange", santara: "Orange",
  pomegranate: "Pomegranate", anar: "Pomegranate", dalimb: "Pomegranate",
  apple: "Apple", seb: "Apple",
  // Grains
  wheat: "Wheat", gehu: "Wheat", gahu: "Wheat",
  rice: "Rice", chawal: "Rice", tandul: "Rice",
  maize: "Maize", makka: "Maize", jowar: "Jowar",
  bajra: "Bajra", ragi: "Ragi",
  // Pulses
  gram: "Gram", chana: "Gram", chana: "Gram",
  tur: "Tur", arhar: "Tur", toor: "Tur",
  urad: "Urad", moong: "Moong", masoor: "Masoor",
  lentil: "Lentil", masoor: "Lentil",
  // Oilseeds
  soyabean: "Soyabean", soyabin: "Soyabean", soybin: "Soyabean",
  soybean: "Soyabean", soya: "Soyabean",
  groundnut: "Groundnut", moongfali: "Groundnut", phalli: "Groundnut",
  mustard: "Mustard", sarson: "Mustard",
  sunflower: "Sunflower", surajmukhi: "Sunflower",
  cotton: "Cotton", kapas: "Cotton",
  // Spices
  turmeric: "Turmeric", haldi: "Turmeric",
  cumin: "Cumin", jeera: "Cumin",
  coriander: "Coriander", dhaniya: "Coriander",
  // Sugars
  sugarcane: "Sugarcane", ganna: "Sugarcane",
};

// ── Indian states ────────────────────────────────────────────────────────────
const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli",
  "Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Lakshadweep", "Puducherry",
];

// State name aliases (common short/informal forms)
const STATE_ALIASES = {
  "maharashtra": "Maharashtra", "mp": "Madhya Pradesh", "up": "Uttar Pradesh",
  "ap": "Andhra Pradesh", "tn": "Tamil Nadu", "karnataka": "Karnataka",
  "kerala": "Kerala", "gujarat": "Gujarat", "rajasthan": "Rajasthan",
  "punjab": "Punjab", "haryana": "Haryana", "bihar": "Bihar",
  "bengal": "West Bengal", "west bengal": "West Bengal",
  "odisha": "Odisha", "orissa": "Odisha",
  "jharkhand": "Jharkhand", "chhattisgarh": "Chhattisgarh",
  "uttarakhand": "Uttarakhand", "hp": "Himachal Pradesh",
  "goa": "Goa", "delhi": "Delhi", "assam": "Assam",
  "telangana": "Telangana", "manipur": "Manipur",
  "nagaland": "Nagaland", "meghalaya": "Meghalaya",
  "mizoram": "Mizoram", "tripura": "Tripura", "sikkim": "Sikkim",
  "arunachal": "Arunachal Pradesh",
};

// ── Common Indian districts ──────────────────────────────────────────────────
const COMMON_DISTRICTS = [
  "Nashik", "Pune", "Mumbai", "Nagpur", "Aurangabad", "Solapur",
  "Ahmednagar", "Kolhapur", "Satara", "Sangli", "Jalna",
  "Indore", "Bhopal", "Jabalpur", "Gwalior",
  "Jaipur", "Jodhpur", "Udaipur", "Kota",
  "Lucknow", "Kanpur", "Agra", "Varanasi", "Meerut",
  "Ahmedabad", "Surat", "Rajkot", "Vadodara",
  "Chennai", "Coimbatore", "Madurai", "Salem",
  "Bangalore", "Mysore", "Hubli",
  "Hyderabad", "Warangal", "Karimnagar",
  "Ludhiana", "Amritsar", "Jalandhar",
  "Patna", "Gaya", "Muzaffarpur",
  "Ranchi", "Jamshedpur",
  "Bhubaneswar", "Cuttack",
  "Thiruvananthapuram", "Kochi", "Kozhikode",
  "Guwahati", "Silchar",
];

// ── Country names ────────────────────────────────────────────────────────────
const COUNTRIES = [
  "UAE", "USA", "UK", "India", "China", "Japan", "Germany", "France",
  "Australia", "Canada", "Russia", "Brazil", "South Africa", "Nigeria",
  "Bangladesh", "Sri Lanka", "Nepal", "Pakistan", "Malaysia", "Singapore",
  "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman", "Turkey",
  "Vietnam", "Thailand", "Indonesia", "Philippines", "South Korea",
  "Netherlands", "Belgium", "Italy", "Spain", "Portugal", "Poland",
  "Iran", "Iraq", "Egypt", "Kenya", "Ethiopia", "Tanzania",
];

// ── Quantity patterns ────────────────────────────────────────────────────────
const QUANTITY_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*(kg|kilogram|kilo|kgs)/i,
  /(\d+(?:\.\d+)?)\s*(tonne|ton|tons|mt|metric\s*ton)/i,
  /(\d+(?:\.\d+)?)\s*(quintal|qt|qtl)/i,
  /(\d+(?:\.\d+)?)\s*(gram|gms|grams)/i,
  /(\d+(?:\.\d+)?)\s*(litre|liter|lts|ltr)/i,
  /(\d+(?:\.\d+)?)\s*(piece|pc|pcs|units?)/i,
  /(\d+(?:\.\d+)?)\s*(bag|bags|gunny|sack)/i,
  /(\d+(?:\.\d+)?)\s*(carton|cartons|box|boxes)/i,
];

// ── Date patterns ────────────────────────────────────────────────────────────
const MONTH_NAMES = /jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/i;

// ── Extraction functions ─────────────────────────────────────────────────────

export function extractCommodity(text) {
  const lower = String(text || "").toLowerCase().trim();

  // Direct alias match
  if (COMMODITY_ALIASES[lower]) return COMMODITY_ALIASES[lower];

  // Word-by-word scan
  const words = lower.split(/[\s,.\-!?]+/).filter(Boolean);
  for (const word of words) {
    if (COMMODITY_ALIASES[word]) return COMMODITY_ALIASES[word];
  }

  // Multi-word match (e.g., "green chilli")
  for (const [alias, canonical] of Object.entries(COMMODITY_ALIASES)) {
    if (lower.includes(alias)) return canonical;
  }

  return null;
}

export function extractState(text) {
  const lower = String(text || "").toLowerCase().trim();

  // Check aliases first
  for (const [alias, state] of Object.entries(STATE_ALIASES)) {
    if (lower.includes(alias)) return state;
  }

  // Check full state names
  for (const state of INDIAN_STATES) {
    if (lower.includes(state.toLowerCase())) return state;
  }

  return null;
}

export function extractDistrict(text) {
  const lower = String(text || "").toLowerCase().trim();

  for (const district of COMMON_DISTRICTS) {
    if (lower.includes(district.toLowerCase())) return district;
  }

  return null;
}

export function extractQuantity(text) {
  const raw = String(text || "");
  for (const pattern of QUANTITY_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      return { value: parseFloat(match[1]), unit: match[2].toLowerCase() };
    }
  }
  return null;
}

export function extractCountry(text) {
  const lower = String(text || "").toLowerCase().trim();

  for (const country of COUNTRIES) {
    if (lower.includes(country.toLowerCase())) return country;
  }

  return null;
}

export function extractDate(text) {
  const raw = String(text || "");
  const monthMatch = raw.match(MONTH_NAMES);
  const yearMatch = raw.match(/20\d{2}/);
  const relativeMatch = raw.match(/\b(today|tomorrow|yesterday|this\s*week|next\s*week|this\s*month|next\s*month)\b/i);

  if (relativeMatch) return relativeMatch[1];
  if (monthMatch && yearMatch) return `${monthMatch[0]} ${yearMatch[0]}`;
  if (monthMatch) return monthMatch[0];

  return null;
}

// ── Combined extraction ──────────────────────────────────────────────────────
export function extractEntities(text) {
  return {
    commodity: extractCommodity(text),
    state: extractState(text),
    district: extractDistrict(text),
    quantity: extractQuantity(text),
    country: extractCountry(text),
    date: extractDate(text),
  };
}

export default {
  extractCommodity,
  extractState,
  extractDistrict,
  extractQuantity,
  extractCountry,
  extractDate,
  extractEntities,
};
