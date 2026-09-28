/**
 * Turn a free-text request into the value a tool argument can actually accept.
 *
 * Blind calls used to paste the whole sentence into every field. A dictionary
 * then looked up "Answer briefly with real data", DNS queried that sentence as
 * a hostname, and DeepWiki received it as repoName. Search-shaped fields keep
 * the sentence (minus the instruction tail). Fields that need one word, a
 * hostname, an owner/repo, or a currency code are extracted, or left empty so
 * the caller skips the tool instead of getting a validation error.
 */

const INSTRUCTION_RE = /\s*(?:answer briefly with (?:a fact from the tool, not a guess|real data)|give one concrete fact a user can check)\.?\s*/gi;
const SKILL_WRAP_RE = /^use the [a-z0-9_-]+ skill\s*\([^)]*\)\.\s*/i;

const FILLER = new Set([
  'answer', 'briefly', 'with', 'real', 'data', 'fact', 'from', 'the', 'tool',
  'not', 'a', 'guess', 'give', 'one', 'concrete', 'user', 'can', 'check', 'please',
]);

const WORD_STOP = new Set([
  ...FILLER,
  'define', 'definition', 'meaning', 'dictionary', 'what', 'does', 'mean', 'of',
  'an', 'is', 'word', 'tell', 'me',
]);

// Keys that, when the catalog lists them, must be filled or the call is skipped.
export const REQUIRED_WHEN_LISTED = new Set([
  'repoName', 'libraryId', 'code', 'indexes', 'url', 'section', 'owner', 'repo',
]);

// Listed keys a tool can run without. An IP lookup with no address uses the exit IP.
const OPTIONAL_ONLY = new Set(['ip', 'date', 'limit', 'year', 'vs', 'amount', 'from', 'to']);

const FX = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'GEL', 'KGS',
  'RUB', 'TRY', 'UAH', 'PLN', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'KRW',
  'SGD', 'HKD', 'ZAR', 'AED', 'SAR', 'THB', 'VND', 'IDR', 'PHP', 'CZK', 'HUF',
  'RON', 'BGN', 'ILS', 'EGP', 'NGN', 'KES', 'AMD', 'AZN', 'KZT', 'UZS', 'TJS',
  'BYN', 'RSD', 'ISK',
]);

export function stripInstruction(text) {
  return String(text ?? '')
    .replace(SKILL_WRAP_RE, '')
    .replace(INSTRUCTION_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.:;\s-]+|[.:;\s-]+$/g, '');
}

/** City/place from a weather or geo sentence. Empty string when there is no place. */
export function placeQuery(query) {
  let q = stripInstruction(query);
  if (!q) return '';
  q = q.replace(/[?!.,]+$/g, '').trim();
  q = q.replace(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:tell me\s+|give me\s+|show(?:\s+me)?\s+|get\s+)?(?:what(?:'s|s| is)\s+|how(?:'s|s| is)\s+)?(?:the\s+)?(?:current\s+)?(?:weather|forecast|temperature|temps?|sunrise|sunset|dawn|dusk)\s+(?:like\s+)?(?:(?:right now|today|tomorrow|yesterday|this week|next week)\s+)?(?:in|for|at|of)\s+/i, '');
  q = q.replace(/^(?:the\s+)?(?:current\s+)?(?:weather|forecast|temperature|temps?|sunrise|sunset|dawn|dusk)\s+/i, '');
  q = q.replace(/^(?:where is|where are|coordinates of|geocode)\s+/i, '');
  q = q.replace(/^(?:in|for|at|of)\s+/i, '');
  q = q.replace(/\s+(?:weather|forecast|temperature|temps?|sunrise|sunset|right now|today|tomorrow)$/i, '');
  q = q.trim();
  if (!q) return '';
  if (/^(?:weather|forecast|temperature|temps?|sunrise|sunset|dawn|dusk)$/i.test(q)) return '';
  if (q.split(/\s+/).length > 8) return '';
  return q;
}

