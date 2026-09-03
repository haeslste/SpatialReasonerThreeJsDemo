import "./styles.css";

import { ApiError, getDefaultScene, getHealth, normalizeReasonResponse, reason } from "./api";
import { WorkbenchScene } from "./scene/WorkbenchScene";
import type {
  Preset,
  ReasonResponse,
  ReasonSettings,
  SpatialObjectData,
  SpatialRelationData,
  TraceStage,
} from "./types";

const settings: ReasonSettings = {
  nearbySchema: "circle",
  nearbyFactor: 1.25,
  nearbyLimit: 2.5,
  sectorFactor: 1,
  maxGap: 0.035,
};
let objects: SpatialObjectData[] = [];
let initialObjects: SpatialObjectData[] = [];
let presets: Preset[] = [];
let selectedId: string | null = null;
let activePresetId = "";
let lastResponse: ReasonResponse | null = null;
let visibleRelations: SpatialRelationData[] = [];
let requestSequence = 0;
let activeRequest: AbortController | null = null;
let reasonDebounce = 0;

const sceneMount = element<HTMLDivElement>("sceneMount");
const inspector = element<HTMLElement>("inspector");
const presetTray = element<HTMLDivElement>("presetTray");
const pipelineInput = element<HTMLInputElement>("pipelineInput");
const runButton = element<HTMLButtonElement>("runButton");
const resetButton = element<HTMLButtonElement>("resetButton");
const rotateLeftButton = element<HTMLButtonElement>("rotateLeftButton");
const rotateRightButton = element<HTMLButtonElement>("rotateRightButton");
const backendStatus = element<HTMLDivElement>("backendStatus");
const reasoningBadge = element<HTMLDivElement>("reasoningBadge");
const resultCard = element<HTMLDivElement>("resultCard");
const traceSummary = element<HTMLSpanElement>("traceSummary");
const traceBody = element<HTMLDivElement>("traceBody");
const sceneToast = element<HTMLDivElement>("sceneToast");
const introDialog = element<HTMLDialogElement>("introDialog");
const nearbySchema = element<HTMLSelectElement>("nearbySchema");
const nearbyFactor = element<HTMLInputElement>("nearbyFactor");
const nearbyFactorOutput = element<HTMLOutputElement>("nearbyFactorOutput");
const nearbyLimit = element<HTMLInputElement>("nearbyLimit");
const nearbyLimitOutput = element<HTMLOutputElement>("nearbyLimitOutput");
const showBounds = element<HTMLInputElement>("showBounds");
const showNearField = element<HTMLInputElement>("showNearField");

const workbench = new WorkbenchScene(sceneMount, handleSelection, handleObjectChange);

runButton.addEventListener("click", () => void executeReasoning(pipelineInput.value));
pipelineInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void executeReasoning(pipelineInput.value);
});
pipelineInput.addEventListener("input", () => {
  activePresetId = "";
  renderPresets();
});
resetButton.addEventListener("click", resetScene);
rotateLeftButton.addEventListener("click", () => workbench.rotateSelected(Math.PI / 12));
rotateRightButton.addEventListener("click", () => workbench.rotateSelected(-Math.PI / 12));
element<HTMLButtonElement>("helpButton").addEventListener("click", () => showIntroduction());
element<HTMLButtonElement>("closeIntroButton").addEventListener("click", () => introDialog.close());
element<HTMLButtonElement>("startButton").addEventListener("click", () => {
  localStorage.setItem("spatial-workbench-intro", "seen");
  introDialog.close();
});
introDialog.addEventListener("click", (event) => {
  if (event.target === introDialog) introDialog.close();
});
nearbySchema.addEventListener("change", applyInferenceParameters);
nearbyFactor.addEventListener("input", updateParameterReadouts);
nearbyFactor.addEventListener("change", applyInferenceParameters);
nearbyLimit.addEventListener("input", updateParameterReadouts);
nearbyLimit.addEventListener("change", applyInferenceParameters);
showBounds.addEventListener("change", () => workbench.setShowBoundingBoxes(showBounds.checked));
showNearField.addEventListener("change", () => workbench.setShowNearField(showNearField.checked));

void initialize();

