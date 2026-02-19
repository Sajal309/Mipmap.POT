import { AnimationMixer, LoopRepeat, Quaternion, Vector3 } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const DEFAULT_FPS = 30;

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
      parentName: findNearestTrackedParentName(node, trackedSet),
      positions: [],
      rotations: []
    };
  }

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
    warnings,
    metadata: {
      clipName: clip.name || null,
      clipDuration: clip.duration,
      trackedJointCount: trackedNodes.length
    }
  };
}
