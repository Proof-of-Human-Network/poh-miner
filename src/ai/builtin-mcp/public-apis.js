/**
 * Builtin "public-apis" pack — 22 no-auth read tools.
 *
 * Spec is the dantrapp/mcp-public-apis list; runtime is native fetch so every
 * miner has the skillset without spawning `npx mcp-public-apis`.
 */

import { fetchJson, compact, num, str, UA } from './fetch.js';

const GEO_HEADERS = { 'User-Agent': UA, Accept: 'application/json' };

/** Blind MCP calls pass the whole user sentence as city/query. Nominatim returns
 *  [] for "weather in sao paulo" but finds the city once the fluff is stripped. */
export function normalizePlaceQuery(query) {
  let q = str(query);
  if (!q) return '';
  q = q.replace(/[?!.,]+$/g, '').trim();
  q = q.replace(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:tell me\s+|give me\s+|show(?:\s+me)?\s+|get\s+)?(?:what(?:'s|s| is)\s+|how(?:'s|s| is)\s+)?(?:the\s+)?(?:current\s+)?(?:weather|forecast|temperature|temps?)\s+(?:like\s+)?(?:(?:right now|today|tomorrow|yesterday|this week|next week)\s+)?(?:in|for|at|of)\s+/i, '');
  q = q.replace(/^(?:the\s+)?(?:current\s+)?(?:weather|forecast|temperature|temps?)\s+/i, '');
  q = q.replace(/\s+(?:weather|forecast|temperature|temps?|right now|today|tomorrow)$/i, '');
  return q.trim();
}

async function geoNominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const data = await fetchJson(url, { headers: GEO_HEADERS });
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  return { lat: num(hit.lat), lon: num(hit.lon), name: hit.display_name };
}

