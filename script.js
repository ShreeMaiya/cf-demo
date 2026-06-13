// API endpoints served by Cloudflare Pages Functions.
const API_URL = "/api/todos";
const ANALYTICS_URL = "/api/analytics";
const COUNTER_URL = "/api/counter";
const CONFIG_URL = "/api/config";
const CALL_URL = "/api/realtime-call";
// Local storage keys used for restoring user interface state.
const THEME_KEY = "todo-theme";
const SECTION_KEY = "todo-active-section";
// Refresh timings used to sync analytics data after todo mutations.
const ANALYTICS_REFRESH_INTERVAL_MS = 30_000; // 30 s — well within free tier (2880 req/day)
const ANALYTICS_REFRESH_DELAY_MS = 1200;

// Todo section elements.
const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");
const message = document.getElementById("message");
const analyticsStatus = document.getElementById("analytics-status");
const analyticsCounts = document.getElementById("analytics-counts");
const analyticsEvents = document.getElementById("analytics-events");
const analyticsRefresh = document.getElementById("analytics-refresh");
const counterValue = document.getElementById("counter-value");
const counterMessage = document.getElementById("counter-message");
const counterIncrement = document.getElementById("counter-increment");
const counterReset = document.getElementById("counter-reset");
const configForm = document.getElementById("config-form");
const configMessage = document.getElementById("config-message");
const configTodos = document.getElementById("config-todos");
const configAnalytics = document.getElementById("config-analytics");
const configCounter = document.getElementById("config-counter");
const configCall = document.getElementById("config-call");
const callSection = document.getElementById("call-section");
const callStatus = document.getElementById("call-status");
const callRoomMeta = document.getElementById("call-room-meta");
const callCreateNameInput = document.getElementById("call-create-name");
const callJoinNameInput = document.getElementById("call-join-name");
const callRoomCodeInput = document.getElementById("call-room-code");
const callCreateButton = document.getElementById("call-create");
const callJoinButton = document.getElementById("call-join");
const callLeaveButton = document.getElementById("call-leave");
const callCopyCodeButton = document.getElementById("call-copy-code");
const callRoomView = document.getElementById("call-room-view");
const callLiveShell = document.getElementById("call-live-shell");
const callProvider = document.getElementById("rtk-call-provider");
const callVideoGrid = document.getElementById("call-video-grid");
const callToggleAudioButton = document.getElementById("call-toggle-audio");
const callToggleVideoButton = document.getElementById("call-toggle-video");
const callParticipantsList = document.getElementById("call-participants-list");
const callParticipantsBtn = document.getElementById("call-participants-btn");
const callChatBtn = document.getElementById("call-chat-btn");
const callParticipantsPopup = document.getElementById("call-participants-popup");
const callChatPopup = document.getElementById("call-chat-popup");
const callFullscreenBtn = document.getElementById("call-fullscreen-btn");
const callChatWidget = document.getElementById("rtk-call-chat");
const sectionTabs = Array.from(document.querySelectorAll("[data-section-tab]"));
const sectionPanels = Array.from(document.querySelectorAll("[data-section-panel]"));
const hasTodoUI = Boolean(form && input && list && message);
const hasAnalyticsUI = Boolean(analyticsStatus && analyticsCounts && analyticsEvents);
const hasCounterUI = Boolean(counterValue && counterMessage && counterIncrement && counterReset);
const hasConfigUI = Boolean(configForm && configMessage && configTodos && configAnalytics && configCounter && configCall);
const hasCallUI = Boolean(
  callSection &&
    callStatus &&
    callRoomMeta &&
    callCreateNameInput &&
    callJoinNameInput &&
    callRoomCodeInput &&
    callCreateButton &&
    callJoinButton &&
    callLeaveButton &&
    callCopyCodeButton &&
    callRoomView &&
    callLiveShell &&
    callProvider &&
    callVideoGrid &&
    callToggleAudioButton &&
    callToggleVideoButton &&
    callParticipantsList &&
    callChatWidget
);
const hasSectionUI = sectionTabs.length > 0 && sectionPanels.length > 0;

// Shared global controls.
const themeToggle = document.getElementById("theme-toggle");

let scrollStateTimer;
let analyticsRefreshTimer;
let toastContainer;
let analyticsPoller;
let callMeeting;
let activeCallRoomId;
let callAudioEnabled = false;
let callVideoEnabled = false;
let callLocalName = "Guest";
let callParticipantSnapshot = [];
let localPreviewStream;

let callMeetingEventUnsubscribers = [];

function syncCallDebugState() {
  window.__callDebug = {
    callMeeting,
    callParticipantSnapshot,
    activeCallRoomId,
    callLocalName
  };
}

const DEFAULT_APP_CONFIG = {
  sections: {
    todos: true,
    analytics: true,
    counter: true,
    call: true
  }
};

let currentAppConfig = DEFAULT_APP_CONFIG;

// ===== Shared UI Helpers =====

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Create a single toast host and reuse it for all notifications.
function getToastContainer() {
  if (toastContainer) {
    return toastContainer;
  }

  toastContainer = document.createElement("div");
  toastContainer.className = "toast-container";
  toastContainer.setAttribute("aria-live", "polite");
  toastContainer.setAttribute("aria-atomic", "true");
  document.body.appendChild(toastContainer);
  return toastContainer;
}

// Create a transient toast message for success, error, and info states.
function showToast(text, type = "info") {
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.remove();
    }, 220);
  }, 2100);
}

