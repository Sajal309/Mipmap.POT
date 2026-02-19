import { AnimationMixer, LoopRepeat, Quaternion, Vector3 } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const DEFAULT_FPS = 30;

function toFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) {
    return input;
  }

  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }

  throw new Error('FBX input must be ArrayBuffer or typed array.');
}

function getStemFromFilename(fileName) {
  const source = String(fileName || 'clip').trim();
  const stripped = source.split('/').pop().split('\\').pop();
  return stripped.replace(/\.[^.]+$/, '') || 'clip';
}

function buildFrameTimes(duration, fps) {
  const safeDuration = Math.max(1 / fps, duration);
  const frameCount = Math.max(2, Math.floor(safeDuration * fps) + 1);
  const frameTimes = new Array(frameCount);

  for (let index = 0; index < frameCount; index += 1) {
    if (index === frameCount - 1) {
      frameTimes[index] = safeDuration;
    } else {
      frameTimes[index] = index / fps;
    }
  }

  return frameTimes;
}

function chooseClip(animations = []) {
  if (!Array.isArray(animations) || !animations.length) {
    return null;
  }

  let best = animations[0];
  for (const clip of animations) {
    if ((clip?.duration || 0) > (best?.duration || 0)) {
      best = clip;
    }
  }

  return best;
}

function shouldTrackNode(node) {
  if (!node?.name) {
    return false;
  }

  if (node.isBone || node.type === 'Bone') {
    return true;
  }

  if (node.isMesh || node.type === 'Mesh') {
    return false;
  }

  const normalized = node.name.toLowerCase();
  return (
    normalized.includes('mixamorig') ||
    normalized.includes('hips') ||
    normalized.includes('spine') ||
    normalized.includes('neck') ||
    normalized.includes('head') ||
    normalized.includes('arm') ||
    normalized.includes('hand') ||
    normalized.includes('leg') ||
    normalized.includes('foot') ||
    normalized.includes('root')
  );
}

function collectTrackedNodes(root) {
  const tracked = [];

  root.traverse((node) => {
    if (shouldTrackNode(node)) {
      tracked.push(node);
    }
  });

  return tracked;
}

function findNearestTrackedParentName(node, trackedSet) {
  let parent = node.parent;
  while (parent) {
    if (trackedSet.has(parent)) {
      return parent.name || null;
    }
    parent = parent.parent;
  }

  return null;
}

function toVectorObject(vector) {
  return {
    x: toFinite(vector?.x, 0),
    y: toFinite(vector?.y, 0),
    z: toFinite(vector?.z, 0)
  };
}

function toQuaternionObject(quaternion) {
  return {
    x: toFinite(quaternion?.x, 0),
    y: toFinite(quaternion?.y, 0),
    z: toFinite(quaternion?.z, 0),
    w: toFinite(quaternion?.w, 1)
  };
}

function buildTrackedDepthMap(trackedNodes, trackedSet) {
  const parentByName = new Map();
  for (const node of trackedNodes) {
    parentByName.set(node.name, findNearestTrackedParentName(node, trackedSet));
  }

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
    const parentName = parentByName.get(name);
    const depth = parentName ? resolveDepth(parentName, stack) + 1 : 0;
    stack.delete(name);
    depthByName.set(name, depth);
    return depth;
  };

  for (const node of trackedNodes) {
    resolveDepth(node.name);
  }

  return {
    parentByName,
    depthByName
  };
}

export async function parseFbxAnimationFromBuffer(arrayBuffer, filename = 'clip.fbx', options = {}) {
  const fps = Math.max(1, Number(options.fps) || DEFAULT_FPS);
  const warnings = [];

  const loader = new FBXLoader();
  const root = loader.parse(toArrayBuffer(arrayBuffer), '');

  const clip = chooseClip(root.animations || []);
  if (!clip) {
    throw new Error('No animation clips were found in this FBX file.');
  }

  const trackedNodes = collectTrackedNodes(root);
  if (!trackedNodes.length) {
    throw new Error('No FBX joint nodes were found for retargeting.');
  }

  const trackedSet = new Set(trackedNodes);
  const { parentByName, depthByName } = buildTrackedDepthMap(trackedNodes, trackedSet);
  const duration = Math.max(clip.duration || 0, 1 / fps);
  const frameTimes = buildFrameTimes(duration, fps);

  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopRepeat, Infinity);
  action.play();

  const positionBuffer = new Vector3();
  const quaternionBuffer = new Quaternion();

  const jointTracks = {};
  for (const node of trackedNodes) {
    jointTracks[node.name] = {
      name: node.name,
      sourceName: node.name,
      parentName: parentByName.get(node.name) || null,
      positions: [],
      rotations: []
    };
  }

  root.updateMatrixWorld(true);
  const restWorldPositionBuffer = new Vector3();
  const restWorldQuaternionBuffer = new Quaternion();
  const skeletonNodes = trackedNodes.map((node) => {
    node.getWorldPosition(restWorldPositionBuffer);
    node.getWorldQuaternion(restWorldQuaternionBuffer);

    return {
      name: node.name || '',
      parentName: parentByName.get(node.name) || null,
      isBone: Boolean(node.isBone || node.type === 'Bone'),
      depth: Math.max(0, depthByName.get(node.name) || 0),
      restWorldPosition: toVectorObject(restWorldPositionBuffer),
      restLocalPosition: toVectorObject(node.position),
      restWorldQuaternion: toQuaternionObject(restWorldQuaternionBuffer),
      frame0WorldPosition: null
    };
  });
  const skeletonNodeByName = new Map(skeletonNodes.map((node) => [node.name, node]));

  for (const time of frameTimes) {
    mixer.setTime(time);
    root.updateMatrixWorld(true);

    for (const node of trackedNodes) {
      const track = jointTracks[node.name];
      node.getWorldPosition(positionBuffer);
      node.getWorldQuaternion(quaternionBuffer);

      track.positions.push({
        x: positionBuffer.x,
        y: positionBuffer.y,
        z: positionBuffer.z
      });

      track.rotations.push({
        x: quaternionBuffer.x,
        y: quaternionBuffer.y,
        z: quaternionBuffer.z,
        w: quaternionBuffer.w
      });

      if (time === frameTimes[0]) {
        const skeletonNode = skeletonNodeByName.get(node.name);
        if (skeletonNode) {
          skeletonNode.frame0WorldPosition = {
            x: positionBuffer.x,
            y: positionBuffer.y,
            z: positionBuffer.z
          };
        }
      }
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  if (trackedNodes.every((node) => !node.isBone)) {
    warnings.push('FBX had no explicit bone nodes; retargeting used heuristic node selection.');
  }

  return {
    sourceFile: filename,
    clipName: clip.name || getStemFromFilename(filename),
    fps,
    duration: frameTimes[frameTimes.length - 1],
    frameTimes,
    jointTracks,
    skeleton: {
      nodes: skeletonNodes
    },
    warnings,
    metadata: {
      clipName: clip.name || null,
      clipDuration: clip.duration,
      trackedJointCount: trackedNodes.length
    }
  };
}
