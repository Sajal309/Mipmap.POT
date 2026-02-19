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
const AXIS_NAMES = Object.freeze(['x', 'y', 'z']);

function normalizeAxisName(value, fallback = null) {
  const axis = String(value || '')
    .trim()
    .toLowerCase();
  return AXIS_NAMES.includes(axis) ? axis : fallback;
}

function getAxisValue(vector, axis) {
  return toFinite(vector?.[axis], 0);
}

function averageTrackPosition(track, frameSampleCount) {
  const positions = track?.positions || [];
  if (!positions.length) {
    return null;
  }

  const sampleCount = clamp(Math.floor(toFinite(frameSampleCount, 1)), 1, positions.length);
  const sum = { x: 0, y: 0, z: 0 };
  let valid = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const position = positions[index];
    if (!position) {
      continue;
    }
    sum.x += getAxisValue(position, 'x');
    sum.y += getAxisValue(position, 'y');
    sum.z += getAxisValue(position, 'z');
    valid += 1;
  }

  if (!valid) {
    return null;
  }

  return {
    x: sum.x / valid,
    y: sum.y / valid,
    z: sum.z / valid
  };
}

function computeAxisSpread(canonicalTracks) {
  const minByAxis = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const maxByAxis = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };

  for (const track of Object.values(canonicalTracks || {})) {
    for (const position of track?.positions || []) {
      if (!position) {
        continue;
      }
      for (const axis of AXIS_NAMES) {
        const value = getAxisValue(position, axis);
        minByAxis[axis] = Math.min(minByAxis[axis], value);
        maxByAxis[axis] = Math.max(maxByAxis[axis], value);
      }
    }
  }

  return {
    x: Number.isFinite(minByAxis.x) && Number.isFinite(maxByAxis.x) ? Math.max(0, maxByAxis.x - minByAxis.x) : 0,
    y: Number.isFinite(minByAxis.y) && Number.isFinite(maxByAxis.y) ? Math.max(0, maxByAxis.y - minByAxis.y) : 0,
    z: Number.isFinite(minByAxis.z) && Number.isFinite(maxByAxis.z) ? Math.max(0, maxByAxis.z - minByAxis.z) : 0
  };
}

function pickDominantAxis(vector, excluded = new Set()) {
  let bestAxis = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const axis of AXIS_NAMES) {
    if (excluded.has(axis)) {
      continue;
    }
    const value = Math.abs(toFinite(vector?.[axis], 0));
    if (value > bestValue) {
      bestValue = value;
      bestAxis = axis;
    }
  }
  if (bestAxis) {
    return bestAxis;
  }
  return AXIS_NAMES.find((axis) => !excluded.has(axis)) || 'x';
}

function resolveProjectionAxes(canonicalTracks, options, warnings) {
  const axisMapping = options?.axisMapping || {};
  const explicitHorizontal = normalizeAxisName(axisMapping.horizontal || options?.horizontalAxis, null);
  const explicitVertical = normalizeAxisName(axisMapping.vertical || options?.verticalAxis, null);
  const explicitDepth = normalizeAxisName(axisMapping.depth || options?.depthAxis, null);
  const explicitSet = new Set([explicitHorizontal, explicitVertical, explicitDepth].filter(Boolean));

  if (explicitHorizontal && explicitVertical && explicitDepth && explicitSet.size === 3) {
    return {
      horizontalAxis: explicitHorizontal,
      verticalAxis: explicitVertical,
      depthAxis: explicitDepth
    };
  }

  const sampleCount = toFinite(options?.sourceSideCalibrationFrames, 5);
  const spread = computeAxisSpread(canonicalTracks);
  const hipsAverage = averageTrackPosition(canonicalTracks?.hips, sampleCount);
  const headAverage = averageTrackPosition(canonicalTracks?.head, sampleCount) || averageTrackPosition(canonicalTracks?.neck, sampleCount);
  const leftArmAverage = averageTrackPosition(canonicalTracks?.leftArm, sampleCount);
  const rightArmAverage = averageTrackPosition(canonicalTracks?.rightArm, sampleCount);
  const leftLegAverage = averageTrackPosition(canonicalTracks?.leftUpLeg, sampleCount);
  const rightLegAverage = averageTrackPosition(canonicalTracks?.rightUpLeg, sampleCount);

  const verticalVector =
    hipsAverage && headAverage
      ? subtractVectors(headAverage, hipsAverage)
      : { x: spread.x, y: spread.y, z: spread.z };
  const verticalAxis = pickDominantAxis(verticalVector);

  const horizontalVector =
    leftArmAverage && rightArmAverage
      ? subtractVectors(leftArmAverage, rightArmAverage)
      : leftLegAverage && rightLegAverage
        ? subtractVectors(leftLegAverage, rightLegAverage)
        : { x: spread.x, y: spread.y, z: spread.z };
  const horizontalAxis = pickDominantAxis(horizontalVector, new Set([verticalAxis]));
  const depthAxis =
    AXIS_NAMES.find((axis) => axis !== horizontalAxis && axis !== verticalAxis) ||
    pickDominantAxis(spread, new Set([horizontalAxis, verticalAxis]));

  warnings.push(`Projection axes inferred as horizontal=${horizontalAxis}, vertical=${verticalAxis}, depth=${depthAxis}.`);

  return {
    horizontalAxis,
    verticalAxis,
    depthAxis
  };
}

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

