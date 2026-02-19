import { toCanonicalHumanoid } from './canonicalize.js';
import { degreesToRadians, roundTo } from './math.js';

const VALID_MODES = new Set(['spine-first', 'fbx-first']);
const VALID_MISMATCH_POLICIES = new Set(['auto-add-bones', 'skip-missing', 'strict-fail']);
const VALID_SCOPES = new Set(['full-hierarchy']);
const DEFAULT_OPTIONS = Object.freeze({
  mode: 'spine-first',
  mismatchPolicy: 'auto-add-bones',
  scope: 'full-hierarchy'
});
const CANONICAL_PARENT_BY_JOINT = Object.freeze({
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
const EPSILON = 1e-5;

function toFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function sanitizeBoneName(value, fallback = 'fbx_bone') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\s/\\:;.,]+/g, '_')
    .replace(/[^A-Za-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function normalizeSkeletonOptions(inputOptions = {}, warnings = []) {
  const mode = String(inputOptions.mode || DEFAULT_OPTIONS.mode).trim().toLowerCase();
  const mismatchPolicy = String(inputOptions.mismatchPolicy || DEFAULT_OPTIONS.mismatchPolicy)
    .trim()
    .toLowerCase();
  const scope = String(inputOptions.scope || DEFAULT_OPTIONS.scope).trim().toLowerCase();

  const normalized = {
    mode: VALID_MODES.has(mode) ? mode : DEFAULT_OPTIONS.mode,
    mismatchPolicy: VALID_MISMATCH_POLICIES.has(mismatchPolicy) ? mismatchPolicy : DEFAULT_OPTIONS.mismatchPolicy,
    scope: VALID_SCOPES.has(scope) ? scope : DEFAULT_OPTIONS.scope
  };

  if (normalized.mode !== mode) {
    warnings.push(`Unsupported skeleton mode "${mode}" requested; defaulted to "${normalized.mode}".`);
  }
  if (normalized.mismatchPolicy !== mismatchPolicy) {
    warnings.push(
      `Unsupported skeleton mismatch policy "${mismatchPolicy}" requested; defaulted to "${normalized.mismatchPolicy}".`
    );
  }
  if (normalized.scope !== scope) {
    warnings.push(`Unsupported skeleton scope "${scope}" requested; defaulted to "${normalized.scope}".`);
  }

  return normalized;
}

function extractTargetBonesByCanonical(profile) {
  const targetBones = new Map();
  for (const [canonicalJoint, mapping] of Object.entries(profile?.targetBones || {})) {
    if (!mapping) {
      continue;
    }
    if (typeof mapping === 'string') {
      targetBones.set(canonicalJoint, mapping);
      continue;
    }
    if (typeof mapping === 'object' && mapping.bone) {
      targetBones.set(canonicalJoint, mapping.bone);
    }
  }
  return targetBones;
}

function collectSourceNodes(parsedFbx, warnings) {
  const nodes = [];
  const rawNodes = Array.isArray(parsedFbx?.skeleton?.nodes) ? parsedFbx.skeleton.nodes : [];

  if (rawNodes.length) {
    for (const node of rawNodes) {
      if (!node?.name) {
        continue;
      }
      nodes.push({
        name: node.name,
        parentName: node.parentName || null,
        depth: Math.max(0, Math.floor(toFinite(node.depth, 0))),
        isBone: Boolean(node.isBone),
        restWorldPosition: node.restWorldPosition || node.frame0WorldPosition || null,
        restLocalPosition: node.restLocalPosition || null,
        frame0WorldPosition: node.frame0WorldPosition || null
      });
    }
  }

  if (nodes.length) {
    const knownNames = new Set(nodes.map((node) => node.name));
    for (const node of nodes) {
      if (node.parentName && !knownNames.has(node.parentName)) {
        node.parentName = null;
      }
    }
    return nodes;
  }

  warnings.push('FBX skeleton metadata was unavailable; source hierarchy fell back to sampled track parent names.');
  const fallbackTracks = Object.values(parsedFbx?.jointTracks || {});
  const names = new Set(fallbackTracks.map((track) => track?.name).filter(Boolean));
  const fallbackNodes = fallbackTracks
    .filter((track) => track?.name)
    .map((track) => ({
      name: track.name,
      parentName: names.has(track.parentName) ? track.parentName : null,
      depth: 0,
      isBone: true,
      restWorldPosition: track.positions?.[0] || null,
      restLocalPosition: null,
      frame0WorldPosition: track.positions?.[0] || null
    }));

  computeAndApplyDepth(fallbackNodes);
  return fallbackNodes;
}

function computeAndApplyDepth(nodes) {
  const nodeByName = new Map(nodes.map((node) => [node.name, node]));
  const depthByName = new Map();

  const resolveDepth = (name, stack = new Set()) => {
    if (!name) {
      return 0;
    }
    if (depthByName.has(name)) {
      return depthByName.get(name);
    }
    if (stack.has(name)) {
      return 0;
    }
    stack.add(name);
    const node = nodeByName.get(name);
    const parentName = node?.parentName || null;
    const parentDepth = parentName ? resolveDepth(parentName, stack) : 0;
    stack.delete(name);
    const depth = parentName ? parentDepth + 1 : 0;
    depthByName.set(name, depth);
    return depth;
  };

  for (const node of nodes) {
    node.depth = resolveDepth(node.name);
  }
}

function sortNodesByHierarchy(nodes) {
  return nodes
    .slice()
    .sort((left, right) => (left.depth - right.depth) || left.name.localeCompare(right.name));
}

function buildNodeMap(nodes) {
  return new Map(nodes.map((node) => [node.name, node]));
}

function buildChildrenByParent(nodes) {
  const map = new Map();
  for (const node of nodes) {
    if (!node.parentName) {
      continue;
    }
    if (!map.has(node.parentName)) {
      map.set(node.parentName, []);
    }
    map.get(node.parentName).push(node.name);
  }
  for (const children of map.values()) {
    children.sort((a, b) => a.localeCompare(b));
  }
  return map;
}

function pickDominantAxis(vector, excluded = new Set()) {
  const axes = ['x', 'y', 'z'];
  let bestAxis = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const axis of axes) {
    if (excluded.has(axis)) {
      continue;
    }
    const value = Math.abs(toFinite(vector?.[axis], 0));
    if (value > bestValue) {
      bestValue = value;
      bestAxis = axis;
    }
  }
  return bestAxis || axes.find((axis) => !excluded.has(axis)) || 'x';
}

function vectorSubtract(left, right) {
  return {
    x: toFinite(left?.x, 0) - toFinite(right?.x, 0),
    y: toFinite(left?.y, 0) - toFinite(right?.y, 0),
    z: toFinite(left?.z, 0) - toFinite(right?.z, 0)
  };
}

function inferProjectionAxes(nodeByName, canonicalData, warnings) {
  const getCanonicalNode = (joint) => {
    const sourceName = canonicalData?.mapping?.[joint];
    if (!sourceName) {
      return null;
    }
    return nodeByName.get(sourceName) || null;
  };

  const getNodeWorldPosition = (node) => node?.restWorldPosition || node?.frame0WorldPosition || null;

  const hipsPosition = getNodeWorldPosition(getCanonicalNode('hips'));
  const headPosition = getNodeWorldPosition(getCanonicalNode('head')) || getNodeWorldPosition(getCanonicalNode('neck'));
  const leftArmPosition = getNodeWorldPosition(getCanonicalNode('leftArm'));
  const rightArmPosition = getNodeWorldPosition(getCanonicalNode('rightArm'));
  const leftLegPosition = getNodeWorldPosition(getCanonicalNode('leftUpLeg'));
  const rightLegPosition = getNodeWorldPosition(getCanonicalNode('rightUpLeg'));

  const spreadMin = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const spreadMax = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  for (const node of nodeByName.values()) {
    const position = getNodeWorldPosition(node);
    if (!position) {
      continue;
    }
    spreadMin.x = Math.min(spreadMin.x, toFinite(position.x, 0));
    spreadMin.y = Math.min(spreadMin.y, toFinite(position.y, 0));
    spreadMin.z = Math.min(spreadMin.z, toFinite(position.z, 0));
    spreadMax.x = Math.max(spreadMax.x, toFinite(position.x, 0));
    spreadMax.y = Math.max(spreadMax.y, toFinite(position.y, 0));
    spreadMax.z = Math.max(spreadMax.z, toFinite(position.z, 0));
  }

  const spreadVector = {
    x: Number.isFinite(spreadMin.x) ? spreadMax.x - spreadMin.x : 0,
    y: Number.isFinite(spreadMin.y) ? spreadMax.y - spreadMin.y : 0,
    z: Number.isFinite(spreadMin.z) ? spreadMax.z - spreadMin.z : 0
  };

  const verticalVector = hipsPosition && headPosition ? vectorSubtract(headPosition, hipsPosition) : spreadVector;
  const horizontalVector =
    leftArmPosition && rightArmPosition
      ? vectorSubtract(leftArmPosition, rightArmPosition)
      : leftLegPosition && rightLegPosition
        ? vectorSubtract(leftLegPosition, rightLegPosition)
        : spreadVector;

  const verticalAxis = pickDominantAxis(verticalVector);
  const horizontalAxis = pickDominantAxis(horizontalVector, new Set([verticalAxis]));
  const depthAxis = ['x', 'y', 'z'].find((axis) => axis !== horizontalAxis && axis !== verticalAxis) || 'z';

  warnings.push(
    `Skeleton conversion projection axes inferred as horizontal=${horizontalAxis}, vertical=${verticalAxis}, depth=${depthAxis}.`
  );

  return {
    horizontalAxis,
    verticalAxis,
    depthAxis
  };
}

function buildProjectedWorldPoints(nodeByName, axes) {
  const points = new Map();
  for (const [name, node] of nodeByName.entries()) {
    const position = node?.restWorldPosition || node?.frame0WorldPosition || null;
    points.set(name, {
      x: toFinite(position?.[axes.horizontalAxis], 0),
      y: toFinite(position?.[axes.verticalAxis], 0),
      z: toFinite(position?.[axes.depthAxis], 0)
    });
  }
  return points;
}

function buildSpineBoneMap(bones) {
  const byName = new Map();
  for (const bone of bones || []) {
    if (bone?.name) {
      byName.set(bone.name, bone);
    }
  }
  return byName;
}

function composeSpineWorldTransform(local, parent = null) {
  if (!parent) {
    return {
      x: toFinite(local.x, 0),
      y: toFinite(local.y, 0),
      rotation: toFinite(local.rotation, 0),
      scaleX: toFinite(local.scaleX, 1),
      scaleY: toFinite(local.scaleY, 1)
    };
  }

  const parentRotationRad = degreesToRadians(parent.rotation);
  const cos = Math.cos(parentRotationRad);
  const sin = Math.sin(parentRotationRad);
  const localX = toFinite(local.x, 0);
  const localY = toFinite(local.y, 0);
  const localScaleX = toFinite(local.scaleX, 1);
  const localScaleY = toFinite(local.scaleY, 1);

  return {
    x: parent.x + (localX * parent.scaleX) * cos - (localY * parent.scaleY) * sin,
    y: parent.y + (localX * parent.scaleX) * sin + (localY * parent.scaleY) * cos,
    rotation: parent.rotation + toFinite(local.rotation, 0),
    scaleX: parent.scaleX * localScaleX,
    scaleY: parent.scaleY * localScaleY
  };
}

function buildSpineWorldMap(bones) {
  const byName = buildSpineBoneMap(bones);
  const worldByName = new Map();

  const resolveWorld = (boneName, stack = new Set()) => {
    if (!boneName) {
      return null;
    }
    if (worldByName.has(boneName)) {
      return worldByName.get(boneName);
    }
    if (stack.has(boneName)) {
      return null;
    }

    const bone = byName.get(boneName);
    if (!bone) {
      return null;
    }

    stack.add(boneName);
    const parentWorld = bone.parent ? resolveWorld(bone.parent, stack) : null;
    stack.delete(boneName);

    const resolved = composeSpineWorldTransform(
      {
        x: toFinite(bone.x, 0),
        y: toFinite(bone.y, 0),
        rotation: toFinite(bone.rotation, 0),
        scaleX: toFinite(bone.scaleX, 1),
        scaleY: toFinite(bone.scaleY, 1)
      },
      parentWorld
    );
    worldByName.set(boneName, resolved);
    return resolved;
  };

  for (const bone of bones || []) {
    resolveWorld(bone.name);
  }

  return {
    byName,
    worldByName
  };
}

function normalizeAngle(angle) {
  let value = toFinite(angle, 0);
  while (value > 180) {
    value -= 360;
  }
  while (value < -180) {
    value += 360;
  }
  return value;
}

function worldToLocalPoint(worldPoint, parentWorld) {
  if (!parentWorld) {
    return {
      x: toFinite(worldPoint?.x, 0),
      y: toFinite(worldPoint?.y, 0)
    };
  }

  const deltaX = toFinite(worldPoint?.x, 0) - toFinite(parentWorld.x, 0);
  const deltaY = toFinite(worldPoint?.y, 0) - toFinite(parentWorld.y, 0);
  const rotationRad = degreesToRadians(toFinite(parentWorld.rotation, 0));
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const parentScaleX = Math.abs(toFinite(parentWorld.scaleX, 1)) <= EPSILON ? 1 : toFinite(parentWorld.scaleX, 1);
  const parentScaleY = Math.abs(toFinite(parentWorld.scaleY, 1)) <= EPSILON ? 1 : toFinite(parentWorld.scaleY, 1);

  return {
    x: ((deltaX * cos) + (deltaY * sin)) / parentScaleX,
    y: ((-deltaX * sin) + (deltaY * cos)) / parentScaleY
  };
}

function distance2d(a, b) {
  return Math.hypot(toFinite(a?.x, 0) - toFinite(b?.x, 0), toFinite(a?.y, 0) - toFinite(b?.y, 0));
}

function rotate2d(point, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: (point.x * cos) - (point.y * sin),
    y: (point.x * sin) + (point.y * cos)
  };
}

