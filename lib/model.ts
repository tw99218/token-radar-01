// Token Radar's scoring model, radar-2.
//
// One sealed snapshot goes in, one ranked board comes out. The board always
// covers the snapshot's watchlist first — that list is the floor, never the
// ceiling — and then adds the strongest pre-token protocols below the floor,
// by TVL, which is the early radar the page exists to show. Protocols whose
// token already trades are kept apart and shown with the market's own numbers,
// never mixed into the ranking.
//
// A protocol counts as pre-token when its record carries no token at all: no
// market cap, no CoinGecko id, no symbol. Nothing here names a protocol, so
// the same code scores any snapshot the same way:
//
//   multiple   = median(mcap / tvl) across the live-token protocols of the
//                protocol's own category, when that category has at least
//                three such comps; otherwise the median across every live
//                protocol. Clamped to [0.05, 2.0].
//   base       = tvl_usd x multiple
//   growth     = the 7-day TVL move, clamped to [-80, 150] per cent
//   growth x   = 1 + growth / 100 x 0.65
//   maturity   = 0.70 + 0.30 x log1p(min(age, 1095)) / log1p(1095)
//                (a protocol with no listing date is scored as 365 days old)
//   breadth    = 1 + 0.04 per chain past the first, at most 1.16
//   implied    = max(1, round(base x growth x maturity x breadth))

