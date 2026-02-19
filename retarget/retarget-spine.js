import { clamp, degreesToRadians, roundTo } from './math.js';

const SIDE_SWAP_MAP = Object.freeze({
  leftArm: 'rightArm',
  leftForeArm: 'rightForeArm',
  leftHand: 'rightHand',
  leftUpLeg: 'rightUpLeg',
  leftLeg: 'rightLeg',
  leftFoot: 'rightFoot',
  rightArm: 'leftArm',
  rightForeArm: 'leftForeArm',
  rightHand: 'leftHand',
  rightUpLeg: 'leftUpLeg',
  rightLeg: 'leftLeg',
  rightFoot: 'leftFoot'
});

const CANONICAL_SOURCE_FALLBACKS = Object.freeze({
  spine: ['hips'],
  spine1: ['spine', 'hips'],
  spine2: ['spine1', 'spine', 'hips'],
  neck: ['spine2', 'spine1', 'spine'],
  head: ['neck', 'spine2', 'spine1'],
  leftForeArm: ['leftArm'],
  leftHand: ['leftForeArm', 'leftArm'],
  rightForeArm: ['rightArm'],
  rightHand: ['rightForeArm', 'rightArm'],
  leftLeg: ['leftUpLeg'],
  leftFoot: ['leftLeg', 'leftUpLeg'],
  rightLeg: ['rightUpLeg'],
  rightFoot: ['rightLeg', 'rightUpLeg']
});

function toFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function reduceTimelineKeys(keys, fields, epsilon) {
  if (!Array.isArray(keys) || keys.length <= 2) {
    return keys || [];
  }

  const safeEpsilon = Math.max(0, toFinite(epsilon, 0));
  const reduced = [keys[0]];

  for (let index = 1; index < keys.length - 1; index += 1) {
    const current = keys[index];
    const previousKept = reduced[reduced.length - 1];

    let significant = false;
    for (const field of fields) {
      const a = toFinite(current[field], 0);
      const b = toFinite(previousKept[field], 0);
      if (Math.abs(a - b) > safeEpsilon) {
        significant = true;
        break;
      }
    }

    if (significant) {
      reduced.push(current);
    }
  }

  reduced.push(keys[keys.length - 1]);
  return reduced;
}

function buildBoneMap(spineJson) {
  const bones = Array.isArray(spineJson?.bones) ? spineJson.bones : [];
  const map = new Map();

  for (const bone of bones) {
    if (bone?.name) {
      map.set(bone.name, bone);
    }
  }

  return map;
}

function buildSetupWorldX(spineJson) {
  const bones = Array.isArray(spineJson?.bones) ? spineJson.bones : [];
  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  const world = new Map();

  const resolveBone = (boneName) => {
    if (world.has(boneName)) {
      return world.get(boneName);
    }

    const bone = byName.get(boneName);
    if (!bone) {
      return null;
    }

    const localX = toFinite(bone.x, 0);
    const localY = toFinite(bone.y, 0);
    const localRotation = toFinite(bone.rotation, 0);
    const localScaleX = toFinite(bone.scaleX, 1);
    const localScaleY = toFinite(bone.scaleY, 1);

    if (!bone.parent) {
      const root = {
        x: localX,
        y: localY,
        rotation: localRotation,
        scaleX: localScaleX,
        scaleY: localScaleY
      };
      world.set(boneName, root);
      return root;
    }

    const parent = resolveBone(bone.parent);
    if (!parent) {
      const fallback = {
        x: localX,
        y: localY,
        rotation: localRotation,
        scaleX: localScaleX,
        scaleY: localScaleY
      };
      world.set(boneName, fallback);
      return fallback;
    }

    const parentRotationRad = degreesToRadians(parent.rotation);
    const cos = Math.cos(parentRotationRad);
    const sin = Math.sin(parentRotationRad);

    const x = parent.x + (localX * parent.scaleX) * cos - (localY * parent.scaleY) * sin;
    const y = parent.y + (localX * parent.scaleX) * sin + (localY * parent.scaleY) * cos;

    const resolved = {
      x,
      y,
      rotation: parent.rotation + localRotation,
      scaleX: parent.scaleX * localScaleX,
      scaleY: parent.scaleY * localScaleY
    };

    world.set(boneName, resolved);
    return resolved;
  };

  for (const bone of bones) {
    resolveBone(bone.name);
  }

  return world;
}

