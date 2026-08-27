/* DAI chain explorer — web build.
 *
 * Mirrors the Electron explorer panel (blocks list, block detail, search by
 * address / tx hash / height) against the same public API, served same-origin
 * through nginx: /api/explorer/* proxies to the node on :3456.
 */
(function () {
  'use strict';

  var DAI = 1e9;                 // μDAI per DAI
  var API = '';                  // same origin; nginx proxies /api/ to the node
  var page = 0;
  var PAGE_SIZE = 20;

  // ── helpers ────────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function t(key, fallback) {
    try {
      if (window.daiI18n && typeof window.daiI18n.t === 'function') {
        var v = window.daiI18n.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) { /* i18n is optional here */ }
    return fallback;
  }

  function dai(n) {
    var v = Number(n || 0) / DAI;
    return (Math.abs(v) >= 1 ? v.toFixed(4) : v.toFixed(6)).replace(/\.?0+$/, '') || '0';
  }

  /* Block rewards are an object — { proposerReward, workerRewards[], totalNewSupply } —
   * not a scalar. Older blocks may still carry a plain number, so handle both. */
  function rewardTotal(r) {
    if (r == null) return 0;
    if (typeof r === 'number') return r;
    if (typeof r.totalNewSupply === 'number') return r.totalNewSupply;
    var w = Array.isArray(r.workerRewards)
      ? r.workerRewards.reduce(function (s, x) { return s + (Number(x && x.amount) || 0); }, 0)
      : 0;
    return (Number(r.proposerReward) || 0) + w;
  }

  function shortHash(h, n) {
    h = String(h || '');
    n = n || 10;
    return h.length > n * 2 ? h.slice(0, n) + '…' + h.slice(-4) : (h || '—');
  }

  function when(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  function ago(ts) {
    if (!ts) return '';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 0) return '';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function loading(el, msg) {
    el.innerHTML = '<div class="xcard p-6 text-center muted"><span class="spin"></span> ' + esc(msg || t('exp.loading', 'Loading…')) + '</div>';
  }

  function errorBox(el, msg) {
    el.innerHTML = '<div class="xcard p-6 text-center" style="color:#b91c1c">' + esc(msg) + '</div>';
  }

  function api(path) {
    return fetch(API + path, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  function showTab(which) {
    var blocks = which === 'blocks';
    $('view-blocks').style.display = blocks ? '' : 'none';
    $('view-result').style.display = blocks ? 'none' : '';
    $('tab-blocks').classList.toggle('active', blocks);
    $('tab-result').classList.toggle('active', !blocks);
  }

  // ── network summary ────────────────────────────────────────────────────────
  function loadStats() {
    // /status carries height, peers and the serving node's wallet in one call.
    api('/status').then(function (s) {
      var h = s.chainHeight != null ? s.chainHeight : s.height;
      if (h != null) $('stat-height').textContent = '#' + h;
      var p = s.peers;
      if (p != null) $('stat-peers').textContent = Array.isArray(p) ? p.length : p;
      var w = s.wallet || s.pohWallet;
      if (w) { $('stat-node').textContent = shortHash(w, 8); $('stat-node').title = w; }
    }).catch(function () {});

    // totalBalances is coin actually held by wallets — the meaningful
    // "circulating" figure. totalMinted includes coinbase dust never credited.
    api('/api/chain/supply-audit').then(function (s) {
      var v = s.totalBalances != null ? s.totalBalances : s.totalMinted;
      if (v != null) $('stat-supply').textContent = dai(v) + ' DAI';
    }).catch(function () {});
  }

  // ── blocks list ────────────────────────────────────────────────────────────
  function loadBlocks() {
    var el = $('view-blocks');
    loading(el);
    api('/api/explorer/blocks?page=' + page + '&limit=' + PAGE_SIZE).then(function (data) {
      var blocks = data.blocks || [];
      if (!blocks.length) {
        el.innerHTML = '<div class="xcard p-6 text-center muted">' + esc(t('exp.noblocks', 'No blocks yet')) + '</div>';
        return;
      }
      var rows = blocks.map(function (b) {
        var rw = rewardTotal(b.reward);
        return '' +
          '<div class="xcard xrow p-4 flex items-center justify-between gap-4 cursor-pointer" data-height="' + esc(b.height) + '">' +
            '<div class="min-w-0">' +
              '<div class="neon mono text-[18px]">#' + esc(b.height) + '</div>' +
              '<div class="muted mono text-[13px] truncate" title="' + esc(b.miner || '') + '">' + esc(shortHash(b.miner, 12)) + '</div>' +
            '</div>' +
            '<div class="text-right shrink-0">' +
              '<div class="mono text-[15px]">' + (rw > 0 ? '+' + esc(dai(rw)) + ' DAI' : '—') + '</div>' +
              '<div class="muted mono text-[13px]">' +
                esc(b.txCount || 0) + ' tx' +
                (b.jobCount ? ' · ' + esc(b.jobCount) + ' job' + (b.jobCount === 1 ? '' : 's') : '') +
                ' · ' + esc(ago(b.timestamp)) +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('');

      el.innerHTML =
        '<div class="flex flex-col gap-2">' + rows + '</div>' +
        '<div class="flex items-center justify-between mt-4">' +
          '<button id="prev" class="xtab px-4 py-2 rounded-[6px] text-[15px]"' + (page === 0 ? ' disabled style="opacity:.45;cursor:default"' : '') + '>← ' + esc(t('exp.newer', 'Newer')) + '</button>' +
          '<span class="muted mono text-[14px]">' + esc(t('exp.page', 'Page')) + ' ' + (page + 1) + '</span>' +
          '<button id="next" class="xtab px-4 py-2 rounded-[6px] text-[15px]">' + esc(t('exp.older', 'Older')) + ' →</button>' +
        '</div>';

      Array.prototype.forEach.call(el.querySelectorAll('[data-height]'), function (card) {
        card.addEventListener('click', function () { viewBlock(card.getAttribute('data-height')); });
      });
      var prev = $('prev'), next = $('next');
      if (prev && page > 0) prev.addEventListener('click', function () { page--; loadBlocks(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      if (next) next.addEventListener('click', function () { page++; loadBlocks(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }).catch(function (e) { errorBox(el, e.message); });
  }

  // ── block detail ───────────────────────────────────────────────────────────
  function viewBlock(height) {
    showTab('result');
    var el = $('view-result');
    loading(el, t('exp.loadingblock', 'Loading block…'));
    api('/api/explorer/block/' + encodeURIComponent(height)).then(function (b) {
      var txs = b.transactions || [];
      var rw = rewardTotal(b.coinbaseReward);
      var workers = (b.coinbaseReward && Array.isArray(b.coinbaseReward.workerRewards)) ? b.coinbaseReward.workerRewards : [];

      var html =
        '<div class="xcard p-5 mb-4">' +
          '<div class="flex items-baseline justify-between mb-3">' +
            '<h2 class="font-display text-[30px] neon">#' + esc(b.height) + '</h2>' +
            '<span class="badge mono">' + esc(when(b.timestamp)) + '</span>' +
          '</div>' +
          '<dl>' +
            kv(t('exp.hash', 'Hash'), '<span class="mono text-[14px]">' + esc(b.hash || '—') + '</span>') +
            kv(t('exp.prev', 'Previous'), '<span class="mono text-[14px]">' + esc(b.previousHash || '—') + '</span>') +
            kv(t('exp.miner', 'Miner'), addrLink(b.minerWallet)) +
            kv(t('exp.reward', 'Reward'), '<span class="mono neon">' + (rw > 0 ? esc(dai(rw)) + ' DAI' : '—') + '</span>') +
            kv(t('exp.difficulty', 'Difficulty'), '<span class="mono">' + esc(b.difficulty != null ? b.difficulty : '—') + '</span>') +
            kv(t('exp.txs', 'Transactions'), '<span class="mono">' + txs.length + '</span>') +
          '</dl>' +
        '</div>';

      if (workers.length) {
        html += '<h3 class="muted text-[15px] mb-2">' + esc(t('exp.workers', 'Worker rewards')) + '</h3><div class="flex flex-col gap-2 mb-4">' +
          workers.map(function (w) {
            return '<div class="xcard p-3 flex justify-between items-center gap-3">' +
              addrLink(w.workerId) +
              '<span class="mono neon text-[15px] shrink-0">+' + esc(dai(w.amount)) + ' DAI</span>' +
            '</div>';
          }).join('') + '</div>';
      }

      if (txs.length) {
        html += '<h3 class="muted text-[15px] mb-2">' + esc(t('exp.txs', 'Transactions')) + '</h3><div class="flex flex-col gap-2">' +
          txs.map(function (tx) {
            return '<div class="xcard p-3">' +
              '<div class="mono text-[13px] neon mb-1">' + esc(tx.hash || tx.txHash || '—') + '</div>' +
              '<div class="flex justify-between items-center gap-3 flex-wrap">' +
                addrLink(tx.from) +
                '<span class="mono text-[15px]">' + esc(dai(tx.amount)) + ' ' + esc(tx.currency || 'DAI') + '</span>' +
                addrLink(tx.to) +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
      }

      el.innerHTML = html;
      bindAddrLinks(el);
    }).catch(function (e) { errorBox(el, e.message); });
  }

  function kv(k, vHtml) {
    return '<div class="kv"><dt>' + esc(k) + '</dt><dd>' + vHtml + '</dd></div>';
  }

  function addrLink(a) {
    if (!a) return '<span class="muted mono text-[14px]">—</span>';
    return '<span class="xlink mono text-[14px]" data-addr="' + esc(a) + '" title="' + esc(a) + '">' + esc(shortHash(a, 12)) + '</span>';
  }

  function bindAddrLinks(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-addr]'), function (el) {
      el.addEventListener('click', function () {
        $('q').value = el.getAttribute('data-addr');
        search();
      });
    });
  }

  // ── search ─────────────────────────────────────────────────────────────────
  function search() {
    var q = ($('q').value || '').trim();
    if (!q) return;
    showTab('result');
    var el = $('view-result');
    loading(el, t('exp.searching', 'Searching…'));

    api('/api/explorer/search?q=' + encodeURIComponent(q)).then(function (d) {
      if (d.type === 'block') return viewBlock(d.block.height);

      if (d.type === 'tx') {
        var tx = d.tx, blk = d.block || {};
        el.innerHTML =
          '<div class="xcard p-5">' +
            '<h2 class="font-display text-[26px] mb-3">' + esc(t('exp.tx', 'Transaction')) + '</h2>' +
            '<dl>' +
              kv(t('exp.hash', 'Hash'), '<span class="mono text-[14px]">' + esc(tx.hash || tx.txHash || '—') + '</span>') +
              kv(t('exp.block', 'Block'), '<span class="xlink mono" data-height="' + esc(blk.height) + '">#' + esc(blk.height) + '</span>') +
              kv(t('exp.from', 'From'), addrLink(tx.from)) +
              kv(t('exp.to', 'To'), addrLink(tx.to)) +
              kv(t('exp.amount', 'Amount'), '<span class="mono neon">' + esc(dai(tx.amount)) + ' ' + esc(tx.currency || 'DAI') + '</span>') +
              kv(t('exp.time', 'Time'), '<span class="mono">' + esc(when(blk.timestamp)) + '</span>') +
            '</dl>' +
          '</div>';
        bindAddrLinks(el);
        var bl = el.querySelector('[data-height]');
        if (bl) bl.addEventListener('click', function () { viewBlock(bl.getAttribute('data-height')); });
        return;
      }

      if (d.type === 'address') {
        var entries = d.entries || [];
        var jobs = (d.jobs || []).filter(function (j) {
          return j.mined || (j.verdict && j.verdict !== 'pending' && j.verdict !== 'submitted');
        });

        var html =
          '<div class="xcard p-5 mb-4">' +
            '<div class="muted text-[14px]">' + esc(t('exp.address', 'Address')) + '</div>' +
            '<div class="mono text-[15px] mb-3" style="word-break:break-all">' + esc(d.address) + '</div>' +
            '<div class="flex items-baseline justify-between">' +
              '<span class="muted text-[15px]">' + esc(t('exp.balance', 'Balance')) + '</span>' +
              '<span class="font-display text-[34px] neon mono">' + esc(dai(d.balance)) + ' DAI</span>' +
            '</div>' +
          '</div>';

        if (jobs.length) {
          html += '<h3 class="muted text-[15px] mb-2">' + esc(t('exp.jobs', 'Completed jobs')) + '</h3><div class="flex flex-col gap-2 mb-4">' +
            jobs.slice(0, 10).map(function (j) {
              return '<div class="xcard p-3">' +
                '<div class="flex justify-between gap-3 flex-wrap">' +
                  '<span class="mono text-[14px] muted">' + esc(j.jobId || j.id || '—') + '</span>' +
                  '<span class="badge">' + esc(j.verdict || (j.mined ? 'mined' : '—')) + '</span>' +
                '</div>' +
                (j.prompt ? '<div class="text-[15px] mt-1" style="word-break:break-word">' + esc(String(j.prompt).slice(0, 160)) + '</div>' : '') +
              '</div>';
            }).join('') + '</div>';
        }

        if (entries.length) {
          html += '<h3 class="muted text-[15px] mb-2">' + esc(t('exp.recenttx', 'Recent transactions')) + '</h3><div class="xcard p-2">' +
            entries.map(function (e) {
              var pos = (e.delta || 0) > 0;
              return '<div class="kv px-2">' +
                '<dt class="mono">' + esc(e.label || '') + ' · #' + esc(e.height != null ? e.height : '?') + '</dt>' +
                '<dd class="mono" style="color:' + (pos ? '#16a34a' : '#b91c1c') + '">' + (pos ? '+' : '') + esc(dai(e.delta)) + ' DAI</dd>' +
              '</div>';
            }).join('') + '</div>';
        }

        if (!jobs.length && !entries.length) {
          html += '<div class="xcard p-5 text-center muted">' + esc(t('exp.noactivity', 'No activity recorded for this address yet.')) + '</div>';
        }

        el.innerHTML = html;
        bindAddrLinks(el);
        return;
      }

      el.innerHTML = '<div class="xcard p-6 text-center muted">' + esc(t('exp.noresults', 'No results for')) + ' "' + esc(q) + '"</div>';
    }).catch(function (e) { errorBox(el, e.message); });
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  function init() {
    $('go').addEventListener('click', search);
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    $('tab-blocks').addEventListener('click', function () { showTab('blocks'); });
    $('tab-result').addEventListener('click', function () { showTab('result'); });

    var burger = document.getElementById('hamburger');
    var drawer = document.getElementById('mobile-drawer');
    if (burger && drawer) {
      burger.addEventListener('click', function () {
        burger.classList.toggle('open');
        drawer.classList.toggle('open');
      });
    }

    // Deep link: /explorer/?q=… or #dai1234…
    var qp = new URLSearchParams(location.search).get('q') || location.hash.replace(/^#/, '');
    if (qp) { $('q').value = decodeURIComponent(qp); search(); }

    // Re-render dynamic content when the visitor switches language.
    if (window.daiI18n && window.daiI18n.onChange) {
      window.daiI18n.onChange(function () {
        if ($('view-blocks').style.display !== 'none') loadBlocks();
      });
    }

    loadStats();
    loadBlocks();
    setInterval(function () { if (page === 0 && $('view-blocks').style.display !== 'none') { loadStats(); loadBlocks(); } }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