function updateListScrollState() {
  if (!list) {
    return;
  }

  clearTimeout(scrollStateTimer);

  // Delay and threshold prevent one-frame scrollbar flicker during list reflow.
  scrollStateTimer = setTimeout(() => {
    const overflowDelta = list.scrollHeight - list.clientHeight;
    const hasOverflow = overflowDelta > 10;
    list.classList.toggle("is-scrollable", hasOverflow);
  }, 90);
}

// Persist and apply the selected theme across reloads.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggle) {
    themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }
}

// Initialize theme from persisted preference, defaulting to dark mode.
function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const theme = savedTheme || "dark";
  applyTheme(theme);
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  });
}

function setMessage(text, isError = false) {
  if (!message) {
    return;
  }

  message.textContent = text;
  message.classList.toggle("error", Boolean(text) && isError);
}

// Update analytics status text and optional error presentation state.
function setAnalyticsStatus(text, isError = false) {
  if (!analyticsStatus) {
    return;
  }

  analyticsStatus.textContent = text;
  analyticsStatus.classList.toggle("error", Boolean(text) && isError);
}

// Update counter status text and optional error presentation state.
function setCounterMessage(text, isError = false) {
  if (!counterMessage) {
    return;
  }

  counterMessage.textContent = text;
  counterMessage.classList.toggle("error", Boolean(text) && isError);
}

function setConfigMessage(text, isError = false) {
  if (!configMessage) {
    return;
  }

  configMessage.textContent = text;
  configMessage.classList.toggle("error", Boolean(text) && isError);
}

function normalizeConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const sections = source.sections && typeof source.sections === "object" ? source.sections : {};

  return {
    sections: {
      todos: sections.todos === undefined ? true : Boolean(sections.todos),
      analytics: sections.analytics === undefined ? true : Boolean(sections.analytics),
      counter: sections.counter === undefined ? true : Boolean(sections.counter),
      call: sections.call === undefined ? true : Boolean(sections.call)
    }
  };
}

function setSectionAvailability(sectionName, enabled) {
  const tab = sectionTabs.find((item) => item.dataset.sectionTab === sectionName);
  const panel = sectionPanels.find((item) => item.dataset.sectionPanel === sectionName);

  if (tab) {
    tab.hidden = !enabled;
  }

  if (panel) {
    panel.dataset.configEnabled = enabled ? "true" : "false";

    if (!enabled) {
      panel.hidden = true;
      panel.classList.remove("is-active");
    }
  }
}

function syncConfigPanel(config) {
  if (!hasConfigUI) {
    return;
  }

  configTodos.checked = Boolean(config.sections.todos);
  configAnalytics.checked = Boolean(config.sections.analytics);
  configCounter.checked = Boolean(config.sections.counter);
  configCall.checked = Boolean(config.sections.call);
}

function applyConfigToUI(config) {
  setSectionAvailability("todos", config.sections.todos);
  setSectionAvailability("analytics", config.sections.analytics);
  setSectionAvailability("counter", config.sections.counter);
  setSectionAvailability("call", config.sections.call);
  syncConfigPanel(config);

  if (hasSectionUI) {
    const savedSection = localStorage.getItem(SECTION_KEY);
    const defaultSection = document.body.dataset.defaultSection || "todos";
    setActiveSection(savedSection || defaultSection, false);
  }
}

function isSectionEnabled(sectionName) {
  return Boolean(currentAppConfig.sections[sectionName]);
}

// Schedule deferred analytics refresh after todo mutations complete.
function scheduleAnalyticsRefresh(delay = ANALYTICS_REFRESH_DELAY_MS) {
  if (!analyticsCounts || !analyticsEvents) {
    return;
  }

  clearTimeout(analyticsRefreshTimer);
  analyticsRefreshTimer = setTimeout(() => {
    loadAnalytics();
  }, delay);
}

// Recalculate todo list overflow class after layout-affecting updates.
function syncTodoListViewport() {
  if (!list) {
    return;
  }

  requestAnimationFrame(() => {
    updateListScrollState();
  });
}

// Activate one section panel and synchronize tab pressed states.
function setActiveSection(sectionName, persist = true) {
  if (!hasSectionUI) {
    return;
  }

  const visiblePanels = sectionPanels.filter((panel) => panel.dataset.configEnabled !== "false");
  const availableSections = new Set(visiblePanels.map((panel) => panel.dataset.sectionPanel));
  const nextSection = availableSections.has(sectionName)
    ? sectionName
    : visiblePanels[0]?.dataset.sectionPanel;

  for (const panel of sectionPanels) {
    const isEnabled = panel.dataset.configEnabled !== "false";
    const isActive = isEnabled && panel.dataset.sectionPanel === nextSection;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  }

  for (const tab of sectionTabs) {
    const isActive = tab.dataset.sectionTab === nextSection;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  }

  if (persist && nextSection) {
    localStorage.setItem(SECTION_KEY, nextSection);
  }
}

// Initialize section tabs from saved state and bind tab click handlers.
function initSectionSwitcher() {
  if (!hasSectionUI) {
    return;
  }

  const defaultSection = document.body.dataset.defaultSection || sectionPanels[0]?.dataset.sectionPanel || "todos";
  const savedSection = localStorage.getItem(SECTION_KEY);
  setActiveSection(savedSection || defaultSection, false);

  for (const tab of sectionTabs) {
    tab.addEventListener("click", () => {
      if (tab.hidden) {
        return;
      }

      setActiveSection(tab.dataset.sectionTab);
    });
  }
}

// Load global config and apply section/maintenance behavior to the UI.
async function loadConfig() {
  try {
    const data = await request(CONFIG_URL);
    currentAppConfig = normalizeConfig(data.config);
    applyConfigToUI(currentAppConfig);
    setConfigMessage("");
  } catch (err) {
    currentAppConfig = normalizeConfig(DEFAULT_APP_CONFIG);
    applyConfigToUI(currentAppConfig);
    setConfigMessage(err.message, true);
    showToast("Using default config.", "info");
  }
}

