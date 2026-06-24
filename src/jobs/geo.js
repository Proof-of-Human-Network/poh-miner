/**
 * Real Geo-IP and Geographic utilities for the PoH Miner Network
 *
 * Supports all countries using ISO 3166-1 alpha-2 codes.
 * Designed to be lightweight and work on any device (Mac Mini, Pi, etc.).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.poh-miner', 'my-location.json');

// Simple but comprehensive country → continent map
// Source: UN geoscheme + common mappings
export const COUNTRY_TO_CONTINENT = {
  // Europe
  'AL': 'Europe', 'AD': 'Europe', 'AT': 'Europe', 'BY': 'Europe', 'BE': 'Europe',
  'BA': 'Europe', 'BG': 'Europe', 'HR': 'Europe', 'CY': 'Europe', 'CZ': 'Europe',
  'DK': 'Europe', 'EE': 'Europe', 'FI': 'Europe', 'FR': 'Europe', 'DE': 'Europe',
  'GR': 'Europe', 'HU': 'Europe', 'IS': 'Europe', 'IE': 'Europe', 'IT': 'Europe',
  'LV': 'Europe', 'LI': 'Europe', 'LT': 'Europe', 'LU': 'Europe', 'MT': 'Europe',
  'MD': 'Europe', 'MC': 'Europe', 'ME': 'Europe', 'NL': 'Europe', 'MK': 'Europe',
  'NO': 'Europe', 'PL': 'Europe', 'PT': 'Europe', 'RO': 'Europe', 'SM': 'Europe',
  'RS': 'Europe', 'SK': 'Europe', 'SI': 'Europe', 'ES': 'Europe', 'SE': 'Europe',
  'CH': 'Europe', 'UA': 'Europe', 'GB': 'Europe', 'VA': 'Europe', 'GE': 'Europe', // Georgia is Europe/Asia, we put it in Europe for POH relevance

  // Asia
  'AF': 'Asia', 'AM': 'Asia', 'AZ': 'Asia', 'BH': 'Asia', 'BD': 'Asia',
  'BT': 'Asia', 'BN': 'Asia', 'KH': 'Asia', 'CN': 'Asia', 'CY': 'Asia',
  'GE': 'Asia', 'IN': 'Asia', 'ID': 'Asia', 'IR': 'Asia', 'IQ': 'Asia',
  'IL': 'Asia', 'JP': 'Asia', 'JO': 'Asia', 'KZ': 'Asia', 'KW': 'Asia',
  'KG': 'Asia', 'LA': 'Asia', 'LB': 'Asia', 'MY': 'Asia', 'MV': 'Asia',
  'MN': 'Asia', 'MM': 'Asia', 'NP': 'Asia', 'KP': 'Asia', 'OM': 'Asia',
  'PK': 'Asia', 'PS': 'Asia', 'PH': 'Asia', 'QA': 'Asia', 'SA': 'Asia',
  'SG': 'Asia', 'KR': 'Asia', 'LK': 'Asia', 'SY': 'Asia', 'TW': 'Asia',
  'TJ': 'Asia', 'TH': 'Asia', 'TL': 'Asia', 'TR': 'Asia', 'TM': 'Asia',
  'AE': 'Asia', 'UZ': 'Asia', 'VN': 'Asia', 'YE': 'Asia',

  // North America
  'AG': 'North America', 'BS': 'North America', 'BB': 'North America', 'BZ': 'North America',
  'CA': 'North America', 'CR': 'North America', 'CU': 'North America', 'DM': 'North America',
  'DO': 'North America', 'SV': 'North America', 'GD': 'North America', 'GT': 'North America',
  'HT': 'North America', 'HN': 'North America', 'JM': 'North America', 'MX': 'North America',
  'NI': 'North America', 'PA': 'North America', 'KN': 'North America', 'LC': 'North America',
  'VC': 'North America', 'TT': 'North America', 'US': 'North America',

  // South America
  'AR': 'South America', 'BO': 'South America', 'BR': 'South America', 'CL': 'South America',
  'CO': 'South America', 'EC': 'South America', 'GY': 'South America', 'PY': 'South America',
  'PE': 'South America', 'SR': 'South America', 'UY': 'South America', 'VE': 'South America',

  // Africa
  'DZ': 'Africa', 'AO': 'Africa', 'BJ': 'Africa', 'BW': 'Africa', 'BF': 'Africa',
  'BI': 'Africa', 'CM': 'Africa', 'CV': 'Africa', 'CF': 'Africa', 'TD': 'Africa',
  'KM': 'Africa', 'CG': 'Africa', 'CD': 'Africa', 'DJ': 'Africa', 'EG': 'Africa',
  'GQ': 'Africa', 'ER': 'Africa', 'ET': 'Africa', 'GA': 'Africa', 'GM': 'Africa',
  'GH': 'Africa', 'GN': 'Africa', 'GW': 'Africa', 'CI': 'Africa', 'KE': 'Africa',
  'LS': 'Africa', 'LR': 'Africa', 'LY': 'Africa', 'MG': 'Africa', 'MW': 'Africa',
  'ML': 'Africa', 'MR': 'Africa', 'MU': 'Africa', 'MA': 'Africa', 'MZ': 'Africa',
  'NA': 'Africa', 'NE': 'Africa', 'NG': 'Africa', 'RW': 'Africa', 'ST': 'Africa',
  'SN': 'Africa', 'SC': 'Africa', 'SL': 'Africa', 'SO': 'Africa', 'ZA': 'Africa',
  'SS': 'Africa', 'SD': 'Africa', 'SZ': 'Africa', 'TZ': 'Africa', 'TG': 'Africa',
  'TN': 'Africa', 'UG': 'Africa', 'ZM': 'Africa', 'ZW': 'Africa',

  // Oceania
  'AU': 'Oceania', 'FJ': 'Oceania', 'KI': 'Oceania', 'MH': 'Oceania', 'FM': 'Oceania',
  'NR': 'Oceania', 'NZ': 'Oceania', 'PW': 'Oceania', 'PG': 'Oceania', 'WS': 'Oceania',
  'SB': 'Oceania', 'TO': 'Oceania', 'TV': 'Oceania', 'VU': 'Oceania',
};

/**
 * Detects the current machine's country using a public IP geolocation service.
 * Caches the result locally for 30 days.
 */