function buildJointWorldAngleTrack(canonicalTracks, jointName, frameCount, options, projectionAxes) {
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

    if (!vector) {
      angles[frameIndex] = frameIndex > 0 ? angles[frameIndex - 1] : 0;
      continue;
    }

    const planarVector = {
      x: getAxisValue(vector, projectionAxes.horizontalAxis),
      y: getAxisValue(vector, projectionAxes.verticalAxis)
    };

    if (magnitude2d(planarVector) <= 1e-5) {
      angles[frameIndex] = frameIndex > 0 ? angles[frameIndex - 1] : 0;
      continue;
    }

    const depthValue = getAxisValue(vector, projectionAxes.depthAxis);
    const baseAngle = vectorAngleDegrees(planarVector);
    const planarLength = Math.max(1e-6, magnitude2d(planarVector));
    const outOfPlaneRatio = Math.abs(depthValue) / (planarLength + Math.abs(depthValue) + 1e-6);
    const yawSuppression = 1 - clamp(outOfPlaneRatio * toFinite(options.outOfPlaneSuppression, 0), 0, 0.95);
    const yawContribution = (Math.atan2(depthValue, planarLength) * 180) / Math.PI;
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

function buildHipsTranslationTrack(hipsTrack, frameCount, options, projectionAxes) {
  const output = new Array(frameCount).fill(null).map(() => ({ x: 0, y: 0 }));
  if (!hipsTrack?.positions?.length) {
    return output;
  }

  const base = hipsTrack.positions[0] || { x: 0, y: 0, z: 0 };
  const baseHorizontal = getAxisValue(base, projectionAxes.horizontalAxis);
  const baseVertical = getAxisValue(base, projectionAxes.verticalAxis);
  const rawX = new Array(frameCount).fill(0);
  const rawY = new Array(frameCount).fill(0);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const position = hipsTrack.positions[frameIndex] || base;
    rawX[frameIndex] = getAxisValue(position, projectionAxes.horizontalAxis) - baseHorizontal;
    rawY[frameIndex] = getAxisValue(position, projectionAxes.verticalAxis) - baseVertical;
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
  if (!axis) {
    return null;
  }

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

  const projectionAxes = resolveProjectionAxes(canonicalTracks, options, warnings);

  const worldAnglesByJoint = {};
  for (const jointName of Object.keys(canonicalTracks)) {
    const worldAngles = buildJointWorldAngleTrack(canonicalTracks, jointName, frameCount, options, projectionAxes);
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
  const hipsTranslation = buildHipsTranslationTrack(hipsTrack, frameCount, options, projectionAxes);

  const leftArmX = averagePositionAxis(
    canonicalTracks.leftArm,
    projectionAxes.horizontalAxis,
    toFinite(options.sourceSideCalibrationFrames, 5)
  );
  const rightArmX = averagePositionAxis(
    canonicalTracks.rightArm,
    projectionAxes.horizontalAxis,
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
    axisMapping: projectionAxes,
    missingCanonicalJoints: canonicalData?.missingCanonicalJoints || [],
    warnings
  };
}
