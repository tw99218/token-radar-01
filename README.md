# Token Launch Radar — token-radar-01

A make.fun entry: reads the sealed DefiLlama snapshot and ranks pre-token
protocols by hypothetical launch value, with a web dashboard and a farm plan
per protocol.

## Model (radar-2)

`implied = TVL x category multiple x growth x maturity x chain breadth`

- Category multiple: median mcap/TVL of live-token protocols in the same
  category (clamped 0.05–2.0), falling back to the global median (0.2138).
- Growth: 7-day TVL change, clamped [-80, +150]%, weight 0.65.
- Maturity: log-scaled age, 0.70–1.00.
- Chain breadth: 1 + 0.04 per extra chain, up to 1.16.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18+. The program writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory.

## License

MIT — see LICENSE.