// Persist app config updates from the Config panel.
async function saveConfig() {
  if (!hasConfigUI) {
    return;
  }

  const nextConfig = normalizeConfig({
    sections: {
      todos: configTodos.checked,
      analytics: configAnalytics.checked,
      counter: configCounter.checked,
      call: configCall.checked
    }
  });

  const data = await request(CONFIG_URL, {
    method: "POST",
    body: JSON.stringify(nextConfig)
  });

  currentAppConfig = normalizeConfig(data.config);
  applyConfigToUI(currentAppConfig);
  setConfigMessage("Configuration saved.");
  showToast("Configuration updated.", "success");
}

// ===== Todo Logic =====

// Todo row and its checkbox/delete actions.
function createTodoElement(todo, index) {
  const li = document.createElement("li");
  li.className = `todo-item${todo.completed ? " completed" : ""}`;
  li.style.setProperty("--i", String(index));

  const checkboxWrap = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(todo.completed);
  checkbox.addEventListener("change", async () => {
    await toggleTodo(todo.id, checkbox.checked);
  });
  checkboxWrap.appendChild(checkbox);

  const title = document.createElement("span");
  title.className = "todo-title";
  title.textContent = todo.title;

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    await deleteTodo(todo.id);
  });

  li.append(checkboxWrap, title, deleteBtn);
  return li;
}

// Render full Todo list state, including an empty-state row.
function renderTodos(todos) {
  if (!list) {
    return;
  }

  list.innerHTML = "";
  list.classList.remove("is-scrollable");

  if (!todos.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No todos yet. Add your first task.";
    list.appendChild(empty);
    return;
  }

  for (const [index, todo] of todos.entries()) {
    list.appendChild(createTodoElement(todo, index));
  }

  updateListScrollState();
}

// ===== Realtime Call Logic =====

function setCallStatus(text, isError = false) {
  if (!callStatus) {
    return;
  }

  callStatus.textContent = text;
  callStatus.classList.toggle("error", Boolean(text) && isError);
}

function setCallRoomMeta(text, isError = false) {
  if (!callRoomMeta) {
    return;
  }

  callRoomMeta.textContent = text;
  callRoomMeta.classList.toggle("error", Boolean(text) && isError);
}

function showCallRoomView(roomId) {
  if (!callRoomView || !callLiveShell) {
    return;
  }

  document.body.classList.add("call-room-mode");
  callSection?.classList.add("is-room-active");
  callRoomView.hidden = false;
  callLiveShell.hidden = false;
  setCallRoomMeta(roomId ? `#${roomId}` : "");
}

function hideCallRoomView() {
  if (!callRoomView || !callLiveShell) {
    return;
  }

  document.body.classList.remove("call-room-mode");
  callSection?.classList.remove("is-room-active");
  callRoomView.hidden = true;
  callLiveShell.hidden = true;
}

function generateGuestName() {
  // Random 3-digit suffix (100–999) so two devices joining simultaneously
  // without a name won't both get "Guest01".
  const suffix = Math.floor(100 + Math.random() * 900);
  return `Guest${suffix}`;
}

function getCreateCallDisplayName() {
  return callCreateNameInput.value.trim() || generateGuestName();
}

function getJoinCallDisplayName() {
  return callJoinNameInput.value.trim() || generateGuestName();
}


function clearCallMeetingEventBindings() {
  for (const cleanup of callMeetingEventUnsubscribers) {
    try {
      cleanup();
    } catch {
      // Ignore event cleanup errors during teardown.
    }
  }

  callMeetingEventUnsubscribers = [];
}

function normalizeParticipantCollection(source) {
  if (!source) {
    return [];
  }

  if (Array.isArray(source)) {
    return source;
  }

  if (source instanceof Map) {
    return Array.from(source.values());
  }

  if (typeof source.values === "function") {
    try {
      return Array.from(source.values());
    } catch {
      // Fall through and try object values.
    }
  }

  if (typeof source === "object") {
    return Object.values(source);
  }

  return [];
}

function getJoinedParticipants(meeting) {
  const joined = meeting?.participants?.joined;

  if (!joined) {
    return [];
  }

  if (typeof joined.toArray === "function") {
    try {
      return normalizeParticipantCollection(joined.toArray());
    } catch {
      // Fall back to the generic collection handlers below.
    }
  }

  return normalizeParticipantCollection(joined);
}

function getParticipantId(participant) {
  return (
    participant?.id ||
    participant?.participantId ||
    participant?.customParticipantId ||
    participant?.uid ||
    participant?.userId ||
    participant?.name ||
    crypto.randomUUID()
  );
}

function getParticipantName(participant) {
  return (
    participant?.name ||
    participant?.displayName ||
    participant?.metadata?.name ||
    participant?.customParticipantId ||
    "Participant"
  );
}

