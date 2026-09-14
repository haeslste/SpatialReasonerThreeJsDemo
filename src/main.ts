import "./styles.css";

import { ApiError, canonicalSceneInputs, getDefaultScene, getHealth, normalizeReasonResponse, reason, relationsForObject } from "./api";
import { parsePipeline, serializePipeline, STAGE_DEFAULTS, type PipelineStage, type StageKind } from "./pipelineEditor";
import { graphPredicateOptions, layoutGraphNodes, selectedObjectGraphEdges, type GraphPoint } from "./relationGraph";
import { WorkbenchScene } from "./scene/WorkbenchScene";
import { pipelineProofRelations, type PipelineProof } from "./scene/proofRelations";
import { carriedTabletopObjects } from "./scene/tabletop";
import type {
  Preset,
  ReasonResponse,
  ReasonSettings,
  RelationWarningData,
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
let savedPipelines: Preset[] = [];
let selectedId: string | null = null;
let activePresetId = "";
let lastResponse: ReasonResponse | null = null;
let visibleRelations: SpatialRelationData[] = [];
let requestSequence = 0;
let activeRequest: AbortController | null = null;
let relationRequest: AbortController | null = null;
let relationRequestSequence = 0;
let queryRelations: SpatialRelationData[] = [];
let currentProof: PipelineProof = { relations: [], referenceIds: [], operation: null };
let graphMode: "pipeline" | "selected" = "pipeline";
let graphSelectedLoadedId: string | null = null;
let selectedRelationWarnings: RelationWarningData[] = [];
let reasonDebounce = 0;
let committedTable: SpatialObjectData | null = null;

const sceneMount = element<HTMLDivElement>("sceneMount");
const inspector = element<HTMLElement>("inspector");
const presetTray = element<HTMLDivElement>("presetTray");
const pipelineInput = element<HTMLInputElement>("pipelineInput");
const stageList = element<HTMLDivElement>("stageList");
const editorStatus = element<HTMLSpanElement>("editorStatus");
const addStageType = element<HTMLSelectElement>("addStageType");
const pipelineName = element<HTMLInputElement>("pipelineName");
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
const relationGraphDialog = element<HTMLDialogElement>("relationGraphDialog");
const relationGraphSvg = element<SVGSVGElement>("relationGraphSvg");
const relationGraphList = element<HTMLElement>("relationGraphList");
const graphPredicateFilter = element<HTMLSelectElement>("graphPredicateFilter");
const graphSummary = element<HTMLSpanElement>("graphSummary");
const graphPipelineTab = element<HTMLButtonElement>("graphPipelineTab");
const graphSelectedTab = element<HTMLButtonElement>("graphSelectedTab");
const nearbySchema = element<HTMLSelectElement>("nearbySchema");
const nearbyFactor = element<HTMLInputElement>("nearbyFactor");
const nearbyFactorOutput = element<HTMLOutputElement>("nearbyFactorOutput");
const nearbyLimit = element<HTMLInputElement>("nearbyLimit");
const nearbyLimitOutput = element<HTMLOutputElement>("nearbyLimitOutput");
const showBounds = element<HTMLInputElement>("showBounds");
const showNearField = element<HTMLInputElement>("showNearField");

const workbench = new WorkbenchScene(sceneMount, handleSelection, handleObjectChange, (message) => showToast(message, true));

runButton.addEventListener("click", () => void executeReasoning(pipelineInput.value));
pipelineInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void executeReasoning(pipelineInput.value);
});
pipelineInput.addEventListener("input", () => {
  markPipelineEdited();
  renderPipelineEditor();
});
stageList.addEventListener("input", (event) => {
  if ((event.target as HTMLElement).matches("[data-stage-argument]")) updatePipelineFromStages();
});
stageList.addEventListener("change", (event) => {
  if ((event.target as HTMLElement).matches("[data-stage-kind]")) {
    const select = event.target as HTMLSelectElement;
    const row = select.closest<HTMLElement>("[data-stage-index]");
    const argument = row?.querySelector<HTMLInputElement>("[data-stage-argument]");
    if (argument) argument.value = STAGE_DEFAULTS[select.value as StageKind];
    updatePipelineFromStages();
  }
});
stageList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-stage-action]");
  if (!button) return;
  const stages = parsePipeline(pipelineInput.value);
  if (!stages) return;
  const index = Number(button.closest<HTMLElement>("[data-stage-index]")?.dataset.stageIndex);
  if (!Number.isInteger(index) || index < 0 || index >= stages.length) return;
  if (button.dataset.stageAction === "remove") stages.splice(index, 1);
  if (button.dataset.stageAction === "up" && index > 0) [stages[index - 1], stages[index]] = [stages[index], stages[index - 1]];
  if (button.dataset.stageAction === "down" && index < stages.length - 1) [stages[index + 1], stages[index]] = [stages[index], stages[index + 1]];
  setEditedPipeline(stages);
});
element<HTMLButtonElement>("addStageButton").addEventListener("click", () => {
  const stages = parsePipeline(pipelineInput.value);
  if (!stages) { editorStatus.textContent = "Correct the pipeline syntax above before adding a stage."; return; }
  if (stages.length >= 12) { editorStatus.textContent = "The server accepts at most 12 stages."; return; }
  const kind = addStageType.value as StageKind;
  stages.push({ kind, argument: STAGE_DEFAULTS[kind] });
  setEditedPipeline(stages);
});
element<HTMLButtonElement>("savePipelineButton").addEventListener("click", () => void savePipeline());
resetButton.addEventListener("click", resetScene);
element<HTMLButtonElement>("exploreButton").addEventListener("click", () => workbench.focusObserver());
rotateLeftButton.addEventListener("click", () => workbench.rotateSelected(Math.PI / 12));
rotateRightButton.addEventListener("click", () => workbench.rotateSelected(-Math.PI / 12));
element<HTMLButtonElement>("relationGraphButton").addEventListener("click", () => {
  renderRelationGraph();
  relationGraphDialog.showModal();
});
element<HTMLButtonElement>("closeRelationGraphButton").addEventListener("click", () => relationGraphDialog.close());
relationGraphDialog.addEventListener("click", (event) => {
  if (event.target === relationGraphDialog) relationGraphDialog.close();
});
graphPipelineTab.addEventListener("click", () => { graphMode = "pipeline"; renderRelationGraph(); });
graphSelectedTab.addEventListener("click", () => { graphMode = "selected"; renderRelationGraph(); });
graphPredicateFilter.addEventListener("change", renderRelationGraph);
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
    rememberTablePose();
    presets = scene.presets;
    savedPipelines = readSavedPipelines();
    activePresetId = scene.defaultPresetId;
    const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];
    pipelineInput.value = activePreset?.pipeline ?? "sort(volume >) | slice(1)";
    workbench.setObjects(objects);
    renderPresets();
    renderPipelineEditor();
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

