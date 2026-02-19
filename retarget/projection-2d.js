import {
  applyDeadbandSequence,
  clamp,
  clampAngleDeltaSequence,
  smoothSequence,
  unwrapAngleSequence
} from './math.js';

const DEFAULT_OPTIONS = Object.freeze({
  maxDeltaDeg: 70,
  angleMedianWindow: 5,
  angleSmoothingAlpha: 0.55,
  angleSmoothingPasses: 2,
  angleDeadbandDeg: 0.02,
  translationMedianWindow: 5,
  translationSmoothingAlpha: 0.5,
  translationSmoothingPasses: 2,
  translationDeadband: 0.01,
  inPlaceTrendAlpha: 0.03,
  yawInfluence: 0.05,
  outOfPlaneSuppression: 0.85,
  sourceSideCalibrationFrames: 5
});

const PARENT_BY_JOINT = Object.freeze({
  hips: null,
  spine: 'hips',
  spine1: 'spine',
  spine2: 'spine1',
  neck: 'spine2',
  head: 'neck',
  leftArm: 'spine2',
  leftForeArm: 'leftArm',
  leftHand: 'leftForeArm',
  rightArm: 'spine2',
  rightForeArm: 'rightArm',
  rightHand: 'rightForeArm',
  leftUpLeg: 'hips',
  leftLeg: 'leftUpLeg',
  leftFoot: 'leftLeg',
  rightUpLeg: 'hips',
  rightLeg: 'rightUpLeg',
  rightFoot: 'rightLeg'
});

const CHILD_BY_JOINT = Object.freeze({
  hips: 'spine',
  spine: 'spine1',
  spine1: 'spine2',
  spine2: 'neck',
  neck: 'head',
  head: null,
  leftArm: 'leftForeArm',
  leftForeArm: 'leftHand',
  leftHand: null,
  rightArm: 'rightForeArm',
  rightForeArm: 'rightHand',
  rightHand: null,
  leftUpLeg: 'leftLeg',
  leftLeg: 'leftFoot',
  leftFoot: null,
  rightUpLeg: 'rightLeg',
  rightLeg: 'rightFoot',
  rightFoot: null
});

function vectorAngleDegrees(vector) {
  return (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
}

function subtractVectors(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  };
}

function magnitude2d(vector) {
  return Math.hypot(vector.x, vector.y);
}

function toFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toWindowSize(value, fallback) {
  const parsed = Math.floor(toFinite(value, fallback));
  if (parsed < 3) {
    return 1;
  }
  return parsed % 2 === 0 ? parsed + 1 : parsed;
}

function medianFilterSequence(values, windowSize) {
  if (!Array.isArray(values) || values.length < 3) {
    return Array.isArray(values) ? values.slice() : [];
  }

  const safeWindowSize = toWindowSize(windowSize, 1);
  if (safeWindowSize <= 1) {
    return values.slice();
  }

  const radius = Math.floor(safeWindowSize / 2);
  const output = new Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    const sample = [];
    for (let offset = -radius; offset <= radius; offset += 1) {
      const clampedIndex = clamp(index + offset, 0, values.length - 1);
      sample.push(toFinite(values[clampedIndex], 0));
    }
    sample.sort((left, right) => left - right);
    output[index] = sample[Math.floor(sample.length / 2)];
  }

  return output;
}

function smoothBidirectionalSequence(values, alpha, passes = 1) {
  if (!Array.isArray(values) || values.length < 2) {
    return Array.isArray(values) ? values.slice() : [];
  }

  const safePasses = Math.max(1, Math.floor(toFinite(passes, 1)));
  let output = values.slice();
  for (let pass = 0; pass < safePasses; pass += 1) {
    const forward = smoothSequence(output, alpha);
    output = smoothSequence(forward.slice().reverse(), alpha).reverse();
  }
  return output;
}