function getParticipantVideoTrack(participant) {
  const visited = new Set();
  const queue = [participant];

  while (queue.length) {
    const current = queue.shift();

    if (!current || visited.has(current)) {
      continue;
    }

    if (current instanceof MediaStreamTrack) {
      if (current.kind === "video") {
        return current;
      }

      continue;
    }

    if (current instanceof MediaStream) {
      if (current.getVideoTracks().length) {
        return current;
      }

      continue;
    }

    if (typeof current.attach === "function") {
      return current;
    }

    visited.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (current instanceof Map) {
      queue.push(...current.values());
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const directTrack =
      current.videoTrack ||
      current.cameraTrack ||
      current.track ||
      current.mediaStreamTrack ||
      current.streamTrack ||
      current.mediaStream;

    if (directTrack instanceof MediaStreamTrack && directTrack.kind === "video") {
      return directTrack;
    }

    if (directTrack instanceof MediaStream) {
      if (directTrack.getVideoTracks().length) {
        return directTrack;
      }

      continue;
    }

    if (directTrack && typeof directTrack.attach === "function") {
      return directTrack;
    }

    if (directTrack && typeof directTrack === "object") {
      queue.push(directTrack);
    }

    const maybeTracks = [
      current.video,
      current.camera,
      current.stream,
      current.mediaStream,
      current.tracks,
      current.trackPublications,
      current.publications,
      current.participants
    ];

    for (const value of maybeTracks) {
      if (!value) {
        continue;
      }

      queue.push(value);
    }

    if (current.values && typeof current.values === "function") {
      try {
        queue.push(...current.values());
      } catch {
        // Ignore collection conversion issues and keep scanning.
      }
    }
  }

  return null;
}

function getLocalParticipant(meeting) {
  return meeting?.self || meeting?.localParticipant || meeting?.participants?.self || null;
}

function getCallParticipants(meeting) {
  const participants = [];
  const local = getLocalParticipant(meeting);

  if (local) {
    participants.push({ participant: local, isLocal: true });
  }

  for (const participant of getJoinedParticipants(meeting)) {
    const participantId = getParticipantId(participant);
    const isDuplicateLocal = local && participantId === getParticipantId(local);

    if (!isDuplicateLocal) {
      participants.push({ participant, isLocal: false });
    }
  }

  if (!participants.length && callLocalName) {
    participants.push({
      isLocal: true,
      participant: {
        id: "local",
        name: callLocalName
      }
    });
  }

  return participants;
}

function attachParticipantVideo(tile, participant) {
  const media = getParticipantVideoTrack(participant);

  if (!media) {
    return false;
  }

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = participant === getLocalParticipant(callMeeting);

  if (media instanceof MediaStream) {
    video.srcObject = media;
  } else if (media instanceof MediaStreamTrack) {
    video.srcObject = new MediaStream([media]);
  } else if (typeof media.attach === "function") {
    const attached = media.attach();
    if (attached instanceof HTMLElement) {
      tile.appendChild(attached);
      return true;
    }
  }

  tile.appendChild(video);
  return true;
}

function createParticipantTile(entry) {
  const { participant, isLocal } = entry;
  const name = isLocal ? `${getParticipantName(participant)} (You)` : getParticipantName(participant);
  const initial = (getParticipantName(participant) || "?").slice(0, 1).toUpperCase();

  const tile = document.createElement("div");
  tile.className = `call-video-tile${isLocal ? " call-video-tile-local" : ""}`;

  // Avatar always rendered first (centered by tile's flex layout).
  // It shows when camera is off; RTK tile / video element sits on top.
  const avatar = document.createElement("div");
  avatar.className = "call-video-avatar";
  avatar.textContent = initial;
  tile.appendChild(avatar);

  if (customElements.get("rtk-participant-tile") && participant && participant.id !== "local") {
    // RTK tile is absolutely positioned and covers the avatar only when video is active
    const rtkTile = document.createElement("rtk-participant-tile");
    rtkTile.meeting = callMeeting;
    rtkTile.participant = participant;
    tile.appendChild(rtkTile);
    // RTK renders its own name label – no need for ours
  } else {
    // Local preview or fallback: attach raw video element
    attachParticipantVideo(tile, participant);
    // Add our own name label for local / fallback tiles
    const label = document.createElement("div");
    label.className = "call-video-label";
    label.textContent = name;
    tile.appendChild(label);
  }

  return tile;
}

function renderCallParticipants() {
  if (!callVideoGrid || !callParticipantsList) {
    return;
  }

  const participants = getCallParticipants(callMeeting);
  callParticipantSnapshot = participants.map(({ participant, isLocal }) => ({
    id: getParticipantId(participant),
    name: getParticipantName(participant),
    isLocal
  }));

  callVideoGrid.innerHTML = "";
  callParticipantsList.innerHTML = "";

  for (const entry of participants) {
    callVideoGrid.appendChild(createParticipantTile(entry));

    const item = document.createElement("li");
    item.className = "call-participant-item";
    item.textContent = entry.isLocal ? `${getParticipantName(entry.participant)} (You)` : getParticipantName(entry.participant);
    callParticipantsList.appendChild(item);
  }

  if (!participants.length) {
    const emptyTile = document.createElement("div");
    emptyTile.className = "call-video-tile call-video-placeholder";
    emptyTile.textContent = "Waiting for participants";
    callVideoGrid.appendChild(emptyTile);

    const emptyParticipant = document.createElement("li");
    emptyParticipant.className = "call-participant-item";
    emptyParticipant.textContent = "No one has joined yet";
    callParticipantsList.appendChild(emptyParticipant);
  }

  // Set participant count so CSS grid adapts layout like Zoom/Meet
  const count = participants.length || 1;
  callVideoGrid.dataset.count = String(count);

  syncCallDebugState();
}

function bindMeetingEvent(target, eventName, handler) {
  if (!target || typeof handler !== "function") {
    return;
  }

  if (typeof target.on === "function") {
    target.on(eventName, handler);
    callMeetingEventUnsubscribers.push(() => {
      if (typeof target.off === "function") {
        target.off(eventName, handler);
      } else if (typeof target.removeListener === "function") {
        target.removeListener(eventName, handler);
      }
    });
    return;
  }

  if (typeof target.addEventListener === "function") {
    target.addEventListener(eventName, handler);
    callMeetingEventUnsubscribers.push(() => target.removeEventListener(eventName, handler));
  }
}

function bindCallMeetingEvents(meeting) {
  clearCallMeetingEventBindings();

  const rerender = () => {
    renderCallParticipants();
  };

  for (const eventName of [
    "participantJoined",
    "participantLeft",
    "participantUpdated",
    "peerStartedPresenting",
    "peerStoppedPresenting",
    "roomJoined",
    "roomLeft"
  ]) {
    bindMeetingEvent(meeting, eventName, rerender);
  }

  for (const eventName of ["participantJoined", "participantLeft", "participantUpdated", "videoUpdate", "audioUpdate"]) {
    bindMeetingEvent(meeting?.participants, eventName, rerender);
    bindMeetingEvent(meeting?.participants?.joined, eventName, rerender);
  }
}

async function startLocalPreview() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  if (localPreviewStream) {
    return;
  }

  try {
    localPreviewStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
  } catch {
    // Keep call functional even if preview permission is denied.
  }
}