export async function detectMyCountry() {
  // Try cache first
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const ageDays = (Date.now() - cached.detectedAt) / (1000 * 60 * 60 * 24);
      if (ageDays < 30 && cached.country) {
        return cached;
      }
    }
  } catch (e) {}

  try {
    // Free, no-key service with good reliability
    const res = await fetch('https://ipapi.co/json/', { timeout: 8000 });
    if (!res.ok) throw new Error('ipapi failed');

    const data = await res.json();
    const result = {
      country: data.country_code?.toUpperCase(),
      countryName: data.country_name,
      city: data.city,
      continent: COUNTRY_TO_CONTINENT[data.country_code?.toUpperCase()] || 'Unknown',
      detectedAt: Date.now(),
      source: 'ipapi.co'
    };

    // Cache it
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
    } catch (e) {}

    return result;
  } catch (err) {
    console.warn('[Geo] Failed to detect country via IP:', err.message);
    return {
      country: 'XX',
      countryName: 'Unknown',
      continent: 'Unknown',
      detectedAt: Date.now(),
      source: 'fallback'
    };
  }
}

/**
 * Returns a multiplier based on how "close" two countries are.
 * This is the core of real geographic job preference.
 */
export function getCountryProximityMultiplier(minerCountry, jobOriginCountry) {
  if (!minerCountry || !jobOriginCountry || minerCountry === 'XX' || jobOriginCountry === 'XX') {
    return 1.0;
  }

  const minerCont = COUNTRY_TO_CONTINENT[minerCountry];
  const jobCont = COUNTRY_TO_CONTINENT[jobOriginCountry];

  if (minerCountry === jobOriginCountry) {
    return 3.5; // Same country = massive advantage
  }

  if (minerCont && jobCont && minerCont === jobCont) {
    return 1.85; // Same continent
  }

  return 0.65; // Different continent
}

/**
 * Get human readable name for a country code (basic map)
 */
const COUNTRY_NAMES = {
  'GE': 'Georgia', 'SG': 'Singapore', 'US': 'United States', 'DE': 'Germany',
  'GB': 'United Kingdom', 'FR': 'France', 'JP': 'Japan', 'AU': 'Australia',
  'BR': 'Brazil', 'IN': 'India', 'CN': 'China', 'RU': 'Russia',
  // Add more as needed
};

export function getCountryName(code) {
  return COUNTRY_NAMES[code] || code;
}