async function executeReasoning(pipeline: string, fromMovement = false): Promise<boolean> {
  if (!objects.length || !pipeline.trim()) return false;
  const sequence = ++requestSequence;
  activeRequest?.abort();
  cancelRelationLookup();
  const controller = new AbortController();
  activeRequest = controller;
  setReasoningState("running", fromMovement ? "Updating after geometry change" : "Evaluating pipeline");
  runButton.disabled = true;
  runButton.classList.add("is-running");
  try {
    const raw = await reason(canonicalSceneInputs(objects, initialObjects), pipeline.trim(), settings, null, controller.signal);
    if (sequence !== requestSequence) return false;
    const response = normalizeReasonResponse(raw, objects);
    lastResponse = response;
    queryRelations = response.relations;
    currentProof = pipelineProofRelations(response);
    graphSelectedLoadedId = null;
    selectedRelationWarnings = [];
    objects = response.objects;
    workbench.updateReasoningData(objects);
    workbench.setSelected(selectedId);
    workbench.setReasoning(response.resultIds, currentProof.relations);
    setReasoningState(response.success ? "ready" : "error", response.success ? `${response.resultIds.length} result${response.resultIds.length === 1 ? "" : "s"}` : "Pipeline error");
    renderResult();
    renderInspector();
    renderTrace(response.trace, response.timingMs);
    renderRelationGraphIfOpen();
    if (fromMovement) showToast(`Relations refreshed in ${formatNumber(response.timingMs, 1)} ms`);
    if (selectedId) void loadSelectedRelations(selectedId);
    return response.success;
  } catch (error) {
    if (controller.signal.aborted) return false;
    if (sequence !== requestSequence) return false;
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 429) {
      setReasoningState("pending", "Engine busy · retry shortly");
    } else if (status === 504) {
      setReasoningState("error", "Reasoning timed out");
    } else if (status === 413) {
      setReasoningState("error", "Scene request too large");
    } else if (status === 503) {
      setBackendState("offline", "Worker unavailable");
      setReasoningState("error", "Worker unavailable");
    } else {
      if (!status) setBackendState("offline", "Engine unavailable");
      setReasoningState("error", "Reasoning rejected");
    }
    showToast(errorMessage(error), true);
    return false;
  } finally {
    if (sequence === requestSequence) {
      runButton.disabled = false;
      runButton.classList.remove("is-running");
    }
  }
}