async function initialize(): Promise<void> {
  setBackendState("checking", "Checking engine");
  renderInspector();
  renderResult();
  try {
    const [health, scene] = await Promise.all([getHealth(), getDefaultScene()]);
    objects = cloneObjects(scene.objects);
    initialObjects = cloneObjects(scene.objects);
    presets = scene.presets;
    activePresetId = scene.defaultPresetId;
    const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
    pipelineInput.value = activePreset?.pipeline ?? "sort(volume >) | slice(1)";
    workbench.setObjects(objects);
    renderPresets();
    renderInspector();
    setBackendState("online", `${health.engine} online`);
    if (!localStorage.getItem("spatial-workbench-intro")) showIntroduction();
    await executeReasoning(pipelineInput.value);
  } catch (error) {
    setBackendState("offline", "Engine unavailable");
    setReasoningState("error", "Backend disconnected");
    showToast(errorMessage(error), true);
    resultCard.innerHTML = `
      <span class="result-index">CONNECTION</span>
      <strong>Start the local Python API</strong>
      <small>The viewport waits for SRpy so no client-side relation logic is substituted.</small>`;
  }
}

async function executeReasoning(pipeline: string, fromMovement = false): Promise<void> {
  if (!objects.length || !pipeline.trim()) return;
  const sequence = ++requestSequence;
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  setReasoningState("running", fromMovement ? "Updating after geometry change" : "Evaluating pipeline");
  runButton.disabled = true;
  runButton.classList.add("is-running");
  try {
    const raw = await reason(objects, pipeline.trim(), settings, controller.signal);
    if (sequence !== requestSequence) return;
    const response = normalizeReasonResponse(raw, objects);
    lastResponse = response;
    objects = response.objects;
    workbench.setObjects(objects);
    workbench.setSelected(selectedId);
    workbench.setReasoning(response.resultIds, response.relations, activePreset()?.focusPredicate ?? "");
    setReasoningState(response.success ? "ready" : "error", response.success ? `${response.resultIds.length} result${response.resultIds.length === 1 ? "" : "s"}` : "Pipeline error");
    renderResult();
    renderInspector();
    renderTrace(response.trace, response.timingMs);
    if (fromMovement) showToast(`Relations refreshed in ${formatNumber(response.timingMs, 1)} ms`);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (sequence !== requestSequence) return;
    const offline = !(error instanceof ApiError) || error.status >= 500;
    if (offline) setBackendState("offline", "Engine unavailable");
    setReasoningState("error", "Reasoning rejected");
    showToast(errorMessage(error), true);
  } finally {
    if (sequence === requestSequence) {
      runButton.disabled = false;
      runButton.classList.remove("is-running");
    }
  }
}

function renderPresets(): void {
  presetTray.innerHTML = presets
    .map(
      (preset, index) => `
        <button class="preset-chip ${preset.id === activePresetId ? "active" : ""}" data-preset-id="${escapeHtml(preset.id)}" type="button" role="listitem" title="${escapeHtml(preset.description)}">
          <span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(preset.shortLabel)}
        </button>`,
    )
    .join("");
  for (const button of presetTray.querySelectorAll<HTMLButtonElement>("[data-preset-id]")) {
    button.addEventListener("click", () => {
      activePresetId = button.dataset.presetId ?? "";
      const preset = activePreset();
      if (!preset) return;
      pipelineInput.value = preset.pipeline;
      renderPresets();
      void executeReasoning(preset.pipeline);
    });
  }
}

function renderResult(): void {
  if (!lastResponse) {
    resultCard.innerHTML = `
      <span class="result-index">RESULT SET</span>
      <strong>No pipeline evaluation yet</strong>
      <small>Retained object IDs and stage-level reductions will appear here.</small>`;
    return;
  }
  const preset = activePreset();
  const inputCount = lastResponse.trace[0]?.inputIds.length ?? objects.length;
  const resultCount = lastResponse.resultIds.length;
  const retained = inputCount ? (resultCount / inputCount) * 100 : 0;
  resultCard.innerHTML = `
    <div class="result-card-head">
      <span class="result-index">${lastResponse.success ? "FILTER OUTPUT" : "PIPELINE ERROR"}</span>
      <span>${lastResponse.trace.length} stages · ${formatNumber(lastResponse.timingMs, 1)} ms</span>
    </div>
    <div class="result-outcome">
      <strong>${resultCount}</strong><span>of ${inputCount}<small>objects retained</small></span>
      <b>${formatNumber(retained, 0)}%</b>
    </div>
    <div class="result-title">${escapeHtml(preset?.label ?? "Custom pipeline")}</div>
    ${
      lastResponse.success && resultCount
        ? `<div class="result-objects">${lastResponse.resultIds
            .map((id) => `<button type="button" data-result-id="${escapeHtml(id)}"><i></i>${escapeHtml(objectById(id)?.label ?? id)}<code>${escapeHtml(id)}</code></button>`)
            .join("")}</div>`
        : `<small>${lastResponse.success ? "No object satisfies every stage in the current geometry." : escapeHtml(lastResponse.error ?? "The pipeline could not be evaluated.")}</small>`
    }`;
  for (const button of resultCard.querySelectorAll<HTMLButtonElement>("[data-result-id]")) {
    button.addEventListener("click", () => handleSelection(button.dataset.resultId ?? null));
  }
}

