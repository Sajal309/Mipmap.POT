import * as PIXI from 'pixi.js';
import { Spine, SpineParser } from 'pixi-spine';
import retargetProfile from './retarget/profile-man39.json';
import { convertFbxToSpineAnimation } from './retarget/convert-fbx-to-spine.js';

// Ensure spine loader plugin is registered for any Loader instance (shared or new).
PIXI.Loader.registerPlugin(SpineParser);

const PAGE_META_KEYS = new Set(['size', 'format', 'filter', 'repeat', 'pma', 'scale']);
const REGION_META_KEYS = new Set(['rotate', 'xy', 'size', 'orig', 'offset', 'index']);
const MANUAL_POT_BASE_SIZE = 2048;
const MANUAL_POT_PADDING = 2;
const MANUAL_POT_MERGED_PAGE_NAME = 'manual-pot-merged.png';
const HISTORY_DB_NAME = 'spine-mipmap-preview-db';
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE = 'characters';
const SHARED_HISTORY_MANIFEST_PATH = 'shared-history/manifest.json';
const SHARED_HISTORY_SOURCE = 'shared';
const DEFAULT_RETARGET_BUNDLE = Object.freeze({
  images: ['powerof2/Man_39.png'],
  atlas: 'powerof2/Man_39.atlas',
  skeleton: 'powerof2/Man_39.json'
});
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
    renderScale: 1,
    fpsCap: 60,
    cpuThrottleMs: 7,
    refreshHz: 60,
    notes: 'Small phone class; constrained thermal/perf budget.'
  },
  {
    id: 'big-phone',
    label: 'iPhone 15 Pro Max',
    viewportPreset: '430x932',
    renderScale: 1,
    fpsCap: 120,
    cpuThrottleMs: 3,
    refreshHz: 120,
    notes: 'Large high-DPI phone class with ProMotion.'
  },
  {
    id: 'tablet',
    label: 'iPad Air 10.9"',
    viewportPreset: '820x1180',
    renderScale: 1,
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
const SECONDARY_ANIMATION_LIMITS = Object.freeze({
  hand: 2,
  leg: 2,
  expression: 1
});
const SECONDARY_TRACKS_BY_TYPE = Object.freeze({
  hand: [1, 2],
  leg: [3, 4],
  expression: [5]
});
const SKELETON_OVERLAY_STYLE = Object.freeze({
  boneColor: 0x00f0e0,
  boneAlpha: 0.94,
  jointOuterColor: 0x00f0e0,
  jointOuterAlpha: 1,
  jointInnerColor: 0x0b1f24,
  jointInnerAlpha: 0.98,
  lengthToWidthRatio: 58,
  minBoneWidthPx: 1.35,
  maxBoneWidthPx: 6.8,
  taperRatio: 0.32,
  taperWidthScale: 2.4,
  minJointRadiusPx: 2.8,
  maxJointRadiusPx: 8.8,
  jointRadiusScale: 1.75,
  jointInnerRadiusRatio: 0.58
});
const FBX_PREVIEW_SOURCE_MODES = Object.freeze({
  auto: 'auto',
  raw: 'raw',
  spine: 'spine'
});
const FBX_PREVIEW_VIEW_MODES = Object.freeze({
  perspective: 'perspective',
  force2d: 'force2d'
});
const SKELETON_CONVERSION_MODES = Object.freeze({
  spineFirst: 'spine-first',
  fbxFirst: 'fbx-first'
});
const DEFAULT_SKELETON_CONVERSION_SCOPE = 'full-hierarchy';
const DEFAULT_SKELETON_CONVERSION_MISMATCH_POLICY = 'auto-add-bones';
const FBX_PREVIEW_SCRUB_MAX = 1000;
const FBX_PREVIEW_DEFAULT_FPS = 30;
const FBX_PREVIEW_PERSPECTIVE = Object.freeze({
  yawDeg: -24,
  pitchDeg: 16,
  cameraDistance: 290
});

const dom = {
  imageInput: document.getElementById('imageInput'),
  atlasInput: document.getElementById('atlasInput'),
  jsonInput: document.getElementById('jsonInput'),
  animationsInput: document.getElementById('animationsInput'),
  retargetFbxInput: document.getElementById('retargetFbxInput'),
  retargetAnimationNameInput: document.getElementById('retargetAnimationNameInput'),
  retargetSkeletonConvertToggle: document.getElementById('retargetSkeletonConvertToggle'),
  retargetSkeletonModeField: document.getElementById('retargetSkeletonModeField'),
  retargetSkeletonModeSelect: document.getElementById('retargetSkeletonModeSelect'),
  retargetPreviewButton: document.getElementById('retargetPreviewButton'),
  retargetDownloadButton: document.getElementById('retargetDownloadButton'),
  retargetStatus: document.getElementById('retargetStatus'),
  retargetWarnings: document.getElementById('retargetWarnings'),
  addButton: document.getElementById('addButton'),
  loadStatus: document.getElementById('loadStatus'),
  warnings: document.getElementById('warnings'),
  historyStatus: document.getElementById('historyStatus'),
  historyList: document.getElementById('historyList'),
  mipmapToggle: document.getElementById('mipmapToggle'),
  potOverrideToggle: document.getElementById('potOverrideToggle'),
  deviceProfileSelect: document.getElementById('deviceProfileSelect'),
  deviceProfileStatus: document.getElementById('deviceProfileStatus'),
  viewportPreset: document.getElementById('viewportPreset'),
  renderScaleSelect: document.getElementById('renderScaleSelect'),
  fpsCapSelect: document.getElementById('fpsCapSelect'),
  panToggle: document.getElementById('panToggle'),
  scale025: document.getElementById('scale025'),
  scale05: document.getElementById('scale05'),
  scale10: document.getElementById('scale10'),
  animationSelectionSummary: document.getElementById('animationSelectionSummary'),
  animationSearchInput: document.getElementById('animationSearchInput'),
  primaryAnimationList: document.getElementById('primaryAnimationList'),
  fbxAnimationList: document.getElementById('fbxAnimationList'),
  secondaryHandAnimationList: document.getElementById('secondaryHandAnimationList'),
  secondaryLegAnimationList: document.getElementById('secondaryLegAnimationList'),
  secondaryExpressionAnimationList: document.getElementById('secondaryExpressionAnimationList'),
  clearAllSecondaryAnimationsButton: document.getElementById('clearAllSecondaryAnimationsButton'),
  boneList: document.getElementById('boneList'),
  slotList: document.getElementById('slotList'),
  attachmentSearchInput: document.getElementById('attachmentSearchInput'),
  attachmentList: document.getElementById('attachmentList'),
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
  localZoomOut: document.getElementById('localZoomOut'),
  skeletonToggleButton: document.getElementById('skeletonToggleButton'),
  fbxPreviewCard: document.getElementById('fbxPreviewCard'),
  fbxPreviewCanvas: document.getElementById('fbxPreviewCanvas'),
  fbxPreviewSourceSelect: document.getElementById('fbxPreviewSourceSelect'),
  fbxPreviewViewSelect: document.getElementById('fbxPreviewViewSelect'),
  fbxPreviewPlayPauseButton: document.getElementById('fbxPreviewPlayPauseButton'),
  fbxPreviewResetButton: document.getElementById('fbxPreviewResetButton'),
  fbxPreviewScrubber: document.getElementById('fbxPreviewScrubber'),
  fbxPreviewSpeedSelect: document.getElementById('fbxPreviewSpeedSelect'),
  fbxPreviewBonesToggle: document.getElementById('fbxPreviewBonesToggle'),
  fbxPreviewJointsToggle: document.getElementById('fbxPreviewJointsToggle'),
  fbxPreviewActiveAnimation: document.getElementById('fbxPreviewActiveAnimation'),
  fbxPreviewMeta: document.getElementById('fbxPreviewMeta'),
  fbxPreviewEmptyState: document.getElementById('fbxPreviewEmptyState')
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
  sharedHistoryRecords: [],
  historyPreviewUrls: [],
  activeHistoryRecordId: null,
  viewportBaseScale: 1,
  localScreenZoom: 1,
  activeDeviceProfileId: 'custom',
  simulatedCpuThrottleMs: 0,
  applyingDeviceProfile: false,
  animationCatalog: {
    primary: [],
    fbx: [],
    hand: [],
    leg: [],
    expression: []
  },
  selectedPrimaryAnimation: null,
  selectedSecondaryAnimations: {
    hand: [],
    leg: [],
    expression: []
  },
  setupDrawOrderNames: [],
  setupDrawOrderIndexByName: new Map(),
  animationSearchQuery: '',
  attachmentSearchQuery: '',
  logs: [],
  retargetBusy: false,
  defaultRetargetBundlePromise: null,
  skeletonVisibilityByCharacter: new Map(),
  currentSkeletonCharacterKey: null,
  skeletonVisible: false,
  skeletonOverlayGraphics: null,
  lastLoadedBundle: null,
  suppressManualPotAutoReload: false,
  manualPotReloadInFlight: false,
  fbxPreviewMap: new Map(),
  fbxPreviewVisible: false,
  fbxPreviewPlaying: true,
  fbxPreviewTimeSec: 0,
  fbxPreviewSpeed: 1,
  fbxPreviewSourceMode: FBX_PREVIEW_SOURCE_MODES.auto,
  fbxPreviewViewMode: FBX_PREVIEW_VIEW_MODES.perspective,
  fbxPreviewShowBones: true,
  fbxPreviewShowJoints: true,
  fbxPreviewSamplerSpine: null,
  fbxPreviewSamplerAnim: null,
  fbxPreviewSamplerData: null,
  fbxPreviewResolvedSource: 'none',
  fbxPreviewContextMessage: 'No FBX preview data loaded.',
  fbxPreviewLastAnimation: null,
  fbxPreviewAutoOpenedOnce: false
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

function setRetargetStatus(message, tone = 'info') {
  if (!dom.retargetStatus) {
    return;
  }

  dom.retargetStatus.textContent = message;
  appendLog('retarget', message, tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'info');

  if (tone === 'error') {
    dom.retargetStatus.style.color = '#ff5f67';
  } else if (tone === 'warn') {
    dom.retargetStatus.style.color = '#ffb347';
  } else {
    dom.retargetStatus.style.color = '#d8e2f1';
  }
}

function setRetargetWarnings(messages = []) {
  if (!dom.retargetWarnings) {
    return;
  }

  if (!messages.length) {
    dom.retargetWarnings.textContent = 'No conversion report yet.';
    return;
  }

  dom.retargetWarnings.textContent = messages.map((message) => `- ${message}`).join('\n');
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

function sharedPathToUrl(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }

  const trimmed = path.trim();
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }

  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = trimmed.replace(/^\/+/, '');
  return `${normalizedBase}${normalizedPath}`;
}

function fileNameFromPath(path, fallbackName) {
  if (!path) {
    return fallbackName;
  }

  if (typeof path === 'string' && path.startsWith('data:')) {
    return fallbackName;
  }

  try {
    const url = new URL(path, window.location.href);
    const value = decodeURIComponent(url.pathname.split('/').pop() || '');
    return value || fallbackName;
  } catch (_error) {
    const value = path.split('/').pop();
    return value || fallbackName;
  }
}

function mimeTypeFromFileName(fileName, fallbackType = 'application/octet-stream') {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.png')) {
    return 'image/png';
  }
  if (name.endsWith('.webp')) {
    return 'image/webp';
  }
  if (name.endsWith('.atlas')) {
    return 'text/plain';
  }
  if (name.endsWith('.json')) {
    return 'application/json';
  }
  if (name.endsWith('.skel')) {
    return 'application/octet-stream';
  }
  return fallbackType;
}

function normalizeCreatedAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function isSharedHistoryRecord(record) {
  return record?.sourceType === SHARED_HISTORY_SOURCE && Boolean(record?.sharedBundle);
}

function normalizeSharedHistoryRecord(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const rawImages = Array.isArray(entry.images) ? entry.images : [];
  const imageUrls = rawImages.map((value) => sharedPathToUrl(value)).filter(Boolean);
  const imageNames = Array.isArray(entry.imageNames)
    ? entry.imageNames.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  const atlasUrl = sharedPathToUrl(entry.atlas);
  const skeletonUrl = sharedPathToUrl(entry.skeleton || entry.json);
  const animationsUrl = sharedPathToUrl(entry.animations || entry.animationsFile || null);
  const previewUrl = sharedPathToUrl(entry.preview || rawImages[0] || null);

  if (!imageUrls.length || !atlasUrl || !skeletonUrl) {
    return null;
  }

  const skeletonName = fileNameFromPath(skeletonUrl, `character-${index + 1}.json`);
  const fallbackName = skeletonName.replace(/\.[^.]+$/, '') || `shared-character-${index + 1}`;
  const recordId = entry.id ? `shared-${entry.id}` : `shared-${index + 1}`;
  const rawPotOverride = entry.potOverride;
  const hasPotOverride =
    rawPotOverride === true ||
    Boolean(
      rawPotOverride &&
        typeof rawPotOverride === 'object' &&
        (rawPotOverride.enabled === true ||
          (Number.isInteger(rawPotOverride.width) &&
            Number.isInteger(rawPotOverride.height) &&
            rawPotOverride.width > 0 &&
            rawPotOverride.height > 0))
    );
  const sharedSettings = {
    potOverride: hasPotOverride,
    mipmapsEnabled: typeof entry.mipmapsEnabled === 'boolean' ? entry.mipmapsEnabled : undefined
  };

  return {
    id: recordId,
    name: entry.name || fallbackName,
    createdAt: normalizeCreatedAt(entry.createdAt),
    imageCount: imageUrls.length,
    sourceType: SHARED_HISTORY_SOURCE,
    previewUrl,
    sharedSettings,
    sharedBundle: {
      images: imageUrls,
      imageNames,
      atlas: atlasUrl,
      skeleton: skeletonUrl,
      animations: animationsUrl
    }
  };
}

