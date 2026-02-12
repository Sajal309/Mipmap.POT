import * as PIXI from 'pixi.js';
import { Spine, SpineParser } from 'pixi-spine';

// Ensure spine loader plugin is registered for any Loader instance (shared or new).
PIXI.Loader.registerPlugin(SpineParser);

const PAGE_META_KEYS = new Set(['size', 'format', 'filter', 'repeat', 'pma', 'scale']);
const HISTORY_DB_NAME = 'spine-mipmap-preview-db';
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE = 'characters';
const FILTER_NAME_BY_VALUE = new Map([
  [9728, 'NEAREST'],
  [9729, 'LINEAR'],
  [9984, 'NEAREST_MIPMAP_NEAREST'],
  [9985, 'LINEAR_MIPMAP_NEAREST'],
  [9986, 'NEAREST_MIPMAP_LINEAR'],
  [9987, 'LINEAR_MIPMAP_LINEAR']
]);
const DEVICE_PROFILES = [
  {
    id: 'custom',
    label: 'Custom (manual)',
    viewportPreset: null,
    renderScale: null,
    fpsCap: null,
    cpuThrottleMs: 0,
    refreshHz: null,
    notes: 'Uses host browser/device characteristics.'
  },
  {
    id: 'small-phone',
    label: 'iPhone SE (2022)',
    viewportPreset: '375x667',
    renderScale: 2,
    fpsCap: 60,
    cpuThrottleMs: 7,
    refreshHz: 60,
    notes: 'Small phone class; constrained thermal/perf budget.'
  },
  {
    id: 'big-phone',
    label: 'iPhone 15 Pro Max',
    viewportPreset: '430x932',
    renderScale: 3,
    fpsCap: 120,
    cpuThrottleMs: 3,
    refreshHz: 120,
    notes: 'Large high-DPI phone class with ProMotion.'
  },
  {
    id: 'tablet',
    label: 'iPad Air 10.9"',
    viewportPreset: '820x1180',
    renderScale: 2,
    fpsCap: 60,
    cpuThrottleMs: 4,
    refreshHz: 60,
    notes: 'Tablet class with larger render surface.'
  },
  {
    id: 'laptop',
    label: '13" Laptop (1366x768)',
    viewportPreset: '1366x768',
    renderScale: 1,
    fpsCap: 60,
    cpuThrottleMs: 1,
    refreshHz: 60,
    notes: 'Mainstream laptop class baseline.'
  }
];
const LOCAL_SCREEN_ZOOM_STEP = 1.2;

const dom = {
  imageInput: document.getElementById('imageInput'),
  atlasInput: document.getElementById('atlasInput'),
  jsonInput: document.getElementById('jsonInput'),
  animationsInput: document.getElementById('animationsInput'),
  addButton: document.getElementById('addButton'),
  loadStatus: document.getElementById('loadStatus'),
  warnings: document.getElementById('warnings'),
  historyStatus: document.getElementById('historyStatus'),
  historyList: document.getElementById('historyList'),
  mipmapToggle: document.getElementById('mipmapToggle'),
  potOverrideToggle: document.getElementById('potOverrideToggle'),
  potWidthInput: document.getElementById('potWidthInput'),
  potHeightInput: document.getElementById('potHeightInput'),
  deviceProfileSelect: document.getElementById('deviceProfileSelect'),
  deviceProfileStatus: document.getElementById('deviceProfileStatus'),
  viewportPreset: document.getElementById('viewportPreset'),
  renderScaleSelect: document.getElementById('renderScaleSelect'),
  fpsCapSelect: document.getElementById('fpsCapSelect'),
  panToggle: document.getElementById('panToggle'),
  scale025: document.getElementById('scale025'),
  scale05: document.getElementById('scale05'),
  scale10: document.getElementById('scale10'),
  animationList: document.getElementById('animationList'),
  boneList: document.getElementById('boneList'),
  slotList: document.getElementById('slotList'),
  potStatus: document.getElementById('potStatus'),
  renderResolutionTag: document.getElementById('renderResolutionTag'),
  mipEstimateTag: document.getElementById('mipEstimateTag'),
  mipActiveTag: document.getElementById('mipActiveTag'),
  perfTag: document.getElementById('perfTag'),
  mipmapBadge: document.getElementById('mipmapBadge'),
  verificationPanel: document.getElementById('verificationPanel'),
  logsPanel: document.getElementById('logsPanel'),
  clearLogsButton: document.getElementById('clearLogsButton'),
  debugOverlay: document.getElementById('debugOverlay'),
  deviceFrame: document.getElementById('deviceFrame'),
  stageWrap: document.querySelector('.stage-wrap'),
  pixiHost: document.getElementById('pixiHost'),
  localZoomIn: document.getElementById('localZoomIn'),
  localZoomOut: document.getElementById('localZoomOut')
};

const app = new PIXI.Application({
  resizeTo: dom.pixiHost,
  antialias: true,
  backgroundAlpha: 0,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1
});

dom.pixiHost.appendChild(app.view);

const world = new PIXI.Container();
app.stage.addChild(world);

const state = {
  spineObject: null,
  pages: [],
  objectUrls: [],
  zoom: 1,
  dragOffsetX: 0,
  dragOffsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartOffsetX: 0,
  dragStartOffsetY: 0,
  panEnabled: false,
  panOffsetX: 0,
  panDirection: 1,
  requestedMipmaps: true,
  npotWarnings: [],
  lastVerification: null,
  frameMsEwma: 16.67,
  lastFrameTimestamp: 0,
  historySupported: typeof indexedDB !== 'undefined',
  historyRecords: [],
  historyPreviewUrls: [],
  activeHistoryRecordId: null,
  viewportBaseScale: 1,
  localScreenZoom: 1,
  activeDeviceProfileId: 'custom',
  simulatedCpuThrottleMs: 0,
  applyingDeviceProfile: false,
  logs: []
};

function setLoadStatus(message, tone = 'info') {
  dom.loadStatus.textContent = message;
  appendLog('loader', message, tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'info');
  if (tone === 'error') {
    dom.loadStatus.style.color = '#ff5f67';
  } else if (tone === 'warn') {
    dom.loadStatus.style.color = '#ffb347';
  } else {
    dom.loadStatus.style.color = '#d8e2f1';
  }
}

function setWarnings(messages = []) {
  if (!messages.length) {
    dom.warnings.textContent = '';
    return;
  }

  dom.warnings.innerHTML = messages.map((msg) => `<div>- ${escapeHtml(msg)}</div>`).join('');
  for (const message of messages) {
    appendLog('warning', message, 'warn');
  }
}

function setBadge(text, kind) {
  dom.mipmapBadge.textContent = text;
  setTagBadge(dom.mipmapBadge, kind);
}

function setTagBadge(element, kind) {
  element.className = 'badge';
  if (kind === 'ok') {
    element.classList.add('badge-ok');
  } else if (kind === 'warn') {
    element.classList.add('badge-warn');
  } else if (kind === 'bad') {
    element.classList.add('badge-bad');
  } else {
    element.classList.add('badge-neutral');
  }
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toDisplayDate(timestamp) {
  if (!timestamp) {
    return 'unknown time';
  }

  try {
    return new Date(timestamp).toLocaleString();
  } catch (_error) {
    return 'unknown time';
  }
}

function deriveHistoryName(atlasFile, jsonFile) {
  const stem = (jsonFile?.name || atlasFile?.name || 'character').replace(/\.[^.]+$/, '');
  return stem || 'character';
}

function openHistoryDb() {
  if (!state.historySupported) {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open history database.'));
  });
}