function fxCodes(text) {
  const out = [];
  for (const m of String(text).matchAll(/\b([A-Za-z]{3})\b/g)) {
    const c = m[1].toUpperCase();
    if (FX.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

function ownerRepo(text) {
  const m = String(text).match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  if (!m) return null;
  return m[1].replace(/\.git$/, '').replace(/[.,]+$/, '');
}

/**
 * @returns {string|string[]|null} null means this key cannot be filled from `text`
 */
export function shapeArgValue(key, text) {
  const clean = stripInstruction(text);
  if (!clean) return null;
  switch (key) {
    case 'word': {
      const words = clean.split(/[^A-Za-z'-]+/)
        .map(w => w.replace(/^'+|'+$/g, ''))
        .filter(w => /^[A-Za-z][A-Za-z'-]{1,}$/.test(w) && !WORD_STOP.has(w.toLowerCase()));
      return words[0] || null;
    }
    case 'repo':
    case 'repoName':
      return ownerRepo(clean);
    case 'owner': {
      const packed = ownerRepo(clean);
      return packed ? packed.split('/')[0] : null;
    }
    case 'resource_type': {
      const aws = clean.match(/\b(AWS::[A-Za-z0-9:]+)\b/);
      if (aws) return aws[1];
      const skip = new Set(['aws', 'docs', 'how', 'to', 'the', 'region', 'availability', 'service', 'for', 'and', 'get', 'check', 'whether', 'an', 'is', 'in', 'a']);
      const toks = [...clean.matchAll(/\b([A-Za-z][A-Za-z0-9-]{1,40})\b/g)]
        .map(m => m[1])
        .filter(t => !skip.has(t.toLowerCase()));
      return toks.length === 1 ? toks[0] : null;
    }
    case 'city':
    case 'location': {
      const place = placeQuery(clean);
      return place || null;
    }
    case 'name': {
      const host = clean.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
      if (host && !host[1].includes('/')) return host[1].replace(/\.$/, '').toLowerCase();
      const t = clean.replace(/^(?:npm\s+(?:package|info)|package|dns(?:\s+lookup)?|mx\s+record|a\s+record|cname|ns\s+record)\s*[:.]?\s*/i, '').trim();
      if (!t || /\s/.test(t)) return null;
      if (!/^[A-Za-z0-9@][A-Za-z0-9._/-]*$/.test(t)) return null;
      if (['npm', 'dns', 'package', 'info', 'lookup'].includes(t.toLowerCase())) return null;
      return t;
    }
    case 'title': {
      const t = clean.replace(/^(?:wikipedia|wiki)\s*[:.]?\s*/i, '').trim();
      if (!t || /^(?:wikipedia|wiki|page|article)$/i.test(t)) return null;
      if (t.split(/\s+/).length > 8) return null;
      return t;
    }
    case 'coin': {
      const known = clean.match(/\b(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|cardano|ada|ripple|xrp|tether|usdt|bnb|tron|trx|ton|monero|xmr)\b/i);
      if (known) return known[1].toLowerCase();
      const one = clean.replace(/^(?:crypto|coin)\s+(?:price\s+)?/i, '').split(/\s+/)[0].replace(/[^a-z0-9-]/gi, '');
      if (one && one.length >= 2 && one.length <= 12 && !FILLER.has(one.toLowerCase()) && !['price', 'crypto', 'coin'].includes(one.toLowerCase())) return one.toLowerCase();
      return null;
    }
    case 'country': {
      let t = clean.replace(/^(?:public\s+)?holidays?(?:\s+in)?\s+/i, '');
      t = t.replace(/^(?:country|capital of|population of|iso code)\s+/i, '').trim();
      if (!t || /^(?:holiday|holidays|country)$/i.test(t)) return null;
      if (t.split(/\s+/).length > 3) return null;
      return t;
    }
    case 'from':
    case 'to': {
      if (/^[A-Za-z]{3}$/.test(clean) && FX.has(clean.toUpperCase())) return clean.toUpperCase();
      const codes = fxCodes(clean);
      if (key === 'from') return codes[0] || null;
      return codes[1] || null;
    }
    case 'ip': {
      const m = clean.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      return m ? m[0] : null;
    }
    case 'url': {
      const m = clean.match(/https?:\/\/[^\s)]+/i);
      return m ? m[0].replace(/[.,]+$/, '') : null;
    }
    case 'keywords': {
      const words = clean.split(/[^A-Za-z0-9+-]+/).filter(w => w.length > 2 && !FILLER.has(w.toLowerCase())).slice(0, 8);
      return words.length ? words : null;
    }
    case 'libraryName':
    case 'library':
    case 'slug':
    case 'section':
    case 'category': {
      const t = clean.replace(/^(?:find library|library id|library docs|library documentation)\s+/i, '').trim();
      const parts = t.split(/\s+/).filter(Boolean);
      if (!parts.length || parts.length > 4) return null;
      if (parts.length === 1 && (FILLER.has(parts[0].toLowerCase()) || ['library', 'docs', 'documentation'].includes(parts[0].toLowerCase()))) return null;
      return t;
    }
    case 'libraryId': {
      const m = clean.match(/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
      return m ? m[0] : null;
    }
    case 'code':
    case 'indexes':
    case 'operations':
    case 'requests':
    case 'repo_ids':
    case 'slugs':
    case 'latitude':
    case 'longitude':
    case 'lat':
    case 'lon':
    case 'lng':
      return null;
    default:
      return clean;
  }
}

export function missingRequiredArgs(argKeys, args, schema) {
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const k of argKeys || []) if (REQUIRED_WHEN_LISTED.has(k)) required.add(k);
  for (const k of required) {
    const v = args?.[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return true;
  }
  return false;
}

/** True when every listed key is optional, so {} is a valid call. */
export function argsMayBeEmpty(argKeys) {
  return !argKeys?.length || argKeys.every(k => OPTIONAL_ONLY.has(k));
}