function shouldSwapSides(canonical2d, profile, setupWorldMap, warnings) {
  const sideConfig = profile?.sideCalibration || {};
  const sourceLeftJoint = sideConfig.sourceLeftJoint || 'leftArm';
  const sourceRightJoint = sideConfig.sourceRightJoint || 'rightArm';
  const targetLeftBone = sideConfig.targetLeftBone || 'ARM_L';
  const targetRightBone = sideConfig.targetRightBone || 'ARM_R';

  const sourceLeftX = canonical2d?.sourceSide?.leftArmX;
  const sourceRightX = canonical2d?.sourceSide?.rightArmX;

  if (!Number.isFinite(sourceLeftX) || !Number.isFinite(sourceRightX)) {
    warnings.push(
      `Side auto-calibration skipped: source ${sourceLeftJoint}/${sourceRightJoint} first-frame X is unavailable.`
    );
    return false;
  }

  const targetLeft = setupWorldMap.get(targetLeftBone);
  const targetRight = setupWorldMap.get(targetRightBone);

  if (!targetLeft || !targetRight) {
    warnings.push(
      `Side auto-calibration skipped: target bones ${targetLeftBone}/${targetRightBone} were not found in skeleton.`
    );
    return false;
  }

  const sourceDelta = sourceLeftX - sourceRightX;
  const targetDelta = targetLeft.x - targetRight.x;

  if (Math.abs(sourceDelta) <= 1e-5 || Math.abs(targetDelta) <= 1e-5) {
    warnings.push('Side auto-calibration skipped: arm side spread is too small to infer handedness.');
    return false;
  }

  return sourceDelta * targetDelta < 0;
}

function resolveCanonicalSourceJoint(canonicalJoint, swapSides) {
  if (!swapSides) {
    return canonicalJoint;
  }

  return SIDE_SWAP_MAP[canonicalJoint] || canonicalJoint;
}

function getJointAdjustment(profile, canonicalJoint, targetBoneName) {
  const adjustments = profile?.jointAdjustments || {};
  const value = adjustments[canonicalJoint] || adjustments[targetBoneName] || null;
  if (!value || typeof value !== 'object') {
    return {
      multiplier: 1,
      offset: 0
    };
  }

  return {
    multiplier: toFinite(value.multiplier, 1),
    offset: toFinite(value.offset, 0)
  };
}

function buildTimelineConfig(profile, options) {
  const profileTimeline = profile?.timeline || {};
  const uniformKeyframes = hasOwn(options, 'uniformKeyframes')
    ? Boolean(options.uniformKeyframes)
    : hasOwn(profileTimeline, 'uniformKeyframes')
      ? Boolean(profileTimeline.uniformKeyframes)
      : true;

  const reduceRotationKeys = hasOwn(options, 'reduceRotationKeys')
    ? Boolean(options.reduceRotationKeys)
    : hasOwn(profileTimeline, 'reduceRotationKeys')
      ? Boolean(profileTimeline.reduceRotationKeys)
      : !uniformKeyframes;

  const reduceTranslationKeys = hasOwn(options, 'reduceTranslationKeys')
    ? Boolean(options.reduceTranslationKeys)
    : hasOwn(profileTimeline, 'reduceTranslationKeys')
      ? Boolean(profileTimeline.reduceTranslationKeys)
      : !uniformKeyframes;

  const fillMissingWithZero = hasOwn(options, 'fillMissingWithZero')
    ? Boolean(options.fillMissingWithZero)
    : hasOwn(profileTimeline, 'fillMissingWithZero')
      ? Boolean(profileTimeline.fillMissingWithZero)
      : true;

  const referenceFrameCount = Math.max(
    1,
    Math.floor(
      hasOwn(options, 'referenceFrameCount')
        ? toFinite(options.referenceFrameCount, 3)
        : hasOwn(profileTimeline, 'referenceFrameCount')
          ? toFinite(profileTimeline.referenceFrameCount, 3)
          : 3
    )
  );

  return {
    uniformKeyframes,
    reduceRotationKeys,
    reduceTranslationKeys,
    fillMissingWithZero,
    referenceFrameCount
  };
}