function processScalarTrack(values, options) {
  if (!Array.isArray(values) || !values.length) {
    return [];
  }

  const filtered = medianFilterSequence(values, options.medianWindow);
  const smoothed = smoothBidirectionalSequence(
    filtered,
    toFinite(options.smoothingAlpha, 1),
    options.smoothingPasses
  );
  return applyDeadbandSequence(smoothed, Math.max(0, toFinite(options.deadband, 0)));
}

function buildJointWorldAngleTrack(canonicalTracks, jointName, frameCount, options) {
  const joint = canonicalTracks[jointName];
  if (!joint) {
    return null;
  }

  const childJointName = CHILD_BY_JOINT[jointName];
  const parentJointName = PARENT_BY_JOINT[jointName];
  const childJoint = childJointName ? canonicalTracks[childJointName] : null;
  const parentJoint = parentJointName ? canonicalTracks[parentJointName] : null;

  const angles = new Array(frameCount).fill(0);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const current = joint.positions[frameIndex];
    if (!current) {
      continue;
    }

    let vector = null;
    if (childJoint?.positions?.[frameIndex]) {
      vector = subtractVectors(childJoint.positions[frameIndex], current);
    } else if (parentJoint?.positions?.[frameIndex]) {
      vector = subtractVectors(current, parentJoint.positions[frameIndex]);
    }

    if (!vector || magnitude2d(vector) <= 1e-5) {
      angles[frameIndex] = frameIndex > 0 ? angles[frameIndex - 1] : 0;
      continue;
    }

    const baseAngle = vectorAngleDegrees(vector);
    const planarLength = Math.max(1e-6, magnitude2d(vector));
    const outOfPlaneRatio = Math.abs(vector.z) / (planarLength + Math.abs(vector.z) + 1e-6);
    const yawSuppression = 1 - clamp(outOfPlaneRatio * toFinite(options.outOfPlaneSuppression, 0), 0, 0.95);
    const yawContribution = (Math.atan2(vector.z, planarLength) * 180) / Math.PI;
    angles[frameIndex] = baseAngle + yawContribution * toFinite(options.yawInfluence, 0) * yawSuppression;
  }

  return angles;
}

function processAngleTrack(angles, options) {
  const unwrapped = unwrapAngleSequence(angles);
  const filtered = medianFilterSequence(unwrapped, options.angleMedianWindow);
  const clamped = clampAngleDeltaSequence(filtered, options.maxDeltaDeg);
  const smoothed = smoothBidirectionalSequence(clamped, options.angleSmoothingAlpha, options.angleSmoothingPasses);
  const deadbanded = applyDeadbandSequence(smoothed, options.angleDeadbandDeg);
  return unwrapAngleSequence(deadbanded);
}

function buildLocalAngleTrack(worldAnglesByJoint, jointName, frameCount) {
  const worldAngles = worldAnglesByJoint[jointName];
  if (!worldAngles) {
    return null;
  }

  const parentName = PARENT_BY_JOINT[jointName];
  if (!parentName || !worldAnglesByJoint[parentName]) {
    return worldAngles.slice();
  }

  const parentWorldAngles = worldAnglesByJoint[parentName];
  const localAngles = new Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    localAngles[frameIndex] = worldAngles[frameIndex] - parentWorldAngles[frameIndex];
  }

  return localAngles;
}