/** One protocol record: the ten fields the sealed snapshot carries for each. */
export interface ProtoEntry {
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number | null; // the TVL move over seven days, in per cent
  category: string | null;
  chains: string[];
  mcap_usd: number | null; // null when the record carries no token
  listed_at: string | null; // first day DefiLlama tracked it, or null
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document as a whole. */
export interface SnapDoc {
  as_of: string; // UTC date of the fetch
  source: string; // where the snapshot came from, and when
  floor_usd: number; // the watchlist's TVL floor, in whole dollars
  protocols: ProtoEntry[];
  watchlist: string[]; // slugs the house's rule kept
}

/** The tuning the model runs on; the dashboard prints these numbers. */
export interface TuneSet {
  multiple_floor: number;
  multiple_cap: number;
  min_live_comps: number; // live comps a category needs before it sets its own multiple
  growth_weight: number; // how much of the 7-day move the value keeps
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number; // the youngest protocol's share of the maturity factor
  maturity_range: number;
  maturity_days: number; // the age at which maturity stops growing
  unknown_age_days: number; // the age scored when no listing date exists
  breadth_step: number; // per extra chain
  breadth_max: number;
}

export const TUNING: TuneSet = {
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  min_live_comps: 3,
  growth_weight: 0.65,
  growth_floor: -80,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.04,
  breadth_max: 1.16,
};

/** The version the dashboard names in its pill and the model panel. */
export const MODEL_LABEL = 'radar-2';

/** How many pre-token protocols below the floor the early radar carries, by TVL. */
export const EARLY_LIMIT = 160;

/** How many live-token protocols the page's Live token view carries, by market cap. */
export const LIVE_LIMIT = 24;

/** One farm-plan step: the action, what it costs, and how long it takes. */
export interface PlanStep {
  text: string;
  cost: string;
  time: string;
}

/** The comparable multiples, worked out from the snapshot's live protocols. */
export interface CompSet {
  /** Median mcap/tvl over every live-token protocol, clamped to [0.05, 2.0]. */
  global: number;
  /** Per-category medians, only where the category has enough live comps. */
  by_category: Record<string, number>;
}

/** One row of board.json. */
export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    breadth_multiplier: number;
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row slimmed down for data.js; the page rebuilds the farm plan. */
export interface LiteEntry {
  rank: number;
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  breadth_multiplier: number;
  base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A protocol that already trades: the market's value, not the model's. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, written to data.js beside the page. */
export interface PageData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: TuneSet;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: CompSet;
  rows: LiteEntry[];
  live: LiveEntry[];
}

/** Why a snapshot file is not one this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, or `fallback` when the value is missing or not a number. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimal places, for the multiples the board prints. */
function to4dp(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The middle of a sorted list: the median of a non-empty set of numbers. */
function middleVal(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/**
 * The comparable multiples for this snapshot: for every category with at
 * least min_live_comps live-token protocols, the median of mcap_usd / tvl_usd
 * among them, clamped to [multiple_floor, multiple_cap]. A category with
 * fewer live comps is left out and falls back to the global median, so one
 * outlier protocol cannot set a whole category's multiple.
 */
export function deriveComps(doc: SnapDoc, tune: TuneSet = TUNING): CompSet {
  const live = doc.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const clamp = (v: number): number => Math.min(tune.multiple_cap, Math.max(tune.multiple_floor, v));
  const ratios = (ps: ProtoEntry[]): number[] => ps.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = live.length > 0 ? clamp(middleVal(ratios(live))) : 0.2;
  const perCat = new Map<string, ProtoEntry[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const bucket = perCat.get(key);
    if (bucket === undefined) perCat.set(key, [p]);
    else bucket.push(p);
  }
  const by_category: Record<string, number> = {};
  for (const [cat, members] of perCat) {
    if (members.length >= tune.min_live_comps) by_category[cat] = to4dp(clamp(middleVal(ratios(members))));
  }
  return { global: to4dp(global), by_category };
}

/** The multiple a category runs on: its own median, or the global one. */
export function multipleFor(category: string | null, comps: CompSet): number {
  if (category !== null && Object.prototype.hasOwnProperty.call(comps.by_category, category)) {
    return comps.by_category[category]!;
  }
  return comps.global;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either is absent or unparsable. */
export function daysSinceListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** Everything one protocol's score is made of, under `tune` and `comps`. */
export function scoreProto(
  proto: ProtoEntry,
  asOf: string,
  tune: TuneSet,
  comps: CompSet,
): { value: number; base: number; growthPct: number; growthMult: number; ripeMult: number; wideMult: number; catMult: number; age: number | null } {
  const age = daysSinceListed(asOf, proto.listed_at);
  const rawGrowth = numOr(proto.change_7d, 0);
  const growthPct = Math.min(tune.growth_cap, Math.max(tune.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * tune.growth_weight;
  const scoredAge = age ?? tune.unknown_age_days;
  const ripeMult =
    tune.maturity_floor +
    tune.maturity_range * (Math.log1p(Math.min(Math.max(scoredAge, 0), tune.maturity_days)) / Math.log1p(tune.maturity_days));
  const catMult = multipleFor(proto.category, comps);
  const wideMult = Math.min(
    tune.breadth_max,
    1 + tune.breadth_step * Math.min(Math.max(proto.chains.length - 1, 0), 4),
  );
  const base = proto.tvl_usd * catMult;
  const value = Math.max(1, Math.round(base * growthMult * ripeMult * wideMult));
  return { value, base, growthPct, growthMult, ripeMult, wideMult, catMult, age };
}

/** A name that ends in a release marker is a pool of another protocol, not a protocol of its own. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol's record carries no token at all. */
export function tokenless(p: ProtoEntry): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function rankable(p: ProtoEntry): boolean {
  return tokenless(p) && p.category !== 'CEX' && !VERSION_TAIL.test(p.name);
}

/** The snapshot's protocols keyed by slug. */
function indexProtos(protocols: ProtoEntry[]): Map<string, ProtoEntry> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function rankBoard(doc: SnapDoc, tune: TuneSet = TUNING, comps: CompSet = deriveComps(doc, tune)): BoardEntry[] {
  const index = indexProtos(doc.protocols);
  const chosen = new Map<string, ProtoEntry>();
  // The watchlist is the floor: every slug it names is in, even one the
  // snapshot no longer carries (it cannot, but coverage is the gate's row
  // and is never gambled on a missing record).
  for (const slug of doc.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL,
  // capped. Never a replacement for a watchlist row: a chosen protocol stays
  // chosen.
  const early = doc.protocols
    .filter((p) => !chosen.has(p.slug) && rankable(p) && p.tvl_usd < doc.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_LIMIT);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ proto: p, score: scoreProto(p, doc.as_of, tune, comps) }));
  scored.sort((a, b) => b.score.value - a.score.value || (a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0));
  return scored.map((s, i) => {
    const p = s.proto;
    const v = s.score;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      category: p.category,
      chains: p.chains,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: v.age,
      implied_value_usd: v.value,
      model: {
        base_multiple: v.catMult,
        category_multiple: v.catMult,
        breadth_multiplier: to4dp(v.wideMult),
        base_usd: Math.round(v.base),
        growth_pct: v.growthPct,
        growth_multiplier: to4dp(v.growthMult),
        maturity_multiplier: to4dp(v.ripeMult),
        age_days: v.age,
      },
      farm_steps: farmPlan(p, v.age).map(renderStep),
    };
  });
}

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function renderStep(step: PlanStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function mainChain(p: ProtoEntry): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The chains where one transaction is cheap enough to farm often. */
const LOW_FEE_CHAINS: ReadonlySet<string> = new Set([
  'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'Sui', 'Aptos', 'Linea', 'Blast',
  'zkSync Era', 'Mantle', 'Scroll', 'Sei', 'Near', 'Tron', 'Binance', 'Hyperliquid L1',
]);

/** What one transaction costs on a chain, from the chain's own fee level. */
function feeText(chain: string): string {
  if (chain === 'Ethereum') return '$8 to $15 of gas';
  if (chain === 'Bitcoin') return '$5 to $10 of gas';
  return LOW_FEE_CHAINS.has(chain) ? '$0.50 to $2 of gas' : '$2 to $4 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
const STAKE_TIERS: Array<[number, number]> = [[5_000_000_000, 250], [1_000_000_000, 150], [100_000_000, 100]];

function stakeSize(p: ProtoEntry): number {
  for (const [floor, size] of STAKE_TIERS) if (p.tvl_usd >= floor) return size;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  return age < 180 ? 60 : age < 365 ? 45 : 30;
}

/** Does the category's name carry any of these words? */
const hasAny = (text: string, words: string[]): boolean => words.some((w) => text.includes(w));

type MoveFn = (name: string, capital: number, chain: string) => string;

/** The category's first move, in the words a farmer can follow. */
const FIRST_MOVES: Array<[(cat: string) => boolean, MoveFn]> = [
  [(c) => hasAny(c, ['lend', 'cdp', 'collateral']), (n, k, ch) => `Supply $${k} of USDC to ${n} on ${ch} and keep the position open.`],
  [(c) => hasAny(c, ['dex']), (n, k, ch) => `Provide $${k} of liquidity to ${n}'s main pool on ${ch} and keep the position open.`],
  [(c) => hasAny(c, ['yield', 'leveraged farm', 'curator', 'allocator']), (n, k, ch) => `Deposit $${k} into a ${n} vault on ${ch} and keep the shares.`],
  [(c) => hasAny(c, ['bridge']), (n, k, ch) => `Bridge $${k} of USDC to ${ch} through ${n} and use the bridged funds in its app.`],
  [(c) => hasAny(c, ['staking', 'restak']), (n, k, ch) => `Stake $${k} of the chain's staking asset through ${n} and keep the receipt.`],
  [(c) => hasAny(c, ['perpetual', 'derivative']), (n, k, ch) => `Deposit $${k} of USDC as margin on ${n} and open one small hedge.`],
  [(c) => hasAny(c, ['prediction']), (n, k, ch) => `Fund $${k} and place one market position on ${n}.`],
  [(c) => hasAny(c, ['stable']), (n, k, ch) => `Mint or deposit $${k} of the stable asset through ${n} on ${ch}.`],
  [(c) => hasAny(c, ['rwa']), (n, k, ch) => `Mint $${k} of the protocol's yield asset on ${ch} and hold it.`],
  [(c) => hasAny(c, ['insurance']), (n, k, ch) => `Buy $${k} of cover from ${n} on ${ch} and keep the policy.`],
];

function firstMove(p: ProtoEntry, capital: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  for (const [match, build] of FIRST_MOVES) if (match(cat)) return build(p.name, capital, chain);
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** The second qualifying move: a different action in the same category, so the wallet shows two kinds of activity. */
const SECOND_MOVES: Array<[(cat: string) => boolean, MoveFn]> = [
  [(c) => hasAny(c, ['lend', 'cdp', 'collateral']), (n, k) => `Borrow $${k} against the supply on ${n}, then repay it within a week to record a borrow event.`],
  [(c) => hasAny(c, ['dex']), (n, k, ch) => `Swap $${k} through ${n} on ${ch} so the wallet records both a swap and a liquidity position.`],
  [(c) => hasAny(c, ['bridge']), (n) => `Use the bridged funds for one swap or deposit on the destination chain, so the bridge is not a dead end.`],
  [(c) => hasAny(c, ['staking', 'restak']), (n) => `Delegate a second small amount through ${n} and keep both receipts.`],
  [(c) => hasAny(c, ['perpetual', 'derivative']), (n) => `Open a second small hedge in the opposite direction on ${n}, then close it, to record two-way activity.`],
  [(c) => hasAny(c, ['prediction']), (n) => `Place a second small position on a different market on ${n}.`],
  [(c) => hasAny(c, ['curator', 'allocator']), (n) => `Claim the vault rewards on ${n} once, then re-deposit the claim so the position compounds.`],
  [(c) => hasAny(c, ['yield', 'leveraged farm']), (n) => `Harvest the yield on ${n} once, then re-deposit the harvest so the position compounds.`],
  [(c) => hasAny(c, ['stable']), (n) => `Hold the minted stable asset for a week, then swap a small part back to test the exit.`],
  [(c) => hasAny(c, ['rwa']), (n, k, ch) => `Reinvest one distribution from the yield asset back into ${n} on ${ch}.`],
  [(c) => hasAny(c, ['insurance']), (n) => `Open the policy page on ${n} and confirm the cover is active before the hold ends.`],
];

function secondMove(p: ProtoEntry, small: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  for (const [match, build] of SECOND_MOVES) if (match(cat)) return build(p.name, small, chain);
  return `Do a second small deposit or swap on ${p.name} on ${chain} in a different week.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmPlan(p: ProtoEntry, age: number | null): PlanStep[] {
  const chain = mainChain(p);
  const capital = stakeSize(p);
  const small = capital >= 100 ? 25 : 10;
  const hold = holdWindow(age);
  const gas = feeText(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: firstMove(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondMove(p, small, chain),
      cost: `$${small} of capital and ${gas}`,
      time: '20 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the page's Live token view. */
export function liveSet(doc: SnapDoc): LiveEntry[] {
  return doc.protocols
    .filter((p) => !tokenless(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan rebuilt in the page. */
export function liteEntry(row: BoardEntry): LiteEntry {
  const m = row.model;
  const { rank, slug, name, tvl_usd, change_7d, category, chains, mcap_usd, listed_at, age_days } = row;
  return {
    rank, slug, name, tvl_usd, change_7d, category, chains, mcap_usd, listed_at, age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: m.category_multiple,
    breadth_multiplier: m.breadth_multiplier,
    base_usd: m.base_usd,
    growth_multiplier: m.growth_multiplier,
    maturity_multiplier: m.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function assemblePage(doc: SnapDoc, tune: TuneSet = TUNING): { board: BoardEntry[]; page: PageData } {
  const comps = deriveComps(doc, tune);
  const board = rankBoard(doc, tune, comps);
  const live = liveSet(doc);
  const early = board.filter((r) => !doc.watchlist.includes(r.slug)).length;
  const page: PageData = {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    model: tune,
    model_version: MODEL_LABEL,
    watchlist_size: doc.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: comps,
    rows: board.map(liteEntry),
    live,
  };
  return { board, page };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnap(text: string): SnapDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function validateBoard(board: BoardEntry[], doc: SnapDoc): string | null {
  const seen = new Set(board.map((r) => r.slug));
  const missing = doc.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataModule(page: PageData): string {
  return `window.RADAR=${JSON.stringify(page)};\n`;
}