function withHistoryStore(mode, action) {
  return openHistoryDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, mode);
        const store = tx.objectStore(HISTORY_STORE);
        action(store, resolve, reject);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error || new Error('History transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('History transaction aborted.'));
      })
  );
}

async function getAllHistoryRecords() {
  const records = await withHistoryStore('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Failed to read history.'));
  });

  return records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getHistoryRecordById(id) {
  return withHistoryStore('readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Failed to read history record.'));
  });
}

async function saveHistoryRecord(record) {
  return withHistoryStore('readwrite', (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to save history record.'));
  });
}

async function deleteHistoryRecord(id) {
  return withHistoryStore('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to delete history record.'));
  });
}

function setHistoryStatus(message, tone = 'neutral') {
  dom.historyStatus.textContent = message;
  appendLog('history', message, tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'info');
  if (tone === 'error') {
    dom.historyStatus.style.color = '#ff5f67';
  } else if (tone === 'warn') {
    dom.historyStatus.style.color = '#ffb347';
  } else {
    dom.historyStatus.style.color = '#95a3bb';
  }
}

function getHistoryFile(fileLike, fallbackName, fallbackType) {
  if (fileLike instanceof File) {
    return fileLike;
  }
  if (fileLike instanceof Blob) {
    return new File([fileLike], fallbackName, { type: fileLike.type || fallbackType || 'application/octet-stream' });
  }
  throw new Error(`History file is invalid: ${fallbackName}`);
}

function revokeHistoryPreviewUrls() {
  for (const url of state.historyPreviewUrls) {
    URL.revokeObjectURL(url);
  }
  state.historyPreviewUrls = [];
}

function createHistoryPreviewUrl(record) {
  const firstImage = record.imageFiles?.[0];
  if (!firstImage) {
    return null;
  }

  try {
    const file = getHistoryFile(firstImage, 'preview.png', 'image/png');
    const url = URL.createObjectURL(file);
    state.historyPreviewUrls.push(url);
    return url;
  } catch (_error) {
    return null;
  }
}

function createHistoryRow(record) {
  const item = document.createElement('li');
  const thumb = document.createElement('div');
  const thumbImage = document.createElement('img');
  const content = document.createElement('div');
  const headerRow = document.createElement('div');
  const actions = document.createElement('div');
  const loadButton = document.createElement('button');
  const deleteButton = document.createElement('button');
  const meta = document.createElement('div');
  const activeBadge = document.createElement('span');

  thumb.className = 'history-thumb';
  content.className = 'history-content';
  headerRow.className = 'history-header';
  actions.className = 'history-actions';
  deleteButton.className = 'history-delete';
  meta.className = 'history-meta';
  activeBadge.className = 'history-active-badge';
  activeBadge.textContent = 'Active';
  if (record.id === state.activeHistoryRecordId) {
    activeBadge.classList.add('is-active');
  }

  const previewUrl = createHistoryPreviewUrl(record);
  thumbImage.alt = `${record.name || 'character'} thumbnail`;
  if (previewUrl) {
    thumbImage.src = previewUrl;
  } else {
    thumbImage.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#101827"/><circle cx="32" cy="24" r="10" fill="#3f5376"/><rect x="16" y="38" width="32" height="14" rx="6" fill="#324663"/></svg>'
      );
  }
  thumb.appendChild(thumbImage);

  loadButton.type = 'button';
  loadButton.textContent = record.name || record.id;
  loadButton.addEventListener('click', async () => {
    try {
      setLoadStatus(`Loading history entry: ${record.name}`);
      const fullRecord = await getHistoryRecordById(record.id);
      if (!fullRecord) {
        await refreshHistoryList();
        throw new Error('History entry no longer exists.');
      }

      const imageFiles = (fullRecord.imageFiles || []).map((file, index) =>
        getHistoryFile(file, `image-${index + 1}.png`, 'image/png')
      );
      const atlasFile = getHistoryFile(fullRecord.atlasFile, fullRecord.atlasName || 'character.atlas', 'text/plain');
      const jsonFile = getHistoryFile(
        fullRecord.jsonFile,
        fullRecord.jsonName || 'character.json',
        'application/octet-stream'
      );
      const animationsFile = fullRecord.animationsFile
        ? getHistoryFile(fullRecord.animationsFile, fullRecord.animationsName || 'animations.json', 'application/json')
        : null;

      await loadSpineBundle(
        { imageFiles, atlasFile, jsonFile, animationsFile },
        { saveHistory: false, activeHistoryRecordId: fullRecord.id }
      );
    } catch (error) {
      console.error(error);
      setLoadStatus(error.message || 'Failed to load history entry.', 'error');
    }
  });

  deleteButton.type = 'button';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', async () => {
    try {
      if (state.activeHistoryRecordId === record.id) {
        state.activeHistoryRecordId = null;
      }
      await deleteHistoryRecord(record.id);
      await refreshHistoryList();
      setLoadStatus(`Deleted history entry: ${record.name}`);
    } catch (error) {
      console.error(error);
      setHistoryStatus(error.message || 'Failed to delete history entry.', 'error');
    }
  });

  meta.textContent = `${record.imageCount || 0} image(s) • ${toDisplayDate(record.createdAt)}`;
  actions.appendChild(loadButton);
  actions.appendChild(deleteButton);
  headerRow.appendChild(actions);
  headerRow.appendChild(activeBadge);
  content.appendChild(headerRow);
  content.appendChild(meta);
  item.appendChild(thumb);
  item.appendChild(content);

  return item;
}

async function refreshHistoryList() {
  revokeHistoryPreviewUrls();

  if (!state.historySupported) {
    dom.historyList.innerHTML = '';
    setHistoryStatus('History unavailable in this browser.', 'warn');
    return;
  }

  try {
    const records = await getAllHistoryRecords();
    state.historyRecords = records;
    dom.historyList.innerHTML = '';

    if (!records.length) {
      setHistoryStatus('No saved characters yet.');
      return;
    }

    for (const record of records) {
      dom.historyList.appendChild(createHistoryRow(record));
    }
    setHistoryStatus(`${records.length} saved character(s).`);
  } catch (error) {
    console.error(error);
    setHistoryStatus(error.message || 'Failed to load history.', 'error');
  }
}

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function nextPowerOfTwo(value) {
  let power = 1;
  while (power < value) {
    power <<= 1;
  }
  return power;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDeviceProfileById(id) {
  return DEVICE_PROFILES.find((profile) => profile.id === id) || DEVICE_PROFILES[0];
}

function getActiveDeviceProfile() {
  return getDeviceProfileById(state.activeDeviceProfileId);
}

function setSimulatedCpuThrottle(ms) {
  state.simulatedCpuThrottleMs = clamp(Number(ms) || 0, 0, 20);
}

function emulateCpuThrottle() {
  const throttleMs = state.simulatedCpuThrottleMs;
  if (throttleMs <= 0) {
    return;
  }

  const end = performance.now() + throttleMs;
  while (performance.now() < end) {
    // Intentional busy wait to mimic slower frame budget on weaker devices.
  }
}

function parseManualPotOverride() {
  if (!dom.potOverrideToggle.checked) {
    return null;
  }

  const width = Number.parseInt(dom.potWidthInput.value, 10);
  const height = Number.parseInt(dom.potHeightInput.value, 10);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Manual POT override is enabled, but width/height are missing or invalid.');
  }

  if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
    throw new Error('Manual POT width and height must be powers of two (e.g. 512, 1024, 2048).');
  }

  return { width, height };
}