function renderInspector(): void {
  const selected = selectedId ? objectById(selectedId) : null;
  if (!selected) {
    inspector.innerHTML = `
      <div class="inspector-head">
        <div><div class="eyebrow">Measurement inspector</div><h2>No spatial object selected</h2></div>
        <span class="object-count">${objects.length || "—"} objects</span>
      </div>
      <div class="inspector-empty">
        <div class="empty-cube" aria-hidden="true"><i></i><i></i><i></i></div>
        <strong>Select an oriented bounding box</strong>
        <p>Inspect its measurement vector, calibrate its extent, and audit the predicates returned by SRpy.</p>
      </div>
      <div class="authority-note"><span>PY</span><p><strong>Inference authority</strong><br />The browser renders SRpy output; it does not reproduce predicate tests.</p></div>`;
    return;
  }

  const allRelations = lastResponse?.relations ?? [];
  visibleRelations = allRelations
    .filter((relation) => relation.subjectId === selected.id || relation.objectId === selected.id)
    .sort(relationSort)
    .slice(0, 36);
  const yaw = ((selected.angle * 180) / Math.PI + 360) % 360;
  const poseControl = selected.immobile
    ? `<div class="locked-note"><span>⌁</span> Pose locked; measured box extent remains calibratable.</div>`
    : `<label class="yaw-control"><span><b>Yaw rotation</b><output id="yawOutput">${formatNumber(yaw, 0)}°</output></span><input id="yawSlider" type="range" min="0" max="359" step="1" value="${yaw}" /></label>`;

  inspector.innerHTML = `
    <div class="inspector-head">
      <div><div class="eyebrow">Selected object</div><h2>${escapeHtml(selected.label || selected.id)}</h2></div>
      <span class="type-badge">${escapeHtml(selected.type || "Object")}</span>
    </div>
    <div class="id-line"><span>ID</span><code>${escapeHtml(selected.id)}</code></div>
    <div class="metric-grid">
      <div><span>Position · m</span><strong>${selected.position.map((value) => formatNumber(value, 2)).join(" / ")}</strong></div>
      <div><span>Dimensions · W/H/D</span><strong>${[selected.width, selected.height, selected.depth].map((value) => formatNumber(value, 2)).join(" × ")}</strong></div>
      <div><span>Volume</span><strong>${formatNumber(selected.width * selected.height * selected.depth * 1000, 1)} L</strong></div>
      <div><span>Confidence</span><strong>${formatConfidence(selected.confidence)}</strong></div>
    </div>
    <section class="measurement-panel">
      <div class="measurement-heading"><span><b>Oriented bounding box</b><small>Measured extent · metres</small></span><code>W / H / D</code></div>
      ${renderDimensionControl("width", "W", selected.width)}
      ${renderDimensionControl("height", "H", selected.height)}
      ${renderDimensionControl("depth", "D", selected.depth)}
      <div class="effective-radius"><span>Effective near radius · ${escapeHtml(settings.nearbySchema)}</span><strong>${selected.nearbyRadius === undefined ? "Run pipeline" : `${formatNumber(selected.nearbyRadius, 3)} m`}</strong></div>
    </section>
    ${poseControl}
    <div class="relation-section-head">
      <div><div class="eyebrow">Detected relations</div><h3>${visibleRelations.length} involving this object</h3></div>
      <span class="relation-source">SRpy</span>
    </div>
    <div class="relation-list">
      ${
        visibleRelations.length
          ? visibleRelations.map(renderRelation).join("")
          : `<div class="empty-relations">Run a query to populate this object's proof relations.</div>`
      }
    </div>
    <div class="authority-note"><span>OBB</span><p><strong>Method boundary</strong><br />Predicates approximate spatial structure; they are not collision or path-safety guarantees.</p></div>`;

  const yawSlider = inspector.querySelector<HTMLInputElement>("#yawSlider");
  const yawOutput = inspector.querySelector<HTMLOutputElement>("#yawOutput");
  yawSlider?.addEventListener("input", () => {
    const degrees = Number(yawSlider.value);
    if (yawOutput) yawOutput.value = `${degrees}°`;
  });
  yawSlider?.addEventListener("change", () => {
    const degrees = Number(yawSlider.value);
    workbench.setSelectedAngle((degrees * Math.PI) / 180);
  });
  for (const input of inspector.querySelectorAll<HTMLInputElement>("[data-dimension]")) {
    input.addEventListener(input.type === "number" ? "input" : "change", () => applyDimension(input));
  }
  for (const button of inspector.querySelectorAll<HTMLButtonElement>("[data-relation-index]")) {
    button.addEventListener("click", () => {
      const relation = visibleRelations[Number(button.dataset.relationIndex)];
      if (relation) workbench.focusRelation(relation);
    });
  }
}

function renderRelation(relation: SpatialRelationData, index: number): string {
  const subject = objectById(relation.subjectId)?.label ?? relation.subjectId;
  const object = objectById(relation.objectId)?.label ?? relation.objectId;
  const kind = relationKind(relation.predicate);
  return `
    <button class="relation-row ${kind}" type="button" data-relation-index="${index}" title="${escapeHtml(relation.description)}">
      <span class="relation-marker"></span>
      <span class="relation-copy">
        <span class="relation-triple"><b>${escapeHtml(subject)}</b><em>${escapeHtml(relation.predicate)}</em><b>${escapeHtml(object)}</b></span>
        <span class="relation-metrics">Δ ${formatNumber(relation.delta, 3)} m · yaw ${formatNumber(relation.yaw, 1)}°</span>
      </span>
      <span class="relation-arrow">→</span>
    </button>`;
}

function renderTrace(stages: TraceStage[], timingMs: number): void {
  traceSummary.textContent = `${stages.length} stages · ${formatNumber(timingMs, 1)} ms`;
  traceBody.innerHTML = stages
    .map(
      (stage, index) => `
        <div class="trace-stage ${stage.error ? "failed" : ""} ${stage.outputIds.length < stage.inputIds.length ? "reducing" : ""} ${index === stages.length - 1 ? "terminal" : ""}">
          <span class="trace-number">${String(index + 1).padStart(2, "0")}</span>
          <div class="trace-operation"><code>${escapeHtml(stage.operation)}</code><small>${stage.error ? escapeHtml(stage.error) : stage.succeeded ? "Completed" : "Empty output"}</small></div>
          <div class="trace-flow"><span>${stage.inputIds.length} in</span><i>→</i><span>${stage.outputIds.length} out</span></div>
          <div class="trace-ids" title="${escapeHtml(stage.outputIds.join(", "))}">${escapeHtml(stage.outputIds.slice(0, 5).join(" · ") || "∅")}</div>
        </div>`,
    )
    .join("");
}

function handleSelection(id: string | null): void {
  selectedId = id;
  workbench.setSelected(id);
  renderInspector();
}

function handleObjectChange(changed: SpatialObjectData): void {
  objects = objects.map((object) => (object.id === changed.id ? changed : object));
  selectedId = changed.id;
  workbench.setObjects(objects);
  workbench.setSelected(selectedId);
  if (lastResponse) workbench.setReasoning(lastResponse.resultIds, lastResponse.relations, activePreset()?.focusPredicate ?? "");
  renderInspector();
  scheduleReasoning("Measurement changed");
}

function scheduleReasoning(label: string): void {
  setReasoningState("pending", label);
  window.clearTimeout(reasonDebounce);
  reasonDebounce = window.setTimeout(() => void executeReasoning(pipelineInput.value, true), 320);
}

function applyInferenceParameters(): void {
  settings.nearbySchema = nearbySchema.value as ReasonSettings["nearbySchema"];
  settings.nearbyFactor = Number(nearbyFactor.value);
  settings.nearbyLimit = Number(nearbyLimit.value);
  updateParameterReadouts();
  scheduleReasoning("Proximity calibration changed");
}

function updateParameterReadouts(): void {
  nearbyFactorOutput.value = `${formatNumber(Number(nearbyFactor.value), 2)}×`;
  nearbyLimitOutput.value = `${formatNumber(Number(nearbyLimit.value), 2)} m`;
}

function applyDimension(input: HTMLInputElement): void {
  const selected = selectedId ? objectById(selectedId) : null;
  const dimension = input.dataset.dimension as "width" | "height" | "depth" | undefined;
  if (!selected || !dimension) return;
  const requested = Number(input.value);
  if (!Number.isFinite(requested) || requested < 0.01) return;
  const value = Math.min(20, requested);
  if (value === selected[dimension]) return;
  const changed = { ...selected, [dimension]: value };
  changed.center = [changed.position[0], changed.position[1] + changed.height / 2, changed.position[2]];
  handleObjectChange(changed);
}

function renderDimensionControl(dimension: "width" | "height" | "depth", axis: string, value: number): string {
  const sliderMax = Math.max(1, Math.ceil(value * 2.25 * 10) / 10);
  return `<label class="dimension-control">
    <b>${axis}</b>
    <input data-dimension="${dimension}" type="range" min="0.01" max="${sliderMax}" step="0.01" value="${value}" aria-label="${dimension} in metres" />
    <span><input data-dimension="${dimension}" type="number" min="0.01" max="20" step="0.01" value="${formatNumber(value, 2)}" aria-label="${dimension} value in metres" /><em>m</em></span>
  </label>`;
}

function resetScene(): void {
  window.clearTimeout(reasonDebounce);
  objects = cloneObjects(initialObjects);
  selectedId = null;
  lastResponse = null;
  workbench.setObjects(objects);
  workbench.setSelected(null);
  showToast("Scene reset to its measured baseline");
  renderInspector();
  void executeReasoning(pipelineInput.value);
}

function activePreset(): Preset | undefined {
  return presets.find((preset) => preset.id === activePresetId && preset.pipeline === pipelineInput.value) ??
    presets.find((preset) => preset.id === activePresetId);
}

function objectById(id: string): SpatialObjectData | undefined {
  return objects.find((object) => object.id === id);
}

function setBackendState(state: "checking" | "online" | "offline", label: string): void {
  backendStatus.className = `status-pill ${state}`;
  backendStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(label)}</span>`;
}

