import { parseFbxAnimationFromBuffer } from './fbx-parse.js';
import { toCanonicalHumanoid } from './canonicalize.js';
import { project3dTo2d } from './projection-2d.js';
import { retargetToSpineAnimation } from './retarget-spine.js';
import { mergeAnimationNonDestructive } from './spine-merge.js';
import { convertSkeletonFromFbx } from './skeleton-convert.js';

function deriveAnimationName(filename, override) {
  const trimmedOverride = String(override || '').trim();
  if (trimmedOverride) {
    if (trimmedOverride.toUpperCase().startsWith('FBX_')) {
      return trimmedOverride;
    }
    return `FBX_${trimmedOverride}`;
  }

  const source = String(filename || 'fbx_animation').split('/').pop().split('\\').pop();
  const stem = source.replace(/\.[^.]+$/, '') || 'fbx_animation';
  const normalized = stem
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `FBX_${normalized || 'animation'}`;
}

function buildPreviewData(parsed) {
  const frameTimes = Array.isArray(parsed?.frameTimes) ? parsed.frameTimes.slice() : [];
  const jointTracks = Object.values(parsed?.jointTracks || {}).map((track) => ({
    name: track?.name || '',
    parentName: track?.parentName || null,
    positions: Array.isArray(track?.positions)
      ? track.positions.map((position) => ({
          x: Number.isFinite(position?.x) ? position.x : 0,
          y: Number.isFinite(position?.y) ? position.y : 0,
          z: Number.isFinite(position?.z) ? position.z : 0
        }))
      : []
  }));

  return {
    sourceFile: parsed?.sourceFile || null,
    clipName: parsed?.clipName || null,
    fps: Number.isFinite(parsed?.fps) ? parsed.fps : 0,
    duration: Number.isFinite(parsed?.duration) ? parsed.duration : 0,
    frameTimes,
    jointTracks
  };
}

export async function convertFbxToSpineAnimation({
  fbxArrayBuffer,
  filename,
  spineJson,
  profile,
  animationName,
  options = {}
}) {
  const parsed = await parseFbxAnimationFromBuffer(fbxArrayBuffer, filename, {
    fps: options.fps || 30
  });

  const canonical = toCanonicalHumanoid(parsed, {
    aliases: options.aliases || null
  });

  let workingSpineJson = spineJson;
  let skeletonReport = {
    mode: 'disabled',
    addedBones: [],
    remappedReferences: 0,
    compatibilityBonesAdded: [],
    warnings: []
  };

  if (options?.skeletonConversion?.enabled) {
    const skeletonResult = convertSkeletonFromFbx({
      spineJson: workingSpineJson,
      parsedFbx: parsed,
      canonicalData: canonical,
      profile,
      options: options.skeletonConversion
    });
    workingSpineJson = skeletonResult.convertedSpineJson;
    skeletonReport = skeletonResult.report || skeletonReport;
  }

  const projected = project3dTo2d(canonical, {
    ...(profile?.projection || {}),
    ...(options.projection || {})
  });

  const retargeted = retargetToSpineAnimation({
    spineJson: workingSpineJson,
    canonical2d: projected,
    profile,
    animationName: deriveAnimationName(filename, animationName),
    options
  });

  const merged = mergeAnimationNonDestructive(workingSpineJson, retargeted.animationName, retargeted.spineAnimation);

  return {
    ...retargeted,
    animationName: merged.animationName,
    mergedSpineJson: merged.mergedSpineJson,
    previewData: buildPreviewData(parsed),
    parseWarnings: parsed.warnings || [],
    canonicalWarnings: canonical.warnings || [],
    skeletonReport
  };
}
