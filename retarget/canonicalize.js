const CANONICAL_JOINTS = Object.freeze([
  'hips',
  'spine',
  'spine1',
  'spine2',
  'neck',
  'head',
  'leftArm',
  'leftForeArm',
  'leftHand',
  'rightArm',
  'rightForeArm',
  'rightHand',
  'leftUpLeg',
  'leftLeg',
  'leftFoot',
  'rightUpLeg',
  'rightLeg',
  'rightFoot'
]);

const DEFAULT_ALIASES = Object.freeze({
  hips: ['mixamorig:hips', 'hips', 'hip', 'pelvis', 'root', 'centerhips'],
  spine: ['mixamorig:spine', 'spine', 'spine0', 'spine_01', 'abdomen'],
  spine1: ['mixamorig:spine1', 'spine1', 'spine_02', 'chest'],
  spine2: ['mixamorig:spine2', 'spine2', 'spine_03', 'upperchest'],
  neck: ['mixamorig:neck', 'neck', 'neck1'],
  head: ['mixamorig:head', 'head', 'headtop'],
  leftArm: ['mixamorig:leftarm', 'leftarm', 'larm', 'arm_l', 'lupperarm', 'leftshoulder', 'lshldr', 'lshoulder'],
  leftForeArm: ['mixamorig:leftforearm', 'leftforearm', 'lforearm', 'forearm_l', 'lfore_arm'],
  leftHand: ['mixamorig:lefthand', 'lefthand', 'lhand', 'hand_l', 'leftpalm', 'lpalm'],
  rightArm: [
    'mixamorig:rightarm',
    'rightarm',
    'rarm',
    'arm_r',
    'rupperarm',
    'rightshoulder',
    'rshldr',
    'rshoulder'
  ],
  rightForeArm: ['mixamorig:rightforearm', 'rightforearm', 'rforearm', 'forearm_r', 'rfore_arm'],
  rightHand: ['mixamorig:righthand', 'righthand', 'rhand', 'hand_r', 'rightpalm', 'rpalm'],
  leftUpLeg: ['mixamorig:leftupleg', 'leftupleg', 'lthigh', 'upleg_l', 'leftthigh', 'leftupperleg'],
  leftLeg: ['mixamorig:leftleg', 'leftleg', 'lleg', 'calf_l', 'leftcalf', 'leftshin', 'lshin'],
  leftFoot: ['mixamorig:leftfoot', 'leftfoot', 'lfoot', 'foot_l', 'leftankle'],
  rightUpLeg: ['mixamorig:rightupleg', 'rightupleg', 'rthigh', 'upleg_r', 'rightthigh', 'rightupperleg'],
  rightLeg: ['mixamorig:rightleg', 'rightleg', 'rleg', 'calf_r', 'rightcalf', 'rightshin', 'rshin'],
  rightFoot: ['mixamorig:rightfoot', 'rightfoot', 'rfoot', 'foot_r', 'rightankle']
});

const CANONICAL_FALLBACKS = Object.freeze({
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

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildAliasSet(aliasValue) {
  const set = new Set();
  for (const alias of aliasValue || []) {
    const normalized = normalizeName(alias);
    if (normalized) {
      set.add(normalized);
    }
  }
  return set;
}

function findTrackByAliases(trackEntries, aliasSet) {
  if (!aliasSet.size) {
    return null;
  }

  for (const entry of trackEntries) {
    if (aliasSet.has(entry.normalizedName)) {
      return entry;
    }
  }

  return null;
}

export function toCanonicalHumanoid(sourceData, options = {}) {
  const warnings = [];
  const sourceWarnings = Array.isArray(sourceData?.warnings) ? sourceData.warnings : [];
  warnings.push(...sourceWarnings);

  const aliasOverrides = options.aliases || {};
  const aliases = {};
  for (const joint of CANONICAL_JOINTS) {
    aliases[joint] = buildAliasSet(aliasOverrides[joint] || DEFAULT_ALIASES[joint] || []);
  }

  const jointTracks = sourceData?.jointTracks || {};
  const trackEntries = Object.values(jointTracks).map((track) => ({
    track,
    normalizedName: normalizeName(track.name || track.sourceName)
  }));

  const canonicalTracks = {};
  const mapping = {};
  const unresolvedCanonicalJoints = [];

  for (const canonicalJoint of CANONICAL_JOINTS) {
    const matchedEntry = findTrackByAliases(trackEntries, aliases[canonicalJoint]);
    if (!matchedEntry) {
      unresolvedCanonicalJoints.push(canonicalJoint);
      continue;
    }

    canonicalTracks[canonicalJoint] = {
      name: canonicalJoint,
      sourceName: matchedEntry.track.name,
      parentName: matchedEntry.track.parentName,
      positions: matchedEntry.track.positions || [],
      rotations: matchedEntry.track.rotations || []
    };
    mapping[canonicalJoint] = matchedEntry.track.name;
  }

  const missingCanonicalJoints = [];
  for (const unresolvedJoint of unresolvedCanonicalJoints) {
    const fallbackChain = CANONICAL_FALLBACKS[unresolvedJoint] || [];
    const fallbackJoint = fallbackChain.find((candidate) => Boolean(canonicalTracks[candidate]));
    if (!fallbackJoint) {
      missingCanonicalJoints.push(unresolvedJoint);
      continue;
    }

    const fallbackTrack = canonicalTracks[fallbackJoint];
    canonicalTracks[unresolvedJoint] = {
      name: unresolvedJoint,
      sourceName: fallbackTrack.sourceName,
      parentName: fallbackTrack.parentName,
      positions: fallbackTrack.positions || [],
      rotations: fallbackTrack.rotations || [],
      derivedFrom: fallbackJoint
    };
    mapping[unresolvedJoint] = fallbackTrack.sourceName;
    warnings.push(
      `Canonical joint "${unresolvedJoint}" was missing; reusing "${fallbackJoint}" source track "${fallbackTrack.sourceName}".`
    );
  }

  if (missingCanonicalJoints.length) {
    warnings.push(`Missing canonical joints: ${missingCanonicalJoints.join(', ')}`);
  }

  return {
    fps: sourceData?.fps,
    duration: sourceData?.duration,
    frameTimes: sourceData?.frameTimes || [],
    canonicalTracks,
    mapping,
    missingCanonicalJoints,
    warnings
  };
}

export { CANONICAL_JOINTS };