function renderPresets(): void {
  presetTray.innerHTML = [...presets, ...savedPipelines]
    .map(
      (preset, index) => `
        <span class="preset-entry" role="listitem"><button class="preset-chip ${preset.id === activePresetId ? "active" : ""}" data-preset-id="${escapeHtml(preset.id)}" type="button" title="${escapeHtml(preset.description)}">
          <span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(preset.shortLabel)}
        </button>${preset.id.startsWith("saved:") ? `<button type="button" class="preset-delete" data-delete-preset="${escapeHtml(preset.id)}" aria-label="Delete ${escapeHtml(preset.label)}">×</button>` : ""}</span>`,
    )
    .join("");
  for (const button of presetTray.querySelectorAll<HTMLButtonElement>("[data-preset-id]")) {
    button.addEventListener("click", () => {
      const preset = [...presets, ...savedPipelines].find((item) => item.id === button.dataset.presetId);
      if (!preset) return;
      activePresetId = preset.id;
      graphMode = "pipeline";
      pipelineInput.value = preset.pipeline;
      renderPresets();
      renderPipelineEditor();
      void executeReasoning(preset.pipeline);
    });
  }
  for (const button of presetTray.querySelectorAll<HTMLButtonElement>("[data-delete-preset]")) {
    button.addEventListener("click", () => {
      savedPipelines = savedPipelines.filter((preset) => preset.id !== button.dataset.deletePreset);
      persistSavedPipelines();
      if (activePresetId === button.dataset.deletePreset) activePresetId = "";
      renderPresets();
    });
  }
}

function renderPipelineEditor(): void {
  const stages = parsePipeline(pipelineInput.value);
  if (!stages) {
    stageList.innerHTML = `<p class="stage-warning">This pipeline cannot be split into stages. Use operation(argument) blocks separated by |.</p>`;
    editorStatus.textContent = "Formal syntax is checked again by the server when you run it.";
    return;
  }
  stageList.innerHTML = stages.length
    ? stages.map((stage, index) => `<div class="stage-row" data-stage-index="${index}">
        <span class="stage-number">${String(index + 1).padStart(2, "0")}</span>
        <select data-stage-kind aria-label="Stage ${index + 1} operation">${Object.keys(STAGE_DEFAULTS).map((kind) => `<option value="${kind}" ${kind === stage.kind ? "selected" : ""}>${kind}</option>`).join("")}</select>
        <input data-stage-argument value="${escapeHtml(stage.argument)}" aria-label="Stage ${index + 1} argument" spellcheck="false" />
        <button type="button" data-stage-action="up" aria-label="Move stage ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-stage-action="down" aria-label="Move stage ${index + 1} down" ${index === stages.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-stage-action="remove" aria-label="Remove stage ${index + 1}">×</button>
      </div>`).join("")
    : `<p class="stage-warning">No stages yet. Add one below.</p>`;
  editorStatus.textContent = `${stages.length}/12 stages · ${pipelineInput.value.length}/800 characters`;
}