function stopLocalPreview() {
  if (!localPreviewStream) {
    return;
  }

  for (const track of localPreviewStream.getTracks()) {
    track.stop();
  }

  localPreviewStream = null;
}

async function applyMeetingAudioState(enabled) {
  if (!callMeeting) return;

  // RealtimeKit (Dyte) SDK: audio control lives on meeting.self
  const self = callMeeting.self || callMeeting.localParticipant;

  try {
    if (enabled) {
      if (self && typeof self.enableAudio === "function") { await self.enableAudio(); return; }
      if (typeof callMeeting.enableAudio === "function") { await callMeeting.enableAudio(); return; }
      if (typeof callMeeting.unmute === "function") { await callMeeting.unmute(); return; }
      if (typeof callMeeting.setAudioEnabled === "function") { await callMeeting.setAudioEnabled(true); }
    } else {
      if (self && typeof self.disableAudio === "function") { await self.disableAudio(); return; }
      if (typeof callMeeting.disableAudio === "function") { await callMeeting.disableAudio(); return; }
      if (typeof callMeeting.mute === "function") { await callMeeting.mute(); return; }
      if (typeof callMeeting.setAudioEnabled === "function") { await callMeeting.setAudioEnabled(false); }
    }
  } catch (err) {
    console.warn("applyMeetingAudioState error:", err);
    throw err;
  }
}

async function applyMeetingVideoState(enabled) {
  if (!callMeeting) return;

  // RealtimeKit (Dyte) SDK: video control lives on meeting.self
  const self = callMeeting.self || callMeeting.localParticipant;

  try {
    if (enabled) {
      if (self && typeof self.enableVideo === "function") { await self.enableVideo(); return; }
      if (typeof callMeeting.enableVideo === "function") { await callMeeting.enableVideo(); return; }
      if (typeof callMeeting.setVideoEnabled === "function") { await callMeeting.setVideoEnabled(true); }
    } else {
      if (self && typeof self.disableVideo === "function") { await self.disableVideo(); return; }
      if (typeof callMeeting.disableVideo === "function") { await callMeeting.disableVideo(); return; }
      if (typeof callMeeting.setVideoEnabled === "function") { await callMeeting.setVideoEnabled(false); }
    }
  } catch (err) {
    console.warn("applyMeetingVideoState error:", err);
    throw err;
  }
}

function syncCallControlLabels() {
  if (callToggleAudioButton) {
    callToggleAudioButton.classList.toggle("is-enabled", callAudioEnabled);
    callToggleAudioButton.classList.toggle("is-muted", !callAudioEnabled);
    callToggleAudioButton.setAttribute("aria-pressed", String(callAudioEnabled));
    const label = callToggleAudioButton.querySelector(".call-toolbar-label");
    if (label) label.textContent = callAudioEnabled ? "Mic On" : "Mic Off";
  }

  if (callToggleVideoButton) {
    callToggleVideoButton.classList.toggle("is-enabled", callVideoEnabled);
    callToggleVideoButton.classList.toggle("is-muted", !callVideoEnabled);
    callToggleVideoButton.setAttribute("aria-pressed", String(callVideoEnabled));
    const label = callToggleVideoButton.querySelector(".call-toolbar-label");
    if (label) label.textContent = callVideoEnabled ? "Camera On" : "Camera Off";
  }
}

function toggleCallPopup(popupEl, btnEl) {
  if (!popupEl) return;
  const isOpen = !popupEl.hidden;
  // Close all popups first
  if (callParticipantsPopup) callParticipantsPopup.hidden = true;
  if (callChatPopup) callChatPopup.hidden = true;
  if (callParticipantsBtn) callParticipantsBtn.classList.remove("is-active");
  if (callChatBtn) callChatBtn.classList.remove("is-active");
  // Toggle clicked one
  if (!isOpen) {
    popupEl.hidden = false;
    if (btnEl) btnEl.classList.add("is-active");
  }
}

async function teardownCallMeeting() {
  clearCallMeetingEventBindings();
  stopLocalPreview();

  if (callProvider) {
    callProvider.meeting = null;
  }

  if (callChatWidget) {
    callChatWidget.meeting = null;
  }

  if (callVideoGrid) {
    callVideoGrid.innerHTML = "";
  }

  if (callParticipantsList) {
    callParticipantsList.innerHTML = "";
  }

  if (!callMeeting) {
    return;
  }

  const meeting = callMeeting;
  callMeeting = null;

  try {
    if (typeof meeting.leave === "function") {
      await meeting.leave();
    }
  } catch {
    // Ignore leave errors to avoid blocking room switches.
  }

  try {
    if (typeof meeting.destroy === "function") {
      meeting.destroy();
    }
  } catch {
    // Ignore destroy errors for best-effort cleanup.
  }
}