function basename(filePath) {
  return filePath.split('/').pop().split('\\').pop();
}

function trackObjectUrl(url) {
  state.objectUrls.push(url);
  return url;
}

function createObjectUrlFromFile(file) {
  return trackObjectUrl(URL.createObjectURL(file));
}

function createObjectUrlFromText(text, contentType = 'text/plain') {
  const blob = new Blob([text], { type: contentType });
  return trackObjectUrl(URL.createObjectURL(blob));
}

function revokeTrackedObjectUrls() {
  for (const url of state.objectUrls) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls = [];
}

function parseAtlasPageEntries(atlasText) {
  const lines = atlasText.replace(/\r/g, '').split('\n');
  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    // Skip lines that are clearly metadata (contain a colon); page headers are simple filenames.
    if (trimmed.includes(':')) {
      continue;
    }

    if (/^\s/.test(line)) {
      continue;
    }

    let nextTrimmed = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (!candidate) {
        continue;
      }
      nextTrimmed = candidate;
      break;
    }

    if (!nextTrimmed) {
      continue;
    }

    const key = nextTrimmed.split(':')[0].trim();
    if (PAGE_META_KEYS.has(key)) {
      entries.push({
        lineIndex: i,
        originalName: trimmed
      });
    }
  }

  return entries;
}

function patchAtlasText(atlasText, pageEntries, pageUrlByName) {
  const lines = atlasText.replace(/\r/g, '').split('\n');

  for (const entry of pageEntries) {
    const pageUrl = pageUrlByName.get(entry.originalName);
    if (pageUrl) {
      lines[entry.lineIndex] = pageUrl;
    }
  }

  return lines.join('\n');
}