function updatePipelineFromStages(): void {
  const stages: PipelineStage[] = [...stageList.querySelectorAll<HTMLElement>("[data-stage-index]")].map((row) => ({
    kind: row.querySelector<HTMLSelectElement>("[data-stage-kind]")!.value as StageKind,
    argument: row.querySelector<HTMLInputElement>("[data-stage-argument]")!.value,
  }));
  pipelineInput.value = serializePipeline(stages);
  markPipelineEdited();
  editorStatus.textContent = `${stages.length}/12 stages · ${pipelineInput.value.length}/800 characters`;
}

function setEditedPipeline(stages: PipelineStage[]): void {
  pipelineInput.value = serializePipeline(stages);
  markPipelineEdited();
  renderPipelineEditor();
}

function markPipelineEdited(): void {
  ++requestSequence;
  activeRequest?.abort();
  cancelRelationLookup();
  activePresetId = "";
  graphMode = "pipeline";
  lastResponse = null;
  queryRelations = [];
  currentProof = { relations: [], referenceIds: [], operation: null };
  graphSelectedLoadedId = null;
  selectedRelationWarnings = [];
  workbench.setReasoning([], []);
  setReasoningState("pending", "Pipeline edited · run to evaluate");
  runButton.disabled = false;
  runButton.classList.remove("is-running");
  renderResult();
  renderInspector();
  renderRelationGraphIfOpen();
  traceSummary.textContent = "Run the edited pipeline";
  traceBody.replaceChildren();
  renderPresets();
}

const SAVED_PIPELINES_KEY = "spatial-workbench-pipelines-v1";

function readSavedPipelines(): Preset[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SAVED_PIPELINES_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is { id: string; label: string; pipeline: string } =>
      item !== null && typeof item === "object" &&
      typeof item.id === "string" && item.id.startsWith("saved:") &&
      typeof item.label === "string" && item.label.length > 0 && item.label.length <= 60 &&
      typeof item.pipeline === "string" && item.pipeline.length <= 800 && parsePipeline(item.pipeline) !== null,
    ).slice(0, 20).map((item) => ({
      id: item.id,
      label: item.label,
      shortLabel: item.label,
      description: "Browser-saved research pipeline",
      pipeline: item.pipeline,
      focusPredicate: "",
    }));
  } catch {
    return [];
  }
}

function persistSavedPipelines(): boolean {
  try {
    localStorage.setItem(SAVED_PIPELINES_KEY, JSON.stringify(savedPipelines));
    return true;
  } catch {
    showToast("Browser storage is unavailable; this pipeline cannot be saved here.", true);
    return false;
  }
}

