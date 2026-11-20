# Token Launch Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tw99218/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tw99218/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun entry for the best token launch radar. It reads the sealed
DefiLlama snapshot — 758 protocols, 40 of them on the house watchlist — and
ranks the ones with no token on record by what a token would be worth if the
protocol's record stayed as it is. The dashboard shows the ranked board, a
detail view for every protocol with the model's own arithmetic, a filterable
live-token view, and a concrete farm plan for each row.

## How the value is worked out (radar-2)

`implied = TVL x category multiple x growth x maturity x chain breadth`

- **Category multiple:** the median mcap/TVL of the live-token protocols in
  the same category (at least 3 of them, otherwise the median over every
  live-token protocol), clamped to 0.05–2.0. The global median here is 0.2138.
  Multiples are computed from the snapshot at run time — no list of names
  is baked in anywhere.
- **Growth:** the 7-day TVL change, clamped to [-80, +150]%, kept at a 0.65
  weight.
- **Maturity:** log-scaled age, 0.70–1.00, over 1,095 days; a protocol with
  no listing date is scored as 365 days old.
- **Breadth:** 1 + 0.04 per chain past the first, capped at 1.16.

The board holds 200 rows: all 40 watchlist protocols, plus the 160
pre-token protocols below the $50M floor with the most TVL. The 24 largest
live-token protocols are set aside in their own view, shown at market cap.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Needs Node.js 22.18 or later (Node 24 works too). The program writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory. Both runs write the same bytes.

## Layout

- `main.ts` — the entry point: read the snapshot, score, write the outputs.
- `lib/model.ts` — the model, the farm plans, and the dashboard's dataset.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `vendor/makefun-board.ts` — the make.fun dossier library (vendored, as
  shipped in the kit).

## License

MIT — see LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