async function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to decode image ${url}`));
    image.src = url;
  });
}

async function buildTextureSourceForPage(pageUrl, manualPotOverride) {
  const image = await loadImageElement(pageUrl);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;

  if (!manualPotOverride) {
    return {
      source: pageUrl,
      sourceWidth,
      sourceHeight,
      width: sourceWidth,
      height: sourceHeight,
      overrideApplied: false
    };
  }

  let targetWidth = manualPotOverride.width;
  let targetHeight = manualPotOverride.height;
  let adjustmentWarning = null;

  if (targetWidth < sourceWidth) {
    targetWidth = nextPowerOfTwo(sourceWidth);
  }
  if (targetHeight < sourceHeight) {
    targetHeight = nextPowerOfTwo(sourceHeight);
  }

  if (targetWidth !== manualPotOverride.width || targetHeight !== manualPotOverride.height) {
    adjustmentWarning = `Manual POT ${manualPotOverride.width}x${manualPotOverride.height} was smaller than source ${sourceWidth}x${sourceHeight}; auto-bumped to ${targetWidth}x${targetHeight}.`;
  }

  const maxTextureSize = app.renderer.gl.getParameter(app.renderer.gl.MAX_TEXTURE_SIZE);
  if (targetWidth > maxTextureSize || targetHeight > maxTextureSize) {
    throw new Error(
      `POT override resolved to ${targetWidth}x${targetHeight}, which exceeds MAX_TEXTURE_SIZE ${maxTextureSize}.`
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create 2D canvas context for manual POT override.');
  }

  // Pad texture to POT size without scaling so atlas pixel coordinates remain valid.
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  return {
    source: canvas,
    sourceWidth,
    sourceHeight,
    width: canvas.width,
    height: canvas.height,
    overrideApplied: true,
    adjustmentWarning
  };
}

async function waitForBaseTexture(baseTexture) {
  if (baseTexture.valid) {
    return;
  }

  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`BaseTexture failed to load: ${baseTexture.resource?.url || 'unknown resource'}`));
    };
    const cleanup = () => {
      baseTexture.off('loaded', onLoaded);
      baseTexture.off('error', onError);
    };

    baseTexture.on('loaded', onLoaded);
    baseTexture.on('error', onError);
  });
}

function clearCollections() {
  dom.animationList.innerHTML = '';
  dom.boneList.innerHTML = '';
  dom.slotList.innerHTML = '';
}

function appendLog(source, message, level = 'info') {
  if (!dom.logsPanel || !message) {
    return;
  }

  const timestamp = new Date();
  const entry = {
    id: timestamp.getTime() + Math.random(),
    source,
    message,
    level,
    time: timestamp.toLocaleTimeString()
  };

  state.logs.unshift(entry);
  if (state.logs.length > 180) {
    state.logs.length = 180;
  }

  dom.logsPanel.innerHTML = '';
  for (const logItem of state.logs) {
    const item = document.createElement('li');
    const meta = document.createElement('span');
    const text = document.createElement('span');
    item.className = `log-${logItem.level}`;
    meta.className = 'log-line-meta';
    text.className = 'log-line-text';
    meta.textContent = `${logItem.time} · ${logItem.source.toUpperCase()}`;
    text.textContent = logItem.message;
    item.appendChild(meta);
    item.appendChild(text);
    dom.logsPanel.appendChild(item);
  }
}

function clearLogs() {
  state.logs = [];
  if (dom.logsPanel) {
    dom.logsPanel.innerHTML = '';
  }
}

function cleanupCurrentSpine() {
  clearCollections();

  if (state.spineObject) {
    world.removeChild(state.spineObject);
    state.spineObject.destroy({ children: true });
    state.spineObject = null;
  }

  for (const page of state.pages) {
    if (page.baseTexture) {
      page.baseTexture.destroy();
    }
  }

  state.pages = [];
  state.dragOffsetX = 0;
  state.dragOffsetY = 0;
  state.panOffsetX = 0;
  state.panEnabled = false;
  dom.panToggle.textContent = 'Pan: OFF';
  state.lastVerification = null;
  state.viewportBaseScale = 1;
  applyWorldScale();
}

function updateWorldPosition() {
  const width = dom.pixiHost.clientWidth;
  const height = dom.pixiHost.clientHeight;

  world.x = width * 0.5 + state.dragOffsetX + state.panOffsetX;
  world.y = height * 0.5 + state.dragOffsetY;
}

function applyWorldScale() {
  world.scale.set(state.viewportBaseScale * state.zoom);
}

function fitSpineToViewport() {
  if (!state.spineObject) {
    state.viewportBaseScale = 1;
    applyWorldScale();
    return;
  }

  const viewportWidth = Math.max(1, dom.pixiHost.clientWidth);
  const viewportHeight = Math.max(1, dom.pixiHost.clientHeight);
  const localBounds = state.spineObject.getLocalBounds();
  const spineWidth = Math.max(1, localBounds.width);
  const spineHeight = Math.max(1, localBounds.height);
  const widthScale = (viewportWidth * 0.74) / spineWidth;
  const heightScale = (viewportHeight * 0.82) / spineHeight;

  state.viewportBaseScale = clamp(Math.min(widthScale, heightScale), 0.04, 30);
  applyWorldScale();
}

function setZoom(scale) {
  state.zoom = clamp(scale, 0.1, 4);
  applyWorldScale();
  updateDebugOverlay();
}

function applyLocalScreenZoom() {
  app.view.style.transform = `scale(${state.localScreenZoom})`;
}

function setLocalScreenZoom(scale) {
  if (!Number.isFinite(scale) || scale <= 0) {
    return;
  }

  state.localScreenZoom = scale;
  applyLocalScreenZoom();
  updateDebugOverlay();
}

function populateAnimationList(spineObject) {
  dom.animationList.innerHTML = '';

  const animations = spineObject.spineData.animations || [];
  for (const animation of animations) {
    const listItem = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = animation.name;
    button.addEventListener('click', () => {
      spineObject.state.setAnimation(0, animation.name, true);
      setLoadStatus(`Playing animation: ${animation.name}`);
    });

    listItem.appendChild(button);
    dom.animationList.appendChild(listItem);
  }

  if (animations.length > 0) {
    spineObject.state.setAnimation(0, animations[0].name, true);
  }
}

function populateBoneList(spineObject) {
  dom.boneList.innerHTML = '';

  for (const bone of spineObject.skeleton.bones) {
    const item = document.createElement('li');
    item.textContent = bone.data.name;
    dom.boneList.appendChild(item);
  }
}

function populateSlotList(spineObject) {
  dom.slotList.innerHTML = '';

  for (const slot of spineObject.skeleton.slots) {
    const item = document.createElement('li');
    item.textContent = slot.data.name;
    dom.slotList.appendChild(item);
  }
}

function positionSpineAtCenter(spineObject) {
  const localBounds = spineObject.getLocalBounds();
  spineObject.x = -localBounds.x - localBounds.width * 0.5;
  spineObject.y = -localBounds.y - localBounds.height * 0.5;
}

function getGlTextureObject(baseTexture) {
  const renderer = app.renderer;
  const glTextureEntry = baseTexture._glTextures?.[renderer.CONTEXT_UID];
  return glTextureEntry?.texture || null;
}

function filterName(value) {
  if (value === null || value === undefined) {
    return 'UNAVAILABLE';
  }

  return FILTER_NAME_BY_VALUE.get(value) || `UNKNOWN(${value})`;
}

function isMipmapMinFilter(gl, filterValue) {
  return (
    filterValue === gl.NEAREST_MIPMAP_NEAREST ||
    filterValue === gl.LINEAR_MIPMAP_NEAREST ||
    filterValue === gl.NEAREST_MIPMAP_LINEAR ||
    filterValue === gl.LINEAR_MIPMAP_LINEAR
  );
}

function forceGlFilters(baseTexture, enableMipmaps) {
  const renderer = app.renderer;
  const gl = renderer.gl;

  renderer.texture.bind(baseTexture, 0);

  const glTexture = getGlTextureObject(baseTexture);
  if (!glTexture) {
    return { minFilter: null, magFilter: null, couldBind: false };
  }

  gl.bindTexture(gl.TEXTURE_2D, glTexture);

  const desiredMin = enableMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desiredMin);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const minFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
  const magFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER);

  return {
    minFilter,
    magFilter,
    couldBind: true
  };
}

async function applyMipmapsAndVerify() {
  if (!state.pages.length) {
    setBadge('Mipmaps status: no texture loaded', 'neutral');
    return;
  }

  const glVersion = app.renderer.context.webGLVersion;
  const webglRestrictionNote = glVersion === 1 ? 'WebGL1 NPOT mipmaps are unsupported.' : 'WebGL2 can sample NPOT mipmaps, runtime keeps NPOT OFF for consistency.';
  const effectiveEnable = state.requestedMipmaps && state.pages.every((page) => page.isPOT);

  for (const page of state.pages) {
    const enableForPage = effectiveEnable && page.isPOT;
    page.baseTexture.mipmap = enableForPage ? PIXI.MIPMAP_MODES.ON : PIXI.MIPMAP_MODES.OFF;
    page.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    page.baseTexture.dirtyStyleId += 1;
    page.baseTexture.update();

    page.glSnapshot = forceGlFilters(page.baseTexture, enableForPage);
  }

  app.renderer.render(app.stage);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const verification = runGlVerification();

  if (!effectiveEnable) {
    if (state.pages.some((page) => !page.isPOT)) {
      setBadge('Mipmaps status: OFF (NPOT texture)', 'warn');
      setWarnings([...state.npotWarnings, webglRestrictionNote]);
    } else {
      setBadge('Mipmaps status: OFF (toggle disabled)', 'neutral');
    }
  } else if (verification.samplingEnabled) {
    setBadge('Mipmaps status: ENABLED (sampling)', 'ok');
  } else {
    setBadge('Mipmaps status: ON, but sampling not confirmed', 'warn');
  }
}

function runGlVerification() {
  const renderer = app.renderer;
  const gl = renderer.gl;
  const webglVersion = renderer.context.webGLVersion === 2 ? 'WebGL2' : 'WebGL1';
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  const pageRows = [];
  let samplingEnabled = true;

  for (const page of state.pages) {
    renderer.texture.bind(page.baseTexture, 0);

    const glTexture = getGlTextureObject(page.baseTexture);
    let minFilter = null;
    let magFilter = null;

    if (glTexture) {
      gl.bindTexture(gl.TEXTURE_2D, glTexture);
      minFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
      magFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER);
    }

    const row = {
      page: page.atlasName,
      width: page.width,
      height: page.height,
      isPOT: page.isPOT,
      mipmapMode: page.baseTexture.mipmap,
      minFilter: filterName(minFilter),
      magFilter: filterName(magFilter)
    };

    const pageSamplingEnabled =
      row.isPOT &&
      page.baseTexture.mipmap === PIXI.MIPMAP_MODES.ON &&
      minFilter !== null &&
      isMipmapMinFilter(gl, minFilter);

    if (!pageSamplingEnabled) {
      samplingEnabled = false;
    }

    row.sampling = pageSamplingEnabled ? 'YES' : 'NO';
    pageRows.push(row);
  }

  const lines = [
    `Renderer: ${webglVersion}`,
    `MAX_TEXTURE_SIZE: ${maxTextureSize}`,
    `DPR: ${window.devicePixelRatio || 1}`,
    `Zoom: ${state.zoom.toFixed(2)}x`,
    `Screen zoom: ${state.localScreenZoom.toFixed(2)}x`,
    `Skeleton scale: ${state.spineObject ? state.spineObject.scale.x.toFixed(2) : 'n/a'}`,
    `Mipmaps sampling: ${samplingEnabled ? 'ENABLED' : 'DISABLED/UNCONFIRMED'}`,
    ''
  ];

  for (const row of pageRows) {
    lines.push(
      `${row.page} | POT=${row.isPOT} | mipmap=${row.mipmapMode} | ${row.width}x${row.height} | MIN=${row.minFilter} | MAG=${row.magFilter} | sampling=${row.sampling}`
    );
  }

  if (state.npotWarnings.length) {
    lines.push('');
    lines.push('NPOT warnings:');
    for (const warning of state.npotWarnings) {
      lines.push(`- ${warning}`);
    }
  }

  dom.verificationPanel.textContent = lines.join('\n');

  state.lastVerification = {
    webglVersion,
    maxTextureSize,
    pageRows,
    samplingEnabled
  };

  console.group('Spine Mipmap Verification');
  console.log(`Renderer: ${webglVersion}`);
  console.log(`MAX_TEXTURE_SIZE: ${maxTextureSize}`);
  console.table(pageRows);
  console.groupEnd();

  updateDebugOverlay();
  return state.lastVerification;
}

function updatePotStatus() {
  if (!state.pages.length) {
    dom.potStatus.textContent = 'Texture POT: -';
    return;
  }

  if (state.pages.length === 1) {
    const page = state.pages[0];
    const sourceSuffix =
      page.sourceWidth && page.sourceHeight && (page.sourceWidth !== page.width || page.sourceHeight !== page.height)
        ? `; source ${page.sourceWidth}x${page.sourceHeight}`
        : '';
    dom.potStatus.textContent = `Texture POT: ${page.isPOT ? 'YES' : 'NO'} (${page.width}x${page.height}${sourceSuffix})`;
    return;
  }

  const detail = state.pages
    .map((page) => {
      const sourceSuffix =
        page.sourceWidth && page.sourceHeight && (page.sourceWidth !== page.width || page.sourceHeight !== page.height)
          ? `<-${page.sourceWidth}x${page.sourceHeight}`
          : '';
      return `${page.atlasName}=${page.isPOT ? 'YES' : 'NO'}(${page.width}x${page.height}${sourceSuffix})`;
    })
    .join(' | ');
  dom.potStatus.textContent = `Texture POT: ${detail}`;
}

function parseViewportPreset(value) {
  if (!value || value === 'auto') {
    return null;
  }

  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return null;
  }

  return { width, height };
}

function resizeRendererToHost() {
  const width = Math.max(1, dom.pixiHost.clientWidth);
  const height = Math.max(1, dom.pixiHost.clientHeight);
  app.renderer.resize(width, height);
}

function getDeviceModeFromPreset(value) {
  const preset = parseViewportPreset(value);
  if (!preset) {
    return 'auto';
  }

  if (preset.width >= 1200 || (preset.width > preset.height && preset.width >= 1024)) {
    return 'laptop';
  }

  if (Math.min(preset.width, preset.height) >= 600) {
    return 'tablet';
  }

  return 'phone';
}

function updateDeviceProfileStatus() {
  const profile = getActiveDeviceProfile();
  if (!dom.deviceProfileStatus) {
    return;
  }

  if (profile.id === 'custom') {
    dom.deviceProfileStatus.textContent = 'Custom mode.';
    return;
  }

  dom.deviceProfileStatus.textContent = `${profile.label} · ${profile.viewportPreset} · ${profile.refreshHz}Hz`;
}

function applyDeviceProfile(profileId, options = {}) {
  const profile = getDeviceProfileById(profileId);
  state.activeDeviceProfileId = profile.id;
  setSimulatedCpuThrottle(profile.cpuThrottleMs);

  if (profile.id !== 'custom' && !options.preserveCurrent) {
    state.applyingDeviceProfile = true;
    try {
      dom.viewportPreset.value = profile.viewportPreset;
      dom.renderScaleSelect.value = String(profile.renderScale);
      dom.fpsCapSelect.value = String(profile.fpsCap);
      applyViewportPreset(dom.viewportPreset.value);
      applyRenderScaleSetting(dom.renderScaleSelect.value);
      applyFpsCapSetting(dom.fpsCapSelect.value);
    } finally {
      state.applyingDeviceProfile = false;
    }
  }

  updateDeviceProfileStatus();
  updateDebugOverlay();
}

function switchToCustomProfileFromManualChange() {
  if (state.applyingDeviceProfile || dom.deviceProfileSelect.value === 'custom') {
    return;
  }

  dom.deviceProfileSelect.value = 'custom';
  applyDeviceProfile('custom', { preserveCurrent: true });
}

function applyViewportPreset(value) {
  const mode = getDeviceModeFromPreset(value);
  dom.deviceFrame.className = `device-frame mode-${mode}`;

  const preset = parseViewportPreset(value);
  if (!preset) {
    dom.pixiHost.style.width = '100%';
    dom.pixiHost.style.height = '100%';
    dom.pixiHost.style.maxWidth = '100%';
    dom.pixiHost.style.maxHeight = '100%';
    dom.deviceFrame.style.transform = 'none';
  } else {
    // Fixed logical device viewport; we scale the whole frame to fit stage.
    dom.pixiHost.style.width = `${preset.width}px`;
    dom.pixiHost.style.height = `${preset.height}px`;
    dom.pixiHost.style.maxWidth = 'none';
    dom.pixiHost.style.maxHeight = 'none';
    fitDeviceFrameToStage();
  }

  // Keep renderer framebuffer aligned with current host CSS size.
  resizeRendererToHost();
  fitSpineToViewport();
  updateWorldPosition();
}

function fitDeviceFrameToStage() {
  if (!dom.stageWrap || dom.viewportPreset.value === 'auto') {
    dom.deviceFrame.style.transform = 'none';
    return;
  }

  // Measure unscaled frame, then apply a uniform fit transform.
  dom.deviceFrame.style.transform = 'none';
  const wrapRect = dom.stageWrap.getBoundingClientRect();
  const frameRect = dom.deviceFrame.getBoundingClientRect();
  const safePadding = 28;
  const availableWidth = Math.max(1, wrapRect.width - safePadding);
  const availableHeight = Math.max(1, wrapRect.height - safePadding);
  // Keep extra headroom so the frame reads as a device preview inside emulator viewport.
  const maxPreviewScale = 0.88;
  const scale = Math.min(availableWidth / frameRect.width, availableHeight / frameRect.height, maxPreviewScale);
  dom.deviceFrame.style.transform = `scale(${scale})`;
}

function applyRenderScaleSetting(value) {
  const targetResolution = value === 'dpr' ? window.devicePixelRatio || 1 : Number.parseFloat(value);
  if (!Number.isFinite(targetResolution) || targetResolution <= 0) {
    return;
  }

  app.renderer.resolution = targetResolution;
  resizeRendererToHost();
  updateWorldPosition();
}

function applyFpsCapSetting(value) {
  const fps = Number.parseInt(value, 10);
  if (!Number.isFinite(fps) || fps <= 0) {
    app.ticker.maxFPS = 0;
    return;
  }

  app.ticker.maxFPS = fps;
}

function getRenderResolutionInfo() {
  const cssWidth = Math.max(1, Math.round(dom.pixiHost.clientWidth));
  const cssHeight = Math.max(1, Math.round(dom.pixiHost.clientHeight));
  const renderWidth = Math.max(1, Math.round(app.renderer.view.width));
  const renderHeight = Math.max(1, Math.round(app.renderer.view.height));
  const resolution = app.renderer.resolution || 1;

  return {
    cssWidth,
    cssHeight,
    renderWidth,
    renderHeight,
    resolution
  };
}

function updateRenderResolutionTag() {
  const info = getRenderResolutionInfo();
  dom.renderResolutionTag.textContent = `Render: ${info.renderWidth}x${info.renderHeight} @${info.resolution.toFixed(2)}x (CSS ${info.cssWidth}x${info.cssHeight})`;
  setTagBadge(dom.renderResolutionTag, 'neutral');
}

function computeMipEstimate() {
  if (!state.spineObject || !state.pages.length) {
    return null;
  }

  const bounds = state.spineObject.getBounds();
  const onScreenWidth = Math.max(1, bounds.width);
  const onScreenHeight = Math.max(1, bounds.height);
  const atlasWidth = Math.max(...state.pages.map((page) => page.width));
  const atlasHeight = Math.max(...state.pages.map((page) => page.height));
  const texelsPerPixel = Math.max(atlasWidth / onScreenWidth, atlasHeight / onScreenHeight);
  const minifying = texelsPerPixel > 1;
  const maxMip = Math.floor(Math.log2(Math.max(atlasWidth, atlasHeight)));
  const estimatedLevel = minifying ? clamp(Math.log2(texelsPerPixel), 0, maxMip) : 0;

  return {
    minifying,
    texelsPerPixel,
    estimatedLevel
  };
}

function updateMipEstimateTag() {
  const estimate = computeMipEstimate();
  if (!estimate) {
    dom.mipEstimateTag.textContent = 'Mip estimate: n/a';
    setTagBadge(dom.mipEstimateTag, 'neutral');
    return;
  }

  dom.mipEstimateTag.textContent = `Mip estimate: L${estimate.estimatedLevel.toFixed(2)} (${estimate.minifying ? 'minifying' : 'magnifying'}, ${estimate.texelsPerPixel.toFixed(2)} texel/px)`;

  const canSampleMipmaps = state.lastVerification?.samplingEnabled && estimate.minifying;
  setTagBadge(dom.mipEstimateTag, canSampleMipmaps ? 'ok' : estimate.minifying ? 'warn' : 'neutral');
}

function getPrimaryAtlasPage() {
  if (!state.pages.length) {
    return null;
  }

  return state.pages.reduce((best, page) => {
    if (!best) {
      return page;
    }
    return page.width * page.height > best.width * best.height ? page : best;
  }, null);
}

function mipSizeForLevel(baseSize, level) {
  return Math.max(1, Math.round(baseSize / Math.pow(2, level)));
}

function updateActiveMipTag() {
  const estimate = computeMipEstimate();
  const primaryPage = getPrimaryAtlasPage();

  if (!estimate || !primaryPage) {
    dom.mipActiveTag.textContent = 'Active mip: n/a';
    setTagBadge(dom.mipActiveTag, 'neutral');
    return;
  }

  const samplingEnabled = Boolean(state.lastVerification?.samplingEnabled);
  if (!samplingEnabled) {
    dom.mipActiveTag.textContent = `Active mip: L0 (${primaryPage.width}x${primaryPage.height})`;
    setTagBadge(dom.mipActiveTag, 'warn');
    return;
  }

  if (!estimate.minifying) {
    dom.mipActiveTag.textContent = `Active mip: L0 (${primaryPage.width}x${primaryPage.height})`;
    setTagBadge(dom.mipActiveTag, 'neutral');
    return;
  }

  const levelFloor = Math.floor(estimate.estimatedLevel);
  const levelCeil = Math.ceil(estimate.estimatedLevel);
  const wFloor = mipSizeForLevel(primaryPage.width, levelFloor);
  const hFloor = mipSizeForLevel(primaryPage.height, levelFloor);

  if (levelFloor === levelCeil) {
    dom.mipActiveTag.textContent = `Active mip: L${levelFloor} (~${wFloor}x${hFloor})`;
    setTagBadge(dom.mipActiveTag, 'ok');
    return;
  }

  const wCeil = mipSizeForLevel(primaryPage.width, levelCeil);
  const hCeil = mipSizeForLevel(primaryPage.height, levelCeil);
  dom.mipActiveTag.textContent = `Active mip: L${levelFloor}-L${levelCeil} (~${wFloor}x${hFloor} -> ~${wCeil}x${hCeil})`;
  setTagBadge(dom.mipActiveTag, 'ok');
}

function updatePerfTag() {
  const fps = 1000 / Math.max(0.0001, state.frameMsEwma);
  const targetFps = app.ticker.maxFPS > 0 ? app.ticker.maxFPS : 60;
  const healthyThreshold = targetFps * 0.9;
  const warnThreshold = targetFps * 0.6;
  dom.perfTag.textContent = `Perf: ${state.frameMsEwma.toFixed(1)} ms (${fps.toFixed(1)} FPS)`;
  setTagBadge(dom.perfTag, fps >= healthyThreshold ? 'ok' : fps >= warnThreshold ? 'warn' : 'bad');
}

function updateDebugOverlay() {
  const renderInfo = getRenderResolutionInfo();
  const primaryPage = getPrimaryAtlasPage();
  const profile = getActiveDeviceProfile();
  const profileName = profile.id === 'custom' ? 'Custom (host)' : profile.label;
  const samplingStatus = state.lastVerification?.samplingEnabled ? 'YES' : 'NO';
  const activeMipSummary = dom.mipActiveTag.textContent.replace(/^Active mip:\s*/, '');

  updateRenderResolutionTag();
  updateMipEstimateTag();
  updateActiveMipTag();
  updatePerfTag();

  dom.debugOverlay.textContent = [
    `Profile: ${profileName}`,
    `Viewport: ${renderInfo.cssWidth}x${renderInfo.cssHeight} @${renderInfo.resolution.toFixed(2)}x`,
    `Screen zoom: ${state.localScreenZoom.toFixed(2)}x`,
    `Mipmaps Active (sampling): ${samplingStatus}`,
    `Current Mip: ${activeMipSummary}`,
    `Primary Atlas: ${primaryPage ? `${primaryPage.atlasName} (${primaryPage.width}x${primaryPage.height})` : 'n/a'}`,
    `POT Eligibility: ${state.pages.length ? (state.pages.every((page) => page.isPOT) ? 'All POT' : 'Has NPOT (limited)') : 'n/a'}`
  ].join('\n');
}

function setPanEnabled(enabled) {
  state.panEnabled = enabled;
  dom.panToggle.textContent = `Pan: ${enabled ? 'ON' : 'OFF'}`;
  if (!enabled) {
    state.panOffsetX = 0;
    updateWorldPosition();
  }
}

function setupInteraction() {
  app.view.addEventListener('wheel', (event) => {
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.0014);
    setZoom(state.zoom * zoomFactor);
  });

  app.view.addEventListener('pointerdown', (event) => {
    if (!state.spineObject || state.panEnabled) {
      return;
    }

    state.dragging = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragStartOffsetX = state.dragOffsetX;
    state.dragStartOffsetY = state.dragOffsetY;
  });

  window.addEventListener('pointermove', (event) => {
    if (!state.dragging) {
      return;
    }

    const deltaX = event.clientX - state.dragStartX;
    const deltaY = event.clientY - state.dragStartY;

    state.dragOffsetX = state.dragStartOffsetX + deltaX;
    state.dragOffsetY = state.dragStartOffsetY + deltaY;
    updateWorldPosition();
  });

  window.addEventListener('pointerup', () => {
    state.dragging = false;
  });

  window.addEventListener('resize', () => {
    fitDeviceFrameToStage();
    resizeRendererToHost();
    fitSpineToViewport();
    updateWorldPosition();
    updateDebugOverlay();
  });
}

function buildAtlasPageMapping(pageEntries, imageFiles, imageUrlByFileName) {
  const exactNameMap = new Map();
  const baseNameMap = new Map();

  for (const file of imageFiles) {
    exactNameMap.set(file.name, file);
    baseNameMap.set(basename(file.name), file);
  }

  const warnings = [];
  const missingPages = [];
  const resolved = [];

  for (const entry of pageEntries) {
    const atlasName = entry.originalName;
    const atlasBaseName = basename(atlasName);
    let file = exactNameMap.get(atlasName) || exactNameMap.get(atlasBaseName);

    if (!file) {
      file = baseNameMap.get(atlasName) || baseNameMap.get(atlasBaseName);
    }

    if (!file && pageEntries.length === 1 && imageFiles.length === 1) {
      file = imageFiles[0];
      warnings.push(
        `Atlas page "${atlasName}" did not match uploaded image name "${file.name}". Mapped atlas page to uploaded image explicitly.`
      );
    }

    if (!file) {
      missingPages.push(atlasName);
      continue;
    }

    if (file.name !== atlasName) {
      warnings.push(`Mapped atlas page "${atlasName}" -> uploaded file "${file.name}".`);
    }

    resolved.push({
      atlasName,
      file,
      url: imageUrlByFileName.get(file.name)
    });
  }

  return { resolved, warnings, missingPages };
}

async function resolveSkeletonResource(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let offset = 0;

  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }

  // Leading whitespace bytes
  while (offset < bytes.length) {
    const byte = bytes[offset];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      offset += 1;
      continue;
    }
    break;
  }

  const firstByte = bytes[offset];
  const timestamp = Date.now();

  if (firstByte === 0x7b || firstByte === 0x5b) {
    const text = new TextDecoder('utf-8').decode(bytes);
    try {
      JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Skeleton file looks like JSON but failed to parse: ${error.message}. Re-export a valid Spine JSON skeleton.`
      );
    }

    return {
      format: 'json',
      resourceName: `spine-${timestamp}.json`,
      url: createObjectUrlFromText(text, 'application/json'),
      xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.JSON,
      warning: null
    };
  }

  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new Error('Skeleton file is gzip-compressed. Export plain .json or .skel from Spine.');
  }

  return {
    format: 'binary',
    resourceName: `spine-${timestamp}.skel`,
    url: createObjectUrlFromFile(file),
    xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.BUFFER,
    warning: `Skeleton "${file.name}" was detected as binary data and loaded as .skel.`
  };
}