async function geoOpenMeteo(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`;
  const data = await fetchJson(url);
  const hit = Array.isArray(data?.results) ? data.results[0] : null;
  if (!hit) return null;
  const name = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
  return { lat: num(hit.latitude), lon: num(hit.longitude), name };
}

async function geoForward(query) {
  const raw = str(query);
  const cleaned = normalizePlaceQuery(raw) || raw;
  if (!cleaned) return null;
  const tries = cleaned === raw ? [cleaned] : [cleaned, raw];
  for (const q of tries) {
    try {
      const g = await geoNominatim(q);
      if (g) return g;
    } catch { /* Nominatim rate-limits; Open-Meteo is the fallback */ }
    try {
      const g = await geoOpenMeteo(q);
      if (g) return g;
    } catch { /* next candidate */ }
  }
  return null;
}

function card(partial) {
  return {
    mcpId: 'public-apis',
    auth: 'none',
    ...partial,
  };
}

export const PUBLIC_APIS_CARDS = [
  card({ id: 'public-apis/weather', tool: 'public_weather_forecast', summary: '7-day forecast from city name or lat/lon (Open-Meteo)', tags: ['weather', 'forecast'], triggers: ['weather', 'forecast', 'temperature', 'celsius', 'fahrenheit', 'will it rain', 'jacket'] }),
  card({ id: 'public-apis/crypto-price', tool: 'public_crypto_price', summary: 'Current cryptocurrency price (CoinGecko)', tags: ['crypto', 'price'], triggers: ['bitcoin', 'btc', 'eth', 'ethereum', 'crypto price', 'coin price'] }),
  card({ id: 'public-apis/crypto-search', tool: 'public_crypto_search', summary: 'Search CoinGecko coins by name or symbol', tags: ['crypto', 'search'], triggers: ['crypto search', 'coin search', 'token search'] }),
  card({ id: 'public-apis/forex', tool: 'public_forex_rates', summary: 'FX rates from Frankfurter (ECB)', tags: ['forex', 'fx', 'currency'], triggers: ['forex', 'exchange rate', 'usd to', 'eur to', 'fx rate'] }),
  card({ id: 'public-apis/geo', tool: 'public_geo_lookup', summary: 'Place name → lat/lon (Nominatim/OSM)', tags: ['geo', 'map', 'travel'], triggers: ['where is', 'coordinates', 'lat lon', 'geocode', 'places to visit', 'best places', 'visit in', 'attractions', 'sightseeing'] }),
  card({ id: 'public-apis/geo-reverse', tool: 'public_geo_reverse', summary: 'Lat/lon → place name (Nominatim/OSM)', tags: ['geo', 'map'], triggers: ['reverse geocode', 'what city'] }),
  card({ id: 'public-apis/country', tool: 'public_country_info', summary: 'Country facts from REST Countries', tags: ['country'], triggers: ['country', 'capital of', 'population of', 'iso code'] }),
  card({ id: 'public-apis/hackernews', tool: 'public_hackernews_top', summary: 'Top Hacker News stories', tags: ['news', 'hn'], triggers: ['hacker news', 'hackernews', 'hn top'] }),
  card({ id: 'public-apis/ip', tool: 'public_ip_lookup', summary: 'IP geolocation via ipapi.co', tags: ['ip', 'geo'], triggers: ['ip lookup', 'ip address', 'whois ip', 'my ip'] }),
  card({ id: 'public-apis/nasa', tool: 'public_nasa_apod', summary: 'NASA Astronomy Picture of the Day', tags: ['nasa', 'space'], triggers: ['nasa', 'apod', 'astronomy picture'] }),
  card({ id: 'public-apis/sun', tool: 'public_sun_times', summary: 'Sunrise/sunset times (Sunrise-Sunset.org)', tags: ['sun', 'sunrise'], triggers: ['sunrise', 'sunset', 'dawn', 'dusk'] }),
  card({ id: 'public-apis/earthquakes', tool: 'public_earthquakes_recent', summary: 'Recent earthquakes (USGS)', tags: ['earthquake'], triggers: ['earthquake', 'quakes', 'seismic'] }),
  card({ id: 'public-apis/holidays', tool: 'public_holidays', summary: 'Public holidays (Nager.Date)', tags: ['holiday'], triggers: ['holiday', 'public holiday', 'bank holiday'] }),
  card({ id: 'public-apis/dictionary', tool: 'public_dictionary_lookup', summary: 'English dictionary (Free Dictionary)', tags: ['dictionary'], triggers: ['define', 'definition', 'meaning of', 'dictionary'] }),
  card({ id: 'public-apis/wikipedia', tool: 'public_wikipedia_summary', summary: 'Wikipedia page summary', tags: ['wikipedia'], triggers: ['wikipedia', 'wiki'] }),
  card({ id: 'public-apis/npm', tool: 'public_npm_package', summary: 'npm package metadata', tags: ['npm', 'js'], triggers: ['npm package', 'npm info'] }),
  card({ id: 'public-apis/github', tool: 'public_github_repo', summary: 'GitHub repository metadata', tags: ['github'], triggers: ['github repo', 'github repository'] }),
  card({ id: 'public-apis/dns', tool: 'public_dns_lookup', summary: 'DNS lookup via Google DNS', tags: ['dns'], triggers: ['dns', 'dns lookup', 'mx record', 'a record'] }),
  card({ id: 'public-apis/qrcode', tool: 'public_qrcode_generate', summary: 'QR code image URL (goqr.me)', tags: ['qr'], triggers: ['qr code', 'qrcode'] }),
  card({ id: 'public-apis/meal', tool: 'public_meal_search', summary: 'Recipe search (TheMealDB)', tags: ['food', 'recipe'], triggers: ['recipe', 'meal', 'cook'] }),
  card({ id: 'public-apis/brewery', tool: 'public_brewery_search', summary: 'Brewery search (Open Brewery DB)', tags: ['brewery', 'beer'], triggers: ['brewery', 'breweries', 'beer'] }),
  card({ id: 'public-apis/book', tool: 'public_book_search', summary: 'Book search (Open Library)', tags: ['book'], triggers: ['book', 'isbn', 'open library'] }),
];

function schema(properties, required = []) {
  return { type: 'object', properties, required };
}

export const PUBLIC_APIS_TOOLS = [
  {
    name: 'public_weather_forecast',
    description: '7-day weather forecast. Pass city (or lat+lon). Open-Meteo, no API key.',
    inputSchema: schema({
      city: { type: 'string', description: 'City or place name' },
      query: { type: 'string', description: 'Alias for city' },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
    }),
    cardId: 'public-apis/weather',
    async run(args) {
      let lat = num(args.latitude ?? args.lat);
      let lon = num(args.longitude ?? args.lon ?? args.lng);
      let place = str(args.city || args.query || args.location);
      if ((lat == null || lon == null) && place) {
        const g = await geoForward(place);
        if (!g) throw new Error(`could not geocode "${place}"`);
        lat = g.lat; lon = g.lon; place = g.name;
      }
      if (lat == null || lon == null) throw new Error('city or latitude+longitude required');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const data = await fetchJson(url);
      return compact({ place, latitude: lat, longitude: lon, ...data });
    },
  },
  {
    name: 'public_crypto_price',
    description: 'Current price of a cryptocurrency via CoinGecko. Pass coin id (bitcoin) or symbol (btc).',
    inputSchema: schema({
      coin: { type: 'string', description: 'CoinGecko id or symbol, e.g. bitcoin / btc' },
      query: { type: 'string' },
      vs: { type: 'string', description: 'Quote currency, default usd' },
    }),
    cardId: 'public-apis/crypto-price',
    async run(args) {
      let id = str(args.coin || args.id || args.query).toLowerCase();
      if (!id) throw new Error('coin required');
      const vs = (str(args.vs) || 'usd').toLowerCase();
      // Resolve symbol → id when needed
      if (!id.includes(' ') && id.length <= 6) {
        try {
          const search = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(id)}`);
          const hit = (search.coins || []).find(c =>
            c.id === id || String(c.symbol).toLowerCase() === id || String(c.name).toLowerCase() === id
          ) || (search.coins || [])[0];
          if (hit?.id) id = hit.id;
        } catch { /* use raw id */ }
      }
      const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`);
      return compact({ coin: id, vs, price: data });
    },
  },
  {
    name: 'public_crypto_search',
    description: 'Search CoinGecko coins by name or symbol.',
    inputSchema: schema({ query: { type: 'string' }, q: { type: 'string' } }),
    cardId: 'public-apis/crypto-search',
    async run(args) {
      const q = str(args.query || args.q || args.coin);
      if (!q) throw new Error('query required');
      const data = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
      const coins = (data.coins || []).slice(0, 8).map(c => ({ id: c.id, name: c.name, symbol: c.symbol, rank: c.market_cap_rank }));
      return compact({ query: q, coins });
    },
  },
  {
    name: 'public_forex_rates',
    description: 'Foreign-exchange rates from Frankfurter (ECB).',
    inputSchema: schema({
      from: { type: 'string', description: 'Base currency, default USD' },
      to: { type: 'string', description: 'Quote currency, or comma-separated list' },
      amount: { type: 'number' },
    }),
    cardId: 'public-apis/forex',
    async run(args) {
      const from = (str(args.from || args.base) || 'USD').toUpperCase();
      const to = str(args.to || args.quote).toUpperCase();
      const amount = num(args.amount, 1);
      const u = new URL('https://api.frankfurter.app/latest');
      u.searchParams.set('from', from);
      if (to) u.searchParams.set('to', to);
      if (amount && amount !== 1) u.searchParams.set('amount', String(amount));
      return compact(await fetchJson(u.toString()));
    },
  },
  {
    name: 'public_geo_lookup',
    description: 'Forward geocode a place name to lat/lon via OpenStreetMap Nominatim.',
    inputSchema: schema({ query: { type: 'string' }, city: { type: 'string' }, q: { type: 'string' } }),
    cardId: 'public-apis/geo',
    async run(args) {
      const raw = str(args.query || args.city || args.q || args.location);
      const q = normalizePlaceQuery(raw) || raw;
      if (!q) throw new Error('query required');
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
      const data = await fetchJson(url, { headers: GEO_HEADERS });
      const hits = (Array.isArray(data) ? data : []).map(h => ({
        name: h.display_name, lat: num(h.lat), lon: num(h.lon), type: h.type,
      }));
      return compact({ query: q, hits });
    },
  },
  {
    name: 'public_geo_reverse',
    description: 'Reverse geocode lat/lon to a place name via Nominatim.',
    inputSchema: schema({ latitude: { type: 'number' }, longitude: { type: 'number' } }),
    cardId: 'public-apis/geo-reverse',
    async run(args) {
      const lat = num(args.latitude ?? args.lat);
      const lon = num(args.longitude ?? args.lon ?? args.lng);
      if (lat == null || lon == null) throw new Error('latitude and longitude required');
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
      return compact(await fetchJson(url, { headers: GEO_HEADERS }));
    },
  },
  {
    name: 'public_country_info',
    description: 'Country information from REST Countries.',
    inputSchema: schema({ country: { type: 'string' }, query: { type: 'string' } }),
    cardId: 'public-apis/country',
    async run(args) {
      const q = str(args.country || args.query || args.name);
      if (!q) throw new Error('country required');
      const data = await fetchJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(q)}?fields=name,capital,region,subregion,population,currencies,languages,cca2,cca3,area`);
      return compact(Array.isArray(data) ? data.slice(0, 3) : data);
    },
  },
  {
    name: 'public_hackernews_top',
    description: 'Top stories from Hacker News.',
    inputSchema: schema({ limit: { type: 'number', description: 'How many stories, default 8, max 20' } }),
    cardId: 'public-apis/hackernews',
    async run(args) {
      const limit = Math.min(20, Math.max(1, num(args.limit, 8)));
      const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
      const slice = (Array.isArray(ids) ? ids : []).slice(0, limit);
      const stories = [];
      for (const id of slice) {
        try {
          const s = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          stories.push({ id, title: s.title, url: s.url, score: s.score, by: s.by });
        } catch { /* skip one */ }
      }
      return compact({ stories });
    },
  },
  {
    name: 'public_ip_lookup',
    description: 'Look up an IP address (or the node exit IP if omitted) via ipapi.co.',
    inputSchema: schema({ ip: { type: 'string' } }),
    cardId: 'public-apis/ip',
    async run(args) {
      const ip = str(args.ip || args.query);
      const url = ip ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : 'https://ipapi.co/json/';
      return compact(await fetchJson(url));
    },
  },
  {
    name: 'public_nasa_apod',
    description: 'NASA Astronomy Picture of the Day. Optional date YYYY-MM-DD.',
    inputSchema: schema({ date: { type: 'string' } }),
    cardId: 'public-apis/nasa',
    async run(args) {
      const date = str(args.date);
      const u = new URL('https://api.nasa.gov/planetary/apod');
      u.searchParams.set('api_key', 'DEMO_KEY');
      if (date) u.searchParams.set('date', date);
      return compact(await fetchJson(u.toString()));
    },
  },
  {
    name: 'public_sun_times',
    description: 'Sunrise and sunset times for a city or lat/lon.',
    inputSchema: schema({
      city: { type: 'string' },
      query: { type: 'string' },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
    }),
    cardId: 'public-apis/sun',
    async run(args) {
      let lat = num(args.latitude ?? args.lat);
      let lon = num(args.longitude ?? args.lon);
      const place = str(args.city || args.query);
      if ((lat == null || lon == null) && place) {
        const g = await geoForward(place);
        if (!g) throw new Error(`could not geocode "${place}"`);
        lat = g.lat; lon = g.lon;
      }
      if (lat == null || lon == null) throw new Error('city or latitude+longitude required');
      const data = await fetchJson(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`);
      return compact({ latitude: lat, longitude: lon, place, ...data });
    },
  },
  {
    name: 'public_earthquakes_recent',
    description: 'Recent earthquakes from USGS.',
    inputSchema: schema({
      limit: { type: 'number' },
      minMagnitude: { type: 'number' },
    }),
    cardId: 'public-apis/earthquakes',
    async run(args) {
      const limit = Math.min(20, Math.max(1, num(args.limit, 8)));
      const min = num(args.minMagnitude ?? args.min_magnitude, 4);
      const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`;
      const data = await fetchJson(url);
      const feats = (data.features || [])
        .filter(f => (f.properties?.mag ?? 0) >= min)
        .slice(0, limit)
        .map(f => ({
          mag: f.properties.mag,
          place: f.properties.place,
          time: f.properties.time,
          url: f.properties.url,
        }));
      return compact({ minMagnitude: min, earthquakes: feats });
    },
  },
  {
    name: 'public_holidays',
    description: 'Public holidays for a country (ISO 3166-1 alpha-2) and year. Nager.Date.',
    inputSchema: schema({
      country: { type: 'string', description: 'ISO country code, e.g. US, GE, DE' },
      year: { type: 'number' },
    }),
    cardId: 'public-apis/holidays',
    async run(args) {
      const country = (str(args.country || args.code) || 'US').toUpperCase();
      const year = num(args.year, new Date().getUTCFullYear());
      const data = await fetchJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(country)}`);
      return compact({ country, year, holidays: data });
    },
  },
  {
    name: 'public_dictionary_lookup',
    description: 'Look up an English word in the Free Dictionary.',
    inputSchema: schema({ word: { type: 'string' }, query: { type: 'string' } }),
    cardId: 'public-apis/dictionary',
    async run(args) {
      const word = str(args.word || args.query);
      if (!word) throw new Error('word required');
      const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const entry = Array.isArray(data) ? data[0] : data;
      const meanings = (entry.meanings || []).slice(0, 4).map(m => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions || []).slice(0, 3).map(d => d.definition),
      }));
      return compact({ word: entry.word || word, phonetic: entry.phonetic, meanings });
    },
  },
  {
    name: 'public_wikipedia_summary',
    description: 'Wikipedia REST summary for a title.',
    inputSchema: schema({ title: { type: 'string' }, query: { type: 'string' } }),
    cardId: 'public-apis/wikipedia',
    async run(args) {
      const title = str(args.title || args.query);
      if (!title) throw new Error('title required');
      const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      return compact({
        title: data.title,
        description: data.description,
        extract: data.extract,
        url: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page,
      });
    },
  },
  {
    name: 'public_npm_package',
    description: 'npm registry metadata for a package.',
    inputSchema: schema({ name: { type: 'string' }, query: { type: 'string' } }),
    cardId: 'public-apis/npm',
    async run(args) {
      const name = str(args.name || args.package || args.query);
      if (!name) throw new Error('package name required');
      const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
      const latest = data['dist-tags']?.latest;
      return compact({
        name: data.name,
        description: data.description,
        latest,
        homepage: data.homepage,
        license: data.license,
        weekly: data,
        versions: latest,
      });
    },
  },
  {
    name: 'public_github_repo',
    description: 'GitHub repository metadata. Pass "owner/repo" or owner + repo.',
    inputSchema: schema({
      repo: { type: 'string', description: 'owner/repo' },
      owner: { type: 'string' },
      name: { type: 'string' },
      query: { type: 'string' },
    }),
    cardId: 'public-apis/github',
    async run(args) {
      let owner = str(args.owner);
      let name = str(args.name || args.repo);
      const q = str(args.repo || args.query);
      if (q.includes('/')) {
        const [o, n] = q.replace(/^https?:\/\/github.com\//, '').split('/');
        owner = owner || o;
        name = n || name;
      }
      if (!owner || !name) throw new Error('owner/repo required');
      const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      return compact({
        full_name: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        language: data.language,
        html_url: data.html_url,
        updated_at: data.updated_at,
        license: data.license?.spdx_id,
      });
    },
  },
  {
    name: 'public_dns_lookup',
    description: 'DNS lookup via Google DNS-over-HTTPS.',
    inputSchema: schema({
      name: { type: 'string' },
      type: { type: 'string', description: 'A, AAAA, MX, TXT, CNAME, NS. Default A' },
      query: { type: 'string' },
    }),
    cardId: 'public-apis/dns',
    async run(args) {
      const name = str(args.name || args.query || args.host);
      if (!name) throw new Error('name required');
      const type = str(args.type) || 'A';
      const data = await fetchJson(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`);
      return compact({ name, type, Status: data.Status, Answer: data.Answer });
    },
  },
  {
    name: 'public_qrcode_generate',
    description: 'Return a QR-code image URL for the given text.',
    inputSchema: schema({ text: { type: 'string' }, query: { type: 'string' } }),
    cardId: 'public-apis/qrcode',
    async run(args) {
      const text = str(args.text || args.query || args.data);
      if (!text) throw new Error('text required');
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
      return compact({ text, imageUrl: url });
    },
  },
  {
    name: 'public_meal_search',
    description: 'Search recipes on TheMealDB.',
    inputSchema: schema({ query: { type: 'string' }, q: { type: 'string' } }),
    cardId: 'public-apis/meal',
    async run(args) {
      const q = str(args.query || args.q || args.name);
      if (!q) throw new Error('query required');
      const data = await fetchJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`);
      const meals = (data.meals || []).slice(0, 5).map(m => ({
        id: m.idMeal, name: m.strMeal, area: m.strArea, category: m.strCategory,
        instructions: String(m.strInstructions || '').slice(0, 800),
        source: m.strSource, youtube: m.strYoutube,
      }));
      return compact({ query: q, meals });
    },
  },
  {
    name: 'public_brewery_search',
    description: 'Search breweries via Open Brewery DB.',
    inputSchema: schema({ query: { type: 'string' }, city: { type: 'string' } }),
    cardId: 'public-apis/brewery',
    async run(args) {
      const q = str(args.query || args.q || args.name);
      const city = str(args.city);
      const u = new URL('https://api.openbrewerydb.org/v1/breweries');
      if (q) u.searchParams.set('by_name', q);
      if (city) u.searchParams.set('by_city', city);
      u.searchParams.set('per_page', '8');
      const data = await fetchJson(u.toString());
      const rows = (Array.isArray(data) ? data : []).map(b => ({
        name: b.name, city: b.city, state: b.state, country: b.country,
        brewery_type: b.brewery_type, website: b.website_url,
      }));
      return compact({ query: q || city, breweries: rows });
    },
  },
  {
    name: 'public_book_search',
    description: 'Search books on Open Library.',
    inputSchema: schema({ query: { type: 'string' }, isbn: { type: 'string' } }),
    cardId: 'public-apis/book',
    async run(args) {
      const isbn = str(args.isbn);
      const q = str(args.query || args.q || args.title);
      if (isbn) {
        const data = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
        return compact({ isbn, title: data.title, publishers: data.publishers, publish_date: data.publish_date });
      }
      if (!q) throw new Error('query or isbn required');
      const data = await fetchJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5`);
      const docs = (data.docs || []).slice(0, 5).map(d => ({
        title: d.title, author: (d.author_name || [])[0], year: d.first_publish_year,
        isbn: (d.isbn || [])[0], key: d.key,
      }));
      return compact({ query: q, numFound: data.numFound, docs });
    },
  },
];

export const PUBLIC_APIS_PACK = {
  id: 'public-apis',
  name: 'Public APIs',
  summary: '22 no-auth public data tools shipped with every node (weather, FX, wiki, …).',
  tools: PUBLIC_APIS_TOOLS,
  cards: PUBLIC_APIS_CARDS,
};