function setReasoningState(state: "ready" | "running" | "pending" | "error", label: string): void {
  reasoningBadge.className = `reasoning-badge ${state}`;
  reasoningBadge.innerHTML = `<span></span>${escapeHtml(label)}`;
}

function showToast(message: string, isError = false): void {
  sceneToast.textContent = message;
  sceneToast.className = `scene-toast visible ${isError ? "error" : ""}`;
  window.setTimeout(() => sceneToast.classList.remove("visible"), 3200);
}

function showIntroduction(): void {
  if (!introDialog.open) introDialog.showModal();
}

function relationSort(a: SpatialRelationData, b: SpatialRelationData): number {
  const priority = ["inside", "touching", "overlapping", "on", "near", "tangible", "seen left", "seen right", "left", "right", "above", "below", "bigger", "smaller"];
  const focus = activePreset()?.focusPredicate ?? "";
  const score = (relation: SpatialRelationData): number => {
    if (relation.predicate === focus || relation.predicate.replace(" ", "") === focus) return -100;
    const index = priority.indexOf(relation.predicate);
    return index === -1 ? 100 : index;
  };
  return score(a) - score(b) || a.delta - b.delta;
}

function relationKind(predicate: string): string {
  if (["inside", "touching", "overlapping", "on", "in", "by"].includes(predicate)) return "contact";
  if (predicate === "near" || predicate === "tangible") return "proximity";
  return "direction";
}

function formatConfidence(value: unknown): string {
  if (typeof value === "number") return `${Math.round(value * 100)}%`;
  if (value && typeof value === "object" && "pose" in value && "dimension" in value) {
    const confidence = value as { pose: number; dimension: number };
    return `${Math.round(((confidence.pose + confidence.dimension) / 2) * 100)}%`;
  }
  return "—";
}

function cloneObjects(value: SpatialObjectData[]): SpatialObjectData[] {
  return value.map((object) => ({ ...object, position: [...object.position] as [number, number, number] }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected reasoning error";
}

function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing required element #${id}`);
  return found as T;
}