function validateFormInputs() {
  const imageFiles = Array.from(dom.imageInput.files || []);
  const atlasFile = dom.atlasInput.files?.[0] || null;
  const jsonFile = dom.jsonInput.files?.[0] || null;
  const animationsFile = dom.animationsInput?.files?.[0] || null;

  if (!imageFiles.length || !atlasFile || !jsonFile) {
    throw new Error('Select image, atlas, and json files before pressing Add.');
  }

  return { imageFiles, atlasFile, jsonFile, animationsFile };
}

async function saveBundleToHistory(bundle) {
  if (!state.historySupported) {
    return;
  }

  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `char-${Date.now()}`;
  const record = {
    id,
    name: deriveHistoryName(bundle.atlasFile, bundle.jsonFile),
    createdAt: Date.now(),
    imageCount: bundle.imageFiles.length,
    imageFiles: bundle.imageFiles,
    atlasFile: bundle.atlasFile,
    atlasName: bundle.atlasFile.name,
    jsonFile: bundle.jsonFile,
    jsonName: bundle.jsonFile.name,
    animationsFile: bundle.animationsFile || null,
    animationsName: bundle.animationsFile?.name || null
  };

  await saveHistoryRecord(record);
  return id;
}

async function loadSpineBundle(bundle, options = {}) {
  setLoadStatus('Loading files...');
  setWarnings([]);
  const requestedActiveHistoryId =
    Object.prototype.hasOwnProperty.call(options, 'activeHistoryRecordId') ? options.activeHistoryRecordId : undefined;

  cleanupCurrentSpine();
  revokeTrackedObjectUrls();

  const imageFiles = Array.from(bundle.imageFiles || []);
  const atlasFile = bundle.atlasFile || null;
  const jsonFile = bundle.jsonFile || null;
  let manualPotOverride;
  try {
    manualPotOverride = parseManualPotOverride();
  } catch (error) {
    setLoadStatus(error.message, 'error');
    return;
  }

  if (!imageFiles.length || !atlasFile || !jsonFile) {
    setLoadStatus('Missing required files for loading character bundle.', 'error');
    return;
  }

  try {
    const atlasText = await atlasFile.text();
    const pageEntries = parseAtlasPageEntries(atlasText);

    if (!pageEntries.length) {
      throw new Error('No atlas page headers found in .atlas file.');
    }

    const imageUrlByFileName = new Map();
    for (const file of imageFiles) {
      imageUrlByFileName.set(file.name, createObjectUrlFromFile(file));
    }

    const mapping = buildAtlasPageMapping(pageEntries, imageFiles, imageUrlByFileName);
    if (mapping.missingPages.length) {
      throw new Error(
        `Missing atlas page image(s): ${mapping.missingPages.join(', ')}. Upload matching PNG files or rename atlas pages.`
      );
    }

    const pages = [];
    const potOverrideWarnings = [];
    for (const item of mapping.resolved) {
      const prepared = await buildTextureSourceForPage(item.url, manualPotOverride);
      pages.push({
        atlasName: item.atlasName,
        fileName: item.file.name,
        url: item.url,
        source: prepared.source,
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight,
        width: prepared.width,
        height: prepared.height,
        isPOT: isPowerOfTwo(prepared.width) && isPowerOfTwo(prepared.height),
        baseTexture: null,
        glSnapshot: null
      });

      if (prepared.overrideApplied) {
        potOverrideWarnings.push(
          `Manual POT applied to ${item.file.name}: ${prepared.sourceWidth}x${prepared.sourceHeight} -> ${prepared.width}x${prepared.height} (padded).`
        );
        if (prepared.adjustmentWarning) {
          potOverrideWarnings.push(prepared.adjustmentWarning);
        }
      }
    }

    state.pages = pages;
    state.npotWarnings = pages
      .filter((page) => !page.isPOT)
      .map(
        (page) =>
          `Texture ${page.fileName} is NPOT (${page.width}x${page.height}). Mipmaps are forced OFF to avoid unreliable minification.`
      );

    for (const page of pages) {
      const baseTexture = PIXI.BaseTexture.from(page.source);
      await waitForBaseTexture(baseTexture);
      page.baseTexture = baseTexture;
    }

    const staticImages = {};
    for (const page of pages) {
      staticImages[page.atlasName] = page.baseTexture;
      // Some atlases reference just basename even if original page header used a relative path.
      staticImages[basename(page.atlasName)] = page.baseTexture;
    }

    const patchedAtlasText = atlasText;
    const skeletonResource = await resolveSkeletonResource(jsonFile);

    const loader = new PIXI.Loader();
    const resourceName = skeletonResource.resourceName;

    const resources = await new Promise((resolve, reject) => {
      loader.onError.add((error, _loader, resource) => {
        console.error('Loader error:', error, 'resource:', resource?.url || resource?.name);
        const reason = error?.message || (typeof error === 'string' ? error : 'unknown loader error');
        reject(new Error(`PIXI Loader failed while reading Spine resources: ${reason}`));
      });

      loader
        .add(resourceName, skeletonResource.url, {
          xhrType: skeletonResource.xhrType,
          metadata: {
            atlasRawData: patchedAtlasText,
            images: staticImages,
            spineSkeletonScale: 1,
            // Blob URLs lose file extension, so this flag tells pixi-spine to treat BUFFER input as spine binary.
            spineMetadata: skeletonResource.format === 'binary' ? {} : null
          }
        })
        .load((_loader, loadedResources) => {
          resolve(loadedResources);
        });
    });

    const spineData = resources[resourceName]?.spineData;
    if (!spineData) {
      throw new Error(
        `Spine data was not created by pixi-spine for ${skeletonResource.format} skeleton input. Verify Spine version compatibility (3.8.x) and atlas/skeleton pair.`
      );
    }

    const spineObject = new Spine(spineData);
    state.spineObject = spineObject;
    world.addChild(spineObject);

    populateAnimationList(spineObject);
    // Apply animation selection first, then center from current pose bounds.
    spineObject.update(0);
    positionSpineAtCenter(spineObject);
    fitSpineToViewport();
    setZoom(1);
    updateWorldPosition();

    populateBoneList(spineObject);
    populateSlotList(spineObject);
    updatePotStatus();

    if (state.npotWarnings.length) {
      dom.mipmapToggle.checked = false;
      dom.mipmapToggle.disabled = true;
      state.requestedMipmaps = false;
    } else {
      dom.mipmapToggle.disabled = false;
      // Restore default behavior: auto-enable mipmaps whenever textures support it.
      dom.mipmapToggle.checked = true;
      state.requestedMipmaps = true;
    }

    const warningMessages = [...mapping.warnings, ...potOverrideWarnings, ...state.npotWarnings];
    if (skeletonResource.warning) {
      warningMessages.push(skeletonResource.warning);
    }
    setWarnings(warningMessages);

    await applyMipmapsAndVerify();
    if (requestedActiveHistoryId !== undefined) {
      state.activeHistoryRecordId = requestedActiveHistoryId;
      await refreshHistoryList();
    }
    setLoadStatus(`Loaded Spine with ${pages.length} atlas page(s).`);

    if (options.saveHistory) {
      try {
        const savedId = await saveBundleToHistory(bundle);
        state.activeHistoryRecordId = savedId;
        await refreshHistoryList();
      } catch (historyError) {
        console.error(historyError);
        setHistoryStatus(historyError.message || 'Failed to save history record.', 'error');
      }
    }
  } catch (error) {
    console.error(error);
    cleanupCurrentSpine();
    revokeTrackedObjectUrls();
    setLoadStatus(error.message || 'Failed to load Spine files.', 'error');
    setBadge('Mipmaps status: load failed', 'bad');
    updatePotStatus();
    dom.verificationPanel.textContent = 'No GL verification yet.';
    updateDebugOverlay();
  }
}

