const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function radiansToDegrees(radians) {
  return radians * RAD2DEG;
}

export function degreesToRadians(degrees) {
  return degrees * DEG2RAD;
}

export function normalizeAngleDegrees(angle) {
  let value = angle;
  while (value > 180) {
    value -= 360;
  }
  while (value < -180) {
    value += 360;
  }
  return value;
}

export function unwrapAngleSequence(values = []) {
  if (!values.length) {
    return [];
  }

  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    const prev = output[index - 1];
    let next = values[index];
    while (next - prev > 180) {
      next -= 360;
    }
    while (next - prev < -180) {
      next += 360;
    }
    output.push(next);
  }

  return output;
}

export function clampAngleDeltaSequence(values = [], maxDeltaDegrees = 40) {
  if (!values.length) {
    return [];
  }

  const output = [values[0]];
  const maxDelta = Math.max(0, Number(maxDeltaDegrees) || 0);

  for (let index = 1; index < values.length; index += 1) {
    const prev = output[index - 1];
    const rawDelta = values[index] - prev;
    const delta = clamp(rawDelta, -maxDelta, maxDelta);
    output.push(prev + delta);
  }

  return output;
}

export function applyDeadbandSequence(values = [], deadband = 0) {
  if (!values.length || deadband <= 0) {
    return values.slice();
  }

  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    const prev = output[index - 1];
    const value = values[index];
    output.push(Math.abs(value - prev) < deadband ? prev : value);
  }

  return output;
}

export function smoothSequence(values = [], alpha = 1) {
  if (!values.length || alpha >= 1) {
    return values.slice();
  }

  const factor = clamp(alpha, 0, 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(output[index - 1] + (values[index] - output[index - 1]) * factor);
  }

  return output;
}

export function quaternionFromEulerDegrees(xDeg = 0, yDeg = 0, zDeg = 0, order = 'XYZ') {
  const x = degreesToRadians(xDeg);
  const y = degreesToRadians(yDeg);
  const z = degreesToRadians(zDeg);

  const c1 = Math.cos(x * 0.5);
  const c2 = Math.cos(y * 0.5);
  const c3 = Math.cos(z * 0.5);
  const s1 = Math.sin(x * 0.5);
  const s2 = Math.sin(y * 0.5);
  const s3 = Math.sin(z * 0.5);

  if (order === 'XYZ') {
    return {
      x: s1 * c2 * c3 + c1 * s2 * s3,
      y: c1 * s2 * c3 - s1 * c2 * s3,
      z: c1 * c2 * s3 + s1 * s2 * c3,
      w: c1 * c2 * c3 - s1 * s2 * s3
    };
  }

  if (order === 'XZY') {
    return {
      x: s1 * c2 * c3 - c1 * s2 * s3,
      y: c1 * s2 * c3 - s1 * c2 * s3,
      z: c1 * c2 * s3 + s1 * s2 * c3,
      w: c1 * c2 * c3 + s1 * s2 * s3
    };
  }

  if (order === 'YXZ') {
    return {
      x: s1 * c2 * c3 + c1 * s2 * s3,
      y: c1 * s2 * c3 - s1 * c2 * s3,
      z: c1 * c2 * s3 - s1 * s2 * c3,
      w: c1 * c2 * c3 + s1 * s2 * s3
    };
  }

  if (order === 'YZX') {
    return {
      x: s1 * c2 * c3 + c1 * s2 * s3,
      y: c1 * s2 * c3 + s1 * c2 * s3,
      z: c1 * c2 * s3 - s1 * s2 * c3,
      w: c1 * c2 * c3 - s1 * s2 * s3
    };
  }

  if (order === 'ZXY') {
    return {
      x: s1 * c2 * c3 - c1 * s2 * s3,
      y: c1 * s2 * c3 + s1 * c2 * s3,
      z: c1 * c2 * s3 + s1 * s2 * c3,
      w: c1 * c2 * c3 - s1 * s2 * s3
    };
  }

  return {
    x: s1 * c2 * c3 - c1 * s2 * s3,
    y: c1 * s2 * c3 + s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3
  };
}

export function quaternionMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

export function quaternionNormalize(quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length
  };
}

export function rotateVectorByQuaternion(vector, quaternion) {
  const q = quaternion;
  const x = vector.x;
  const y = vector.y;
  const z = vector.z;

  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

export function composeWorldTransform(local, parent = null) {
  if (!parent) {
    return {
      position: { ...local.position },
      rotation: quaternionNormalize(local.rotation),
      scale: { ...local.scale }
    };
  }

  const scaledLocalPosition = {
    x: local.position.x * parent.scale.x,
    y: local.position.y * parent.scale.y,
    z: local.position.z * parent.scale.z
  };
  const rotatedPosition = rotateVectorByQuaternion(scaledLocalPosition, parent.rotation);

  return {
    position: {
      x: parent.position.x + rotatedPosition.x,
      y: parent.position.y + rotatedPosition.y,
      z: parent.position.z + rotatedPosition.z
    },
    rotation: quaternionNormalize(quaternionMultiply(parent.rotation, local.rotation)),
    scale: {
      x: parent.scale.x * local.scale.x,
      y: parent.scale.y * local.scale.y,
      z: parent.scale.z * local.scale.z
    }
  };
}

export function roundTo(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