function buildHipsTranslationTrack(hipsTrack, frameCount, options) {
  const output = new Array(frameCount).fill(null).map(() => ({ x: 0, y: 0 }));
  if (!hipsTrack?.positions?.length) {
    return output;
  }

  const base = hipsTrack.positions[0] || { x: 0, y: 0 };
  const rawX = new Array(frameCount).fill(0);
  const rawY = new Array(frameCount).fill(0);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const position = hipsTrack.positions[frameIndex] || base;
    rawX[frameIndex] = position.x - base.x;
    rawY[frameIndex] = position.y - base.y;
  }

  let trendX = rawX[0];
  let trendY = rawY[0];
  const inPlaceX = new Array(frameCount);
  const inPlaceY = new Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    trendX += (rawX[frameIndex] - trendX) * options.inPlaceTrendAlpha;
    trendY += (rawY[frameIndex] - trendY) * options.inPlaceTrendAlpha;

    inPlaceX[frameIndex] = rawX[frameIndex] - trendX;
    inPlaceY[frameIndex] = rawY[frameIndex] - trendY;
  }

  const smoothX = processScalarTrack(inPlaceX, {
    medianWindow: options.translationMedianWindow,
    smoothingAlpha: options.translationSmoothingAlpha,
    smoothingPasses: options.translationSmoothingPasses,
    deadband: options.translationDeadband
  });
  const smoothY = processScalarTrack(inPlaceY, {
    medianWindow: options.translationMedianWindow,
    smoothingAlpha: options.translationSmoothingAlpha,
    smoothingPasses: options.translationSmoothingPasses,
    deadband: options.translationDeadband
  });

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    output[frameIndex] = { x: smoothX[frameIndex], y: smoothY[frameIndex] };
  }

  return output;
}

function averagePositionAxis(track, axis, frameSampleCount) {
  const positions = track?.positions || [];
  if (!positions.length) {
    return null;
  }

  const sampleCount = clamp(Math.floor(toFinite(frameSampleCount, 1)), 1, positions.length);
  let sum = 0;
  let valid = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = toFinite(positions[index]?.[axis], Number.NaN);
    if (Number.isFinite(value)) {
      sum += value;
      valid += 1;
    }
  }

  if (!valid) {
    return null;
  }
  return sum / valid;
}

export function project3dTo2d(canonicalData, inputOptions = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...(inputOptions || {})
  };

  const warnings = [...(canonicalData?.warnings || [])];
  const frameTimes = canonicalData?.frameTimes || [];
  const frameCount = frameTimes.length;
  const canonicalTracks = canonicalData?.canonicalTracks || {};

  if (!frameCount) {
    throw new Error('No animation frames available for 3D to 2D projection.');
  }

  const worldAnglesByJoint = {};
  for (const jointName of Object.keys(canonicalTracks)) {
    const worldAngles = buildJointWorldAngleTrack(canonicalTracks, jointName, frameCount, options);
    if (!worldAngles) {
      continue;
    }
    worldAnglesByJoint[jointName] = processAngleTrack(worldAngles, options);
  }

  const localAnglesByJoint = {};
  for (const jointName of Object.keys(worldAnglesByJoint)) {
    const localAngles = buildLocalAngleTrack(worldAnglesByJoint, jointName, frameCount);
    if (!localAngles) {
      continue;
    }
    localAnglesByJoint[jointName] = processAngleTrack(localAngles, options);
  }

  const hipsTrack = canonicalTracks.hips || null;
  const hipsTranslation = buildHipsTranslationTrack(hipsTrack, frameCount, options);

  const leftArmX = averagePositionAxis(
    canonicalTracks.leftArm,
    'x',
    toFinite(options.sourceSideCalibrationFrames, 5)
  );
  const rightArmX = averagePositionAxis(
    canonicalTracks.rightArm,
    'x',
    toFinite(options.sourceSideCalibrationFrames, 5)
  );

  if (!Number.isFinite(leftArmX) || !Number.isFinite(rightArmX)) {
    warnings.push('Unable to derive source side calibration from left/right arm first-frame positions.');
  }

  return {
    fps: canonicalData?.fps,
    duration: canonicalData?.duration,
    frameTimes,
    jointAngles: localAnglesByJoint,
    worldJointAngles: worldAnglesByJoint,
    hipsTranslation,
    sourceSide: {
      leftArmX: Number.isFinite(leftArmX) ? leftArmX : null,
      rightArmX: Number.isFinite(rightArmX) ? rightArmX : null
    },
    missingCanonicalJoints: canonicalData?.missingCanonicalJoints || [],
    warnings
  };
}