async function mountCallMeeting(authToken, baseURI) {
  if (!window.RealtimeKitClient?.init) {
    throw new Error("RealtimeKit SDK is not available in this page.");
  }

  await teardownCallMeeting();
  setCallStatus("Connecting to call...");

  callAudioEnabled = false;
  callVideoEnabled = false;
  syncCallControlLabels();

  const initPayload = {
    authToken,
    defaults: {
      audio: false,
      video: false
    }
  };

  if (baseURI) {
    initPayload.baseURI = baseURI;
  }

  const meeting = await window.RealtimeKitClient.init(initPayload);
  if (typeof meeting?.joinRoom === "function") {
    await meeting.joinRoom();
  }
  callMeeting = meeting;
  bindCallMeetingEvents(meeting);

  // Enforce muted defaults immediately after joining.
  try {
    await applyMeetingAudioState(false);
  } catch {
    // Best-effort only; keep join flow working.
  }

  try {
    await applyMeetingVideoState(false);
  } catch {
    // Best-effort only; keep join flow working.
  }

  syncCallDebugState();

  if (callProvider) {
    callProvider.meeting = meeting;
  }

  if (callChatWidget) {
    callChatWidget.meeting = meeting;
  }

  renderCallParticipants();
  setCallStatus("Connected. Video, audio, chat, and participants are in this call.");
}

async function createCallRoom() {
  const data = await request(CALL_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "create_call",
      title: `Call Room · ${new Date().toLocaleString()}`
    })
  });

  return data.roomId;
}

async function joinCallRoom(roomId, name) {
  return request(CALL_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "join_call",
      roomId,
      name
    })
  });
}

async function handleCreateCall() {
  if (!hasCallUI) {
    return;
  }

  const name = getCreateCallDisplayName();
  if (!name) {
    setCallStatus("Your name is required.", true);
    return;
  }

  try {
    setCallStatus("Creating call...");
    const roomId = await createCallRoom();
    callRoomCodeInput.value = roomId;
    showToast("Call room created. Joining now...", "success");
    const data = await joinCallRoom(roomId, name);
    callLocalName = name;
    await mountCallMeeting(data.authToken, data.baseURI);
    activeCallRoomId = data.roomId;
    showCallRoomView(data.roomId);
  } catch (err) {
    setCallStatus(err.message, true);
    showToast(err.message, "error");
  }
}

async function handleJoinCall() {
  if (!hasCallUI) {
    return;
  }

  const roomId = normalizeRoomCode(callRoomCodeInput.value);
  const name = getJoinCallDisplayName();

  if (!name) {
    setCallStatus("Your name is required.", true);
    return;
  }

  if (!roomId) {
    setCallStatus("Room code is required.", true);
    setCallRoomMeta("");
    return;
  }

  try {
    setCallStatus("Joining call...");
    const data = await joinCallRoom(roomId, name);
    callLocalName = name;
    await mountCallMeeting(data.authToken, data.baseURI);
    activeCallRoomId = data.roomId;
    showCallRoomView(data.roomId);
    showToast("Joined call successfully.", "success");
  } catch (err) {
    setCallStatus(err.message, true);
    showToast(err.message, "error");
  }
}

async function handleLeaveCall() {
  if (!hasCallUI) {
    return;
  }

  await teardownCallMeeting();
  activeCallRoomId = null;
  callParticipantSnapshot = [];
  syncCallDebugState();
  hideCallRoomView();
  setCallStatus("Create a call or join with a room code.");
  setCallRoomMeta("");
}

async function handleCopyCallCode() {
  const roomCode = normalizeRoomCode(callRoomCodeInput?.value || activeCallRoomId || "");

  if (!roomCode) {
    setCallStatus("No room code available to copy.", true);
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(roomCode);
      showToast("Room code copied.", "success");
      return;
    }

    throw new Error("Clipboard API unavailable.");
  } catch {
    setCallStatus("Copy failed. Please copy the room code manually.", true);
  }
}

async function handleToggleAudio() {
  if (!callMeeting) {
    return;
  }

  callAudioEnabled = !callAudioEnabled;
  syncCallControlLabels();

  try {
    await applyMeetingAudioState(callAudioEnabled);
  } catch (err) {
    callAudioEnabled = !callAudioEnabled;
    syncCallControlLabels();
    setCallStatus(err.message || "Unable to update microphone state.", true);
  }
}

async function handleToggleVideo() {
  if (!callMeeting) {
    return;
  }

  callVideoEnabled = !callVideoEnabled;
  syncCallControlLabels();

  if (localPreviewStream) {
    for (const track of localPreviewStream.getVideoTracks()) {
      track.enabled = callVideoEnabled;
    }
  }

  try {
    await applyMeetingVideoState(callVideoEnabled);
  } catch (err) {
    callVideoEnabled = !callVideoEnabled;
    syncCallControlLabels();
    setCallStatus(err.message || "Unable to update camera state.", true);
  }
}

function handleToggleFullscreen() {
  const target = callRoomView;
  if (!target) return;

  if (!document.fullscreenElement) {
    (target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen)?.call(target);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)?.call(document);
  }
}

function syncFullscreenButton() {
  if (!callFullscreenBtn) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  callFullscreenBtn.classList.toggle("is-fullscreen", isFullscreen);
  const label = callFullscreenBtn.querySelector(".fullscreen-label");
  if (label) label.textContent = isFullscreen ? "Exit" : "Fullscreen";
}