function getReferenceAngle(angleSeries, sampleCount = 3) {
  if (!Array.isArray(angleSeries) || !angleSeries.length) {
    return 0;
  }

  const safeSampleCount = Math.min(Math.max(1, sampleCount), angleSeries.length);
  let sum = 0;
  let valid = 0;
  for (let index = 0; index < safeSampleCount; index += 1) {
    const value = toFinite(angleSeries[index], Number.NaN);
    if (Number.isFinite(value)) {
      sum += value;
      valid += 1;
    }
  }

  return valid ? sum / valid : toFinite(angleSeries[0], 0);
}

function buildRotationKeys(frameTimes, angleSeries, adjustment, limits, timelineConfig) {
  if (!Array.isArray(frameTimes) || !Array.isArray(angleSeries) || !frameTimes.length || !angleSeries.length) {
    return [];
  }

  const minAngle = Number.isFinite(limits?.minAngle) ? limits.minAngle : -360;
  const maxAngle = Number.isFinite(limits?.maxAngle) ? limits.maxAngle : 360;
  const referenceAngle = getReferenceAngle(angleSeries, timelineConfig.referenceFrameCount);

  const keys = frameTimes.map((time, index) => {
    const value =
      ((toFinite(angleSeries[index], referenceAngle) - referenceAngle) * adjustment.multiplier) + adjustment.offset;
    return {
      time: roundTo(toFinite(time, 0), 4),
      angle: roundTo(clamp(value, minAngle, maxAngle), 4)
    };
  });

  if (timelineConfig.uniformKeyframes || !timelineConfig.reduceRotationKeys) {
    return keys;
  }
  return reduceTimelineKeys(keys, ['angle'], limits?.rotationEpsilonDeg ?? 0.2);
}

function buildTranslationKeys(frameTimes, translationSeries, scale, limits, timelineConfig) {
  if (!Array.isArray(frameTimes) || !Array.isArray(translationSeries) || !frameTimes.length || !translationSeries.length) {
    return [];
  }

  const scaled = frameTimes.map((time, index) => {
    const frame = translationSeries[index] || { x: 0, y: 0 };
    return {
      time: roundTo(toFinite(time, 0), 4),
      x: roundTo(toFinite(frame.x, 0) * scale, 4),
      y: roundTo(toFinite(frame.y, 0) * scale, 4)
    };
  });

  if (timelineConfig.uniformKeyframes || !timelineConfig.reduceTranslationKeys) {
    return scaled;
  }
  return reduceTimelineKeys(scaled, ['x', 'y'], limits?.translationEpsilon ?? 0.12);
}

function resolveSourceAngles(canonical2d, canonicalJoint, swapSides, warnings, warningSet) {
  const fallbackChain = [canonicalJoint, ...(CANONICAL_SOURCE_FALLBACKS[canonicalJoint] || [])];

  for (let index = 0; index < fallbackChain.length; index += 1) {
    const candidateCanonical = fallbackChain[index];
    const candidateSourceJoint = resolveCanonicalSourceJoint(candidateCanonical, swapSides);
    const candidateAngles = canonical2d?.jointAngles?.[candidateSourceJoint];
    if (!Array.isArray(candidateAngles) || !candidateAngles.length) {
      continue;
    }

    if (index > 0) {
      const warningKey = `${canonicalJoint}|${candidateCanonical}|${candidateSourceJoint}`;
      if (!warningSet.has(warningKey)) {
        warningSet.add(warningKey);
        warnings.push(
          `Source joint "${resolveCanonicalSourceJoint(canonicalJoint, swapSides)}" missing; using fallback "${candidateSourceJoint}" for "${canonicalJoint}".`
        );
      }
    }

    return {
      sourceJoint: candidateSourceJoint,
      sourceAngles: candidateAngles
    };
  }

  return {
    sourceJoint: resolveCanonicalSourceJoint(canonicalJoint, swapSides),
    sourceAngles: null
  };
}