async function fetchSharedFile(url, fallbackName, fallbackType) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to fetch shared asset (${response.status}): ${url}`);
  }

  const blob = await response.blob();
  const fileName = fileNameFromPath(url, fallbackName);
  const mimeType = blob.type || mimeTypeFromFileName(fileName, fallbackType);
  return new File([blob], fileName, { type: mimeType });
}

async function buildSharedBundle(record) {
  if (!isSharedHistoryRecord(record)) {
    throw new Error('History record is not a shared bundle.');
  }

  const bundleRef = record.sharedBundle;
  const imageFiles = await Promise.all(
    bundleRef.images.map((url, index) =>
      fetchSharedFile(url, bundleRef.imageNames?.[index] || `image-${index + 1}.png`, 'image/png')
    )
  );
  const atlasFile = await fetchSharedFile(bundleRef.atlas, 'character.atlas', 'text/plain');
  const jsonFile = await fetchSharedFile(bundleRef.skeleton, 'character.json', 'application/octet-stream');
  const animationsFile = bundleRef.animations
    ? await fetchSharedFile(bundleRef.animations, 'animations.json', 'application/json')
    : null;

  return { imageFiles, atlasFile, jsonFile, animationsFile };
}

function applySharedRuntimeSettings(record) {
  const settings = record?.sharedSettings;
  if (!settings || typeof settings !== 'object') {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'mipmapsEnabled')) {
    const enabled = Boolean(settings.mipmapsEnabled);
    dom.mipmapToggle.checked = enabled;
    state.requestedMipmaps = enabled;
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'potOverride')) {
    const override = settings.potOverride;
    const enabled = override === true || Boolean(override && typeof override === 'object');
    state.suppressManualPotAutoReload = true;
    try {
      dom.potOverrideToggle.checked = Boolean(enabled);
      updateManualPotUiState();
      dom.potOverrideToggle.dispatchEvent(new Event('change'));
    } finally {
      state.suppressManualPotAutoReload = false;
    }
  }
}

async function loadSharedHistoryRecords() {
  const manifestUrl = sharedPathToUrl(SHARED_HISTORY_MANIFEST_PATH);
  if (!manifestUrl) {
    state.sharedHistoryRecords = [];
    await refreshHistoryList();
    return;
  }

  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (response.status === 404) {
      state.sharedHistoryRecords = [];
      await refreshHistoryList();
      return;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch shared history manifest (${response.status}).`);
    }

    const payload = await response.json();
    const rawEntries = Array.isArray(payload) ? payload : Array.isArray(payload?.characters) ? payload.characters : [];
    const records = rawEntries
      .map((entry, index) => normalizeSharedHistoryRecord(entry, index))
      .filter(Boolean);

    state.sharedHistoryRecords = records;
    await refreshHistoryList();
  } catch (error) {
    console.error(error);
    state.sharedHistoryRecords = [];
    await refreshHistoryList();
    setHistoryStatus(error.message || 'Failed to load shared history manifest.', 'warn');
  }
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
  if (isSharedHistoryRecord(record) && record.previewUrl) {
    return record.previewUrl;
  }

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
  const sharedRecord = isSharedHistoryRecord(record);

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
      if (sharedRecord) {
        setLoadStatus(`Loading shared entry: ${record.name}`);
        applySharedRuntimeSettings(record);
        const bundle = await buildSharedBundle(record);
        await loadSpineBundle(bundle, { saveHistory: false, activeHistoryRecordId: record.id });
      } else {
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
      }
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

  meta.textContent = sharedRecord
    ? `${record.imageCount || 0} image(s) • shared preset`
    : `${record.imageCount || 0} image(s) • ${toDisplayDate(record.createdAt)}`;
  actions.appendChild(loadButton);
  if (!sharedRecord) {
    actions.appendChild(deleteButton);
  }
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
  const sharedRecords = Array.from(state.sharedHistoryRecords || []);
  let localRecords = [];
  let localError = null;

  if (state.historySupported) {
    try {
      localRecords = await getAllHistoryRecords();
    } catch (error) {
      console.error(error);
      localError = error;
    }
  }

  const records = [...sharedRecords, ...localRecords].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  state.historyRecords = records;
  dom.historyList.innerHTML = '';

  if (!records.length) {
    if (!state.historySupported) {
      setHistoryStatus('History unavailable in this browser.', 'warn');
    } else {
      setHistoryStatus('No saved characters yet.');
    }
    return;
  }

  for (const record of records) {
    dom.historyList.appendChild(createHistoryRow(record));
  }

  if (localError) {
    setHistoryStatus(localError.message || 'Failed to load local history.', 'warn');
    return;
  }

  if (!state.historySupported && sharedRecords.length) {
    setHistoryStatus(`${sharedRecords.length} shared character(s) loaded.`);
    return;
  }

  if (sharedRecords.length && localRecords.length) {
    setHistoryStatus(`${records.length} character(s): ${localRecords.length} local + ${sharedRecords.length} shared.`);
    return;
  }

  if (sharedRecords.length) {
    setHistoryStatus(`${sharedRecords.length} shared character(s) loaded.`);
    return;
  }

  setHistoryStatus(`${localRecords.length} saved character(s).`);
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

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function setFbxPreviewMap(previewMap) {
  if (previewMap instanceof Map) {
    state.fbxPreviewMap = new Map(previewMap);
  } else {
    state.fbxPreviewMap = new Map();
  }
}

function destroyFbxPreviewSampler() {
  if (!state.fbxPreviewSamplerSpine) {
    return;
  }

  if (!state.fbxPreviewSamplerSpine.destroyed && !state.fbxPreviewSamplerSpine._destroyed) {
    state.fbxPreviewSamplerSpine.destroy({ children: true });
  }
  state.fbxPreviewSamplerSpine = null;
  state.fbxPreviewSamplerAnim = null;
  state.fbxPreviewSamplerData = null;
}

function clearFbxPreviewCanvas(message = '') {
  const canvas = dom.fbxPreviewCanvas;
  if (!canvas) {
    return;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0f1621';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#8fa4c4';
  context.font = '12px "SF Pro Text", "Helvetica Neue", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(message || 'No preview data', width * 0.5, height * 0.5);
}

function setFbxPreviewCardVisible(visible) {
  state.fbxPreviewVisible = Boolean(visible);
  if (!dom.fbxPreviewCard) {
    return;
  }

  dom.fbxPreviewCard.classList.toggle('is-hidden', !state.fbxPreviewVisible);
  dom.fbxPreviewCard.setAttribute('aria-hidden', String(!state.fbxPreviewVisible));

  if (state.fbxPreviewVisible && !state.fbxPreviewAutoOpenedOnce) {
    dom.fbxPreviewCard.open = true;
    state.fbxPreviewAutoOpenedOnce = true;
  }
}

function setFbxPreviewEmptyState(message, visible) {
  if (!dom.fbxPreviewEmptyState) {
    return;
  }

  dom.fbxPreviewEmptyState.textContent = message;
  dom.fbxPreviewEmptyState.style.display = visible ? 'block' : 'none';
}

function setFbxPreviewPlaybackControlsEnabled(enabled) {
  const disabled = !enabled;
  if (dom.fbxPreviewPlayPauseButton) {
    dom.fbxPreviewPlayPauseButton.disabled = disabled;
  }
  if (dom.fbxPreviewResetButton) {
    dom.fbxPreviewResetButton.disabled = disabled;
  }
  if (dom.fbxPreviewScrubber) {
    dom.fbxPreviewScrubber.disabled = disabled;
  }
  if (dom.fbxPreviewBonesToggle) {
    dom.fbxPreviewBonesToggle.disabled = disabled;
  }
  if (dom.fbxPreviewJointsToggle) {
    dom.fbxPreviewJointsToggle.disabled = disabled;
  }
}

function updateFbxPreviewPlayPauseButton() {
  if (!dom.fbxPreviewPlayPauseButton) {
    return;
  }
  dom.fbxPreviewPlayPauseButton.textContent = state.fbxPreviewPlaying ? 'Pause' : 'Play';
}

function getSpineAnimationByName(animationName) {
  if (!animationName || !state.spineObject?.spineData?.animations?.length) {
    return null;
  }

  return state.spineObject.spineData.animations.find((animation) => animation?.name === animationName) || null;
}

function getRawPreviewDuration(previewData) {
  if (!previewData) {
    return 0;
  }

  const explicitDuration = Number(previewData.duration);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
    return explicitDuration;
  }

  const frameTimes = Array.isArray(previewData.frameTimes) ? previewData.frameTimes : [];
  const inferredDuration = Number(frameTimes[frameTimes.length - 1]);
  if (Number.isFinite(inferredDuration) && inferredDuration > 0) {
    return inferredDuration;
  }

  return 0;
}

function resolveFbxPreviewSource(animationName) {
  if (!animationName || !isFbxGeneratedAnimation(animationName)) {
    return {
      kind: 'none',
      label: 'None',
      message: 'Select an FBX primary animation to preview.'
    };
  }

  const rawData = state.fbxPreviewMap.get(animationName) || null;
  const spineAnimation = getSpineAnimationByName(animationName);
  const hasRawData = Boolean(rawData);
  const hasSpineFallback = Boolean(spineAnimation);
  const mode = state.fbxPreviewSourceMode;

  if (mode === FBX_PREVIEW_SOURCE_MODES.raw) {
    if (hasRawData) {
      return {
        kind: 'raw',
        label: 'Raw FBX',
        message: 'Using raw FBX sampled joints.',
        rawData
      };
    }
    if (hasSpineFallback) {
      return {
        kind: 'spine',
        label: 'Spine fallback',
        message: 'Raw FBX data unavailable; using Spine fallback.',
        spineAnimation
      };
    }
    return {
      kind: 'none',
      label: 'None',
      message: 'Raw FBX and Spine fallback data are unavailable.'
    };
  }

  if (mode === FBX_PREVIEW_SOURCE_MODES.spine) {
    if (hasSpineFallback) {
      return {
        kind: 'spine',
        label: 'Spine fallback',
        message: 'Using Spine animation fallback data.',
        spineAnimation
      };
    }
    if (hasRawData) {
      return {
        kind: 'raw',
        label: 'Raw FBX',
        message: 'Spine fallback unavailable; using Raw FBX instead.',
        rawData
      };
    }
    return {
      kind: 'none',
      label: 'None',
      message: 'Spine fallback and raw FBX data are unavailable.'
    };
  }

  if (hasRawData) {
    return {
      kind: 'raw',
      label: 'Raw FBX',
      message: 'Auto source selected Raw FBX data.',
      rawData
    };
  }
  if (hasSpineFallback) {
    return {
      kind: 'spine',
      label: 'Spine fallback',
      message: 'Raw FBX cache unavailable; using Spine fallback.',
      spineAnimation
    };
  }
  return {
    kind: 'none',
    label: 'None',
    message: 'No preview source is available for this FBX animation.'
  };
}

function getFbxPreviewDuration(sourceInfo, animationName) {
  if (!sourceInfo || sourceInfo.kind === 'none') {
    return 0;
  }

  if (sourceInfo.kind === 'raw') {
    return getRawPreviewDuration(sourceInfo.rawData);
  }

  const spineAnimation = sourceInfo.spineAnimation || getSpineAnimationByName(animationName);
  const duration = Number(spineAnimation?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function getFbxPreviewFps(sourceInfo) {
  if (sourceInfo?.kind === 'raw') {
    const rawFps = Number(sourceInfo.rawData?.fps);
    if (Number.isFinite(rawFps) && rawFps > 0) {
      return rawFps;
    }
  }
  return FBX_PREVIEW_DEFAULT_FPS;
}

function normalizeLoopTime(timeSec, durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  const wrapped = timeSec % durationSec;
  return wrapped < 0 ? wrapped + durationSec : wrapped;
}

function clampPreviewSampleTime(timeSec, durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  if (durationSec <= 0.0001) {
    return 0;
  }
  return clamp(timeSec, 0, durationSec - 0.0001);
}

function findFrameSpan(frameTimes, timeSec) {
  if (!Array.isArray(frameTimes) || !frameTimes.length) {
    return {
      indexA: 0,
      indexB: 0,
      alpha: 0
    };
  }

  if (frameTimes.length === 1 || timeSec <= frameTimes[0]) {
    return {
      indexA: 0,
      indexB: 0,
      alpha: 0
    };
  }

  const lastIndex = frameTimes.length - 1;
  if (timeSec >= frameTimes[lastIndex]) {
    return {
      indexA: lastIndex,
      indexB: lastIndex,
      alpha: 0
    };
  }

  let low = 0;
  let high = lastIndex;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (frameTimes[mid] <= timeSec) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const indexA = clamp(high, 0, lastIndex);
  const indexB = clamp(indexA + 1, 0, lastIndex);
  const timeA = frameTimes[indexA];
  const timeB = frameTimes[indexB];
  const delta = timeB - timeA;
  const alpha = delta > 1e-6 ? (timeSec - timeA) / delta : 0;

  return {
    indexA,
    indexB,
    alpha: clamp(alpha, 0, 1)
  };
}

function sampleRawFbxJoints(previewData, timeSec) {
  if (!previewData) {
    return null;
  }

  const frameTimes = Array.isArray(previewData.frameTimes) ? previewData.frameTimes : [];
  const tracks = Array.isArray(previewData.jointTracks) ? previewData.jointTracks : [];
  if (!tracks.length) {
    return null;
  }

  const duration = getRawPreviewDuration(previewData);
  const clampedTime = clampPreviewSampleTime(timeSec, duration);
  const frameSpan = findFrameSpan(frameTimes, clampedTime);
  const joints = [];

  for (const track of tracks) {
    const positions = Array.isArray(track?.positions) ? track.positions : [];
    if (!positions.length) {
      continue;
    }

    const positionA = positions[clamp(frameSpan.indexA, 0, positions.length - 1)] || positions[0];
    const positionB = positions[clamp(frameSpan.indexB, 0, positions.length - 1)] || positionA;
    const alpha = frameSpan.alpha;
    joints.push({
      name: track.name || '',
      parentName: track.parentName || null,
      x: ((positionA?.x || 0) * (1 - alpha)) + ((positionB?.x || 0) * alpha),
      y: ((positionA?.y || 0) * (1 - alpha)) + ((positionB?.y || 0) * alpha),
      z: ((positionA?.z || 0) * (1 - alpha)) + ((positionB?.z || 0) * alpha)
    });
  }

  return {
    joints,
    duration,
    fps: Number(previewData.fps) || FBX_PREVIEW_DEFAULT_FPS,
    currentTime: clampedTime,
    frameIndex: Math.min(frameSpan.indexA + 1, frameTimes.length || 1),
    frameCount: Math.max(1, frameTimes.length),
    sourceFile: previewData.sourceFile || null,
    clipName: previewData.clipName || null
  };
}

function ensureFbxPreviewSampler(animationName) {
  const sourceSpineData = state.spineObject?.spineData || null;
  if (!sourceSpineData || !animationName) {
    return null;
  }

  const needsNewSampler =
    !state.fbxPreviewSamplerSpine ||
    state.fbxPreviewSamplerAnim !== animationName ||
    state.fbxPreviewSamplerData !== sourceSpineData;

  if (!needsNewSampler) {
    return state.fbxPreviewSamplerSpine;
  }

  destroyFbxPreviewSampler();

  const sampler = new Spine(sourceSpineData);
  sampler.visible = false;
  sampler.alpha = 0;
  sampler.autoUpdate = false;
  sampler.skeleton.setToSetupPose();
  sampler.state.setAnimation(0, animationName, true);
  sampler.update(0);

  state.fbxPreviewSamplerSpine = sampler;
  state.fbxPreviewSamplerAnim = animationName;
  state.fbxPreviewSamplerData = sourceSpineData;
  return sampler;
}

function sampleSpineFallbackJoints(animationName, timeSec, sourceInfo) {
  const sampler = ensureFbxPreviewSampler(animationName);
  if (!sampler) {
    return null;
  }

  const animation = sourceInfo?.spineAnimation || getSpineAnimationByName(animationName);
  if (!animation) {
    return null;
  }

  const duration = Math.max(0, Number(animation.duration) || 0);
  const clampedTime = clampPreviewSampleTime(timeSec, duration);
  const currentTrack = sampler.state.getCurrent(0);
  if (!currentTrack || currentTrack.animation?.name !== animationName) {
    sampler.state.setAnimation(0, animationName, true);
  }

  const track = sampler.state.getCurrent(0);
  if (track) {
    track.trackTime = clampedTime;
  }

  sampler.skeleton.setToSetupPose();
  sampler.state.apply(sampler.skeleton);
  sampler.skeleton.updateWorldTransform();

  const joints = [];
  const bones = sampler.skeleton?.bones || [];
  for (const bone of bones) {
    joints.push({
      name: bone?.data?.name || '',
      parentName: bone?.parent?.data?.name || null,
      x: Number.isFinite(bone?.worldX) ? bone.worldX : 0,
      y: Number.isFinite(bone?.worldY) ? bone.worldY : 0,
      z: 0
    });
  }

  const fps = getFbxPreviewFps(sourceInfo);
  const frameCount = Math.max(1, Math.round(duration * fps));
  return {
    joints,
    duration,
    fps,
    currentTime: clampedTime,
    frameIndex: Math.min(frameCount, Math.max(1, Math.floor(clampedTime * fps) + 1)),
    frameCount,
    sourceFile: null,
    clipName: animationName
  };
}

function projectFbxPreviewPoint(point, viewMode) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  const z = Number(point?.z) || 0;

  if (viewMode === FBX_PREVIEW_VIEW_MODES.force2d) {
    return { x, y };
  }

  const yaw = toRadians(FBX_PREVIEW_PERSPECTIVE.yawDeg);
  const pitch = toRadians(FBX_PREVIEW_PERSPECTIVE.pitchDeg);

  const xYaw = (x * Math.cos(yaw)) - (z * Math.sin(yaw));
  const zYaw = (x * Math.sin(yaw)) + (z * Math.cos(yaw));
  const yPitch = (y * Math.cos(pitch)) - (zYaw * Math.sin(pitch));
  const zPitch = (y * Math.sin(pitch)) + (zYaw * Math.cos(pitch));

  const depth = FBX_PREVIEW_PERSPECTIVE.cameraDistance + zPitch;
  const perspectiveScale = FBX_PREVIEW_PERSPECTIVE.cameraDistance / Math.max(24, depth);
  return {
    x: xYaw * perspectiveScale,
    y: yPitch * perspectiveScale
  };
}

function drawFbxPreviewBackground(context, width, height, viewMode) {
  context.fillStyle = '#0d141f';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(107, 132, 170, 0.24)';
  context.lineWidth = 1;
  const step = 24;
  for (let x = 0; x <= width; x += step) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }

  context.strokeStyle = 'rgba(175, 205, 255, 0.4)';
  context.beginPath();
  context.moveTo(0, height * 0.5 + 0.5);
  context.lineTo(width, height * 0.5 + 0.5);
  context.stroke();

  context.fillStyle = '#91abc9';
  context.font = '11px "SF Pro Text", "Helvetica Neue", sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(viewMode === FBX_PREVIEW_VIEW_MODES.force2d ? 'Force 2D' : 'Perspective', 8, 7);
}