function initCall() {
  if (!hasCallUI) {
    return;
  }

  hideCallRoomView();
  syncCallControlLabels();
  syncCallDebugState();

  callCreateButton.addEventListener("click", () => handleCreateCall());
  callJoinButton.addEventListener("click", () => handleJoinCall());
  callLeaveButton.addEventListener("click", () => handleLeaveCall());
  callCopyCodeButton.addEventListener("click", () => handleCopyCallCode());
  callToggleAudioButton.addEventListener("click", () => handleToggleAudio());
  callToggleVideoButton.addEventListener("click", () => handleToggleVideo());

  if (callFullscreenBtn) {
    callFullscreenBtn.addEventListener("click", handleToggleFullscreen);
  }

  document.addEventListener("fullscreenchange", syncFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncFullscreenButton);

  if (callParticipantsBtn) {
    callParticipantsBtn.addEventListener("click", () => {
      toggleCallPopup(callParticipantsPopup, callParticipantsBtn);
    });
  }

  if (callChatBtn) {
    callChatBtn.addEventListener("click", () => {
      toggleCallPopup(callChatPopup, callChatBtn);
    });
  }

  // Close popup when clicking its close button
  document.querySelectorAll(".call-popup-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.closePopup;
      const popup = targetId ? document.getElementById(targetId) : null;
      if (popup) popup.hidden = true;
      btn.closest(".call-popup")?.previousElementSibling?.classList?.remove("is-active");
      if (callParticipantsBtn) callParticipantsBtn.classList.remove("is-active");
      if (callChatBtn) callChatBtn.classList.remove("is-active");
    });
  });

  callRoomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleJoinCall();
    }
  });

  // ── Immediate leave on page exit ──────────────────────────────────
  // `beforeunload`  – tab close / navigate away (desktop)
  // `pagehide`      – mobile Safari & bfcache navigations
  // `visibilitychange` – catches the final hide before the page is killed
  // All three call the same synchronous helper so there are no race conditions.

  function leaveMeetingNow() {
    if (!callMeeting) return;
    const meeting = callMeeting;
    callMeeting = null;                     // prevent double-leave
    clearCallMeetingEventBindings();
    stopLocalPreview();

    // Fire-and-forget: browser may cancel the promise on unload, but
    // the underlying WebSocket close (caused by the process exiting)
    // will remove the participant server-side within seconds anyway.
    try {
      if (typeof meeting.leave === "function")   meeting.leave();
      if (typeof meeting.destroy === "function") meeting.destroy();
    } catch { /* ignore */ }
  }

  window.addEventListener("beforeunload", leaveMeetingNow);  // close / refresh (desktop)
  window.addEventListener("pagehide",     leaveMeetingNow);  // mobile Safari & bfcache
}

function normalizeRoomCode(value) {
  return (value || "").trim();
}

// Shared HTTP helper with JSON validation and transient error retry.
async function request(url, options = {}) {
  // Send one HTTP request with shared JSON headers and caller overrides.
  async function fetchOnce() {
    return fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      ...options
    });
  }

  // Parse JSON responses and normalize error handling for UI consumers.
  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    const payloadText = await response.text();

    if (!payloadText) {
      if (response.ok) {
        return {};
      }

      throw new Error("Empty response from server.");
    }

    if (!contentType.includes("application/json")) {
      const isLikelyTransient = response.status >= 500 || payloadText.includes("<html") || payloadText.includes("<!DOCTYPE html");
      if (isLikelyTransient) {
        throw new Error("Temporary server response.");
      }

      throw new Error("Invalid JSON response from server.");
    }

    let data;
    try {
      data = JSON.parse(payloadText);
    } catch {
      throw new Error("Invalid JSON response from server.");
    }

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
  }

  const retryDelays = [250, 500, 1000, 1500, 2000];
  let lastError;

  // Retry only transient server responses with progressive backoff delays.
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const response = await fetchOnce();
      return await parseResponse(response);
    } catch (error) {
      lastError = error;

      if (error.message !== "Temporary server response." || attempt === retryDelays.length - 1) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }

  throw lastError || new Error("Request failed.");
}

// Fetch and paint latest Todo data from the backend.
async function loadTodos() {
  if (!hasTodoUI) {
    return;
  }

  try {
    setMessage("Loading todos...");
    const data = await request(API_URL);
    renderTodos(data.todos || []);
    setMessage("");
  } catch (err) {
    setMessage(err.message, true);
  }
}

// ===== Todo Actions =====

// Create a todo item through the backend API.
async function addTodo(title, delaySeconds) {
  await request(API_URL, {
    method: "POST",
    body: JSON.stringify({ title, delaySeconds })
  });
}

// Update completion state, then refresh todo and analytics views.
async function toggleTodo(id, completed) {
  try {
    await request(API_URL, {
      method: "PUT",
      body: JSON.stringify({ id, completed })
    });
    await loadTodos();
    scheduleAnalyticsRefresh();
    showToast(completed ? "Task marked as done." : "Task marked as pending.", "success");
  } catch (err) {
    setMessage(err.message, true);
    showToast(err.message, "error");
    await loadTodos();
  }
}