async function handleAddSpine() {
  let bundle;
  try {
    bundle = validateFormInputs();
  } catch (error) {
    setLoadStatus(error.message, 'error');
    return;
  }

  await loadSpineBundle(bundle, { saveHistory: true });
}

function setupUiEvents() {
  dom.addButton.addEventListener('click', handleAddSpine);
  if (dom.clearLogsButton) {
    dom.clearLogsButton.addEventListener('click', () => {
      clearLogs();
      appendLog('system', 'Logs cleared by user.', 'info');
    });
  }

  const updateManualPotUiState = () => {
    const enabled = dom.potOverrideToggle.checked;
    dom.potWidthInput.disabled = !enabled;
    dom.potHeightInput.disabled = !enabled;
  };
  dom.potOverrideToggle.addEventListener('change', updateManualPotUiState);
  updateManualPotUiState();

  dom.deviceProfileSelect.addEventListener('change', (event) => {
    applyDeviceProfile(event.target.value);
  });

  dom.viewportPreset.addEventListener('change', (event) => {
    switchToCustomProfileFromManualChange();
    applyViewportPreset(event.target.value);
    updateDebugOverlay();
  });

  dom.renderScaleSelect.addEventListener('change', (event) => {
    switchToCustomProfileFromManualChange();
    applyRenderScaleSetting(event.target.value);
    updateDebugOverlay();
  });

  dom.fpsCapSelect.addEventListener('change', (event) => {
    switchToCustomProfileFromManualChange();
    applyFpsCapSetting(event.target.value);
    updateDebugOverlay();
  });

  dom.mipmapToggle.addEventListener('change', async (event) => {
    state.requestedMipmaps = event.target.checked;
    if (!state.pages.length) {
      return;
    }

    await applyMipmapsAndVerify();
  });

  dom.scale025.addEventListener('click', () => setZoom(0.25));
  dom.scale05.addEventListener('click', () => setZoom(0.5));
  dom.scale10.addEventListener('click', () => setZoom(1));
  if (dom.localZoomIn) {
    dom.localZoomIn.addEventListener('click', () => {
      setLocalScreenZoom(state.localScreenZoom * LOCAL_SCREEN_ZOOM_STEP);
    });
  }
  if (dom.localZoomOut) {
    dom.localZoomOut.addEventListener('click', () => {
      setLocalScreenZoom(state.localScreenZoom / LOCAL_SCREEN_ZOOM_STEP);
    });
  }

  dom.panToggle.addEventListener('click', () => {
    if (!state.spineObject) {
      return;
    }

    setPanEnabled(!state.panEnabled);
  });

  refreshHistoryList();
}

app.ticker.add((delta) => {
  const now = performance.now();
  if (state.lastFrameTimestamp > 0) {
    const wallFrameMs = now - state.lastFrameTimestamp;
    state.frameMsEwma = state.frameMsEwma * 0.9 + wallFrameMs * 0.1;
  }
  state.lastFrameTimestamp = now;

  if (state.panEnabled) {
    state.panOffsetX += 1.2 * delta * state.panDirection;
    if (Math.abs(state.panOffsetX) > 42) {
      state.panDirection *= -1;
    }
    updateWorldPosition();
  }

  emulateCpuThrottle();
  updateDebugOverlay();
});

setupUiEvents();
setupInteraction();
applyViewportPreset(dom.viewportPreset.value);
applyRenderScaleSetting(dom.renderScaleSelect.value);
applyFpsCapSetting(dom.fpsCapSelect.value);
applyDeviceProfile(dom.deviceProfileSelect.value, { preserveCurrent: true });
applyLocalScreenZoom();
updateWorldPosition();
updateDebugOverlay();
setBadge('Mipmaps status: waiting for texture', 'neutral');
setLoadStatus('Waiting for files.');