async function savePipeline(): Promise<void> {
  const label = pipelineName.value.trim();
  if (!label) { editorStatus.textContent = "Enter a name before saving."; pipelineName.focus(); return; }
  const pipeline = pipelineInput.value.trim();
  if (!parsePipeline(pipeline)?.length || pipeline.length > 800) {
    editorStatus.textContent = "Use 1–12 formal stages and at most 800 characters.";
    return;
  }
  const saveButton = element<HTMLButtonElement>("savePipelineButton");
  saveButton.disabled = true;
  const valid = await executeReasoning(pipeline);
  saveButton.disabled = false;
  if (!valid) { editorStatus.textContent = "Not saved: the server rejected this pipeline."; return; }
  const preset: Preset = {
    id: `saved:${crypto.randomUUID()}`,
    label,
    shortLabel: label,
    description: "Browser-saved research pipeline",
    pipeline,
    focusPredicate: "",
  };
  const previous = savedPipelines;
  savedPipelines = [...savedPipelines, preset].slice(-20);
  if (!persistSavedPipelines()) { savedPipelines = previous; return; }
  activePresetId = preset.id;
  renderPresets();
  renderResult();
  editorStatus.textContent = `Saved “${label}” in this browser.`;
  pipelineName.value = "";
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
        <p>Select an object to inspect its measured box and SRpy relations. Use Explore flat to walk the observer through the rooms.</p>
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
    : `<div class="yaw-control">
        <label for="yawSlider"><span><b>Rotation · Y axis</b><output id="yawOutput">${formatNumber(yaw, 0)}°</output></span></label>
        <input id="yawSlider" type="range" min="0" max="359" step="1" value="${yaw}" aria-label="Rotation around the vertical Y axis in degrees" />
        <div class="yaw-steps" role="group" aria-label="Y-axis rotation steps">
          <button type="button" data-yaw-step="90" aria-label="Rotate 90 degrees left around Y">↶ 90°</button>
          <button type="button" data-yaw-step="-90" aria-label="Rotate 90 degrees right around Y">↷ 90°</button>
          <button type="button" data-yaw-step="180" aria-label="Rotate 180 degrees around Y">180°</button>
        </div>
      </div>`;

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
    ${selected.id === "observer" ? `<div class="walk-note">Walk with W / A / S / D or arrow keys; hold Shift for a longer step. Turn with Q / E, or drag the observer.</div>` : ""}
    <div class="relation-section-head">
      <div><div class="eyebrow">Detected relations</div><h3>${visibleRelations.length} involving this object</h3></div>
      <span class="relation-source">SRpy</span>
    </div>
    ${selectedRelationWarnings.length ? `<p class="relation-warning">SRpy omitted similarity predicates for ${selectedRelationWarnings.length} object pair${selectedRelationWarnings.length === 1 ? "" : "s"} because its same-perimeter predicate is unavailable. Other relation categories remain.</p>` : ""}
    <div class="relation-list">
      ${
        visibleRelations.length
          ? visibleRelations.map(renderRelation).join("")
          : `<div class="empty-relations">Run a query to populate this object's proof relations.</div>`
      }
    </div>
    <div class="authority-note"><span>OBB</span><p><strong>Method boundary</strong><br />Tabletop overlaps are user-managed. Walls and floor furnishings constrain the observer; predicates are not path-safety guarantees.</p></div>`;

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
  for (const button of inspector.querySelectorAll<HTMLButtonElement>("[data-yaw-step]")) {
    button.addEventListener("click", () => workbench.rotateSelected(Number(button.dataset.yawStep) * Math.PI / 180));
  }
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

function renderRelationGraphIfOpen(): void {
  if (relationGraphDialog.open) renderRelationGraph();
}

function renderRelationGraph(): void {
  graphPipelineTab.setAttribute("aria-selected", String(graphMode === "pipeline"));
  graphSelectedTab.setAttribute("aria-selected", String(graphMode === "selected"));
  graphPredicateFilter.parentElement?.classList.toggle("is-hidden", graphMode !== "selected");

  let ids: string[] = [];
  let edges: { relation: SpatialRelationData; detail: string }[] = [];
  let listHeading = "";
  let listNote = "";
  let emptyMessage = "";

  if (graphMode === "pipeline") {
    ids = lastResponse ? [...currentProof.referenceIds, ...lastResponse.resultIds] : [];
    edges = currentProof.relations.map((relation) => ({ relation, detail: relation.description }));
    graphSummary.textContent = lastResponse ? `${lastResponse.resultIds.length} retained · ${edges.length} proof links` : "No query yet";
    listHeading = currentProof.operation ? `Proofs · ${currentProof.operation}` : "Pipeline result";
    listNote = `Only relations that justify retained objects are drawn. Selection does not add unrelated links here.${lastResponse?.relationWarnings?.length ? ` SRpy omitted similarity predicates for ${lastResponse.relationWarnings.length} affected pair${lastResponse.relationWarnings.length === 1 ? "" : "s"}.` : ""}`;
    emptyMessage = !lastResponse
      ? "Run a pipeline to build its proof graph."
      : lastResponse.resultIds.length === 0
        ? "No objects satisfy this pipeline in the current geometry."
        : "This result has no pairwise predicate proof in the available relation scope (for example, a scalar sort-and-slice result).";
  } else if (!selectedId || !lastResponse) {
    graphSummary.textContent = "Select an object";
    listHeading = "Selected-object graph";
    listNote = "Choose an object in the 3D scene or in the pipeline proof graph.";
    emptyMessage = "Select an object after running a pipeline to inspect its relation network.";
  } else {
    ids = [selectedId];
    const loaded = graphSelectedLoadedId === selectedId;
    const selectedRelations = loaded
      ? lastResponse.relations.filter((relation) => relation.subjectId === selectedId || relation.objectId === selectedId)
      : [];
    const predicates = graphPredicateOptions(selectedRelations, selectedId);
    const previousFilter = graphPredicateFilter.value;
    graphPredicateFilter.innerHTML = `<option value="all">All predicates</option>${predicates.map((predicate) => `<option value="${escapeHtml(predicate)}">${escapeHtml(predicate)}</option>`).join("")}`;
    graphPredicateFilter.value = predicates.includes(previousFilter) ? previousFilter : "all";
    const allPeers = selectedObjectGraphEdges(selectedRelations, selectedId);
    const selectedEdges = selectedObjectGraphEdges(selectedRelations, selectedId, graphPredicateFilter.value);
    ids.push(...selectedEdges.map((edge) => edge.peerId));
    edges = selectedEdges.map((edge) => ({ relation: edge.relation, detail: `${edge.relationCount} predicates: ${edge.predicates.join(", ")}` }));
    graphSummary.textContent = loaded
      ? `${selectedEdges.length} / ${allPeers.length} peers · ${selectedRelations.length} relations`
      : "Loading complete relation set";
    listHeading = `${objectById(selectedId)?.label ?? selectedId} · relation network`;
    listNote = `One edge per peer; use the predicate filter to inspect different relation types. The object inspector retains every returned predicate.${selectedRelationWarnings.length ? ` SRpy omitted similarity predicates for ${selectedRelationWarnings.length} affected pair${selectedRelationWarnings.length === 1 ? "" : "s"}.` : ""}`;
    emptyMessage = loaded ? "No relation matches this predicate filter." : "Loading this object's complete relation set from SRpy…";
  }

  const nodeIds = [...new Set(ids)];
  const points = layoutGraphNodes(objects, nodeIds);
  const markers = `<defs>
    <marker id="graphArrowDirection" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="#5489ce" /></marker>
    <marker id="graphArrowContact" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="#bd872e" /></marker>
    <marker id="graphArrowProximity" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="#4b9b75" /></marker>
    <marker id="graphArrowOther" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="#9aa8ad" /></marker>
  </defs>`;
  const lines = edges.map(({ relation, detail }) => {
    const subject = points.get(relation.subjectId);
    const object = points.get(relation.objectId);
    if (!subject || !object) return "";
    const from = graphNodeBoundary(subject, object);
    const to = graphNodeBoundary(object, subject);
    const kind = graphEdgeKind(relation.predicate);
    const marker = kind[0].toUpperCase() + kind.slice(1);
    const title = `${relationLabel(relation)}${detail ? ` · ${detail}` : ""}`;
    const label = graphMode === "pipeline"
      ? `<text class="graph-edge-label" x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 6}">${escapeHtml(relation.predicate)}</text>`
      : "";
    return `<g><title>${escapeHtml(title)}</title><line class="graph-edge ${kind}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#graphArrow${marker})" />${label}</g>`;
  }).join("");
  const nodes = nodeIds.map((id) => {
    const point = points.get(id);
    const object = objectById(id);
    if (!point || !object) return "";
    const classes = ["graph-node"];
    if (lastResponse?.resultIds.includes(id)) classes.push("is-result");
    if (currentProof.referenceIds.includes(id)) classes.push("is-reference");
    if (id === selectedId) classes.push("is-selected");
    const name = object.label || id;
    const shortName = name.length > 17 ? `${name.slice(0, 16)}…` : name;
    return `<g class="${classes.join(" ")}" data-graph-id="${escapeHtml(id)}" transform="translate(${point.x} ${point.y})" role="button" tabindex="0" aria-label="Inspect ${escapeHtml(name)}"><title>${escapeHtml(name)} · ${escapeHtml(id)}</title><rect x="-53" y="-16" width="106" height="32" rx="5" /><text>${escapeHtml(shortName)}</text></g>`;
  }).join("");
  relationGraphSvg.setAttribute("aria-label", graphMode === "pipeline" ? "Pipeline proof graph" : "Selected-object relation graph");
  relationGraphSvg.innerHTML = `${markers}${lines}${nodes}${nodeIds.length ? "" : `<text x="500" y="300" text-anchor="middle" fill="#69787d" font-size="18">${escapeHtml(emptyMessage)}</text>`}`;

  relationGraphList.innerHTML = `<h3>${escapeHtml(listHeading)}</h3><p>${escapeHtml(listNote)}</p>${edges.length
    ? edges.map(({ relation, detail }) => `<button type="button" data-graph-id="${escapeHtml(relation.subjectId)}" title="${escapeHtml(detail)}"><strong>${escapeHtml(objectById(relation.subjectId)?.label ?? relation.subjectId)}</strong><em>${escapeHtml(relation.predicate)} →</em><strong>${escapeHtml(objectById(relation.objectId)?.label ?? relation.objectId)}</strong>${graphMode === "selected" ? `<small>${escapeHtml(detail)}</small>` : ""}</button>`).join("")
    : `<div class="graph-empty">${escapeHtml(emptyMessage)}</div>`}`;
  for (const node of relationGraphSvg.querySelectorAll<SVGGElement>("[data-graph-id]")) {
    node.addEventListener("click", () => selectGraphObject(node.dataset.graphId));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectGraphObject(node.dataset.graphId); }
    });
  }
  for (const button of relationGraphList.querySelectorAll<HTMLButtonElement>("[data-graph-id]")) {
    button.addEventListener("click", () => selectGraphObject(button.dataset.graphId));
  }
}