// Delete a todo item, then refresh related UI sections.
async function deleteTodo(id) {
  try {
    await request(`${API_URL}?id=${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    await loadTodos();
    scheduleAnalyticsRefresh();
    showToast("Task removed.", "success");
  } catch (err) {
    setMessage(err.message, true);
    showToast(err.message, "error");
  }
}

// ===== Analytics Logic =====

// Render analytics summary cards using aggregated event counts.
function renderAnalyticsCounts(counts) {
  if (!analyticsCounts) {
    return;
  }

  const cards = [
    { label: "Created",      value: counts["todo.created"]      || 0 },
    { label: "Updated",      value: counts["todo.updated"]      || 0 },
    { label: "Deleted",      value: counts["todo.deleted"]      || 0 },
    { label: "Auto-Deleted", value: counts["todo.auto_deleted"] || 0 }
  ];

  analyticsCounts.innerHTML = cards
    .map(
      (card) => `
        <div class="analytics-card">
          <span class="analytics-card-label">${card.label}</span>
          <span class="analytics-card-value">${card.value}</span>
        </div>
      `
    )
    .join("");
}

// Render recent analytics events including event type, todo identity, and timestamp.
function renderAnalyticsEvents(events) {
  if (!analyticsEvents) {
    return;
  }

  if (!events.length) {
    analyticsEvents.innerHTML = `
      <li class="empty">No analytics events yet. Perform a todo action to generate queue data.</li>
    `;
    return;
  }

  analyticsEvents.innerHTML = events
    .map((event) => {
      const eventLabel = {
        "todo.created":      "Created",
        "todo.updated":      "Updated",
        "todo.deleted":      "Deleted",
        "todo.auto_deleted": "Auto-Deleted"
      }[event.event_type] || event.event_type;

      const occurredAt = new Date(event.occurred_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });

      const todoTitle = event.todo_title || event.payload?.title || `Todo #${event.todo_id ?? "-"}`;
      const completionState =
        event.todo_completed === null || event.todo_completed === undefined
          ? ""
          : event.todo_completed
            ? "Completed"
            : "Pending";

      return `
        <li class="analytics-event">
          <div class="analytics-event-type">${eventLabel}</div>
          <div class="analytics-event-meta">
            <div>${escapeHTML(todoTitle)}</div>
            <div>Todo #${event.todo_id ?? "-"}${completionState ? ` · ${completionState}` : ""}</div>
            <div>${occurredAt}</div>
          </div>
        </li>
      `;
    })
    .join("");
}

// Load queue-processed analytics snapshots and update the analytics panel.
async function loadAnalytics() {
  if (!analyticsCounts || !analyticsEvents) {
    return;
  }

  try {
    setAnalyticsStatus("Loading queue events...");
    const data = await request(ANALYTICS_URL);
    renderAnalyticsCounts(data.counts || {});
    renderAnalyticsEvents(data.recent_events || []);
    setAnalyticsStatus("Showing queue-processed analytics events.");
    syncTodoListViewport();
  } catch (err) {
    analyticsCounts.innerHTML = "";
    analyticsEvents.innerHTML = `
      <li class="empty">Unable to load analytics right now.</li>
    `;
    setAnalyticsStatus(err.message, true);
    syncTodoListViewport();
  }
}

// ===== Counter Logic =====

// Render current counter value in the counter panel.
function renderCounter(value) {
  if (!counterValue) {
    return;
  }

  counterValue.textContent = String(value);
}

// Read current Durable Object counter value and render it.
async function loadCounter() {
  if (!hasCounterUI) {
    return;
  }

  try {
    setCounterMessage("Loading counter...");
    const data = await request(COUNTER_URL);
    renderCounter(data.value ?? 0);
    setCounterMessage("Counter synced.");
  } catch (err) {
    setCounterMessage(err.message, true);
    showToast(err.message, "error");
  }
}

// Execute counter mutations through the counter API, then update UI state.
async function updateCounter(method, body, successMessage) {
  try {
    const data = await request(COUNTER_URL, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    renderCounter(data.value ?? 0);
    setCounterMessage(successMessage);
    showToast(successMessage, "success");
  } catch (err) {
    setCounterMessage(err.message, true);
    showToast(err.message, "error");
  }
}

// Register todo form submit behavior for create and refresh flow.
if (form) {
  form.addEventListener("submit", async (event) => {
    // Todo submit pipeline: validate, create, refresh list, notify.
    event.preventDefault();
    const title = input.value.trim();
    const delayInput = document.getElementById("todo-delay");
    const delaySeconds = delayInput ? parseInt(delayInput.value, 10) : 0;

    if (!title) {
      setMessage("Todo title is required.", true);
      return;
    }

    try {
      await addTodo(title, delaySeconds);
      input.value = "";
      setMessage("Todo added.");
      await loadTodos();
      scheduleAnalyticsRefresh();
      showToast("Task added.", "success");
    } catch (err) {
      setMessage(err.message, true);
      showToast(err.message, "error");
    }
  });
}

if (configForm) {
  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      await saveConfig();
    } catch (err) {
      setConfigMessage(err.message, true);
      showToast(err.message, "error");
    }
  });
}

// Application bootstrap sequence.
async function bootstrap() {
  initTheme();
  initSectionSwitcher();
  await loadConfig();

  // Initialize todo section data and resize sync listener.
  if (hasTodoUI) {
    if (isSectionEnabled("todos")) {
      loadTodos();
    }

    window.addEventListener("resize", updateListScrollState);
  }

  // Initialize analytics section data, manual refresh, and polling.
  if (hasAnalyticsUI) {
    if (isSectionEnabled("analytics")) {
      loadAnalytics();
    }

    if (analyticsRefresh) {
      analyticsRefresh.addEventListener("click", () => {
        loadAnalytics();
      });
    }

  }

  // Initialize counter section data and mutation handlers.
  if (hasCounterUI) {
    if (isSectionEnabled("counter")) {
      loadCounter();
    }

    counterIncrement.addEventListener("click", async () => {
      await updateCounter("POST", { delta: 1 }, "Counter incremented.");
    });

    counterReset.addEventListener("click", async () => {
      await updateCounter("DELETE", undefined, "Counter reset.");
    });
  }

  // Initialize RealtimeKit call controls.
  if (hasCallUI && isSectionEnabled("call")) {
    initCall();
  }

}

bootstrap();