export function retargetToSpineAnimation({ spineJson, canonical2d, profile, animationName, options = {} }) {
  if (!spineJson || typeof spineJson !== 'object') {
    throw new Error('A valid Spine JSON object is required for retargeting.');
  }

  const frameTimes = canonical2d?.frameTimes || [];
  if (!frameTimes.length) {
    throw new Error('No projected frame data is available for retargeting.');
  }

  const warnings = [...(canonical2d?.warnings || [])];
  const mappedBones = [];

  const profileTargetBones = profile?.targetBones || {};
  const boneMap = buildBoneMap(spineJson);
  const setupWorldMap = buildSetupWorldX(spineJson);
  const swapSides = shouldSwapSides(canonical2d, profile, setupWorldMap, warnings);
  const timelineConfig = buildTimelineConfig(profile, options);
  const rootMotionMode = String(options?.rootMotion || profile?.rootMotion || 'in_place')
    .trim()
    .toLowerCase();
  const hipsTranslationAllowed = rootMotionMode !== 'in_place' && rootMotionMode !== 'none';
  const warningSet = new Set();
  const zeroAngles = new Array(frameTimes.length).fill(0);

  const animationBones = {};
  const mappedBoneSet = new Set();

  for (const [canonicalJoint, mappingEntry] of Object.entries(profileTargetBones)) {
    const targetBoneName = typeof mappingEntry === 'string' ? mappingEntry : mappingEntry?.bone;
    if (!targetBoneName) {
      continue;
    }

    if (!boneMap.has(targetBoneName)) {
      warnings.push(`Target bone "${targetBoneName}" is missing in skeleton.`);
      continue;
    }

    const resolvedSource = resolveSourceAngles(canonical2d, canonicalJoint, swapSides, warnings, warningSet);
    const sourceJoint = resolvedSource.sourceJoint;
    const sourceAngles = resolvedSource.sourceAngles;
    const sourceAngleSeries =
      Array.isArray(sourceAngles) && sourceAngles.length
        ? sourceAngles
        : timelineConfig.fillMissingWithZero
          ? zeroAngles
          : null;

    if (!sourceAngleSeries) {
      warnings.push(`Source joint "${sourceJoint}" has no projected angle data.`);
      continue;
    }
    if (sourceAngleSeries === zeroAngles) {
      warnings.push(`Source joint "${sourceJoint}" has no projected angle data; writing static keys for "${targetBoneName}".`);
    }

    const adjustment = getJointAdjustment(profile, canonicalJoint, targetBoneName);
    const rotationKeys = buildRotationKeys(frameTimes, sourceAngleSeries, adjustment, profile?.limits || {}, timelineConfig);

    if (!rotationKeys.length) {
      continue;
    }

    animationBones[targetBoneName] ||= {};
    animationBones[targetBoneName].rotate = rotationKeys;
    if (!mappedBoneSet.has(targetBoneName)) {
      mappedBoneSet.add(targetBoneName);
      mappedBones.push(targetBoneName);
    }

    const shouldTranslate =
      Boolean(typeof mappingEntry === 'object' ? mappingEntry.translate : false) && hipsTranslationAllowed;
    if (shouldTranslate && canonicalJoint === 'hips') {
      const translationScale = toFinite(profile?.translationScale, 1);
      const translationKeys = buildTranslationKeys(
        frameTimes,
        canonical2d?.hipsTranslation || [],
        translationScale,
        profile?.limits || {},
        timelineConfig
      );

      if (translationKeys.length) {
        animationBones[targetBoneName].translate = translationKeys;
      }
    }
  }

  if (!Object.keys(animationBones).length) {
    throw new Error('Retargeting produced no bone timelines.');
  }

  const finalAnimationName = String(animationName || 'fbx_animation').trim() || 'fbx_animation';

  return {
    animationName: finalAnimationName,
    duration: frameTimes[frameTimes.length - 1] || 0,
    fps: canonical2d?.fps,
    mappedBones,
    missingCanonicalJoints: canonical2d?.missingCanonicalJoints || [],
    warnings,
    sideSwapApplied: swapSides,
    spineAnimation: {
      bones: animationBones
    }
  };
}