function selectGraphObject(id: string | undefined): void {
  if (!id) return;
  graphMode = "selected";
  handleSelection(id);
}

function graphNodeBoundary(from: GraphPoint, to: GraphPoint): GraphPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scale = Math.min(53 / Math.max(Math.abs(dx), 0.001), 16 / Math.max(Math.abs(dy), 0.001));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function graphEdgeKind(predicate: string): "direction" | "contact" | "proximity" | "other" {
  if (["inside", "containing", "touching", "overlapping", "meeting", "on", "in", "by"].includes(predicate)) return "contact";
  if (["near", "tangible"].includes(predicate)) return "proximity";
  if (["left", "right", "above", "below", "ahead", "behind", "seen left", "seen right", "in front", "at rear"].includes(predicate)) return "direction";
  return "other";
}

function relationLabel(relation: SpatialRelationData): string {
  return `${objectById(relation.subjectId)?.label ?? relation.subjectId} ${relation.predicate} ${objectById(relation.objectId)?.label ?? relation.objectId}`;
}

function handleSelection(id: string | null): void {
  cancelRelationLookup();
  selectedId = id;
  graphPredicateFilter.value = "all";
  workbench.setSelected(id);
  if (lastResponse) lastResponse = { ...lastResponse, relations: queryRelations };
  graphSelectedLoadedId = null;
  selectedRelationWarnings = [];
  renderInspector();
  renderRelationGraphIfOpen();
  if (id && lastResponse) void loadSelectedRelations(id);
}

