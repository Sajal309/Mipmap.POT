#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertFbxToSpineAnimation } from '../retarget/convert-fbx-to-spine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PROFILE_PATH = path.resolve(ROOT_DIR, 'retarget/profile-man39.json');

function printUsage() {
  console.log(`Usage:
  node scripts/fbx-retarget.mjs --fbx <file> --spine-json <file> [--animation-name <name>]
  node scripts/fbx-retarget.mjs --fbx-dir <dir> --spine-json <file>

Options:
  --fbx <file>            Convert a single FBX file.
  --fbx-dir <dir>         Convert all .fbx files in a directory.
  --spine-json <file>     Target Spine skeleton JSON file.
  --profile <file>        Retarget profile JSON path (default: retarget/profile-man39.json).
  --animation-name <name> Override output animation name for single mode.
  --fps <number>          Sampling FPS (default: 30).
  --out <file>            Output generated Spine JSON path.
  --report <file>         Output report JSON path.
`);
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      continue;
    }

    const key = value.slice(2);
    if (key === 'help' || key === 'h') {
      result.help = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    index += 1;
  }

  return result;
}

function resolvePath(inputPath) {
  if (!inputPath) {
    return null;
  }
  return path.resolve(process.cwd(), inputPath);
}

async function loadJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function defaultOutputPath(spineJsonPath) {
  const directory = path.dirname(spineJsonPath);
  const stem = path.basename(spineJsonPath, path.extname(spineJsonPath));
  return path.join(directory, `${stem}.generated.json`);
}

function defaultReportPath(spineJsonPath) {
  const directory = path.dirname(spineJsonPath);
  const stem = path.basename(spineJsonPath, path.extname(spineJsonPath));
  return path.join(directory, `${stem}.generated.report.json`);
}

function deriveAnimationNameFromFile(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

async function listFbxFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fbx'))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function ensureOutputDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const spineJsonPath = resolvePath(args['spine-json']);
  const singleFbxPath = resolvePath(args.fbx);
  const batchFbxDir = resolvePath(args['fbx-dir']);

  if (!spineJsonPath) {
    console.error('Missing required --spine-json argument.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!singleFbxPath && !batchFbxDir) {
    console.error('Provide either --fbx or --fbx-dir.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (singleFbxPath && batchFbxDir) {
    console.error('Use either --fbx or --fbx-dir, not both.');
    process.exitCode = 1;
    return;
  }

  const fps = Math.max(1, Number(args.fps) || 30);
  const profilePath = resolvePath(args.profile) || DEFAULT_PROFILE_PATH;
  const outputPath = resolvePath(args.out) || defaultOutputPath(spineJsonPath);
  const reportPath = resolvePath(args.report) || defaultReportPath(spineJsonPath);

  const spineJson = await loadJsonFile(spineJsonPath);
  const profile = await loadJsonFile(profilePath);

  const inputFiles = singleFbxPath ? [singleFbxPath] : await listFbxFiles(batchFbxDir);
  if (!inputFiles.length) {
    console.error('No .fbx files were found to process.');
    process.exitCode = 1;
    return;
  }

  let mergedSpineJson = spineJson;
  let successCount = 0;
  let failureCount = 0;

  const items = [];

  for (const filePath of inputFiles) {
    const start = Date.now();
    const fileName = path.basename(filePath);
    const item = {
      file: filePath,
      status: 'failed',
      animationName: null,
      duration: 0,
      mappedBones: [],
      missingCanonicalJoints: [],
      warnings: [],
      error: null,
      elapsedMs: 0
    };

    try {
      const data = await fs.readFile(filePath);
      const conversion = await convertFbxToSpineAnimation({
        fbxArrayBuffer: toArrayBuffer(data),
        filename: fileName,
        spineJson: mergedSpineJson,
        profile,
        animationName: singleFbxPath ? args['animation-name'] : deriveAnimationNameFromFile(filePath),
        options: { fps }
      });

      mergedSpineJson = conversion.mergedSpineJson;
      successCount += 1;

      item.status = 'ok';
      item.animationName = conversion.animationName;
      item.duration = conversion.duration;
      item.mappedBones = conversion.mappedBones;
      item.missingCanonicalJoints = conversion.missingCanonicalJoints;
      item.warnings = conversion.warnings;

      console.log(`OK ${fileName} -> ${conversion.animationName}`);
    } catch (error) {
      failureCount += 1;
      item.error = error?.message || String(error);
      console.error(`FAIL ${fileName}: ${item.error}`);
    }

    item.elapsedMs = Date.now() - start;
    items.push(item);
  }

  const report = {
    targetSkeleton: spineJsonPath,
    profileId: profile.id || 'unknown-profile',
    generatedAt: new Date().toISOString(),
    fps,
    filesProcessed: inputFiles.length,
    filesSucceeded: successCount,
    filesFailed: failureCount,
    outputPath,
    items
  };

  if (successCount > 0) {
    await ensureOutputDirectory(outputPath);
    await fs.writeFile(outputPath, `${JSON.stringify(mergedSpineJson, null, 2)}\n`, 'utf8');
    console.log(`Wrote generated Spine JSON: ${outputPath}`);
  }

  await ensureOutputDirectory(reportPath);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote report: ${reportPath}`);

  if (successCount === 0) {
    console.error('No FBX files were converted successfully.');
    process.exitCode = 1;
    return;
  }

  console.log(`Done. Success: ${successCount}, Failed: ${failureCount}`);
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
