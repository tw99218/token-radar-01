// Token Radar, round 2 (Node 22, standard library only).
//
// The entry point. It reads the sealed snapshot (by default /input, or
// --input <snapshot.json|directory>), scores every pre-token protocol with
// the model in lib/model.ts, and writes the ranked board to
// /output/board.json. It also writes the dashboard's data beside the page
// (data.js, the same board in compact form), copies this repository's
// dashboard/ and screenshots/ into the output, and finishes by writing
// /output/dossier.json with the vendored make.fun library — the dossier is
// written last, because the scorer rebuilds it from this output and compares
// the bytes.
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes. The board covers the watchlist, states the
// model it runs on, and gives every protocol a farm plan.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath as urlToPath } from 'node:url';
import { assemblePage, dataModule, parseSnap, validateBoard } from './lib/model.ts';
import { buildDossier as makeDossier } from './vendor/makefun-board.ts';

const ROOT = urlToPath(new URL('./', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASH_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --name <value> or --name=<value>, or `fallback` when absent. */
function flag(name: string, fallback: string): string {
  const args = process.argv;
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const glued = args.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

/** Print a failure and stop with a non-zero exit. */
function fail(message: string, code: number): never {
  process.stderr.write(`radar: ${message}\n`);
  process.exit(code);
}

/** Copy a directory's regular files into `to`, skipping dot-names, and return what landed. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const landed: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isFile()) continue;
    copyFileSync(joinPath(from, entry.name), joinPath(to, entry.name));
    landed.push(entry.name);
  }
  return landed;
}

function main(): void {
  const inputArg = flag('input', '/input');
  const snapPath = inputArg.endsWith('.json') ? inputArg : joinPath(inputArg, 'snapshot.json');
  if (!existsSync(snapPath)) {
    fail(`no snapshot at ${snapPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const doc = parseSnap(readFileSync(snapPath, 'utf8'));
  const { board, page } = assemblePage(doc);
  const problem = validateBoard(board, doc);
  if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`, 1);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(joinPath(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(joinPath(outDir, 'data.js'), dataModule(page));

  copyDir(joinPath(ROOT, 'dashboard'), joinPath(outDir, 'dashboard'));
  const shots = copyDir(joinPath(ROOT, 'screenshots'), joinPath(outDir, 'screenshots'));
  if (shots.length < 3) {
    fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  const dossierOpts = { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: DASH_LIMITS };
  writeFileSync(joinPath(outDir, 'dossier.json'), makeDossier(outDir, dossierOpts));

  process.stdout.write(
    `radar: ${doc.protocols.length} protocols, ${doc.watchlist.length} on the watchlist, ${board.length} rows scored (${page.early_size} early, ${page.live_size} live set aside)\n` +
      `radar: wrote ${joinPath(outDir, 'board.json')}, ${joinPath(outDir, 'data.js')}, ${joinPath(outDir, 'dashboard')} (3 files), ${joinPath(outDir, 'screenshots')} (${shots.length} images) and ${joinPath(outDir, 'dossier.json')}\n`,
  );
}

main();