function cancelRelationLookup(): void {
  relationRequest?.abort();
  relationRequest = null;
  ++relationRequestSequence;
}

async function loadSelectedRelations(id: string): Promise<void> {
  const controller = new AbortController();
  relationRequest = controller;
  const sequence = ++relationRequestSequence;
  const reasoningSequence = requestSequence;
  try {
    const response = await relationsForObject(canonicalSceneInputs(objects, initialObjects), id, settings, controller.signal);
    if (controller.signal.aborted || sequence !== relationRequestSequence || reasoningSequence !== requestSequence || selectedId !== id || !lastResponse) return;
    // Keep this view independent from the active query's limited relation scope.
    lastResponse = { ...lastResponse, relations: response.relations };
    selectedRelationWarnings = response.relationWarnings ?? [];
    graphSelectedLoadedId = id;
    renderInspector();
    renderRelationGraphIfOpen();
  } catch (error) {
    if (!controller.signal.aborted) showToast(`Could not load selected-object relations: ${errorMessage(error)}`, true);
  } finally {
    if (relationRequest === controller) relationRequest = null;
  }
}

function handleObjectChange(changed: SpatialObjectData): void {
  const changedObjects = changed.id === "table" && committedTable
    ? [changed, ...carriedTabletopObjects(objects, committedTable, changed)]
    : [changed];
  const changedById = new Map(changedObjects.map((object) => [object.id, object]));
  objects = objects.map((object) => changedById.get(object.id) ?? object);
  if (changed.id === "table") rememberTablePose();
  selectedId = changed.id;
  workbench.updateObjects(changedObjects);
  workbench.setSelected(selectedId);
  if (lastResponse) workbench.setReasoning(lastResponse.resultIds, currentProof.relations);
  renderInspector();
  renderRelationGraphIfOpen();
  scheduleReasoning("Measurement changed");
}