function median(values = []) {
  if (!values.length) {
    return null;
  }
  const sorted = values
    .map((value) => toFinite(value, Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildCanonicalSourceToTargetMap(canonicalData, targetBonesByCanonical) {
  const map = new Map();
  for (const [canonicalJoint, targetBone] of targetBonesByCanonical.entries()) {
    const sourceName = canonicalData?.mapping?.[canonicalJoint];
    if (sourceName && targetBone) {
      map.set(sourceName, targetBone);
    }
  }
  return map;
}

function estimateScaleRatioFromCanonical({
  canonicalData,
  targetBonesByCanonical,
  sourceWorldPoints,
  spineBonesByName,
  spineWorldByName
}) {
  const ratios = [];

  for (const [canonicalJoint, targetBoneName] of targetBonesByCanonical.entries()) {
    const sourceName = canonicalData?.mapping?.[canonicalJoint];
    const parentCanonical = CANONICAL_PARENT_BY_JOINT[canonicalJoint];
    const sourceParentName = parentCanonical ? canonicalData?.mapping?.[parentCanonical] : null;
    if (!sourceName || !sourceParentName) {
      continue;
    }

    const sourcePoint = sourceWorldPoints.get(sourceName);
    const sourceParentPoint = sourceWorldPoints.get(sourceParentName);
    if (!sourcePoint || !sourceParentPoint) {
      continue;
    }

    const sourceLength = distance2d(sourcePoint, sourceParentPoint);
    if (sourceLength <= EPSILON) {
      continue;
    }

    const targetBone = spineBonesByName.get(targetBoneName);
    if (!targetBone) {
      continue;
    }

    let targetLength = Math.abs(toFinite(targetBone.length, 0));
    if (targetLength <= EPSILON && targetBone.parent) {
      const targetWorld = spineWorldByName.get(targetBoneName);
      const targetParentWorld = spineWorldByName.get(targetBone.parent);
      if (targetWorld && targetParentWorld) {
        targetLength = distance2d(targetWorld, targetParentWorld);
      }
    }
    if (targetLength <= EPSILON) {
      continue;
    }

    ratios.push(targetLength / sourceLength);
  }

  const ratio = median(ratios);
  return Number.isFinite(ratio) && ratio > EPSILON ? ratio : 1;
}

function buildAlignmentTransform({
  canonicalData,
  canonicalSourceToTargetBone,
  sourceWorldPoints,
  spineWorldByName,
  scale,
  warnings
}) {
  const matchedPairs = [];
  for (const [sourceName, targetBoneName] of canonicalSourceToTargetBone.entries()) {
    const sourcePoint = sourceWorldPoints.get(sourceName);
    const targetPoint = spineWorldByName.get(targetBoneName);
    if (sourcePoint && targetPoint) {
      matchedPairs.push({
        sourceName,
        targetBoneName,
        sourcePoint,
        targetPoint
      });
    }
  }

  if (!matchedPairs.length) {
    warnings.push('Skeleton conversion alignment fell back to identity transform (no canonical source/target anchor pairs).');
    return {
      sourceOrigin: { x: 0, y: 0 },
      targetOrigin: { x: 0, y: 0 },
      rotationRad: 0,
      scale: toFinite(scale, 1)
    };
  }

  let originPair = matchedPairs[0];
  const hipsSource = canonicalData?.mapping?.hips;
  if (hipsSource) {
    const hipsPair = matchedPairs.find((pair) => pair.sourceName === hipsSource);
    if (hipsPair) {
      originPair = hipsPair;
    }
  }

  let rotationRad = 0;
  const tryPairRotation = (sourceAName, sourceBName) => {
    const pairA = matchedPairs.find((pair) => pair.sourceName === sourceAName);
    const pairB = matchedPairs.find((pair) => pair.sourceName === sourceBName);
    if (!pairA || !pairB) {
      return null;
    }
    const sourceVector = vectorSubtract(pairB.sourcePoint, pairA.sourcePoint);
    const targetVector = vectorSubtract(pairB.targetPoint, pairA.targetPoint);
    if (Math.hypot(sourceVector.x, sourceVector.y) <= EPSILON || Math.hypot(targetVector.x, targetVector.y) <= EPSILON) {
      return null;
    }
    const sourceAngle = Math.atan2(sourceVector.y, sourceVector.x);
    const targetAngle = Math.atan2(targetVector.y, targetVector.x);
    return targetAngle - sourceAngle;
  };

  const canonicalRotationCandidates = [
    ['hips', 'head'],
    ['leftArm', 'rightArm'],
    ['leftUpLeg', 'rightUpLeg']
  ];
  for (const [leftJoint, rightJoint] of canonicalRotationCandidates) {
    const sourceAName = canonicalData?.mapping?.[leftJoint];
    const sourceBName = canonicalData?.mapping?.[rightJoint];
    if (!sourceAName || !sourceBName) {
      continue;
    }
    const candidate = tryPairRotation(sourceAName, sourceBName);
    if (candidate === null) {
      continue;
    }
    rotationRad = candidate;
    break;
  }

  if (rotationRad === 0 && matchedPairs.length >= 2) {
    const fallback = tryPairRotation(matchedPairs[0].sourceName, matchedPairs[1].sourceName);
    if (fallback !== null) {
      rotationRad = fallback;
    }
  }

  return {
    sourceOrigin: {
      x: toFinite(originPair.sourcePoint.x, 0),
      y: toFinite(originPair.sourcePoint.y, 0)
    },
    targetOrigin: {
      x: toFinite(originPair.targetPoint.x, 0),
      y: toFinite(originPair.targetPoint.y, 0)
    },
    rotationRad,
    scale: toFinite(scale, 1)
  };
}

function applyAlignment(point, alignment) {
  const translated = {
    x: toFinite(point?.x, 0) - toFinite(alignment.sourceOrigin?.x, 0),
    y: toFinite(point?.y, 0) - toFinite(alignment.sourceOrigin?.y, 0)
  };
  const rotated = rotate2d(translated, toFinite(alignment.rotationRad, 0));
  const scale = toFinite(alignment.scale, 1);
  return {
    x: (rotated.x * scale) + toFinite(alignment.targetOrigin?.x, 0),
    y: (rotated.y * scale) + toFinite(alignment.targetOrigin?.y, 0)
  };
}

function computeWorldOrientation(nodeName, worldPointsByName, childrenByParent, nodeByName) {
  const point = worldPointsByName.get(nodeName);
  if (!point) {
    return 0;
  }

  const children = childrenByParent.get(nodeName) || [];
  let vector = null;
  if (children.length) {
    const firstChild = worldPointsByName.get(children[0]);
    if (firstChild) {
      vector = vectorSubtract(firstChild, point);
    }
  }

  if (!vector) {
    const parentName = nodeByName.get(nodeName)?.parentName || null;
    const parentPoint = parentName ? worldPointsByName.get(parentName) : null;
    if (parentPoint) {
      vector = vectorSubtract(point, parentPoint);
    }
  }

  if (!vector || Math.hypot(vector.x, vector.y) <= EPSILON) {
    return 0;
  }
  return Math.atan2(vector.y, vector.x) * (180 / Math.PI);
}

function computeNodeLength(nodeName, worldPointsByName, childrenByParent) {
  const point = worldPointsByName.get(nodeName);
  if (!point) {
    return 0;
  }

  const children = childrenByParent.get(nodeName) || [];
  if (!children.length) {
    return 0;
  }
  const childPoint = worldPointsByName.get(children[0]);
  if (!childPoint) {
    return 0;
  }
  return distance2d(point, childPoint);
}

function buildNormalizedIndex(names = []) {
  const index = new Map();
  for (const name of names) {
    const normalized = normalizeName(name);
    if (!normalized) {
      continue;
    }
    if (!index.has(normalized)) {
      index.set(normalized, []);
    }
    index.get(normalized).push(name);
  }
  return index;
}

function resolveByNormalizedName(name, normalizedIndex) {
  const normalized = normalizeName(name);
  if (!normalized || !normalizedIndex.has(normalized)) {
    return null;
  }
  const matches = normalizedIndex.get(normalized) || [];
  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
}

function generateUniqueBoneName(preferredName, usedNames) {
  const baseName = sanitizeBoneName(preferredName, 'fbx_bone');
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  let suffix = 1;
  while (suffix < 100000) {
    const candidate = `${baseName}_fbx_${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix += 1;
  }

  const fallback = `${baseName}_${Date.now()}`;
  usedNames.add(fallback);
  return fallback;
}

function ensureFallbackRoot(spineJson, report) {
  spineJson.bones ||= [];
  if (spineJson.bones.length) {
    const rootBone = spineJson.bones.find((bone) => !bone?.parent) || spineJson.bones[0];
    return rootBone?.name || null;
  }

  const rootBone = { name: 'root' };
  spineJson.bones.push(rootBone);
  report.addedBones.push(rootBone.name);
  return rootBone.name;
}

function buildSpineFirstSkeleton({
  spineJson,
  sourceNodes,
  sourceNodeByName,
  canonicalData,
  targetBonesByCanonical,
  options,
  report
}) {
  const converted = deepClone(spineJson);
  converted.bones ||= [];
  const sourceNodesOrdered = sortNodesByHierarchy(sourceNodes);
  const sourceChildrenByParent = buildChildrenByParent(sourceNodesOrdered);
  const existingBoneNames = converted.bones.map((bone) => bone.name).filter(Boolean);
  const existingBoneSet = new Set(existingBoneNames);
  const existingNormalizedIndex = buildNormalizedIndex(existingBoneNames);
  const canonicalSourceToTarget = buildCanonicalSourceToTargetMap(canonicalData, targetBonesByCanonical);
  const sourceToBone = new Map();

  for (const [sourceName, targetBoneName] of canonicalSourceToTarget.entries()) {
    if (existingBoneSet.has(targetBoneName)) {
      sourceToBone.set(sourceName, targetBoneName);
    }
  }

  for (const node of sourceNodesOrdered) {
    if (sourceToBone.has(node.name)) {
      continue;
    }

    if (existingBoneSet.has(node.name)) {
      sourceToBone.set(node.name, node.name);
      continue;
    }

    const normalizedMatch = resolveByNormalizedName(node.name, existingNormalizedIndex);
    if (normalizedMatch) {
      sourceToBone.set(node.name, normalizedMatch);
    }
  }

  const { byName: spineBonesByName, worldByName: spineWorldByName } = buildSpineWorldMap(converted.bones);
  const projectionAxes = inferProjectionAxes(sourceNodeByName, canonicalData, report.warnings);
  const sourceWorldPoints = buildProjectedWorldPoints(sourceNodeByName, projectionAxes);
  const scale = estimateScaleRatioFromCanonical({
    canonicalData,
    targetBonesByCanonical,
    sourceWorldPoints,
    spineBonesByName,
    spineWorldByName
  });
  const alignment = buildAlignmentTransform({
    canonicalData,
    canonicalSourceToTargetBone: canonicalSourceToTarget,
    sourceWorldPoints,
    spineWorldByName,
    scale,
    warnings: report.warnings
  });
  const alignedWorldPoints = new Map();
  for (const [sourceName, sourcePoint] of sourceWorldPoints.entries()) {
    alignedWorldPoints.set(sourceName, applyAlignment(sourcePoint, alignment));
  }

  const rootBoneName = ensureFallbackRoot(converted, report);
  if (!rootBoneName) {
    throw new Error('Spine-first skeleton conversion failed because a root bone could not be resolved.');
  }

  const unresolvedNodes = [];
  const usedBoneNames = new Set(converted.bones.map((bone) => bone.name).filter(Boolean));
  const workingWorldByName = buildSpineWorldMap(converted.bones).worldByName;

  for (const node of sourceNodesOrdered) {
    if (sourceToBone.has(node.name)) {
      continue;
    }

    if (options.mismatchPolicy === 'strict-fail') {
      unresolvedNodes.push(node.name);
      continue;
    }

    if (options.mismatchPolicy === 'skip-missing') {
      report.warnings.push(`Skipped unmapped FBX source node "${node.name}" due to skeleton mismatch policy.`);
      continue;
    }

    const preferredName = sanitizeBoneName(node.name, 'fbx_bone');
    const addedBoneName = generateUniqueBoneName(preferredName, usedBoneNames);
    const parentBoneName = sourceToBone.get(node.parentName) || rootBoneName;
    const parentWorld = workingWorldByName.get(parentBoneName) || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1
    };
    const worldPoint = alignedWorldPoints.get(node.name) || { x: parentWorld.x, y: parentWorld.y };
    const localPoint = worldToLocalPoint(worldPoint, parentWorld);
    const worldOrientation = computeWorldOrientation(node.name, alignedWorldPoints, sourceChildrenByParent, sourceNodeByName);
    const localRotation = normalizeAngle(worldOrientation - toFinite(parentWorld.rotation, 0));
    const length = computeNodeLength(node.name, alignedWorldPoints, sourceChildrenByParent);

    const newBone = {
      name: addedBoneName,
      parent: parentBoneName
    };

    if (Math.abs(localPoint.x) > EPSILON) {
      newBone.x = roundTo(localPoint.x, 4);
    }
    if (Math.abs(localPoint.y) > EPSILON) {
      newBone.y = roundTo(localPoint.y, 4);
    }
    if (Math.abs(localRotation) > EPSILON) {
      newBone.rotation = roundTo(localRotation, 4);
    }
    if (length > EPSILON) {
      newBone.length = roundTo(length, 4);
    }

    converted.bones.push(newBone);
    report.addedBones.push(addedBoneName);
    sourceToBone.set(node.name, addedBoneName);
    workingWorldByName.set(
      addedBoneName,
      composeSpineWorldTransform(
        {
          x: toFinite(newBone.x, 0),
          y: toFinite(newBone.y, 0),
          rotation: toFinite(newBone.rotation, 0),
          scaleX: toFinite(newBone.scaleX, 1),
          scaleY: toFinite(newBone.scaleY, 1)
        },
        parentWorld
      )
    );
  }

  if (unresolvedNodes.length) {
    throw new Error(
      `Spine-first skeleton conversion failed with strict mismatch policy. Missing mappings: ${unresolvedNodes.join(', ')}`
    );
  }

  return {
    convertedSpineJson: converted
  };
}

function buildCanonicalPreferredNames(canonicalData, targetBonesByCanonical) {
  const sourceToPreferred = new Map();
  for (const [canonicalJoint, targetBoneName] of targetBonesByCanonical.entries()) {
    const sourceName = canonicalData?.mapping?.[canonicalJoint];
    if (sourceName && targetBoneName) {
      sourceToPreferred.set(sourceName, targetBoneName);
    }
  }
  return sourceToPreferred;
}

function remapWeightedVerticesInPlace(vertices, oldToNewIndexMap, fallbackIndex) {
  if (!Array.isArray(vertices) || !vertices.length) {
    return false;
  }

  let cursor = 0;
  while (cursor < vertices.length) {
    const boneCount = Math.floor(toFinite(vertices[cursor], Number.NaN));
    if (!Number.isFinite(boneCount) || boneCount <= 0) {
      return false;
    }

    const expectedEnd = cursor + 1 + (boneCount * 4);
    if (expectedEnd > vertices.length) {
      return false;
    }

    cursor += 1;
    for (let index = 0; index < boneCount; index += 1) {
      const oldBoneIndex = Math.floor(toFinite(vertices[cursor], fallbackIndex));
      vertices[cursor] = oldToNewIndexMap.get(oldBoneIndex) ?? fallbackIndex;
      cursor += 4;
    }
  }

  return true;
}

function iterateSkinAttachments(spineJson, visitor) {
  const skins = spineJson?.skins;
  if (Array.isArray(skins)) {
    for (const skin of skins) {
      const attachmentsBySlot = skin?.attachments;
      if (!attachmentsBySlot || typeof attachmentsBySlot !== 'object') {
        continue;
      }
      for (const [slotName, attachments] of Object.entries(attachmentsBySlot)) {
        if (!attachments || typeof attachments !== 'object') {
          continue;
        }
        for (const [attachmentName, attachment] of Object.entries(attachments)) {
          visitor(attachment, {
            skinName: skin?.name || '',
            slotName,
            attachmentName
          });
        }
      }
    }
    return;
  }

  if (!skins || typeof skins !== 'object') {
    return;
  }

  for (const [skinName, skinValue] of Object.entries(skins)) {
    if (!skinValue || typeof skinValue !== 'object') {
      continue;
    }
    for (const [slotName, attachments] of Object.entries(skinValue)) {
      if (!attachments || typeof attachments !== 'object') {
        continue;
      }
      for (const [attachmentName, attachment] of Object.entries(attachments)) {
        visitor(attachment, {
          skinName,
          slotName,
          attachmentName
        });
      }
    }
  }
}

function remapSkinBoneIndices(spineJson, oldBones, resolveBoneReference, report, fallbackRootName) {
  const resolvedNamesByOldIndex = new Map();
  for (let index = 0; index < oldBones.length; index += 1) {
    const oldName = oldBones[index]?.name;
    if (!oldName) {
      continue;
    }
    const resolvedName = resolveBoneReference(oldName, {
      context: 'skin weights',
      allowSkip: false
    });
    resolvedNamesByOldIndex.set(index, resolvedName || fallbackRootName);
  }

  const newBoneIndexByName = new Map((spineJson?.bones || []).map((bone, index) => [bone?.name, index]));
  const fallbackIndex = newBoneIndexByName.get(fallbackRootName) ?? 0;
  const oldToNewIndexMap = new Map();
  for (const [oldIndex, resolvedName] of resolvedNamesByOldIndex.entries()) {
    oldToNewIndexMap.set(oldIndex, newBoneIndexByName.get(resolvedName) ?? fallbackIndex);
  }

  let remappedAttachmentCount = 0;
  iterateSkinAttachments(spineJson, (attachment) => {
    if (!attachment || !Array.isArray(attachment.vertices)) {
      return;
    }

    const vertexCount = Number.isFinite(attachment.vertexCount)
      ? Math.floor(attachment.vertexCount)
      : Array.isArray(attachment.uvs)
        ? Math.floor(attachment.uvs.length / 2)
        : null;
    if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
      return;
    }

    const unweightedLength = vertexCount * 2;
    if (attachment.vertices.length <= unweightedLength) {
      return;
    }

    if (remapWeightedVerticesInPlace(attachment.vertices, oldToNewIndexMap, fallbackIndex)) {
      remappedAttachmentCount += 1;
    }
  });

  if (remappedAttachmentCount > 0) {
    report.warnings.push(`Remapped weighted skin bone indices for ${remappedAttachmentCount} attachment(s).`);
  }
}

function collectMissingBoneReferences(spineJson) {
  const boneSet = new Set((spineJson?.bones || []).map((bone) => bone?.name).filter(Boolean));
  const missing = new Set();

  for (const slot of spineJson?.slots || []) {
    if (slot?.bone && !boneSet.has(slot.bone)) {
      missing.add(slot.bone);
    }
  }

  const constraintGroups = [spineJson?.ik || [], spineJson?.path || [], spineJson?.transform || []];
  for (const constraints of constraintGroups) {
    for (const constraint of constraints) {
      if (constraint?.target && !boneSet.has(constraint.target)) {
        missing.add(constraint.target);
      }
      for (const boneName of constraint?.bones || []) {
        if (boneName && !boneSet.has(boneName)) {
          missing.add(boneName);
        }
      }
    }
  }

  const animations = spineJson?.animations || {};
  for (const animation of Object.values(animations)) {
    for (const boneName of Object.keys(animation?.bones || {})) {
      if (!boneSet.has(boneName)) {
        missing.add(boneName);
      }
    }
  }

  return missing;
}

function buildFbxFirstSkeleton({
  spineJson,
  sourceNodes,
  sourceNodeByName,
  canonicalData,
  targetBonesByCanonical,
  options,
  report
}) {
  const originalSpine = deepClone(spineJson);
  const originalBones = Array.isArray(originalSpine?.bones) ? originalSpine.bones : [];
  const originalBoneByName = buildSpineBoneMap(originalBones);
  const sourceNodesOrdered = sortNodesByHierarchy(sourceNodes);
  const sourceChildrenByParent = buildChildrenByParent(sourceNodesOrdered);
  const projectionAxes = inferProjectionAxes(sourceNodeByName, canonicalData, report.warnings);
  const sourceWorldPoints = buildProjectedWorldPoints(sourceNodeByName, projectionAxes);
  const { byName: originalBonesByName, worldByName: originalWorldByName } = buildSpineWorldMap(originalBones);
  const canonicalSourceToTarget = buildCanonicalSourceToTargetMap(canonicalData, targetBonesByCanonical);
  const scale = estimateScaleRatioFromCanonical({
    canonicalData,
    targetBonesByCanonical,
    sourceWorldPoints,
    spineBonesByName: originalBonesByName,
    spineWorldByName: originalWorldByName
  });
  const alignment = buildAlignmentTransform({
    canonicalData,
    canonicalSourceToTargetBone: canonicalSourceToTarget,
    sourceWorldPoints,
    spineWorldByName: originalWorldByName,
    scale,
    warnings: report.warnings
  });

  const alignedWorldPoints = new Map();
  for (const [sourceName, sourcePoint] of sourceWorldPoints.entries()) {
    alignedWorldPoints.set(sourceName, applyAlignment(sourcePoint, alignment));
  }

  const rootCandidate =
    originalBones.find((bone) => bone && !bone.parent) || originalBones.find((bone) => bone?.name === 'root') || null;
  const rootName = rootCandidate?.name || 'root';
  const rootBone = rootCandidate ? deepClone(rootCandidate) : { name: rootName };
  delete rootBone.parent;

  const converted = deepClone(originalSpine);
  const newBones = [rootBone];
  const usedNames = new Set([rootName]);
  const sourceToNewBoneName = new Map();
  const canonicalPreferredNames = buildCanonicalPreferredNames(canonicalData, targetBonesByCanonical);

  for (const node of sourceNodesOrdered) {
    const preferredName = canonicalPreferredNames.get(node.name) || sanitizeBoneName(node.name, 'fbx_bone');
    const resolvedName = generateUniqueBoneName(preferredName === rootName ? `${preferredName}_fbx` : preferredName, usedNames);
    sourceToNewBoneName.set(node.name, resolvedName);
  }

  const workingWorldByName = new Map();
  workingWorldByName.set(rootName, {
    x: toFinite(rootBone.x, 0),
    y: toFinite(rootBone.y, 0),
    rotation: toFinite(rootBone.rotation, 0),
    scaleX: toFinite(rootBone.scaleX, 1),
    scaleY: toFinite(rootBone.scaleY, 1)
  });

  for (const node of sourceNodesOrdered) {
    const boneName = sourceToNewBoneName.get(node.name);
    const parentBoneName = sourceToNewBoneName.get(node.parentName) || rootName;
    const parentWorld = workingWorldByName.get(parentBoneName) || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1
    };
    const worldPoint = alignedWorldPoints.get(node.name) || { x: parentWorld.x, y: parentWorld.y };
    const localPoint = worldToLocalPoint(worldPoint, parentWorld);
    const worldOrientation = computeWorldOrientation(node.name, alignedWorldPoints, sourceChildrenByParent, sourceNodeByName);
    const localRotation = normalizeAngle(worldOrientation - toFinite(parentWorld.rotation, 0));
    const length = computeNodeLength(node.name, alignedWorldPoints, sourceChildrenByParent);

    const newBone = {
      name: boneName,
      parent: parentBoneName
    };
    if (Math.abs(localPoint.x) > EPSILON) {
      newBone.x = roundTo(localPoint.x, 4);
    }
    if (Math.abs(localPoint.y) > EPSILON) {
      newBone.y = roundTo(localPoint.y, 4);
    }
    if (Math.abs(localRotation) > EPSILON) {
      newBone.rotation = roundTo(localRotation, 4);
    }
    if (length > EPSILON) {
      newBone.length = roundTo(length, 4);
    }
    newBones.push(newBone);
    report.addedBones.push(newBone.name);

    workingWorldByName.set(
      boneName,
      composeSpineWorldTransform(
        {
          x: toFinite(newBone.x, 0),
          y: toFinite(newBone.y, 0),
          rotation: toFinite(newBone.rotation, 0),
          scaleX: toFinite(newBone.scaleX, 1),
          scaleY: toFinite(newBone.scaleY, 1)
        },
        parentWorld
      )
    );
  }

  converted.bones = newBones;
  const newBoneNameSet = new Set(newBones.map((bone) => bone?.name).filter(Boolean));
  const newNormalizedIndex = buildNormalizedIndex(Array.from(newBoneNameSet));
  const compatibilityBonesAdded = new Set();
  const remapCache = new Map();

  const ensureCompatibilityBone = (boneName, stack = new Set()) => {
    if (!boneName) {
      return rootName;
    }
    if (newBoneNameSet.has(boneName)) {
      return boneName;
    }
    if (compatibilityBonesAdded.has(boneName)) {
      return boneName;
    }
    if (stack.has(boneName)) {
      return rootName;
    }

    stack.add(boneName);
    const originalBone = originalBoneByName.get(boneName);
    const parentResolved =
      originalBone?.parent && originalBone.parent !== boneName
        ? ensureCompatibilityBone(originalBone.parent, stack)
        : rootName;
    stack.delete(boneName);

    const clone = originalBone ? deepClone(originalBone) : { name: boneName };
    clone.name = boneName;
    if (parentResolved && parentResolved !== boneName) {
      clone.parent = parentResolved;
    } else {
      delete clone.parent;
    }
    converted.bones.push(clone);
    newBoneNameSet.add(boneName);
    compatibilityBonesAdded.add(boneName);
    report.compatibilityBonesAdded.push(boneName);
    return boneName;
  };

  const resolveOldToNewCandidate = (boneName) => {
    if (!boneName) {
      return null;
    }
    if (newBoneNameSet.has(boneName)) {
      return boneName;
    }
    const normalizedMatch = resolveByNormalizedName(boneName, newNormalizedIndex);
    if (normalizedMatch) {
      return normalizedMatch;
    }
    return null;
  };

  const resolveBoneReference = (boneName, context = {}) => {
    if (!boneName) {
      return null;
    }
    if (remapCache.has(boneName)) {
      return remapCache.get(boneName);
    }

    const resolvedCandidate = resolveOldToNewCandidate(boneName);
    if (resolvedCandidate) {
      remapCache.set(boneName, resolvedCandidate);
      return resolvedCandidate;
    }

    if (options.mismatchPolicy === 'strict-fail') {
      throw new Error(`FBX-first skeleton conversion could not remap "${boneName}" (${context.context || 'reference'}).`);
    }

    if (options.mismatchPolicy === 'skip-missing' && context.allowSkip !== false) {
      remapCache.set(boneName, null);
      report.warnings.push(`Skipped unresolved bone reference "${boneName}" (${context.context || 'reference'}).`);
      return null;
    }

    const compatibilityName = ensureCompatibilityBone(boneName);
    remapCache.set(boneName, compatibilityName);
    report.warnings.push(`Added compatibility bone "${boneName}" for unresolved ${context.context || 'reference'}.`);
    return compatibilityName;
  };

  const remapBoneRef = (boneName, context) => {
    const resolved = resolveBoneReference(boneName, context);
    if (resolved && resolved !== boneName) {
      report.remappedReferences += 1;
    }
    return resolved;
  };

  if (Array.isArray(converted.slots)) {
    for (const slot of converted.slots) {
      if (!slot?.bone) {
        continue;
      }
      const resolved = remapBoneRef(slot.bone, { context: `slot "${slot.name || 'unknown'}"` });
      slot.bone = resolved || rootName;
    }
  }

  const remapConstraintCollection = (collection, label) => {
    if (!Array.isArray(collection)) {
      return [];
    }
    const remapped = [];

    for (const constraint of collection) {
      const next = deepClone(constraint);
      next.target = next.target ? remapBoneRef(next.target, { context: `${label} target "${next.name || 'unknown'}"` }) : next.target;
      if (Array.isArray(next.bones)) {
        const remappedBones = [];
        for (const boneName of next.bones) {
          const resolvedBone = remapBoneRef(boneName, { context: `${label} bones "${next.name || 'unknown'}"` });
          if (resolvedBone) {
            remappedBones.push(resolvedBone);
          }
        }
        next.bones = remappedBones;
      }

      if (options.mismatchPolicy === 'skip-missing') {
        const hasValidTarget = !next.target || newBoneNameSet.has(next.target);
        const hasValidBones = !Array.isArray(next.bones) || next.bones.length > 0;
        if (!hasValidTarget || !hasValidBones) {
          report.warnings.push(`Dropped ${label} constraint "${next.name || 'unknown'}" due to unresolved bone references.`);
          continue;
        }
      }

      remapped.push(next);
    }

    return remapped;
  };

  converted.ik = remapConstraintCollection(converted.ik, 'IK');
  converted.path = remapConstraintCollection(converted.path, 'path');
  converted.transform = remapConstraintCollection(converted.transform, 'transform');

  const animations = converted.animations || {};
  for (const [animationName, animation] of Object.entries(animations)) {
    const nextBones = {};
    for (const [boneName, timeline] of Object.entries(animation?.bones || {})) {
      const resolvedBone = remapBoneRef(boneName, { context: `animation "${animationName}"` });
      if (!resolvedBone) {
        continue;
      }
      if (hasOwn(nextBones, resolvedBone)) {
        nextBones[resolvedBone] = {
          ...(nextBones[resolvedBone] || {}),
          ...(timeline || {})
        };
        report.warnings.push(
          `Merged duplicate animation bone timelines into "${resolvedBone}" while remapping "${animationName}".`
        );
      } else {
        nextBones[resolvedBone] = timeline;
      }
    }
    animation.bones = nextBones;
  }

  remapSkinBoneIndices(converted, originalBones, resolveBoneReference, report, rootName);

  let missingRefs = collectMissingBoneReferences(converted);
  if (missingRefs.size) {
    if (options.mismatchPolicy === 'strict-fail') {
      throw new Error(`FBX-first skeleton conversion left unresolved references: ${Array.from(missingRefs).join(', ')}`);
    }

    if (options.mismatchPolicy === 'skip-missing') {
      report.warnings.push(
        `FBX-first conversion dropped or redirected unresolved references: ${Array.from(missingRefs).join(', ')}.`
      );
      for (const slot of converted.slots || []) {
        if (slot?.bone && missingRefs.has(slot.bone)) {
          slot.bone = rootName;
        }
      }
      for (const animation of Object.values(converted.animations || {})) {
        for (const boneName of Object.keys(animation?.bones || {})) {
          if (missingRefs.has(boneName)) {
            delete animation.bones[boneName];
          }
        }
      }
    } else {
      for (const missingBoneName of missingRefs) {
        ensureCompatibilityBone(missingBoneName);
      }
      report.warnings.push(`Added compatibility bones for unresolved references: ${Array.from(missingRefs).join(', ')}.`);
    }
  }

  missingRefs = collectMissingBoneReferences(converted);
  if (missingRefs.size) {
    throw new Error(`FBX-first skeleton conversion failed validation. Missing references: ${Array.from(missingRefs).join(', ')}`);
  }

  return {
    convertedSpineJson: converted
  };
}

export function convertSkeletonFromFbx({
  spineJson,
  parsedFbx,
  canonicalData = null,
  profile = null,
  options = {}
}) {
  if (!spineJson || typeof spineJson !== 'object') {
    throw new Error('A valid Spine JSON object is required for skeleton conversion.');
  }
  if (!parsedFbx || typeof parsedFbx !== 'object') {
    throw new Error('A valid parsed FBX payload is required for skeleton conversion.');
  }

  const warnings = [];
  const normalizedOptions = normalizeSkeletonOptions(options, warnings);
  const sourceNodes = collectSourceNodes(parsedFbx, warnings);
  if (!sourceNodes.length) {
    throw new Error('No FBX skeleton nodes were found for skeleton conversion.');
  }
  computeAndApplyDepth(sourceNodes);
  const sourceNodeByName = buildNodeMap(sourceNodes);
  const canonical = canonicalData || toCanonicalHumanoid(parsedFbx, { aliases: null });
  const targetBonesByCanonical = extractTargetBonesByCanonical(profile);

  const report = {
    mode: normalizedOptions.mode,
    addedBones: [],
    remappedReferences: 0,
    compatibilityBonesAdded: [],
    warnings
  };

  if (normalizedOptions.scope !== 'full-hierarchy') {
    report.warnings.push(
      `Skeleton conversion scope "${normalizedOptions.scope}" is not supported in this runtime; using full hierarchy.`
    );
  }

  if (normalizedOptions.mode === 'spine-first') {
    const result = buildSpineFirstSkeleton({
      spineJson,
      sourceNodes,
      sourceNodeByName,
      canonicalData: canonical,
      targetBonesByCanonical,
      options: normalizedOptions,
      report
    });
    return {
      convertedSpineJson: result.convertedSpineJson,
      report
    };
  }

  const result = buildFbxFirstSkeleton({
    spineJson,
    sourceNodes,
    sourceNodeByName,
    canonicalData: canonical,
    targetBonesByCanonical,
    options: normalizedOptions,
    report
  });
  return {
    convertedSpineJson: result.convertedSpineJson,
    report
  };
}