function colorIntToRgbaString(colorInt, alpha = 1) {
  const safeColor = Number.isFinite(colorInt) ? (Math.floor(colorInt) >>> 0) : 0;
  const clampedAlpha = clamp(Number(alpha) || 0, 0, 1);
  const red = (safeColor >> 16) & 255;
  const green = (safeColor >> 8) & 255;
  const blue = safeColor & 255;
  return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
}

function getFbxPreviewBoneWidth(lengthPx) {
  const widthFromLength = Math.max(0, lengthPx) / SKELETON_OVERLAY_STYLE.lengthToWidthRatio;
  return clamp(widthFromLength, SKELETON_OVERLAY_STYLE.minBoneWidthPx, SKELETON_OVERLAY_STYLE.maxBoneWidthPx);
}

function getFbxPreviewJointRadius(boneWidth) {
  return clamp(
    Math.max(boneWidth * SKELETON_OVERLAY_STYLE.jointRadiusScale, SKELETON_OVERLAY_STYLE.minJointRadiusPx),
    SKELETON_OVERLAY_STYLE.minJointRadiusPx,
    SKELETON_OVERLAY_STYLE.maxJointRadiusPx
  );
}

function drawFbxPreviewBoneShape(context, fromPoint, toPoint, boneWidth) {
  const deltaX = toPoint.screenX - fromPoint.screenX;
  const deltaY = toPoint.screenY - fromPoint.screenY;
  const length = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(length) || length <= 0.0001) {
    return;
  }

  const directionX = deltaX / length;
  const directionY = deltaY / length;
  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const taperInset = Math.min(length * SKELETON_OVERLAY_STYLE.taperRatio, boneWidth * SKELETON_OVERLAY_STYLE.taperWidthScale);
  const neckDistance = Math.max(length - taperInset, 0);

  const leftX = fromPoint.screenX + (directionX * neckDistance) - (perpendicularX * boneWidth);
  const leftY = fromPoint.screenY + (directionY * neckDistance) - (perpendicularY * boneWidth);
  const rightX = fromPoint.screenX + (directionX * neckDistance) + (perpendicularX * boneWidth);
  const rightY = fromPoint.screenY + (directionY * neckDistance) + (perpendicularY * boneWidth);

  context.beginPath();
  context.moveTo(fromPoint.screenX, fromPoint.screenY);
  context.lineTo(leftX, leftY);
  context.lineTo(toPoint.screenX, toPoint.screenY);
  context.lineTo(rightX, rightY);
  context.closePath();
  context.fill();
}

