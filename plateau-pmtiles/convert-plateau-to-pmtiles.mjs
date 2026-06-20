#!/usr/bin/env node
// PLATEAU CityGML -> GeoJSON -> MBTiles -> PMTiles の変換パイプラインを
// 外部CLI (nusamai / tippecanoe / pmtiles) を呼び出して実行する。
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const GML_CHUNK_SIZE = 200;

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string' },
      package: { type: 'string', default: 'bldg' },
      out: { type: 'string' },
      layer: { type: 'string' },
      minzoom: { type: 'string', default: '10' },
      maxzoom: { type: 'string', default: '16' },
      workdir: { type: 'string' },
      'keep-temp': { type: 'boolean', default: false },
      'citygml-converter': { type: 'string', default: 'nusamai' },
      tippecanoe: { type: 'string', default: 'tippecanoe' },
      pmtiles: { type: 'string', default: 'pmtiles' },
      help: { type: 'boolean', default: false },
    },
  });
  return values;
}

function printHelp() {
  console.log(`使い方:
  node convert-plateau-to-pmtiles.mjs --input <PLATEAUデータのディレクトリ> --out <出力.pmtiles> [options]

必須:
  --input <dir>     展開済みPLATEAUデータセットのルートディレクトリ (udx/ を含む)
  --out <file>      出力する .pmtiles ファイルパス

オプション:
  --package <name>      udx 配下の対象パッケージ名 (既定: bldg)
  --layer <name>        ベクトルタイルのレイヤー名 (既定: --package と同じ)
  --minzoom <n>         最小ズームレベル (既定: 10)
  --maxzoom <n>         最大ズームレベル (既定: 16)
  --workdir <dir>       中間ファイルの作業ディレクトリ (既定: OSの一時ディレクトリ)
  --keep-temp           中間ファイル(GeoJSON/MBTiles)を削除せず残す
  --citygml-converter   CityGML変換CLIのバイナリ名/パス (既定: nusamai)
  --tippecanoe          tippecanoeバイナリ名/パス (既定: tippecanoe)
  --pmtiles             pmtiles CLIバイナリ名/パス (既定: pmtiles)
`);
}

function checkBinary(bin) {
  const result = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  if (result.error) {
    throw new Error(
      `コマンド "${bin}" が見つかりません。PATH に通っているか確認してください。\n` +
      `(${result.error.message})`
    );
  }
}

function findGmlFiles(rootDir, pkg) {
  const pkgDir = join(rootDir, 'udx', pkg);
  if (!existsSync(pkgDir)) {
    throw new Error(`パッケージディレクトリが見つかりません: ${pkgDir}`);
  }
  const result = [];
  const stack = [pkgDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.toLowerCase().endsWith('.gml')) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function run(bin, args, label) {
  console.log(`> ${bin} ${args.join(' ')}`);
  const result = spawnSync(bin, args, { stdio: 'inherit' });
  if (result.error) {
    throw new Error(`${label} の実行に失敗しました: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} が異常終了しました (exit code ${result.status})`);
  }
}

function convertCityGmlToGeoJson({ converterBin, gmlFiles, workdir }) {
  const geojsonFiles = [];
  const batches = chunk(gmlFiles, GML_CHUNK_SIZE);
  batches.forEach((batch, i) => {
    const outFile = join(workdir, `batch-${i}.geojson`);
    run(converterBin, [...batch, '--sink', 'geojson', '--output', outFile], 'CityGML -> GeoJSON 変換');
    geojsonFiles.push(outFile);
  });
  return geojsonFiles;
}

function convertGeoJsonToMbtiles({ tippecanoeBin, geojsonFiles, mbtilesPath, layer, minzoom, maxzoom }) {
  run(
    tippecanoeBin,
    [
      '-o', mbtilesPath,
      '-l', layer,
      '-Z', String(minzoom),
      '-z', String(maxzoom),
      '--force',
      ...geojsonFiles,
    ],
    'GeoJSON -> MBTiles 変換 (tippecanoe)'
  );
}

function convertMbtilesToPmtiles({ pmtilesBin, mbtilesPath, outPath }) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  run(pmtilesBin, ['convert', mbtilesPath, outPath], 'MBTiles -> PMTiles 変換 (pmtiles)');
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help || !args.input || !args.out) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const inputDir = resolve(args.input);
  const outPath = resolve(args.out);
  const layer = args.layer || args.package;
  const workdir = args.workdir
    ? resolve(args.workdir)
    : mkdtempSync(join(tmpdir(), 'plateau-pmtiles-'));

  if (args.workdir) mkdirSync(workdir, { recursive: true });

  for (const bin of [args['citygml-converter'], args.tippecanoe, args.pmtiles]) {
    checkBinary(bin);
  }

  console.log(`PLATEAU データを検索中: ${inputDir}/udx/${args.package}`);
  const gmlFiles = findGmlFiles(inputDir, args.package);
  if (gmlFiles.length === 0) {
    throw new Error('CityGML (.gml) ファイルが見つかりませんでした。');
  }
  console.log(`${gmlFiles.length} 件の CityGML ファイルを検出しました。`);

  try {
    const geojsonFiles = convertCityGmlToGeoJson({
      converterBin: args['citygml-converter'],
      gmlFiles,
      workdir,
    });

    const mbtilesPath = join(workdir, 'output.mbtiles');
    convertGeoJsonToMbtiles({
      tippecanoeBin: args.tippecanoe,
      geojsonFiles,
      mbtilesPath,
      layer,
      minzoom: args.minzoom,
      maxzoom: args.maxzoom,
    });

    convertMbtilesToPmtiles({
      pmtilesBin: args.pmtiles,
      mbtilesPath,
      outPath,
    });

    console.log(`完了: ${outPath}`);
  } finally {
    if (args['keep-temp']) {
      console.log(`中間ファイルは ${workdir} に残しています (--keep-temp 指定のため削除しません)`);
    } else {
      rmSync(workdir, { recursive: true, force: true });
    }
  }
}

main();
