// Token Radar's dashboard (radar-2). It reads window.RADAR — written beside
// dashboard/ by main.ts — and renders the ranked board, a filterable table,
// and a per-protocol detail drawer carrying the model's own inputs and the
// protocol's farm plan. No network: every byte it shows arrives in data.js.
(() => {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'rank', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one place: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. The category multiple
  // and the breadth multiplier ride with the row in data.js; the page never
  // re-derives them from a hardcoded list.
  function recompute(row, tuning) {
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, raw));
    var growthMult = 1 + (growth / 100) * tuning.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? tuning.unknown_age_days : row.age_days;
    var maturity = tuning.maturity_floor + tuning.maturity_range * (Math.log1p(Math.min(Math.max(age, 0), tuning.maturity_days)) / Math.log1p(tuning.maturity_days));
    var catMult = row.category_multiple !== null && row.category_multiple !== undefined ? row.category_multiple : (D.category_multiples ? D.category_multiples.global : 0.2);
    var chains = row.chains || [];
    var breadth = row.breadth_multiplier !== null && row.breadth_multiplier !== undefined ? row.breadth_multiplier : Math.min(tuning.breadth_max, 1 + tuning.breadth_step * Math.min(Math.max(chains.length - 1, 0), 4));
    return Math.max(1, Math.round(row.tvl_usd * catMult * growthMult * maturity * breadth));
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var entry of Object.entries(attrs)) {
        var k = entry[0];
        var v = entry[1];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function mainChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  var LOW_FEE = new Set(['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'Sui', 'Aptos', 'Linea', 'Blast', 'zkSync Era', 'Mantle', 'Scroll', 'Sei', 'Near', 'Tron', 'Binance', 'Hyperliquid L1']);
  function feeText(chain) {
    if (chain === 'Ethereum') return '$8 to $15 of gas';
    if (chain === 'Bitcoin') return '$5 to $10 of gas';
    return LOW_FEE.has(chain) ? '$0.50 to $2 of gas' : '$2 to $4 of gas';
  }
  var STAKE_TIERS = [[5e9, 250], [1e9, 150], [1e8, 100]];
  function stakeSize(p) {
    for (var tier of STAKE_TIERS) if (p.tvl_usd >= tier[0]) return tier[1];
    return 50;
  }
  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function hasAny(text, words) { return words.some(function (w) { return text.indexOf(w) >= 0; }); }
  var FIRST_STEPS = [
    [function (c) { return hasAny(c, ['lend', 'cdp', 'collateral']); }, function (n, k, ch) { return 'Supply $' + k + ' of USDC to ' + n + ' on ' + ch + ' and keep the position open.'; }],
    [function (c) { return hasAny(c, ['dex']); }, function (n, k, ch) { return 'Provide $' + k + ' of liquidity to ' + n + "'s main pool on " + ch + ' and keep the position open.'; }],
    [function (c) { return hasAny(c, ['yield', 'leveraged farm', 'curator', 'allocator']); }, function (n, k, ch) { return 'Deposit $' + k + ' into a ' + n + ' vault on ' + ch + ' and keep the shares.'; }],
    [function (c) { return hasAny(c, ['bridge']); }, function (n, k, ch) { return 'Bridge $' + k + ' of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.'; }],
    [function (c) { return hasAny(c, ['staking', 'restak']); }, function (n, k, ch) { return "Stake $" + k + " of the chain's staking asset through " + n + ' and keep the receipt.'; }],
    [function (c) { return hasAny(c, ['perpetual', 'derivative']); }, function (n, k, ch) { return 'Deposit $' + k + ' of USDC as margin on ' + n + ' and open one small hedge.'; }],
    [function (c) { return hasAny(c, ['prediction']); }, function (n, k) { return 'Fund $' + k + ' and place one market position on ' + n + '.'; }],
    [function (c) { return hasAny(c, ['stable']); }, function (n, k, ch) { return 'Mint or deposit $' + k + ' of the stable asset through ' + n + ' on ' + ch + '.'; }],
    [function (c) { return hasAny(c, ['rwa']); }, function (n, k, ch) { return "Mint $" + k + " of the protocol's yield asset on " + ch + ' and hold it.'; }],
    [function (c) { return hasAny(c, ['insurance']); }, function (n, k, ch) { return 'Buy $' + k + ' of cover from ' + n + ' on ' + ch + ' and keep the policy.'; }]
  ];
  function firstStep(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var pair of FIRST_STEPS) if (pair[0](c)) return pair[1](p.name, capital, chain);
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  var SECOND_STEPS = [
    [function (c) { return hasAny(c, ['lend', 'cdp', 'collateral']); }, function (n, k) { return 'Borrow $' + k + ' against the supply on ' + n + ', then repay it within a week to record a borrow event.'; }],
    [function (c) { return hasAny(c, ['dex']); }, function (n, k, ch) { return 'Swap $' + k + ' through ' + n + ' on ' + ch + ' so the wallet records both a swap and a liquidity position.'; }],
    [function (c) { return hasAny(c, ['bridge']); }, function (n) { return 'Use the bridged funds for one swap or deposit on the destination chain, so the bridge is not a dead end.'; }],
    [function (c) { return hasAny(c, ['staking', 'restak']); }, function (n) { return 'Delegate a second small amount through ' + n + ' and keep both receipts.'; }],
    [function (c) { return hasAny(c, ['perpetual', 'derivative']); }, function (n) { return 'Open a second small hedge in the opposite direction on ' + n + ', then close it, to record two-way activity.'; }],
    [function (c) { return hasAny(c, ['prediction']); }, function (n) { return 'Place a second small position on a different market on ' + n + '.'; }],
    [function (c) { return hasAny(c, ['curator', 'allocator']); }, function (n) { return 'Claim the vault rewards on ' + n + ' once, then re-deposit the claim so the position compounds.'; }],
    [function (c) { return hasAny(c, ['yield', 'leveraged farm']); }, function (n) { return 'Harvest the yield on ' + n + ' once, then re-deposit the harvest so the position compounds.'; }],
    [function (c) { return hasAny(c, ['stable']); }, function (n) { return 'Hold the minted stable asset for a week, then swap a small part back to test the exit.'; }],
    [function (c) { return hasAny(c, ['rwa']); }, function (n, k, ch) { return 'Reinvest one distribution from the yield asset back into ' + n + ' on ' + ch + '.'; }],
    [function (c) { return hasAny(c, ['insurance']); }, function (n) { return 'Open the policy page on ' + n + ' and confirm the cover is active before the hold ends.'; }]
  ];
  function secondStep(p, small, chain) {
    var c = (p.category || '').toLowerCase();
    for (var pair of SECOND_STEPS) if (pair[0](c)) return pair[1](p.name, small, chain);
    return 'Do a second small deposit or swap on ' + p.name + ' on ' + chain + ' in a different week.';
  }
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planFor(p) {
    var chain = mainChain(p);
    var capital = stakeSize(p);
    var small = capital >= 100 ? 25 : 10;
    var hold = holdDays(p.age_days);
    var gas = feeText(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: firstStep(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondStep(p, small, chain), cost: '$' + small + ' of capital and ' + gas, time: '20 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(renderStep);
  }

  function loadHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }
  function saveHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && (!r.chains || r.chains.indexOf(view.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function orderedRows(list) {
    var key = view.sort;
    // Rank runs the other way: strongest first is rank 1 first, so the rank
    // key sorts ascending while every value key sorts descending at the same dir.
    var d = key === 'rank' ? -view.dir : view.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -d;
      if (av > bv) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' }), h('span', { class: 'pill', text: D.model_version + ' model' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + D.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: D.board_size + ' pre-token rows' })
      )
    );
  }

  function intro() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: D.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(D.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + D.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: D.watchlist_size + ' / ' + D.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(D.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(D.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(D.live_size) }))
      )
    );
  }

  function modelStrip() {
    var tuning = D.model;
    var g = D.category_multiples ? D.category_multiples.global : null;
    return h('section', { class: 'formula-strip' },
      h('span', { class: 'formula-label', text: 'Model' }),
      h('code', { text: 'implied = round( TVL x category multiple x (1 + clamp(7d, ' + tuning.growth_floor + ', ' + tuning.growth_cap + ') / 100 x ' + tuning.growth_weight + ') x (' + tuning.maturity_floor + ' + ' + tuning.maturity_range + ' x log1p(min(age, ' + tuning.maturity_days + ')) / log1p(' + tuning.maturity_days + ')) x breadth )' }),
      h('span', { class: 'sub', text: g === null ? '' : 'Global median multiple ' + g })
    );
  }

  function chainList() {
    var counts = {};
    D.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 15);
  }

  function filterBar() {
    var categories = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = chainList();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; saveHash(); paint(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; saveHash(); paint(); });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; saveHash(); paint(); });
    var pre = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var live = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : D.live.length + ' live-token protocols' })
    );
  }

  function sortCell(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardView() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; saveHash(); paint(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = h('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      },
        h('td', { class: 'num rank', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageText(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortCell('rank', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveView() {
    var tbody = h('tbody');
    D.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status live-status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelNote() {
    var tuning = D.model;
    var comps = D.category_multiples;
    var multiplesText = '';
    if (comps) {
      var parts = Object.keys(comps.by_category).sort(function (a, b) { return comps.by_category[b] - comps.by_category[a]; }).map(function (c) { return c + ' ' + comps.by_category[c].toFixed(4); });
      multiplesText = 'Category multiples (median mcap / TVL of live-token protocols, at least 3 per category): ' + parts.join('  ·  ') + '. Global median ' + comps.global.toFixed(4) + ' is used for every other category.';
    }
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + tuning.growth_floor + ', ' + tuning.growth_cap + ') / 100 x ' + tuning.growth_weight + ') x (' + tuning.maturity_floor + ' + ' + tuning.maturity_range + ' x log1p(min(age_days, ' + tuning.maturity_days + ')) / log1p(' + tuning.maturity_days + ')) x (1 + ' + tuning.breadth_step + ' x min(chains - 1, 4)) )'
      ),
      h('p', { class: 'sub', text: multiplesText }),
      h('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + tuning.unknown_age_days + ' days. Breadth rewards protocols live on more than one chain, capped at 1.16. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      h('p', { class: 'warn', text: 'Implied value is this model\u2019s claim about what a token would be worth if the protocol\u2019s record stayed as it is. It is not a prediction that a token will be issued, when it will be issued, or what it will trade at.' })
    );
  }

  var dlg = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dlg.addEventListener('close', function () { view.selected = null; saveHash(); });

  function showDetail(slug) {
    var row = D.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    saveHash();
    dlg.textContent = '';
    var steps = planFor(row);
    var comps = D.category_multiples;
    var fallback = comps && row.category && !Object.prototype.hasOwnProperty.call(comps.by_category, row.category);
    var base = row.base_usd !== null && row.base_usd !== undefined ? row.base_usd : Math.round(row.tvl_usd * (row.category_multiple || 0));
    dlg.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + D.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dlg.close(); } })
    ));
    dlg.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Category multiple' }), h('b', { class: 'num', text: String(row.category_multiple) + (fallback ? ' (global median)' : '') })),
        h('div', null, h('span', { text: 'Base value (TVL x multiple)' }), h('b', { class: 'num', text: money(base) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageText(row.age_days) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
        h('div', null, h('span', { text: 'Chains (' + (row.chains || []).length + ')' }), h('b', { class: 'num', text: String(row.breadth_multiplier) + ' breadth' })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      h('p', { class: 'sub', text: 'Model ' + D.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recompute(row, D.model)) + (recompute(row, D.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dlg.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }

  function paint() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    shell.appendChild(modelStrip());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardView() : liveView());
    if (view.tab === 'pre-token') shell.appendChild(modelNote());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dlg.isConnected) mount.appendChild(dlg);
    if (view.selected) showDetail(view.selected);
  }

  loadHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dlg.open) dlg.close();
  });
})();