function drawFbxPreviewSkeleton(sample) {
  const canvas = dom.fbxPreviewCanvas;
  if (!canvas) {
    return;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  drawFbxPreviewBackground(context, width, height, state.fbxPreviewViewMode);

  const joints = Array.isArray(sample?.joints) ? sample.joints : [];
  if (!joints.length) {
    context.fillStyle = '#8fa4c4';
    context.font = '12px "SF Pro Text", "Helvetica Neue", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('No joints available', width * 0.5, height * 0.5);
    return;
  }

  const projected = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const joint of joints) {
    const point = projectFbxPreviewPoint(joint, state.fbxPreviewViewMode);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    projected.push({
      name: joint.name || '',
      parentName: joint.parentName || null,
      x: point.x,
      y: point.y
    });
  }

  if (!projected.length) {
    clearFbxPreviewCanvas('No projected joints');
    return;
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = 20;
  const scale = Math.min((width - (padding * 2)) / contentWidth, (height - (padding * 2)) / contentHeight);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const canvasCenterX = width * 0.5;
  const canvasCenterY = height * 0.56;

  const screenPointByName = new Map();
  for (const point of projected) {
    const screenX = canvasCenterX + ((point.x - centerX) * scale);
    const screenY = canvasCenterY - ((point.y - centerY) * scale);
    screenPointByName.set(point.name, {
      ...point,
      screenX,
      screenY
    });
  }

  const segments = [];
  const jointRadiusByName = new Map();
  const registerJointRadius = (jointName, radius) => {
    if (!jointName || !Number.isFinite(radius)) {
      return;
    }
    const existing = jointRadiusByName.get(jointName);
    if (!Number.isFinite(existing) || radius > existing) {
      jointRadiusByName.set(jointName, radius);
    }
  };

  for (const point of screenPointByName.values()) {
    if (!point.parentName) {
      registerJointRadius(point.name, SKELETON_OVERLAY_STYLE.minJointRadiusPx);
      continue;
    }
    const parent = screenPointByName.get(point.parentName);
    if (!parent) {
      registerJointRadius(point.name, SKELETON_OVERLAY_STYLE.minJointRadiusPx);
      continue;
    }

    const segmentLength = Math.hypot(point.screenX - parent.screenX, point.screenY - parent.screenY);
    const boneWidth = getFbxPreviewBoneWidth(segmentLength);
    segments.push({
      fromPoint: parent,
      toPoint: point,
      boneWidth
    });

    const jointRadius = getFbxPreviewJointRadius(boneWidth);
    registerJointRadius(parent.name, jointRadius);
    registerJointRadius(point.name, jointRadius);
  }

  if (state.fbxPreviewShowBones) {
    context.fillStyle = colorIntToRgbaString(SKELETON_OVERLAY_STYLE.boneColor, SKELETON_OVERLAY_STYLE.boneAlpha);
    for (const segment of segments) {
      drawFbxPreviewBoneShape(context, segment.fromPoint, segment.toPoint, segment.boneWidth);
    }
  }

  if (state.fbxPreviewShowJoints) {
    context.fillStyle = colorIntToRgbaString(SKELETON_OVERLAY_STYLE.jointOuterColor, SKELETON_OVERLAY_STYLE.jointOuterAlpha);
    for (const point of screenPointByName.values()) {
      const jointRadius = jointRadiusByName.get(point.name) || SKELETON_OVERLAY_STYLE.minJointRadiusPx;
      context.beginPath();
      context.arc(point.screenX, point.screenY, jointRadius, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = colorIntToRgbaString(SKELETON_OVERLAY_STYLE.jointInnerColor, SKELETON_OVERLAY_STYLE.jointInnerAlpha);
    for (const point of screenPointByName.values()) {
      const jointRadius = jointRadiusByName.get(point.name) || SKELETON_OVERLAY_STYLE.minJointRadiusPx;
      const jointInnerRadius = Math.max(
        Math.min(jointRadius * SKELETON_OVERLAY_STYLE.jointInnerRadiusRatio, jointRadius - 0.0001),
        0
      );
      if (jointInnerRadius <= 0.0001) {
        continue;
      }
      context.beginPath();
      context.arc(point.screenX, point.screenY, jointInnerRadius, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function updateFbxPreviewScrubberFromDuration(duration) {
  if (!dom.fbxPreviewScrubber) {
    return;
  }

  const maxValue = Number(dom.fbxPreviewScrubber.max) || FBX_PREVIEW_SCRUB_MAX;
  if (!Number.isFinite(duration) || duration <= 0) {
    dom.fbxPreviewScrubber.value = '0';
    return;
  }

  const ratio = clamp(state.fbxPreviewTimeSec / duration, 0, 1);
  dom.fbxPreviewScrubber.value = String(Math.round(ratio * maxValue));
}

function updateFbxPreviewMeta(sourceInfo, sample, animationName) {
  if (dom.fbxPreviewActiveAnimation) {
    dom.fbxPreviewActiveAnimation.textContent = `Active animation: ${animationName || '-'}`;
  }

  if (!dom.fbxPreviewMeta) {
    return;
  }

  if (!sample) {
    dom.fbxPreviewMeta.textContent = sourceInfo?.message || 'No preview sample available.';
    return;
  }

  const fallbackPerspectiveWarning =
    sourceInfo?.kind === 'spine' && state.fbxPreviewViewMode === FBX_PREVIEW_VIEW_MODES.perspective
      ? 'Perspective uses 2D Spine fallback data.'
      : '';
  const sourceFileOrClip = sample.sourceFile || sample.clipName || 'n/a';

  dom.fbxPreviewMeta.textContent =
    `Source: ${sourceInfo?.label || 'None'} | ` +
    `FPS: ${sample.fps.toFixed(1)} | ` +
    `Frame: ${sample.frameIndex}/${sample.frameCount} | ` +
    `Time: ${sample.currentTime.toFixed(2)}s / ${sample.duration.toFixed(2)}s | ` +
    `Joints: ${sample.joints.length} | ` +
    `Clip: ${sourceFileOrClip}` +
    (fallbackPerspectiveWarning ? ` | ${fallbackPerspectiveWarning}` : '');
}

function syncFbxPreviewContext() {
  const animationName = state.selectedPrimaryAnimation || null;
  const hasFbxAnimation = Boolean(animationName && isFbxGeneratedAnimation(animationName));
  setFbxPreviewCardVisible(hasFbxAnimation);

  if (!hasFbxAnimation) {
    state.fbxPreviewResolvedSource = 'none';
    state.fbxPreviewContextMessage = 'Select an FBX primary animation to preview.';
    state.fbxPreviewLastAnimation = null;
    state.fbxPreviewTimeSec = 0;
    setFbxPreviewPlaybackControlsEnabled(false);
    setFbxPreviewEmptyState('Select an FBX primary animation to preview skeleton motion.', true);
    updateFbxPreviewMeta({ message: state.fbxPreviewContextMessage }, null, null);
    destroyFbxPreviewSampler();
    clearFbxPreviewCanvas('FBX preview hidden');
    return;
  }

  if (state.fbxPreviewLastAnimation !== animationName) {
    state.fbxPreviewLastAnimation = animationName;
    state.fbxPreviewTimeSec = 0;
    destroyFbxPreviewSampler();
  }

  const sourceInfo = resolveFbxPreviewSource(animationName);
  state.fbxPreviewResolvedSource = sourceInfo.kind;
  state.fbxPreviewContextMessage = sourceInfo.message || '';

  const hasSourceData = sourceInfo.kind !== 'none';
  setFbxPreviewPlaybackControlsEnabled(hasSourceData);
  setFbxPreviewEmptyState(sourceInfo.message || 'No preview source available.', !hasSourceData);
  updateFbxPreviewPlayPauseButton();
}

function updateFbxPreviewClock(deltaMs) {
  if (!state.fbxPreviewVisible || !state.fbxPreviewPlaying) {
    return;
  }

  const animationName = state.selectedPrimaryAnimation;
  if (!animationName || !isFbxGeneratedAnimation(animationName)) {
    return;
  }

  const sourceInfo = resolveFbxPreviewSource(animationName);
  const duration = getFbxPreviewDuration(sourceInfo, animationName);
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  const deltaSec = (Number(deltaMs) || 0) / 1000;
  const speed = Number.isFinite(state.fbxPreviewSpeed) ? state.fbxPreviewSpeed : 1;
  state.fbxPreviewTimeSec = normalizeLoopTime(state.fbxPreviewTimeSec + (deltaSec * speed), duration);
}

function renderFbxPreview() {
  if (!state.fbxPreviewVisible) {
    return;
  }

  const animationName = state.selectedPrimaryAnimation;
  if (!animationName || !isFbxGeneratedAnimation(animationName)) {
    clearFbxPreviewCanvas('No FBX animation selected');
    return;
  }

  const sourceInfo = resolveFbxPreviewSource(animationName);
  state.fbxPreviewResolvedSource = sourceInfo.kind;
  state.fbxPreviewContextMessage = sourceInfo.message || '';

  if (sourceInfo.kind === 'none') {
    updateFbxPreviewMeta(sourceInfo, null, animationName);
    setFbxPreviewEmptyState(sourceInfo.message || 'No preview source available.', true);
    clearFbxPreviewCanvas('No source available');
    updateFbxPreviewScrubberFromDuration(0);
    return;
  }

  const duration = getFbxPreviewDuration(sourceInfo, animationName);
  if (duration > 0) {
    state.fbxPreviewTimeSec = clamp(state.fbxPreviewTimeSec, 0, duration);
  } else {
    state.fbxPreviewTimeSec = 0;
  }

  const sample =
    sourceInfo.kind === 'raw'
      ? sampleRawFbxJoints(sourceInfo.rawData, state.fbxPreviewTimeSec)
      : sampleSpineFallbackJoints(animationName, state.fbxPreviewTimeSec, sourceInfo);

  if (!sample || !sample.joints?.length) {
    updateFbxPreviewMeta(sourceInfo, null, animationName);
    setFbxPreviewEmptyState('Preview source is available, but no joints were sampled.', true);
    clearFbxPreviewCanvas('No sampled joints');
    updateFbxPreviewScrubberFromDuration(duration);
    return;
  }

  setFbxPreviewEmptyState(sourceInfo.message || '', false);
  updateFbxPreviewMeta(sourceInfo, sample, animationName);
  updateFbxPreviewScrubberFromDuration(sample.duration);
  drawFbxPreviewSkeleton(sample);
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

  return {
    enabled: true,
    baseSize: MANUAL_POT_BASE_SIZE,
    padding: MANUAL_POT_PADDING
  };
}

function updateManualPotUiState() {
  const enabled = dom.potOverrideToggle.checked;
  dom.potOverrideToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
}

function basename(filePath) {
  return filePath.split('/').pop().split('\\').pop();
}

function fileStem(filePath) {
  return basename(filePath).replace(/\.[^.]+$/, '').toLowerCase();
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

function parseAtlasKeyValueLine(line, context) {
  const separatorIndex = line.indexOf(':');
  if (separatorIndex < 0) {
    throw new Error(`Atlas parse error (${context}): expected key/value pair.`);
  }

  const key = line.slice(0, separatorIndex).trim();
  const value = line.slice(separatorIndex + 1).trim();
  if (!key) {
    throw new Error(`Atlas parse error (${context}): empty key.`);
  }

  return { key, value };
}

function parseAtlasInteger(value, context) {
  const normalized = String(value ?? '').trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`Atlas parse error (${context}): expected integer, got "${value}".`);
  }
  return Number.parseInt(normalized, 10);
}

function parseAtlasIntegerPair(value, context) {
  const parts = String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Atlas parse error (${context}): expected pair "x, y", got "${value}".`);
  }

  return [parseAtlasInteger(parts[0], context), parseAtlasInteger(parts[1], context)];
}

function parseAtlasRotate(value, context) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  throw new Error(`Atlas parse error (${context}): invalid rotate value "${value}".`);
}

function formatAtlasIntegerPair(first, second) {
  return `${first}, ${second}`;
}

function cloneSpineAtlasModel(model) {
  return {
    pages: model.pages.map((page) => ({
      name: page.name,
      meta: page.meta.map((entry) => ({ key: entry.key, value: entry.value })),
      regions: page.regions.map((region) => ({
        name: region.name,
        fields: region.fields.map((entry) => ({ key: entry.key, value: entry.value })),
        parsed: {
          rotate: region.parsed.rotate,
          xy: [...region.parsed.xy],
          size: [...region.parsed.size],
          orig: [...region.parsed.orig],
          offset: [...region.parsed.offset],
          index: region.parsed.index
        }
      }))
    }))
  };
}

function setRegionFieldValue(region, key, value) {
  const formatted = String(value);
  const entry = region.fields.find((field) => field.key === key);
  if (entry) {
    entry.value = formatted;
  } else {
    region.fields.push({ key, value: formatted });
  }
}

function getPageMetaValue(page, key) {
  const entry = page.meta.find((metaEntry) => metaEntry.key === key);
  return entry?.value;
}

function setPageMetaValue(page, key, value) {
  const formatted = String(value);
  const entry = page.meta.find((metaEntry) => metaEntry.key === key);
  if (entry) {
    entry.value = formatted;
  } else {
    page.meta.push({ key, value: formatted });
  }
}

function parseSpineAtlas(atlasText) {
  const lines = atlasText.replace(/\r/g, '').split('\n');
  const totalLines = lines.length;
  const pages = [];
  let cursor = 0;

  const nextNonEmptyLineIndex = (startIndex) => {
    for (let lineIndex = startIndex; lineIndex < totalLines; lineIndex += 1) {
      if (lines[lineIndex].trim()) {
        return lineIndex;
      }
    }
    return -1;
  };

  const isPageHeaderAt = (lineIndex) => {
    if (lineIndex < 0 || lineIndex >= totalLines) {
      return false;
    }

    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes(':') || /^\s/.test(line)) {
      return false;
    }

    const nextIndex = nextNonEmptyLineIndex(lineIndex + 1);
    if (nextIndex < 0) {
      return false;
    }

    const nextLine = lines[nextIndex];
    const nextTrimmed = nextLine.trim();
    if (!nextTrimmed || /^\s/.test(nextLine) || !nextTrimmed.includes(':')) {
      return false;
    }

    const { key } = parseAtlasKeyValueLine(nextTrimmed, `line ${nextIndex + 1}`);
    return PAGE_META_KEYS.has(key);
  };

  while (true) {
    const pageHeaderIndex = nextNonEmptyLineIndex(cursor);
    if (pageHeaderIndex < 0) {
      break;
    }

    if (!isPageHeaderAt(pageHeaderIndex)) {
      throw new Error(`Invalid atlas format near line ${pageHeaderIndex + 1}: expected page header.`);
    }

    const pageName = lines[pageHeaderIndex].trim();
    cursor = pageHeaderIndex + 1;
    const pageMeta = [];

    while (cursor < totalLines) {
      const line = lines[cursor];
      const trimmed = line.trim();
      if (!trimmed) {
        cursor += 1;
        break;
      }
      if (/^\s/.test(line) || !trimmed.includes(':')) {
        break;
      }

      const { key, value } = parseAtlasKeyValueLine(trimmed, `line ${cursor + 1}`);
      pageMeta.push({ key, value });
      cursor += 1;
    }

    const regions = [];
    while (cursor < totalLines) {
      const line = lines[cursor];
      const trimmed = line.trim();

      if (!trimmed) {
        cursor += 1;
        break;
      }

      if (isPageHeaderAt(cursor)) {
        break;
      }

      if (trimmed.includes(':') || /^\s/.test(line)) {
        throw new Error(`Invalid atlas format near line ${cursor + 1}: expected region name.`);
      }

      const regionName = trimmed;
      cursor += 1;
      const regionFields = [];

      while (cursor < totalLines) {
        const fieldLine = lines[cursor];
        const fieldTrimmed = fieldLine.trim();
        if (!fieldTrimmed) {
          cursor += 1;
          break;
        }
        if (!/^\s/.test(fieldLine)) {
          break;
        }

        const { key, value } = parseAtlasKeyValueLine(fieldTrimmed, `line ${cursor + 1}`);
        regionFields.push({ key, value });
        cursor += 1;
      }

      const fieldMap = new Map(regionFields.map((entry) => [entry.key, entry.value]));
      for (const requiredKey of REGION_META_KEYS) {
        if (!fieldMap.has(requiredKey)) {
          throw new Error(
            `Invalid atlas format: region "${regionName}" on page "${pageName}" is missing required field "${requiredKey}".`
          );
        }
      }

      regions.push({
        name: regionName,
        fields: regionFields,
        parsed: {
          rotate: parseAtlasRotate(fieldMap.get('rotate'), `region "${regionName}" rotate`),
          xy: parseAtlasIntegerPair(fieldMap.get('xy'), `region "${regionName}" xy`),
          size: parseAtlasIntegerPair(fieldMap.get('size'), `region "${regionName}" size`),
          orig: parseAtlasIntegerPair(fieldMap.get('orig'), `region "${regionName}" orig`),
          offset: parseAtlasIntegerPair(fieldMap.get('offset'), `region "${regionName}" offset`),
          index: parseAtlasInteger(fieldMap.get('index'), `region "${regionName}" index`)
        }
      });
    }

    if (!regions.length) {
      throw new Error(`Invalid atlas format: page "${pageName}" does not contain any regions.`);
    }

    pages.push({
      name: pageName,
      meta: pageMeta,
      regions
    });
  }

  if (!pages.length) {
    throw new Error('No atlas page headers found in .atlas file.');
  }

  return { pages };
}

function serializeSpineAtlas(model) {
  const lines = [];

  model.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      lines.push('');
    }

    lines.push(page.name);
    for (const metaEntry of page.meta) {
      lines.push(`${metaEntry.key}: ${metaEntry.value}`);
    }

    for (const region of page.regions) {
      lines.push(region.name);
      for (const field of region.fields) {
        lines.push(`  ${field.key}: ${field.value}`);
      }
    }
  });

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

function isRegionRotated(rotateValue) {
  if (typeof rotateValue === 'boolean') {
    return rotateValue;
  }

  if (typeof rotateValue === 'number') {
    return Math.abs(rotateValue) % 180 === 90;
  }

  const normalized = String(rotateValue ?? '').trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  if (/^-?\d+$/.test(normalized)) {
    const numeric = Number.parseInt(normalized, 10);
    return Math.abs(numeric) % 180 === 90;
  }

  return false;
}

function rectanglesIntersect(a, b) {
  return !(
    a.x >= b.x + b.width ||
    a.x + a.width <= b.x ||
    a.y >= b.y + b.height ||
    a.y + a.height <= b.y
  );
}

function isRectContainedIn(inner, outer) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function splitFreeRectangles(freeRectangles, usedRect) {
  const next = [];

  for (const freeRect of freeRectangles) {
    if (!rectanglesIntersect(freeRect, usedRect)) {
      next.push(freeRect);
      continue;
    }

    if (usedRect.x > freeRect.x) {
      next.push({
        x: freeRect.x,
        y: freeRect.y,
        width: usedRect.x - freeRect.x,
        height: freeRect.height
      });
    }

    if (usedRect.x + usedRect.width < freeRect.x + freeRect.width) {
      next.push({
        x: usedRect.x + usedRect.width,
        y: freeRect.y,
        width: freeRect.x + freeRect.width - (usedRect.x + usedRect.width),
        height: freeRect.height
      });
    }

    if (usedRect.y > freeRect.y) {
      next.push({
        x: freeRect.x,
        y: freeRect.y,
        width: freeRect.width,
        height: usedRect.y - freeRect.y
      });
    }

    if (usedRect.y + usedRect.height < freeRect.y + freeRect.height) {
      next.push({
        x: freeRect.x,
        y: usedRect.y + usedRect.height,
        width: freeRect.width,
        height: freeRect.y + freeRect.height - (usedRect.y + usedRect.height)
      });
    }
  }

  return next.filter((rect) => rect.width > 0 && rect.height > 0);
}

function pruneContainedFreeRectangles(freeRectangles) {
  for (let i = 0; i < freeRectangles.length; i += 1) {
    for (let j = i + 1; j < freeRectangles.length; j += 1) {
      if (isRectContainedIn(freeRectangles[i], freeRectangles[j])) {
        freeRectangles.splice(i, 1);
        i -= 1;
        break;
      }
      if (isRectContainedIn(freeRectangles[j], freeRectangles[i])) {
        freeRectangles.splice(j, 1);
        j -= 1;
      }
    }
  }
}

function findBestShortSidePlacement(freeRectangles, width, height) {
  let best = null;
  let bestShortSide = Number.POSITIVE_INFINITY;
  let bestLongSide = Number.POSITIVE_INFINITY;

  for (const freeRect of freeRectangles) {
    if (width > freeRect.width || height > freeRect.height) {
      continue;
    }

    const leftoverHoriz = freeRect.width - width;
    const leftoverVert = freeRect.height - height;
    const shortSideFit = Math.min(leftoverHoriz, leftoverVert);
    const longSideFit = Math.max(leftoverHoriz, leftoverVert);

    if (
      shortSideFit < bestShortSide ||
      (shortSideFit === bestShortSide && longSideFit < bestLongSide) ||
      (shortSideFit === bestShortSide && longSideFit === bestLongSide && best && freeRect.y < best.y) ||
      (shortSideFit === bestShortSide &&
        longSideFit === bestLongSide &&
        best &&
        freeRect.y === best.y &&
        freeRect.x < best.x)
    ) {
      bestShortSide = shortSideFit;
      bestLongSide = longSideFit;
      best = {
        x: freeRect.x,
        y: freeRect.y,
        width,
        height
      };
    }
  }

  return best;
}

function tryPackRectanglesMaxRects(rectangles, atlasWidth, atlasHeight) {
  const freeRectangles = [{ x: 0, y: 0, width: atlasWidth, height: atlasHeight }];
  const placements = new Map();

  const sorted = [...rectangles].sort((first, second) => {
    const firstMaxSide = Math.max(first.packWidth, first.packHeight);
    const secondMaxSide = Math.max(second.packWidth, second.packHeight);
    if (secondMaxSide !== firstMaxSide) {
      return secondMaxSide - firstMaxSide;
    }

    const secondArea = second.packWidth * second.packHeight;
    const firstArea = first.packWidth * first.packHeight;
    if (secondArea !== firstArea) {
      return secondArea - firstArea;
    }

    return first.id - second.id;
  });

  for (const rect of sorted) {
    const placement = findBestShortSidePlacement(freeRectangles, rect.packWidth, rect.packHeight);
    if (!placement) {
      return null;
    }

    placements.set(rect.id, placement);
    const nextFree = splitFreeRectangles(freeRectangles, placement);
    freeRectangles.length = 0;
    freeRectangles.push(...nextFree);
    pruneContainedFreeRectangles(freeRectangles);
  }

  return placements;
}

function buildManualPotCandidates(baseSize, maxTextureSize, minWidth, minHeight) {
  const startWidth = nextPowerOfTwo(Math.max(baseSize, minWidth));
  const startHeight = nextPowerOfTwo(Math.max(baseSize, minHeight));
  const widths = [];
  const heights = [];

  for (let width = startWidth; width <= maxTextureSize; width *= 2) {
    widths.push(width);
  }
  for (let height = startHeight; height <= maxTextureSize; height *= 2) {
    heights.push(height);
  }

  const candidates = [];
  for (const width of widths) {
    for (const height of heights) {
      candidates.push({ width, height });
    }
  }

  candidates.sort((first, second) => {
    const areaDiff = first.width * first.height - second.width * second.height;
    if (areaDiff !== 0) {
      return areaDiff;
    }
    const maxSideDiff = Math.max(first.width, first.height) - Math.max(second.width, second.height);
    if (maxSideDiff !== 0) {
      return maxSideDiff;
    }
    if (first.width !== second.width) {
      return first.width - second.width;
    }
    return first.height - second.height;
  });

  return candidates;
}

function buildMergedPageMeta(basePage, allPages, targetWidth, targetHeight) {
  const warnings = [];
  const mergedPage = {
    name: MANUAL_POT_MERGED_PAGE_NAME,
    meta: basePage.meta.map((entry) => ({ key: entry.key, value: entry.value })),
    regions: []
  };

  setPageMetaValue(mergedPage, 'size', formatAtlasIntegerPair(targetWidth, targetHeight));

  if (!getPageMetaValue(mergedPage, 'format')) {
    setPageMetaValue(mergedPage, 'format', 'RGBA8888');
  }
  if (!getPageMetaValue(mergedPage, 'filter')) {
    setPageMetaValue(mergedPage, 'filter', 'Linear,Linear');
  }
  if (!getPageMetaValue(mergedPage, 'repeat')) {
    setPageMetaValue(mergedPage, 'repeat', 'none');
  }

  const metadataKeys = ['format', 'filter', 'repeat', 'pma', 'scale'];
  for (const key of metadataKeys) {
    const selectedValue = getPageMetaValue(basePage, key);
    for (let pageIndex = 1; pageIndex < allPages.length; pageIndex += 1) {
      const page = allPages[pageIndex];
      const pageValue = getPageMetaValue(page, key);
      if (!pageValue || pageValue === selectedValue) {
        continue;
      }

      warnings.push(
        `Manual POT merge kept first page ${key}="${selectedValue ?? '(missing)'}" and ignored ${page.name} value "${pageValue}".`
      );
    }
  }

  return { mergedPage, warnings };
}

function repackAtlasToSinglePotPage(atlasModel, sourcePageByName, options) {
  const cloned = cloneSpineAtlasModel(atlasModel);
  const allRegions = [];
  let nextRegionId = 1;

  for (const page of cloned.pages) {
    const sourcePage = sourcePageByName.get(page.name);
    if (!sourcePage) {
      throw new Error(`Manual POT repack failed: no source image found for atlas page "${page.name}".`);
    }

    for (const region of page.regions) {
      const [sourceX, sourceY] = region.parsed.xy;
      const [sizeWidth, sizeHeight] = region.parsed.size;
      const rotated = isRegionRotated(region.parsed.rotate);
      const cropWidth = rotated ? sizeHeight : sizeWidth;
      const cropHeight = rotated ? sizeWidth : sizeHeight;

      if (cropWidth <= 0 || cropHeight <= 0) {
        throw new Error(`Manual POT repack failed: region "${region.name}" has invalid size ${sizeWidth}x${sizeHeight}.`);
      }

      if (
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX + cropWidth > sourcePage.width ||
        sourceY + cropHeight > sourcePage.height
      ) {
        throw new Error(
          `Manual POT repack failed: region "${region.name}" (${sourceX},${sourceY},${cropWidth},${cropHeight}) exceeds source page "${page.name}" (${sourcePage.width}x${sourcePage.height}).`
        );
      }

      allRegions.push({
        id: nextRegionId,
        pageName: page.name,
        sourcePage,
        region,
        sourceX,
        sourceY,
        cropWidth,
        cropHeight,
        packWidth: cropWidth + options.padding * 2,
        packHeight: cropHeight + options.padding * 2
      });
      nextRegionId += 1;
    }
  }

  if (!allRegions.length) {
    throw new Error('Manual POT repack failed: atlas contains no regions to repack.');
  }

  const minWidth = Math.max(...allRegions.map((region) => region.packWidth));
  const minHeight = Math.max(...allRegions.map((region) => region.packHeight));
  const totalPackedArea = allRegions.reduce((sum, region) => sum + region.packWidth * region.packHeight, 0);
  const candidates = buildManualPotCandidates(options.baseSize, options.maxTextureSize, minWidth, minHeight);

  let selectedCandidate = null;
  let placements = null;
  for (const candidate of candidates) {
    if (candidate.width * candidate.height < totalPackedArea) {
      continue;
    }

    const attempt = tryPackRectanglesMaxRects(allRegions, candidate.width, candidate.height);
    if (attempt) {
      selectedCandidate = candidate;
      placements = attempt;
      break;
    }
  }

  if (!selectedCandidate || !placements) {
    throw new Error(
      `Manual POT repack failed: unable to fit ${allRegions.length} regions within MAX_TEXTURE_SIZE ${options.maxTextureSize}.`
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = selectedCandidate.width;
  canvas.height = selectedCandidate.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Manual POT repack failed: unable to create 2D canvas context.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const packed of allRegions) {
    const placement = placements.get(packed.id);
    if (!placement) {
      throw new Error(`Manual POT repack failed: no placement found for region "${packed.region.name}".`);
    }

    const destinationX = placement.x + options.padding;
    const destinationY = placement.y + options.padding;
    context.drawImage(
      packed.sourcePage.image,
      packed.sourceX,
      packed.sourceY,
      packed.cropWidth,
      packed.cropHeight,
      destinationX,
      destinationY,
      packed.cropWidth,
      packed.cropHeight
    );

    packed.region.parsed.xy = [destinationX, destinationY];
    setRegionFieldValue(packed.region, 'xy', formatAtlasIntegerPair(destinationX, destinationY));
  }

  const { mergedPage, warnings: metadataWarnings } = buildMergedPageMeta(
    cloned.pages[0],
    cloned.pages,
    selectedCandidate.width,
    selectedCandidate.height
  );
  for (const page of cloned.pages) {
    mergedPage.regions.push(...page.regions);
  }

  const warnings = [
    `Manual POT repacked ${allRegions.length} regions from ${cloned.pages.length} page(s) into ${selectedCandidate.width}x${selectedCandidate.height}.`
  ];
  if (selectedCandidate.width !== options.baseSize || selectedCandidate.height !== options.baseSize) {
    warnings.push(
      `Manual POT target ${options.baseSize}x${options.baseSize} auto-bumped to ${selectedCandidate.width}x${selectedCandidate.height} to fit atlas content.`
    );
  }
  warnings.push(...metadataWarnings);

  const atlasText = serializeSpineAtlas({
    pages: [mergedPage]
  });

  return {
    pageName: MANUAL_POT_MERGED_PAGE_NAME,
    canvas,
    width: selectedCandidate.width,
    height: selectedCandidate.height,
    atlasText,
    warnings
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
  dom.primaryAnimationList.innerHTML = '';
  dom.fbxAnimationList.innerHTML = '';
  dom.secondaryHandAnimationList.innerHTML = '';
  dom.secondaryLegAnimationList.innerHTML = '';
  dom.secondaryExpressionAnimationList.innerHTML = '';
  if (dom.animationSelectionSummary) {
    dom.animationSelectionSummary.textContent = 'Load a character to configure primary and secondary layers.';
  }
  if (dom.clearAllSecondaryAnimationsButton) {
    dom.clearAllSecondaryAnimationsButton.disabled = true;
  }

  state.animationCatalog = {
    primary: [],
    fbx: [],
    hand: [],
    leg: [],
    expression: []
  };
  state.selectedPrimaryAnimation = null;
  state.selectedSecondaryAnimations = {
    hand: [],
    leg: [],
    expression: []
  };
  state.setupDrawOrderNames = [];
  state.setupDrawOrderIndexByName = new Map();

  dom.boneList.innerHTML = '';
  dom.slotList.innerHTML = '';
  dom.attachmentList.innerHTML = '';
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

  if (state.skeletonOverlayGraphics) {
    if (state.skeletonOverlayGraphics.parent) {
      state.skeletonOverlayGraphics.parent.removeChild(state.skeletonOverlayGraphics);
    }
    if (!state.skeletonOverlayGraphics.destroyed && !state.skeletonOverlayGraphics._destroyed) {
      state.skeletonOverlayGraphics.destroy();
    }
    state.skeletonOverlayGraphics = null;
  }

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
  state.currentSkeletonCharacterKey = null;
  state.skeletonVisible = false;
  state.fbxPreviewTimeSec = 0;
  state.fbxPreviewLastAnimation = null;
  state.fbxPreviewResolvedSource = 'none';
  state.fbxPreviewContextMessage = 'No FBX preview data loaded.';
  destroyFbxPreviewSampler();
  updateSkeletonToggleButton();
  applyWorldScale();
  syncFbxPreviewContext();
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

function toCharacterKey(fileName, fallback = 'character') {
  const normalized = String(fileName || '')
    .toLowerCase()
    .replace(/\.json$/i, '')
    .replace(/\.generated(\.[^.]+)?$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function deriveSkeletonCharacterKey(bundle = {}) {
  const jsonName = bundle?.jsonFile?.name || '';
  const atlasName = bundle?.atlasFile?.name || '';
  const jsonKey = toCharacterKey(jsonName);
  if (jsonKey && jsonKey !== 'character') {
    return jsonKey;
  }
  return toCharacterKey(atlasName);
}

function getSkeletonOverlayScreenScale(spineObject) {
  const transform = spineObject?.worldTransform;
  if (!transform) {
    return 1;
  }

  const xScale = Math.hypot(transform.a || 0, transform.b || 0);
  const yScale = Math.hypot(transform.c || 0, transform.d || 0);
  return Math.max((xScale + yScale) * 0.5, 0.0001);
}

function ensureSkeletonOverlayGraphics(spineObject) {
  if (state.skeletonOverlayGraphics?.destroyed || state.skeletonOverlayGraphics?._destroyed) {
    state.skeletonOverlayGraphics = null;
  }

  if (!state.skeletonOverlayGraphics) {
    const overlay = new PIXI.Graphics();
    overlay.name = 'skeleton-overlay';
    overlay.visible = false;
    overlay.eventMode = 'none';
    state.skeletonOverlayGraphics = overlay;
  }

  const overlay = state.skeletonOverlayGraphics;
  if (overlay.parent !== spineObject) {
    spineObject.addChild(overlay);
  } else if (spineObject.children[spineObject.children.length - 1] !== overlay) {
    spineObject.addChild(overlay);
  }

  return overlay;
}

function toSkeletonPoint(bone, skeletonX, skeletonY, localX, localY) {
  const matrix = bone.matrix;
  return {
    x: skeletonX + matrix.tx + matrix.a * localX + matrix.c * localY,
    y: skeletonY + matrix.ty + matrix.b * localX + matrix.d * localY
  };
}

function drawSkeletonBone(graphics, bone, skeletonX, skeletonY, screenScale) {
  if (!bone?.matrix || !bone?.data) {
    return;
  }

  const length = Number.isFinite(bone.data.length) ? Math.abs(bone.data.length) : 0;
  const minBoneWidth = SKELETON_OVERLAY_STYLE.minBoneWidthPx / screenScale;
  const maxBoneWidth = SKELETON_OVERLAY_STYLE.maxBoneWidthPx / screenScale;
  const widthFromLength = length / SKELETON_OVERLAY_STYLE.lengthToWidthRatio;
  const boneWidth = clamp(widthFromLength, minBoneWidth, maxBoneWidth);

  if (length > 0.0001) {
    const taperInset = Math.min(
      length * SKELETON_OVERLAY_STYLE.taperRatio,
      boneWidth * SKELETON_OVERLAY_STYLE.taperWidthScale
    );
    const neckX = Math.max(length - taperInset, 0);

    const start = toSkeletonPoint(bone, skeletonX, skeletonY, 0, 0);
    const left = toSkeletonPoint(bone, skeletonX, skeletonY, neckX, -boneWidth);
    const tip = toSkeletonPoint(bone, skeletonX, skeletonY, length, 0);
    const right = toSkeletonPoint(bone, skeletonX, skeletonY, neckX, boneWidth);

    if (
      Number.isFinite(start.x) && Number.isFinite(start.y) &&
      Number.isFinite(left.x) && Number.isFinite(left.y) &&
      Number.isFinite(tip.x) && Number.isFinite(tip.y) &&
      Number.isFinite(right.x) && Number.isFinite(right.y)
    ) {
      graphics.beginFill(SKELETON_OVERLAY_STYLE.boneColor, SKELETON_OVERLAY_STYLE.boneAlpha);
      graphics.moveTo(start.x, start.y);
      graphics.lineTo(left.x, left.y);
      graphics.lineTo(tip.x, tip.y);
      graphics.lineTo(right.x, right.y);
      graphics.lineTo(start.x, start.y);
      graphics.endFill();
    }
  }

  const joint = toSkeletonPoint(bone, skeletonX, skeletonY, 0, 0);
  if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y)) {
    return;
  }

  const minJointRadius = SKELETON_OVERLAY_STYLE.minJointRadiusPx / screenScale;
  const maxJointRadius = SKELETON_OVERLAY_STYLE.maxJointRadiusPx / screenScale;
  const jointRadius = clamp(
    Math.max(boneWidth * SKELETON_OVERLAY_STYLE.jointRadiusScale, minJointRadius),
    minJointRadius,
    maxJointRadius
  );
  const jointInnerRadius = Math.max(
    Math.min(jointRadius * SKELETON_OVERLAY_STYLE.jointInnerRadiusRatio, jointRadius - 0.0001),
    0
  );

  graphics.beginFill(SKELETON_OVERLAY_STYLE.jointOuterColor, SKELETON_OVERLAY_STYLE.jointOuterAlpha);
  graphics.drawCircle(joint.x, joint.y, jointRadius);
  graphics.endFill();

  if (jointInnerRadius > 0.0001) {
    graphics.beginFill(SKELETON_OVERLAY_STYLE.jointInnerColor, SKELETON_OVERLAY_STYLE.jointInnerAlpha);
    graphics.drawCircle(joint.x, joint.y, jointInnerRadius);
    graphics.endFill();
  }
}

function drawSkeletonOverlay() {
  const spineObject = state.spineObject;
  if (!spineObject) {
    return;
  }

  const overlay = ensureSkeletonOverlayGraphics(spineObject);
  if (!state.skeletonVisible) {
    overlay.visible = false;
    return;
  }

  const skeleton = spineObject.skeleton;
  const bones = skeleton?.bones || [];
  if (!bones.length) {
    overlay.clear();
    overlay.visible = false;
    return;
  }

  overlay.visible = true;
  overlay.clear();

  const skeletonX = Number.isFinite(skeleton.x) ? skeleton.x : 0;
  const skeletonY = Number.isFinite(skeleton.y) ? skeleton.y : 0;
  const screenScale = getSkeletonOverlayScreenScale(spineObject);

  for (const bone of bones) {
    drawSkeletonBone(overlay, bone, skeletonX, skeletonY, screenScale);
  }
}

function updateSkeletonToggleButton() {
  if (!dom.skeletonToggleButton) {
    return;
  }

  const hasCharacter = Boolean(state.spineObject);
  const enabled = hasCharacter ? state.skeletonVisible : false;

  dom.skeletonToggleButton.disabled = !hasCharacter;
  dom.skeletonToggleButton.textContent = `Skeleton: ${enabled ? 'ON' : 'OFF'}`;
  dom.skeletonToggleButton.setAttribute('aria-pressed', String(enabled));
  dom.skeletonToggleButton.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} skeleton`);
}

function setSkeletonVisible(visible, options = {}) {
  const { silent = false } = options;
  const resolvedVisible = Boolean(visible);
  state.skeletonVisible = resolvedVisible;

  if (state.currentSkeletonCharacterKey) {
    state.skeletonVisibilityByCharacter.set(state.currentSkeletonCharacterKey, resolvedVisible);
  }

  updateSkeletonToggleButton();
  drawSkeletonOverlay();
  if (!silent) {
    setLoadStatus(`Skeleton: ${resolvedVisible ? 'ON' : 'OFF'}.`);
  }
}

function applySkeletonVisibilityForBundle(bundle, options = {}) {
  const characterKey = deriveSkeletonCharacterKey(bundle);
  state.currentSkeletonCharacterKey = characterKey;

  const visible = state.skeletonVisibilityByCharacter.has(characterKey)
    ? state.skeletonVisibilityByCharacter.get(characterKey)
    : false;

  state.skeletonVisibilityByCharacter.set(characterKey, visible);
  setSkeletonVisible(visible, options);
}

function getAnimationNameTokens(animationName) {
  return String(animationName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isFbxGeneratedAnimation(animationName) {
  return String(animationName || '').toUpperCase().startsWith('FBX_');
}

function captureSetupDrawOrder(spineObject) {
  const drawOrder = spineObject?.skeleton?.drawOrder || [];
  state.setupDrawOrderNames = drawOrder.map((slot) => slot?.data?.name).filter(Boolean);
  state.setupDrawOrderIndexByName = new Map(
    state.setupDrawOrderNames.map((slotName, index) => [slotName, index])
  );
}

function enforceFbxDrawOrder() {
  const spineObject = state.spineObject;
  if (!spineObject || !isFbxGeneratedAnimation(state.selectedPrimaryAnimation)) {
    return;
  }

  const drawOrder = spineObject.skeleton?.drawOrder || null;
  if (!Array.isArray(drawOrder) || !drawOrder.length || !state.setupDrawOrderIndexByName.size) {
    return;
  }

  drawOrder.sort((leftSlot, rightSlot) => {
    const leftName = leftSlot?.data?.name || '';
    const rightName = rightSlot?.data?.name || '';
    const leftIndex = state.setupDrawOrderIndexByName.get(leftName);
    const rightIndex = state.setupDrawOrderIndexByName.get(rightName);

    const safeLeft = Number.isInteger(leftIndex) ? leftIndex : Number.MAX_SAFE_INTEGER;
    const safeRight = Number.isInteger(rightIndex) ? rightIndex : Number.MAX_SAFE_INTEGER;
    return safeLeft - safeRight;
  });
}

function applyDefaultAttachmentOverrides(spineObject) {
  const torsoSlot = spineObject?.skeleton?.findSlot?.('TORSO') || null;
  if (torsoSlot?.setAttachment) {
    torsoSlot.setAttachment(null);
  }
}

function classifyAnimationLayer(animationName) {
  if (isFbxGeneratedAnimation(animationName)) {
    return 'fbx';
  }

  const tokens = getAnimationNameTokens(animationName);
  const hasPartMarker = tokens.includes('part');

  if (
    tokens.includes('expression') ||
    tokens.includes('facial') ||
    tokens.includes('face') ||
    (tokens.includes('head') && hasPartMarker)
  ) {
    return 'expression';
  }

  if ((tokens.includes('hand') && hasPartMarker) || tokens.includes('handpart')) {
    return 'hand';
  }

  if ((tokens.includes('leg') && hasPartMarker) || tokens.includes('legpart')) {
    return 'leg';
  }

  return 'primary';
}

function buildAnimationCatalog(spineObject) {
  const catalog = {
    primary: [],
    fbx: [],
    hand: [],
    leg: [],
    expression: []
  };

  const animations = spineObject.spineData.animations || [];
  for (const animation of animations) {
    const layerType = classifyAnimationLayer(animation.name);
    catalog[layerType].push(animation.name);
  }

  // Fallback for old assets where no naming convention exists.
  if (!catalog.primary.length && animations.length) {
    catalog.primary = animations.map((animation) => animation.name);
    catalog.fbx = [];
    catalog.hand = [];
    catalog.leg = [];
    catalog.expression = [];
  }

  return catalog;
}

function syncSelectedAnimationsToCatalog() {
  const { animationCatalog } = state;
  const validPrimaryAnimations = [...(animationCatalog.primary || []), ...(animationCatalog.fbx || [])];

  if (!validPrimaryAnimations.includes(state.selectedPrimaryAnimation)) {
    state.selectedPrimaryAnimation = animationCatalog.primary[0] || animationCatalog.fbx[0] || null;
  }

  for (const type of Object.keys(SECONDARY_ANIMATION_LIMITS)) {
    const allowed = new Set(animationCatalog[type]);
    const limit = SECONDARY_ANIMATION_LIMITS[type];
    const filtered = (state.selectedSecondaryAnimations[type] || []).filter((name) => allowed.has(name)).slice(0, limit);
    state.selectedSecondaryAnimations[type] = filtered;
  }
}

function selectedNamesToDisplay(names) {
  if (!Array.isArray(names) || !names.length) {
    return 'none';
  }

  return names.join(', ');
}

function updateAnimationSelectionSummary() {
  if (!dom.animationSelectionSummary) {
    return;
  }

  if (!state.selectedPrimaryAnimation) {
    dom.animationSelectionSummary.textContent = 'No animations were detected in this skeleton.';
    return;
  }

  dom.animationSelectionSummary.textContent =
    `Primary: ${state.selectedPrimaryAnimation} | ` +
    `Hand: ${selectedNamesToDisplay(state.selectedSecondaryAnimations.hand)} | ` +
    `Leg: ${selectedNamesToDisplay(state.selectedSecondaryAnimations.leg)} | ` +
    `Expression: ${selectedNamesToDisplay(state.selectedSecondaryAnimations.expression)}`;
}

function hasAnySecondarySelection() {
  return Object.keys(SECONDARY_ANIMATION_LIMITS).some((type) => state.selectedSecondaryAnimations[type].length > 0);
}

function updateClearAllSecondaryButtonState() {
  if (!dom.clearAllSecondaryAnimationsButton) {
    return;
  }

  dom.clearAllSecondaryAnimationsButton.disabled = !hasAnySecondarySelection();
}

function normalizeAnimationSearchQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function isAnimationSearchActive() {
  return state.animationSearchQuery.length >= 2;
}

function animationNameMatchesSearch(animationName) {
  if (!isAnimationSearchActive()) {
    return true;
  }

  const normalizedName = getAnimationNameTokens(animationName).join(' ');
  if (!normalizedName) {
    return false;
  }

  if (normalizedName.includes(state.animationSearchQuery)) {
    return true;
  }

  const queryTokens = state.animationSearchQuery.split(/\s+/).filter(Boolean);
  return queryTokens.length > 1 && queryTokens.every((token) => normalizedName.includes(token));
}

function filterAnimationNamesBySearch(animationNames) {
  if (!isAnimationSearchActive()) {
    return animationNames;
  }

  return animationNames.filter((animationName) => animationNameMatchesSearch(animationName));
}

function appendEmptyAnimationListItem(listElement, message) {
  const item = document.createElement('li');
  item.className = 'animation-empty';
  item.textContent = message;
  listElement.appendChild(item);
}

function renderEmptyAnimationList(listElement, message) {
  listElement.innerHTML = '';
  appendEmptyAnimationListItem(listElement, message);
}

function getSecondaryListElement(type) {
  if (type === 'hand') {
    return dom.secondaryHandAnimationList;
  }
  if (type === 'leg') {
    return dom.secondaryLegAnimationList;
  }

  return dom.secondaryExpressionAnimationList;
}

function clearSecondaryAnimationSelection(type, options = {}) {
  const { silent = false } = options;
  if (!Object.prototype.hasOwnProperty.call(SECONDARY_ANIMATION_LIMITS, type)) {
    return;
  }

  state.selectedSecondaryAnimations[type] = [];
  applySelectedAnimationLayers();
  renderAnimationControls();
  if (!silent) {
    setLoadStatus(`Cleared all ${type} secondary animations.`);
  }
}

function clearAllSecondaryAnimationSelections(options = {}) {
  const { silent = false } = options;
  for (const type of Object.keys(SECONDARY_ANIMATION_LIMITS)) {
    state.selectedSecondaryAnimations[type] = [];
  }

  const spineObject = state.spineObject;
  if (spineObject) {
    const spineState = spineObject.state;

    for (const trackIndices of Object.values(SECONDARY_TRACKS_BY_TYPE)) {
      for (const trackIndex of trackIndices) {
        spineState.clearTrack(trackIndex);
      }
    }

    if (state.selectedPrimaryAnimation) {
      // Ensure any lingering partial-pose from secondary overlays is reset back to base motion.
      spineObject.skeleton.setToSetupPose();
      spineState.setAnimation(0, state.selectedPrimaryAnimation, true);
    } else {
      spineState.clearTrack(0);
    }

    spineObject.update(0);
    updateAnimationSelectionSummary();
    updateClearAllSecondaryButtonState();
  } else {
    applySelectedAnimationLayers();
  }

  renderAnimationControls();
  if (!silent) {
    setLoadStatus('Cleared all secondary animations.');
  }
}

function setTrackAnimationIfNeeded(spineState, trackIndex, animationName) {
  const current = spineState.getCurrent(trackIndex);
  const currentAnimation = current?.animation?.name || null;

  if (!animationName) {
    if (current) {
      spineState.clearTrack(trackIndex);
    }
    return;
  }

  if (currentAnimation === animationName) {
    return;
  }

  spineState.setAnimation(trackIndex, animationName, true);
}

function applySelectedAnimationLayers() {
  const spineObject = state.spineObject;
  if (!spineObject) {
    updateAnimationSelectionSummary();
    updateClearAllSecondaryButtonState();
    syncFbxPreviewContext();
    return;
  }

  const spineState = spineObject.state;
  setTrackAnimationIfNeeded(spineState, 0, state.selectedPrimaryAnimation);

  for (const [type, trackIndices] of Object.entries(SECONDARY_TRACKS_BY_TYPE)) {
    const selected = state.selectedSecondaryAnimations[type] || [];
    for (let i = 0; i < trackIndices.length; i += 1) {
      const animationName = selected[i] || null;
      setTrackAnimationIfNeeded(spineState, trackIndices[i], animationName);
    }
  }

  spineObject.update(0);
  enforceFbxDrawOrder();
  updateAnimationSelectionSummary();
  updateClearAllSecondaryButtonState();
  syncFbxPreviewContext();
}

function renderAnimationControls() {
  const primaryAnimations = state.animationCatalog.primary || [];
  const fbxAnimations = state.animationCatalog.fbx || [];
  const searchActive = isAnimationSearchActive();
  updateClearAllSecondaryButtonState();

  const renderPrimarySelectorList = (listElement, allAnimations, emptyMessage) => {
    listElement.innerHTML = '';
    const filteredAnimations = filterAnimationNamesBySearch(allAnimations);

    if (!filteredAnimations.length) {
      if (searchActive && allAnimations.length) {
        renderEmptyAnimationList(listElement, `No animation matches "${state.animationSearchQuery}".`);
      } else {
        renderEmptyAnimationList(listElement, emptyMessage);
      }
      return;
    }

    for (const animationName of filteredAnimations) {
      const listItem = document.createElement('li');
      const label = document.createElement('label');
      const input = document.createElement('input');
      const control = document.createElement('span');
      const text = document.createElement('span');

      label.className = 'animation-option';
      input.type = 'radio';
      input.name = 'primaryAnimation';
      input.value = animationName;
      input.checked = state.selectedPrimaryAnimation === animationName;
      input.className = 'animation-option-input';
      control.className = 'animation-option-control';
      text.className = 'animation-option-text';
      text.textContent = animationName;

      input.addEventListener('change', () => {
        if (!input.checked) {
          return;
        }

        state.selectedPrimaryAnimation = animationName;
        applySelectedAnimationLayers();
        setLoadStatus(`Primary animation set to "${animationName}".`);
      });

      label.appendChild(input);
      label.appendChild(control);
      label.appendChild(text);
      listItem.appendChild(label);
      listElement.appendChild(listItem);
    }
  };

  renderPrimarySelectorList(dom.primaryAnimationList, primaryAnimations, 'No base animation found.');
  renderPrimarySelectorList(dom.fbxAnimationList, fbxAnimations, 'No FBX animation found.');

  for (const type of Object.keys(SECONDARY_ANIMATION_LIMITS)) {
    const listElement = getSecondaryListElement(type);
    const items = state.animationCatalog[type] || [];
    const filteredItems = filterAnimationNamesBySearch(items);
    listElement.innerHTML = '';

    if (!items.length) {
      renderEmptyAnimationList(listElement, `No ${type} part animation found.`);
      continue;
    }

    if (type === 'expression') {
      const noneItem = document.createElement('li');
      const noneLabel = document.createElement('label');
      const noneInput = document.createElement('input');
      const noneControl = document.createElement('span');
      const noneText = document.createElement('span');

      noneLabel.className = 'animation-option';
      noneInput.type = 'radio';
      noneInput.name = 'secondaryExpressionAnimation';
      noneInput.value = '';
      noneInput.checked = state.selectedSecondaryAnimations.expression.length === 0;
      noneInput.className = 'animation-option-input';
      noneControl.className = 'animation-option-control';
      noneText.className = 'animation-option-text';
      noneText.textContent = 'None';

      noneInput.addEventListener('change', () => {
        if (!noneInput.checked) {
          return;
        }

        clearSecondaryAnimationSelection('expression', { silent: true });
        setLoadStatus('Expression overlay cleared.');
      });

      noneLabel.appendChild(noneInput);
      noneLabel.appendChild(noneControl);
      noneLabel.appendChild(noneText);
      noneItem.appendChild(noneLabel);
      listElement.appendChild(noneItem);

      if (!filteredItems.length && searchActive) {
        appendEmptyAnimationListItem(listElement, `No expression part animation matches "${state.animationSearchQuery}".`);
        continue;
      }

      for (const animationName of filteredItems) {
        const listItem = document.createElement('li');
        const label = document.createElement('label');
        const input = document.createElement('input');
        const control = document.createElement('span');
        const text = document.createElement('span');

        label.className = 'animation-option';
        input.type = 'radio';
        input.name = 'secondaryExpressionAnimation';
        input.value = animationName;
        input.checked = state.selectedSecondaryAnimations.expression[0] === animationName;
        input.className = 'animation-option-input';
        control.className = 'animation-option-control';
        text.className = 'animation-option-text';
        text.textContent = animationName;

        input.addEventListener('change', () => {
          if (!input.checked) {
            return;
          }

          state.selectedSecondaryAnimations.expression = [animationName];
          applySelectedAnimationLayers();
          setLoadStatus('Updated layered animation playback.');
        });

        label.appendChild(input);
        label.appendChild(control);
        label.appendChild(text);
        listItem.appendChild(label);
        listElement.appendChild(listItem);
      }
      continue;
    }

    if (!filteredItems.length) {
      renderEmptyAnimationList(listElement, `No ${type} part animation matches "${state.animationSearchQuery}".`);
      continue;
    }

    for (const animationName of filteredItems) {
      const listItem = document.createElement('li');
      const label = document.createElement('label');
      const input = document.createElement('input');
      const control = document.createElement('span');
      const text = document.createElement('span');

      label.className = 'animation-option';
      input.type = 'checkbox';
      input.value = animationName;
      input.checked = state.selectedSecondaryAnimations[type].includes(animationName);
      input.className = 'animation-option-input';
      control.className = 'animation-option-control';
      text.className = 'animation-option-text';
      text.textContent = animationName;

      input.addEventListener('change', () => {
        const selected = state.selectedSecondaryAnimations[type];
        const limit = SECONDARY_ANIMATION_LIMITS[type];

        if (input.checked) {
          if (selected.includes(animationName)) {
            return;
          }
          if (selected.length >= limit) {
            input.checked = false;
            setLoadStatus(`Secondary ${type} animation limit reached (${limit}).`, 'warn');
            return;
          }
          selected.push(animationName);
        } else {
          state.selectedSecondaryAnimations[type] = selected.filter((name) => name !== animationName);
        }

        applySelectedAnimationLayers();
        setLoadStatus('Updated layered animation playback.');
      });

      label.appendChild(input);
      label.appendChild(control);
      label.appendChild(text);
      listItem.appendChild(label);
      listElement.appendChild(listItem);
    }
  }

  updateAnimationSelectionSummary();
  syncFbxPreviewContext();
}

function populateAnimationList(spineObject) {
  state.animationCatalog = buildAnimationCatalog(spineObject);
  syncSelectedAnimationsToCatalog();
  renderAnimationControls();
  applySelectedAnimationLayers();
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

function getCurrentSlotAttachment(slot) {
  if (!slot) {
    return null;
  }

  return slot.getAttachment ? slot.getAttachment() : slot.attachment || null;
}

function syncAttachmentToggleStates(spineObject) {
  if (!spineObject || !dom.attachmentList) {
    return;
  }

  const slots = spineObject.skeleton?.slots || [];
  const toggleInputs = dom.attachmentList.querySelectorAll('input.attachment-toggle-input');
  for (const input of toggleInputs) {
    const slotIndex = Number.parseInt(input.dataset.slotIndex || '', 10);
    const attachmentName = input.dataset.attachmentName || '';
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || !attachmentName) {
      input.checked = false;
      continue;
    }

    const activeAttachment = getCurrentSlotAttachment(slots[slotIndex]);
    input.checked = Boolean(activeAttachment && activeAttachment.name === attachmentName);
  }
}

function normalizeAttachmentSearchQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function isAttachmentSearchActive() {
  return state.attachmentSearchQuery.length >= 2;
}

function attachmentRecordMatchesSearch(record) {
  if (!isAttachmentSearchActive()) {
    return true;
  }
  if (!record) {
    return false;
  }

  const searchText = `${record.slotName || ''} ${record.attachmentName || ''}`.toLowerCase();
  if (searchText.includes(state.attachmentSearchQuery)) {
    return true;
  }

  const queryTokens = state.attachmentSearchQuery.split(/\s+/).filter(Boolean);
  return queryTokens.length > 1 && queryTokens.every((token) => searchText.includes(token));
}

function filterAttachmentRecordsBySearch(records) {
  if (!isAttachmentSearchActive()) {
    return records;
  }

  return records.filter((record) => attachmentRecordMatchesSearch(record));
}

function populateAttachmentList(spineObject) {
  dom.attachmentList.innerHTML = '';

  const spineData = spineObject.spineData;
  const skeleton = spineObject.skeleton;
  const slots = skeleton.slots || [];
  const slotDataList = spineData.slots || [];
  const recordByKey = new Map();

  const addAttachmentRecord = (slotIndex, attachmentName, attachmentRef = null) => {
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
      return;
    }
    if (typeof attachmentName !== 'string' || !attachmentName.trim()) {
      return;
    }

    const slotName = slotDataList[slotIndex]?.name || `slot-${slotIndex}`;
    const normalizedAttachment = attachmentName.trim();
    const key = `${slotIndex}\u0000${normalizedAttachment}`;
    let record = recordByKey.get(key);
    if (!record) {
      record = {
        slotIndex,
        slotName,
        attachmentName: normalizedAttachment,
        attachmentRef: attachmentRef || null
      };
      recordByKey.set(key, record);
    }
    if (!record.attachmentRef && attachmentRef) {
      record.attachmentRef = attachmentRef;
    }
  };

  for (let slotIndex = 0; slotIndex < slotDataList.length; slotIndex += 1) {
    const setupAttachmentName = slotDataList[slotIndex]?.attachmentName;
    const setupAttachmentRef = setupAttachmentName ? skeleton.getAttachment(slotIndex, setupAttachmentName) : null;
    addAttachmentRecord(slotIndex, setupAttachmentName, setupAttachmentRef);
  }

  for (const skin of spineData.skins || []) {
    if (!skin || typeof skin.getAttachments !== 'function') {
      continue;
    }

    const entries = skin.getAttachments() || [];
    for (const entry of entries) {
      addAttachmentRecord(entry.slotIndex, entry.name, entry.attachment || null);
    }
  }

  const sortedRecords = Array.from(recordByKey.values()).sort((a, b) => {
    const bySlot = a.slotIndex - b.slotIndex;
    if (bySlot !== 0) {
      return bySlot;
    }
    return a.attachmentName.localeCompare(b.attachmentName);
  });

  if (!sortedRecords.length) {
    const item = document.createElement('li');
    item.className = 'animation-empty';
    item.textContent = 'No attachments found.';
    dom.attachmentList.appendChild(item);
    return;
  }

  const filteredRecords = filterAttachmentRecordsBySearch(sortedRecords);
  if (!filteredRecords.length) {
    const item = document.createElement('li');
    item.className = 'animation-empty';
    item.textContent = `No attachments match "${state.attachmentSearchQuery}".`;
    dom.attachmentList.appendChild(item);
    return;
  }

  const groupsBySlot = new Map();
  for (const record of filteredRecords) {
    let group = groupsBySlot.get(record.slotIndex);
    if (!group) {
      group = {
        slotIndex: record.slotIndex,
        slotName: record.slotName,
        records: []
      };
      groupsBySlot.set(record.slotIndex, group);
    }
    group.records.push(record);
  }

  const groupedRecords = Array.from(groupsBySlot.values()).sort((a, b) => a.slotIndex - b.slotIndex);

  const createAttachmentOptionItem = (record, options = {}) => {
    const { useRadioSelection = false, radioGroupName = '' } = options;
    const slot = slots[record.slotIndex];
    const activeAttachment = getCurrentSlotAttachment(slot);
    const isActive = Boolean(activeAttachment && activeAttachment.name === record.attachmentName);

    const listItem = document.createElement('li');
    const option = document.createElement('label');
    const toggleInput = document.createElement('input');
    const toggleControl = document.createElement('span');
    const name = document.createElement('span');

    listItem.className = 'attachment-item';
    option.className = 'animation-option attachment-option';
    toggleInput.className = 'animation-option-input attachment-toggle-input';
    toggleControl.className = 'animation-option-control';
    name.className = 'animation-option-text attachment-name';
    toggleInput.type = useRadioSelection ? 'radio' : 'checkbox';
    if (useRadioSelection) {
      toggleInput.name = radioGroupName;
    }
    toggleInput.checked = isActive;
    toggleInput.dataset.slotIndex = String(record.slotIndex);
    toggleInput.dataset.attachmentName = record.attachmentName;

    toggleInput.addEventListener('change', () => {
      const targetSlot = slots[record.slotIndex];
      if (!targetSlot) {
        return;
      }

      if (useRadioSelection) {
        if (!toggleInput.checked) {
          return;
        }
        if (record.attachmentRef) {
          targetSlot.setAttachment(record.attachmentRef);
        } else {
          skeleton.setAttachment(record.slotName, record.attachmentName);
        }
      } else if (toggleInput.checked) {
        if (record.attachmentRef) {
          targetSlot.setAttachment(record.attachmentRef);
        } else {
          skeleton.setAttachment(record.slotName, record.attachmentName);
        }
      } else {
        const currentAttachment = getCurrentSlotAttachment(targetSlot);
        if (currentAttachment && currentAttachment.name === record.attachmentName) {
          targetSlot.setAttachment(null);
        }
      }

      spineObject.update(0);
      syncAttachmentToggleStates(spineObject);
      setLoadStatus(`Attachment ${toggleInput.checked ? 'ON' : 'OFF'}: ${record.slotName} -> ${record.attachmentName}`);
    });

    name.textContent = useRadioSelection ? record.attachmentName : `${record.slotName} -> ${record.attachmentName}`;
    option.appendChild(toggleInput);
    option.appendChild(toggleControl);
    option.appendChild(name);
    listItem.appendChild(option);

    return listItem;
  };

  for (const group of groupedRecords) {
    if (group.records.length <= 1) {
      const standaloneItem = createAttachmentOptionItem(group.records[0], { useRadioSelection: false });
      standaloneItem.classList.add('attachment-single-item');
      dom.attachmentList.appendChild(standaloneItem);
      continue;
    }

    const groupItem = document.createElement('li');
    const groupDetails = document.createElement('details');
    const groupSummary = document.createElement('summary');
    const groupList = document.createElement('ul');
    const radioGroupName = `attachment-slot-${group.slotIndex}`;

    groupItem.className = 'attachment-group-item';
    groupDetails.className = 'attachment-group';
    groupSummary.className = 'attachment-group-summary';
    groupSummary.textContent = `${group.slotName} (${group.records.length})`;
    groupList.className = 'attachment-group-list';

    for (const record of group.records) {
      const optionItem = createAttachmentOptionItem(record, {
        useRadioSelection: true,
        radioGroupName
      });
      groupList.appendChild(optionItem);
    }

    groupDetails.appendChild(groupSummary);
    groupDetails.appendChild(groupList);
    groupItem.appendChild(groupDetails);
    dom.attachmentList.appendChild(groupItem);
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

function buildAtlasPageMapping(atlasPages, imageFiles, imageUrlByFileName) {
  const exactNameMap = new Map();
  const baseNameMap = new Map();
  const stemNameMap = new Map();

  for (const file of imageFiles) {
    exactNameMap.set(file.name, file);
    baseNameMap.set(basename(file.name), file);
    const stem = fileStem(file.name);
    if (!stemNameMap.has(stem)) {
      stemNameMap.set(stem, []);
    }
    stemNameMap.get(stem).push(file);
  }

  const warnings = [];
  const missingPages = [];
  const resolved = [];

  for (const page of atlasPages) {
    const atlasName = page.name;
    const atlasBaseName = basename(atlasName);
    let file = exactNameMap.get(atlasName) || exactNameMap.get(atlasBaseName);

    if (!file) {
      file = baseNameMap.get(atlasName) || baseNameMap.get(atlasBaseName);
    }

    if (!file) {
      const stemCandidates = stemNameMap.get(fileStem(atlasBaseName)) || [];
      if (stemCandidates.length === 1) {
        file = stemCandidates[0];
      } else if (stemCandidates.length > 1) {
        warnings.push(
          `Atlas page "${atlasName}" matched multiple uploaded image names by stem: ${stemCandidates
            .map((candidate) => candidate.name)
            .join(', ')}.`
        );
      }
    }

    if (!file && atlasPages.length === 1 && imageFiles.length === 1) {
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

function setRetargetBusy(isBusy) {
  state.retargetBusy = Boolean(isBusy);
  if (dom.retargetPreviewButton) {
    dom.retargetPreviewButton.disabled = state.retargetBusy;
  }
  if (dom.retargetDownloadButton) {
    dom.retargetDownloadButton.disabled = state.retargetBusy;
  }
  if (dom.retargetSkeletonConvertToggle) {
    dom.retargetSkeletonConvertToggle.disabled = state.retargetBusy;
  }
  if (dom.retargetSkeletonModeSelect) {
    dom.retargetSkeletonModeSelect.disabled =
      state.retargetBusy || !Boolean(dom.retargetSkeletonConvertToggle?.checked);
  }
}

function cloneBundleFiles(bundle) {
  return {
    imageFiles: Array.from(bundle?.imageFiles || []),
    atlasFile: bundle?.atlasFile || null,
    jsonFile: bundle?.jsonFile || null,
    animationsFile: bundle?.animationsFile || null
  };
}

async function buildDefaultRetargetBundle() {
  if (state.defaultRetargetBundlePromise) {
    return state.defaultRetargetBundlePromise;
  }

  state.defaultRetargetBundlePromise = (async () => {
    const imageFiles = await Promise.all(
      DEFAULT_RETARGET_BUNDLE.images.map((relativePath, index) => {
        const url = sharedPathToUrl(relativePath);
        if (!url) {
          throw new Error(`Default retarget image path is invalid: ${relativePath}`);
        }
        const fallbackName = relativePath.split('/').pop() || `retarget-image-${index + 1}.png`;
        return fetchSharedFile(url, fallbackName, 'image/png');
      })
    );

    const atlasUrl = sharedPathToUrl(DEFAULT_RETARGET_BUNDLE.atlas);
    if (!atlasUrl) {
      throw new Error(`Default retarget atlas path is invalid: ${DEFAULT_RETARGET_BUNDLE.atlas}`);
    }
    const atlasFile = await fetchSharedFile(
      atlasUrl,
      DEFAULT_RETARGET_BUNDLE.atlas.split('/').pop() || 'Man_39.atlas',
      'text/plain'
    );

    const skeletonUrl = sharedPathToUrl(DEFAULT_RETARGET_BUNDLE.skeleton);
    if (!skeletonUrl) {
      throw new Error(`Default retarget skeleton path is invalid: ${DEFAULT_RETARGET_BUNDLE.skeleton}`);
    }
    const jsonFile = await fetchSharedFile(
      skeletonUrl,
      DEFAULT_RETARGET_BUNDLE.skeleton.split('/').pop() || 'Man_39.json',
      'application/json'
    );

    return {
      imageFiles,
      atlasFile,
      jsonFile,
      animationsFile: null
    };
  })().catch((error) => {
    state.defaultRetargetBundlePromise = null;
    throw error;
  });

  return state.defaultRetargetBundlePromise;
}

async function resolveRetargetBaseBundle() {
  const loadedBundle = cloneBundleFiles(state.lastLoadedBundle);
  if (loadedBundle.imageFiles.length && loadedBundle.atlasFile && loadedBundle.jsonFile) {
    return {
      bundle: loadedBundle,
      source: 'loaded'
    };
  }

  const defaultBundle = await buildDefaultRetargetBundle();
  return {
    bundle: cloneBundleFiles(defaultBundle),
    source: 'default'
  };
}

async function saveGeneratedBundleToHistory(bundle) {
  if (!state.historySupported) {
    return null;
  }

  const savedId = await saveBundleToHistory(bundle);
  if (!savedId) {
    return null;
  }

  state.activeHistoryRecordId = savedId;
  await refreshHistoryList();
  return savedId;
}

function getRetargetAnimationNameOverride() {
  return String(dom.retargetAnimationNameInput?.value || '').trim() || null;
}

function syncRetargetSkeletonModeVisibility() {
  const skeletonConversionEnabled = Boolean(dom.retargetSkeletonConvertToggle?.checked);
  if (dom.retargetSkeletonModeField) {
    dom.retargetSkeletonModeField.classList.toggle('is-hidden', !skeletonConversionEnabled);
  }
  if (dom.retargetSkeletonModeSelect) {
    dom.retargetSkeletonModeSelect.disabled = state.retargetBusy || !skeletonConversionEnabled;
  }
}

function getRetargetSkeletonConversionOptions() {
  const enabled = Boolean(dom.retargetSkeletonConvertToggle?.checked);
  const requestedMode = String(dom.retargetSkeletonModeSelect?.value || SKELETON_CONVERSION_MODES.spineFirst)
    .trim()
    .toLowerCase();
  const mode =
    requestedMode === SKELETON_CONVERSION_MODES.fbxFirst
      ? SKELETON_CONVERSION_MODES.fbxFirst
      : SKELETON_CONVERSION_MODES.spineFirst;

  return {
    enabled,
    mode,
    scope: DEFAULT_SKELETON_CONVERSION_SCOPE,
    mismatchPolicy: DEFAULT_SKELETON_CONVERSION_MISMATCH_POLICY
  };
}

function summarizeSkeletonReport(skeletonReport) {
  if (!skeletonReport || skeletonReport.mode === 'disabled') {
    return null;
  }

  const added = Array.isArray(skeletonReport.addedBones) ? skeletonReport.addedBones.length : 0;
  const remapped = Number.isFinite(skeletonReport.remappedReferences) ? skeletonReport.remappedReferences : 0;
  const compatibility = Array.isArray(skeletonReport.compatibilityBonesAdded)
    ? skeletonReport.compatibilityBonesAdded.length
    : 0;

  return `Skeleton ${skeletonReport.mode}: +${added} bone(s), ${remapped} remap(s), ${compatibility} compatibility bone(s).`;
}

function buildGeneratedSpineFile(targetFile, mergedSpineJson) {
  const stem = (targetFile?.name || 'character').replace(/\.[^.]+$/, '');
  const outputName = `${stem}.generated.json`;
  const serialized = `${JSON.stringify(mergedSpineJson, null, 2)}\n`;
  return new File([serialized], outputName, { type: 'application/json' });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleFbxRetargetAction({ preview = false, download = false } = {}) {
  if (state.retargetBusy) {
    return;
  }

  const fbxFiles = Array.from(dom.retargetFbxInput?.files || []);
  if (!fbxFiles.length) {
    setRetargetStatus('Select one or more FBX files before converting.', 'error');
    return;
  }

  setRetargetBusy(true);
  setRetargetWarnings([]);

  try {
    const { bundle: retargetBaseBundle, source: retargetSource } = await resolveRetargetBaseBundle();
    const targetSpineFile = retargetBaseBundle.jsonFile;
    if (!targetSpineFile) {
      throw new Error('No target Spine JSON file is available for FBX conversion.');
    }

    const sourceLabel =
      retargetSource === 'loaded' ? 'loaded character bundle' : 'default powerof2/Man_39 bundle';
    const skeletonConversion = getRetargetSkeletonConversionOptions();
    const skeletonModeLabel = skeletonConversion.enabled
      ? `with ${skeletonConversion.mode} skeleton conversion`
      : 'animation-only mode';
    setRetargetStatus(`Converting ${fbxFiles.length} FBX animation(s) in ${skeletonModeLabel} using ${sourceLabel}...`);

    const targetJsonText = await targetSpineFile.text();
    let targetSpineJson;
    try {
      targetSpineJson = JSON.parse(targetJsonText);
    } catch (error) {
      throw new Error(`Target skeleton is not valid JSON: ${error.message}`);
    }

    const animationOverride = getRetargetAnimationNameOverride();
    let mergedSpineJson = targetSpineJson;
    const successfulConversions = [];
    const fbxPreviewMap = new Map();
    const failedFiles = [];
    const allWarnings = [];
    const skeletonSummaryLines = [];

    for (let index = 0; index < fbxFiles.length; index += 1) {
      const fbxFile = fbxFiles[index];
      setRetargetStatus(`Converting ${index + 1}/${fbxFiles.length}: ${fbxFile.name}`);

      try {
        const conversion = await convertFbxToSpineAnimation({
          fbxArrayBuffer: await fbxFile.arrayBuffer(),
          filename: fbxFile.name,
          spineJson: mergedSpineJson,
          profile: retargetProfile,
          animationName: fbxFiles.length === 1 ? animationOverride : null,
          options: {
            rootMotion: 'in_place',
            fps: 30,
            skeletonConversion
          }
        });

        mergedSpineJson = conversion.mergedSpineJson;
        successfulConversions.push(conversion.animationName);
        if (conversion.previewData) {
          fbxPreviewMap.set(conversion.animationName, conversion.previewData);
        }
        allWarnings.push(...(conversion.parseWarnings || []), ...(conversion.canonicalWarnings || []), ...(conversion.warnings || []));

        const skeletonReport = conversion.skeletonReport || null;
        if (skeletonReport?.mode && skeletonReport.mode !== 'disabled') {
          const summary = summarizeSkeletonReport(skeletonReport);
          if (summary) {
            skeletonSummaryLines.push(`${fbxFile.name}: ${summary}`);
          }
          for (const warning of skeletonReport.warnings || []) {
            allWarnings.push(`SKELETON ${fbxFile.name}: ${warning}`);
          }
        }
      } catch (error) {
        const message = error?.message || 'unknown conversion failure';
        failedFiles.push(`${fbxFile.name}: ${message}`);
      }
    }

    if (!successfulConversions.length) {
      throw new Error('No FBX files were converted successfully.');
    }

    const generatedJsonFile = buildGeneratedSpineFile(targetSpineFile, mergedSpineJson);
    const warningMessages = [...allWarnings, ...skeletonSummaryLines, ...failedFiles.map((line) => `FAILED ${line}`)];
    const statusTone = failedFiles.length ? 'warn' : 'info';
    let savedToHistory = false;
    const skeletonStatusSuffix = skeletonConversion.enabled
      ? ` using ${skeletonConversion.mode} skeleton conversion`
      : '';

    if (download) {
      downloadFile(generatedJsonFile);
    }

    if (preview) {
      const previewBundle = {
        imageFiles: Array.from(retargetBaseBundle.imageFiles || []),
        atlasFile: retargetBaseBundle.atlasFile,
        jsonFile: generatedJsonFile,
        animationsFile: null
      };

      await loadSpineBundle(previewBundle, {
        saveHistory: true,
        activeHistoryRecordId: null,
        fbxPreviewMap
      });
      savedToHistory = true;
      setRetargetStatus(
        `Converted and previewed ${successfulConversions.length}/${fbxFiles.length} FBX animations${skeletonStatusSuffix}. Saved to history.`,
        statusTone
      );
    } else {
      const historyBundle = {
        imageFiles: Array.from(retargetBaseBundle.imageFiles || []),
        atlasFile: retargetBaseBundle.atlasFile,
        jsonFile: generatedJsonFile,
        animationsFile: null
      };
      try {
        const savedId = await saveGeneratedBundleToHistory(historyBundle);
        savedToHistory = Boolean(savedId);
      } catch (historyError) {
        warningMessages.push(`Failed to save generated bundle to history: ${historyError.message || historyError}`);
      }
    }

    if (!preview) {
      setFbxPreviewMap(null);
      destroyFbxPreviewSampler();
      syncFbxPreviewContext();
      if (download) {
        setRetargetStatus(
          `Converted ${successfulConversions.length}/${fbxFiles.length} FBX animations${skeletonStatusSuffix} and downloaded "${generatedJsonFile.name}"${savedToHistory ? '. Saved to history.' : '.'}`,
          statusTone
        );
      } else {
        setRetargetStatus(
          `Converted ${successfulConversions.length}/${fbxFiles.length} FBX animations${skeletonStatusSuffix}${savedToHistory ? '. Saved to history.' : '.'}`,
          statusTone
        );
      }
    }

    setRetargetWarnings(warningMessages);
  } catch (error) {
    console.error(error);
    setRetargetStatus(error.message || 'FBX retarget conversion failed.', 'error');
  } finally {
    setRetargetBusy(false);
  }
}

async function loadSpineBundle(bundle, options = {}) {
  setLoadStatus('Loading files...');
  setWarnings([]);
  const requestedActiveHistoryId =
    Object.prototype.hasOwnProperty.call(options, 'activeHistoryRecordId') ? options.activeHistoryRecordId : undefined;
  const requestedFbxPreviewMap = options.fbxPreviewMap instanceof Map ? options.fbxPreviewMap : null;

  setFbxPreviewMap(requestedFbxPreviewMap);
  state.fbxPreviewTimeSec = 0;
  state.fbxPreviewLastAnimation = null;
  destroyFbxPreviewSampler();

  cleanupCurrentSpine();
  revokeTrackedObjectUrls();

  const imageFiles = Array.from(bundle.imageFiles || []);
  const atlasFile = bundle.atlasFile || null;
  const jsonFile = bundle.jsonFile || null;
  const manualPotOverride = parseManualPotOverride();

  if (!imageFiles.length || !atlasFile || !jsonFile) {
    setLoadStatus('Missing required files for loading character bundle.', 'error');
    return;
  }

  try {
    const atlasText = await atlasFile.text();
    const parsedAtlas = parseSpineAtlas(atlasText);

    const imageUrlByFileName = new Map();
    for (const file of imageFiles) {
      imageUrlByFileName.set(file.name, createObjectUrlFromFile(file));
    }

    const mapping = buildAtlasPageMapping(parsedAtlas.pages, imageFiles, imageUrlByFileName);
    if (mapping.missingPages.length) {
      throw new Error(
        `Missing atlas page image(s): ${mapping.missingPages.join(', ')}. Upload matching PNG/WEBP files or rename atlas pages.`
      );
    }

    const sourcePages = await Promise.all(
      mapping.resolved.map(async (item) => {
        const image = await loadImageElement(item.url);
        return {
          atlasName: item.atlasName,
          file: item.file,
          url: item.url,
          image,
          width: image.naturalWidth,
          height: image.naturalHeight
        };
      })
    );
    const sourcePageByName = new Map(sourcePages.map((page) => [page.atlasName, page]));
    const sourceHasNpot = sourcePages.some((page) => !isPowerOfTwo(page.width) || !isPowerOfTwo(page.height));

    let runtimeAtlasText = atlasText;
    const manualPotWarnings = [];
    let pages = [];

    if (manualPotOverride && sourceHasNpot) {
      const maxTextureSize = app.renderer.gl.getParameter(app.renderer.gl.MAX_TEXTURE_SIZE);
      const repacked = repackAtlasToSinglePotPage(parsedAtlas, sourcePageByName, {
        baseSize: manualPotOverride.baseSize,
        padding: manualPotOverride.padding,
        maxTextureSize
      });
      runtimeAtlasText = repacked.atlasText;
      manualPotWarnings.push(...repacked.warnings);
      pages = [
        {
          atlasName: repacked.pageName,
          fileName: repacked.pageName,
          url: null,
          source: repacked.canvas,
          sourceWidth: repacked.width,
          sourceHeight: repacked.height,
          width: repacked.width,
          height: repacked.height,
          isPOT: true,
          baseTexture: null,
          glSnapshot: null
        }
      ];
    } else {
      if (manualPotOverride && !sourceHasNpot) {
        manualPotWarnings.push('Manual POT is enabled, but all source atlas pages are already POT. Repack skipped.');
      }

      pages = sourcePages.map((page) => ({
        atlasName: page.atlasName,
        fileName: page.file.name,
        url: page.url,
        source: page.url,
        sourceWidth: page.width,
        sourceHeight: page.height,
        width: page.width,
        height: page.height,
        isPOT: isPowerOfTwo(page.width) && isPowerOfTwo(page.height),
        baseTexture: null,
        glSnapshot: null
      }));
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

    const patchedAtlasText = runtimeAtlasText;
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
    applySkeletonVisibilityForBundle({ jsonFile, atlasFile }, { silent: true });
    captureSetupDrawOrder(spineObject);

    populateAnimationList(spineObject);
    // Apply animation selection first, then center from current pose bounds.
    spineObject.update(0);
    applyDefaultAttachmentOverrides(spineObject);
    enforceFbxDrawOrder();
    positionSpineAtCenter(spineObject);
    fitSpineToViewport();
    setZoom(1);
    updateWorldPosition();

    populateBoneList(spineObject);
    populateSlotList(spineObject);
    populateAttachmentList(spineObject);
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

    const warningMessages = [...mapping.warnings, ...manualPotWarnings, ...state.npotWarnings];
    if (skeletonResource.warning) {
      warningMessages.push(skeletonResource.warning);
    }
    setWarnings(warningMessages);

    await applyMipmapsAndVerify();
    if (requestedActiveHistoryId !== undefined) {
      state.activeHistoryRecordId = requestedActiveHistoryId;
      await refreshHistoryList();
    }
    state.lastLoadedBundle = {
      imageFiles: Array.from(imageFiles),
      atlasFile,
      jsonFile,
      animationsFile: bundle.animationsFile || null
    };
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
  if (dom.retargetSkeletonConvertToggle) {
    dom.retargetSkeletonConvertToggle.checked = false;
    dom.retargetSkeletonConvertToggle.addEventListener('change', () => {
      syncRetargetSkeletonModeVisibility();
    });
  }
  if (dom.retargetSkeletonModeSelect) {
    dom.retargetSkeletonModeSelect.value = SKELETON_CONVERSION_MODES.spineFirst;
    dom.retargetSkeletonModeSelect.addEventListener('change', (event) => {
      const requestedMode = String(event.target.value || SKELETON_CONVERSION_MODES.spineFirst)
        .trim()
        .toLowerCase();
      event.target.value =
        requestedMode === SKELETON_CONVERSION_MODES.fbxFirst
          ? SKELETON_CONVERSION_MODES.fbxFirst
          : SKELETON_CONVERSION_MODES.spineFirst;
    });
  }
  syncRetargetSkeletonModeVisibility();

  if (dom.retargetPreviewButton) {
    dom.retargetPreviewButton.addEventListener('click', () => {
      handleFbxRetargetAction({ preview: true, download: false });
    });
  }
  if (dom.retargetDownloadButton) {
    dom.retargetDownloadButton.addEventListener('click', () => {
      handleFbxRetargetAction({ preview: false, download: true });
    });
  }
  if (dom.animationSearchInput) {
    dom.animationSearchInput.addEventListener('input', (event) => {
      state.animationSearchQuery = normalizeAnimationSearchQuery(event.target.value);
      if (state.spineObject) {
        renderAnimationControls();
      }
    });
  }
  if (dom.attachmentSearchInput) {
    dom.attachmentSearchInput.addEventListener('input', (event) => {
      state.attachmentSearchQuery = normalizeAttachmentSearchQuery(event.target.value);
      if (state.spineObject) {
        populateAttachmentList(state.spineObject);
      }
    });
  }
  if (dom.clearAllSecondaryAnimationsButton) {
    dom.clearAllSecondaryAnimationsButton.addEventListener('click', () => {
      clearAllSecondaryAnimationSelections();
    });
  }
  if (dom.clearLogsButton) {
    dom.clearLogsButton.addEventListener('click', () => {
      clearLogs();
      appendLog('system', 'Logs cleared by user.', 'info');
    });
  }
  if (dom.fbxPreviewSourceSelect) {
    dom.fbxPreviewSourceSelect.value = state.fbxPreviewSourceMode;
    dom.fbxPreviewSourceSelect.addEventListener('change', (event) => {
      const nextMode = String(event.target.value || FBX_PREVIEW_SOURCE_MODES.auto);
      if (!Object.prototype.hasOwnProperty.call(FBX_PREVIEW_SOURCE_MODES, nextMode)) {
        return;
      }
      state.fbxPreviewSourceMode = nextMode;
      destroyFbxPreviewSampler();
      syncFbxPreviewContext();
      renderFbxPreview();
    });
  }
  if (dom.fbxPreviewViewSelect) {
    dom.fbxPreviewViewSelect.value = state.fbxPreviewViewMode;
    dom.fbxPreviewViewSelect.addEventListener('change', (event) => {
      const nextMode = String(event.target.value || FBX_PREVIEW_VIEW_MODES.perspective);
      if (!Object.prototype.hasOwnProperty.call(FBX_PREVIEW_VIEW_MODES, nextMode)) {
        return;
      }
      state.fbxPreviewViewMode = nextMode;
      renderFbxPreview();
    });
  }
  if (dom.fbxPreviewPlayPauseButton) {
    updateFbxPreviewPlayPauseButton();
    dom.fbxPreviewPlayPauseButton.addEventListener('click', () => {
      state.fbxPreviewPlaying = !state.fbxPreviewPlaying;
      updateFbxPreviewPlayPauseButton();
      renderFbxPreview();
    });
  }
  if (dom.fbxPreviewResetButton) {
    dom.fbxPreviewResetButton.addEventListener('click', () => {
      state.fbxPreviewTimeSec = 0;
      renderFbxPreview();
    });
  }
  if (dom.fbxPreviewSpeedSelect) {
    dom.fbxPreviewSpeedSelect.value = String(state.fbxPreviewSpeed);
    dom.fbxPreviewSpeedSelect.addEventListener('change', (event) => {
      const speed = Number.parseFloat(event.target.value);
      state.fbxPreviewSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    });
  }
  if (dom.fbxPreviewScrubber) {
    dom.fbxPreviewScrubber.max = String(FBX_PREVIEW_SCRUB_MAX);
    dom.fbxPreviewScrubber.value = '0';
    dom.fbxPreviewScrubber.addEventListener('input', (event) => {
      const animationName = state.selectedPrimaryAnimation;
      const sourceInfo = resolveFbxPreviewSource(animationName);
      const duration = getFbxPreviewDuration(sourceInfo, animationName);
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const scrubMax = Number(dom.fbxPreviewScrubber.max) || FBX_PREVIEW_SCRUB_MAX;
      const ratio = clamp((Number.parseFloat(event.target.value) || 0) / scrubMax, 0, 1);
      state.fbxPreviewTimeSec = duration * ratio;
      renderFbxPreview();
    });
  }
  if (dom.fbxPreviewBonesToggle) {
    dom.fbxPreviewBonesToggle.checked = state.fbxPreviewShowBones;
    dom.fbxPreviewBonesToggle.addEventListener('change', (event) => {
      state.fbxPreviewShowBones = Boolean(event.target.checked);
      renderFbxPreview();
    });
  }
  if (dom.fbxPreviewJointsToggle) {
    dom.fbxPreviewJointsToggle.checked = state.fbxPreviewShowJoints;
    dom.fbxPreviewJointsToggle.addEventListener('change', (event) => {
      state.fbxPreviewShowJoints = Boolean(event.target.checked);
      renderFbxPreview();
    });
  }

  dom.potOverrideToggle.addEventListener('change', async () => {
    updateManualPotUiState();

    if (state.suppressManualPotAutoReload || state.manualPotReloadInFlight) {
      return;
    }

    if (!state.lastLoadedBundle?.imageFiles?.length || !state.lastLoadedBundle?.atlasFile || !state.lastLoadedBundle?.jsonFile) {
      return;
    }

    state.manualPotReloadInFlight = true;
    try {
      setLoadStatus('Applying Manual POT setting...');
      await loadSpineBundle(cloneBundleFiles(state.lastLoadedBundle), {
        saveHistory: false,
        activeHistoryRecordId: state.activeHistoryRecordId,
        fbxPreviewMap: state.fbxPreviewMap
      });
    } finally {
      state.manualPotReloadInFlight = false;
    }
  });
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
  if (dom.skeletonToggleButton) {
    dom.skeletonToggleButton.addEventListener('click', () => {
      if (!state.spineObject) {
        return;
      }
      setSkeletonVisible(!state.skeletonVisible);
    });
  }

  dom.panToggle.addEventListener('click', () => {
    if (!state.spineObject) {
      return;
    }

    setPanEnabled(!state.panEnabled);
  });

  refreshHistoryList();
  loadSharedHistoryRecords();
  setRetargetStatus('Waiting for FBX input.');
  setRetargetWarnings([]);
  updateSkeletonToggleButton();
  syncFbxPreviewContext();
  renderFbxPreview();
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

  enforceFbxDrawOrder();
  drawSkeletonOverlay();
  updateFbxPreviewClock(app.ticker.deltaMS);
  renderFbxPreview();
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