function scheduleReasoning(label: string): void {
  cancelRelationLookup();
  graphSelectedLoadedId = null;
  selectedRelationWarnings = [];
  renderRelationGraphIfOpen();
  setReasoningState("pending", label);
  window.clearTimeout(reasonDebounce);
  reasonDebounce = window.setTimeout(() => void executeReasoning(pipelineInput.value, true), 180);
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
  if (!workbench.canPlace(changed)) { renderInspector(); return; }
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
  cancelRelationLookup();
  objects = cloneObjects(initialObjects);
  rememberTablePose();
  selectedId = null;
  lastResponse = null;
  queryRelations = [];
  currentProof = { relations: [], referenceIds: [], operation: null };
  graphSelectedLoadedId = null;
  selectedRelationWarnings = [];
  workbench.setObjects(objects);
  workbench.setSelected(null);
  workbench.resetView();
  showToast("Scene reset to its measured baseline");
  renderInspector();
  renderRelationGraphIfOpen();
  void executeReasoning(pipelineInput.value);
}

function activePreset(): Preset | undefined {
  return [...presets, ...savedPipelines].find((preset) => preset.id === activePresetId && preset.pipeline === pipelineInput.value);
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

function rememberTablePose(): void {
  const table = objects.find((object) => object.id === "table");
  committedTable = table ? { ...table, position: [...table.position] } : null;
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

function element<T extends Element>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing required element #${id}`);
  return found as unknown as T;
}
