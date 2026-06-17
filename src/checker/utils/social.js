'use strict';

const axios = require('axios');

const FARCASTER_API = 'https://api.farcaster.xyz';
const FARCASTER_HUB = 'https://hub.pinata.cloud/v1';
const PARAGRAPH_API = 'https://public.api.paragraph.com/api/v1';

// ── Farcaster ─────────────────────────────────────────────────────────────────

async function _farcasterUserByAddress(address) {
  try {
    const r = await axios.get(`${FARCASTER_API}/v2/user-by-verification`, {
      params: { address: address.toLowerCase() },
      timeout: 8000,
    });
    return r.data?.result?.user || null;
  } catch { return null; }
}

async function _hubUserData(fid) {
  try {
    const r = await axios.get(`${FARCASTER_HUB}/userDataByFid`, {
      params: { fid },
      timeout: 8000,
    });
    const out = {};
    for (const m of (r.data?.messages || [])) {
      const b = m.data?.userDataBody;
      if (b?.type && b?.value !== undefined) out[b.type] = b.value;
    }
    return out;
  } catch { return {}; }
}

async function _hubCasts(fid, limit = 12) {
  try {
    const r = await axios.get(`${FARCASTER_HUB}/castsByFid`, {
      params: { fid, pageSize: limit, reverse: 1 },
      timeout: 10000,
    });
    return r.data?.messages || [];
  } catch { return []; }
}

async function _hubFollowing(fid) {
  try {
    const r = await axios.get(`${FARCASTER_HUB}/linksByFid`, {
      params: { fid, link_type: 'follow', pageSize: 8 },
      timeout: 8000,
    });
    return (r.data?.messages || [])
      .map(m => String(m.data?.linkBody?.targetFid))
      .filter(f => f && f !== 'undefined');
  } catch { return []; }
}

/**
 * Fetch Farcaster social data for an EVM address.
 * Returns null if the address has no Farcaster account.
 */
async function getFarcasterData(address) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;

  const user = await _farcasterUserByAddress(address);
  if (!user?.fid) return null;

  const fid = user.fid;

  const [rawCasts, following, userData] = await Promise.all([
    _hubCasts(fid),
    _hubFollowing(fid),
    _hubUserData(fid),
  ]);

  const casts = rawCasts.slice(0, 12).map(c => {
    const body = c.data?.castAddBody;
    const text = body?.text || c.text || '';
    const ts   = c.data?.timestamp || c.timestamp || null;
    return { text, likes: 0, replies: 0, recasts: 0, ts };
  }).filter(c => c.text.length > 2);

  return {
    fid,
    username:       userData['USER_DATA_TYPE_USERNAME'] || user.username         || '',
    displayName:    userData['USER_DATA_TYPE_DISPLAY']  || user.displayName      || user.username || '',
    bio:            userData['USER_DATA_TYPE_BIO']      || user.profile?.bio?.text || '',
    followerCount:  user.followerCount  || 0,
    followingCount: user.followingCount || 0,
    casts,
    following,
  };
}

// ── Paragraph ─────────────────────────────────────────────────────────────────

async function _paragraphSearch(q) {
  try {
    const r = await axios.get(`${PARAGRAPH_API}/discover/blogs/search`, {
      params: { q },
      timeout: 8000,
    });
    return Array.isArray(r.data) ? r.data : (r.data?.blogs || r.data?.data || []);
  } catch { return []; }
}

async function _paragraphPosts(slug) {
  try {
    const r = await axios.get(`${PARAGRAPH_API}/publications/${slug}/posts`, {
      params: { limit: 6 },
      timeout: 8000,
    });
    const list = Array.isArray(r.data) ? r.data : (r.data?.posts || []);
    return list.slice(0, 6).map(p => ({
      title:       p.title       || '',
      subtitle:    p.subtitle    || '',
      publishedAt: p.publishedAt || p.created_at || '',
    }));
  } catch { return []; }
}

/**
 * Fetch Paragraph blog data for an EVM address.
 * Returns null if the address has no Paragraph blog.
 */
async function getParagraphData(address) {
  if (!address) return null;
  const addr = address.toLowerCase();

  const results = await _paragraphSearch(addr);
  if (!results.length) return null;

  // Prefer exact wallet-address match, fall back to first result
  const match = results.find(r => (r.user?.walletAddress || '').toLowerCase() === addr)
    || results[0];
  if (!match) return null;

  const blog = match.blog || match;
  const slug = blog.slug || blog.url;
  const posts = slug ? await _paragraphPosts(slug) : [];

  return {
    blogId:          blog.blogId         || blog.id    || null,
    title:           blog.name           || blog.title || '',
    description:     blog.summary        || blog.description || '',
    subscriberCount: match.activeSubscriberCount || blog.subscriberCount || 0,
    postCount:       blog.postCount      || posts.length,
    posts,
  };
}

module.exports = { getFarcasterData, getParagraphData };
