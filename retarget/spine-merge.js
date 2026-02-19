function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function sanitizeAnimationName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'fbx_animation';
}

export function resolveAnimationNameCollision(baseName, existingAnimations = {}) {
  const safeBase = sanitizeAnimationName(baseName);
  if (!Object.prototype.hasOwnProperty.call(existingAnimations, safeBase)) {
    return safeBase;
  }

  let suffix = 1;
  while (suffix < 100000) {
    const candidate = suffix === 1 ? `${safeBase}_fbx` : `${safeBase}_fbx_${suffix}`;
    if (!Object.prototype.hasOwnProperty.call(existingAnimations, candidate)) {
      return candidate;
    }
    suffix += 1;
  }

  return `${safeBase}_${Date.now()}`;
}

export function mergeAnimationNonDestructive(spineJson, animationName, animationData) {
  const mergedSpineJson = deepClone(spineJson);
  mergedSpineJson.animations ||= {};

  const resolvedName = resolveAnimationNameCollision(animationName, mergedSpineJson.animations);
  mergedSpineJson.animations[resolvedName] = animationData;

  return {
    mergedSpineJson,
    animationName: resolvedName
  };
}
