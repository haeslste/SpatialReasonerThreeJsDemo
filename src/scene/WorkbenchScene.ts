import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type { SpatialObjectData, SpatialRelationData } from "../types";

type ObjectChangeHandler = (object: SpatialObjectData) => void;
type SelectionHandler = (id: string | null) => void;

const CYAN = 0x43d3df;
const BLUE = 0x73a9ff;
const GREEN = 0x70c8a1;
const AMBER = 0xe4ad52;
const SLATE = 0x222b35;

const DIRECTIONAL = new Set([
  "left",
  "right",
  "above",
  "below",
  "ahead",
  "behind",
  "seen left",
  "seen right",
  "in front",
  "at rear",
]);
const CONTACT = new Set(["inside", "containing", "touching", "overlapping", "meeting", "on", "in", "by"]);

export class WorkbenchScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly dragPlane = new THREE.Plane();
  private readonly dragOffset = new THREE.Vector3();
  private readonly objectRoots = new Map<string, THREE.Group>();
  private readonly objects = new Map<string, SpatialObjectData>();
  private readonly overlays = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private selectedId: string | null = null;
  private resultIds = new Set<string>();
  private activeRelations: SpatialRelationData[] = [];
  private focusPredicate = "";
  private showBoundingBoxes = false;
  private showNearField = true;
  private draggingId: string | null = null;
  private dragMoved = false;

  constructor(
    private readonly mount: HTMLElement,
    private readonly onSelection: SelectionHandler,
    private readonly onObjectChange: ObjectChangeHandler,
  ) {
    this.scene.background = new THREE.Color(SLATE);
    this.scene.fog = new THREE.Fog(0x222b35, 9, 18);
    this.camera.position.set(4.25, 3.45, 5.4);
    this.camera.lookAt(0, 0.55, -0.35);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "webgl-canvas";
    this.mount.append(this.renderer.domElement);

    this.labelRenderer.domElement.className = "label-layer";
    this.labelRenderer.domElement.setAttribute("aria-hidden", "true");
    this.mount.append(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.target.set(0, 0.62, -0.35);
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

    this.overlays.name = "reasoning-overlays";
    this.scene.add(this.overlays);
    this.addLighting();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.handlePointerUp);
    this.renderer.domElement.addEventListener("dblclick", this.handleDoubleClick);
    window.addEventListener("keydown", this.handleKeyDown);
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.handleKeyDown);
    this.renderer.dispose();
    this.mount.replaceChildren();
  }

  setObjects(objects: SpatialObjectData[]): void {
    for (const root of this.objectRoots.values()) {
      this.disposeTree(root);
      root.removeFromParent();
    }
    this.objectRoots.clear();
    this.objects.clear();

    for (const object of objects) {
      this.objects.set(object.id, object);
      const root = this.createObject(object);
      root.name = object.id;
      root.userData.objectId = object.id;
      root.position.set(-object.position[0], object.position[1], object.position[2]);
      root.rotation.y = object.angle;
      root.traverse((child) => {
        child.userData.objectId = object.id;
      });
      this.objectRoots.set(object.id, root);
      this.scene.add(root);
    }
    if (this.selectedId && !this.objects.has(this.selectedId)) this.selectedId = null;
    this.refreshVisualState();
  }

  setReasoning(resultIds: string[], relations: SpatialRelationData[], focusPredicate: string): void {
    this.resultIds = new Set(resultIds);
    this.activeRelations = relations;
    this.focusPredicate = focusPredicate;
    this.refreshVisualState();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.refreshVisualState();
  }

  setShowBoundingBoxes(show: boolean): void {
    this.showBoundingBoxes = show;
    this.refreshVisualState();
  }

  setShowNearField(show: boolean): void {
    this.showNearField = show;
    this.refreshVisualState();
  }

  rotateSelected(deltaRadians: number): void {
    if (!this.selectedId) return;
    const object = this.objects.get(this.selectedId);
    const root = this.objectRoots.get(this.selectedId);
    if (!object || !root || object.immobile) return;
    object.angle = normalizeAngle(object.angle + deltaRadians);
    object.yaw = (object.angle * 180) / Math.PI;
    root.rotation.y = object.angle;
    this.onObjectChange({ ...object, position: [...object.position] as [number, number, number] });
    this.refreshVisualState();
  }

  setSelectedAngle(angle: number): void {
    if (!this.selectedId) return;
    const object = this.objects.get(this.selectedId);
    const root = this.objectRoots.get(this.selectedId);
    if (!object || !root || object.immobile) return;
    object.angle = normalizeAngle(angle);
    object.yaw = (object.angle * 180) / Math.PI;
    root.rotation.y = object.angle;
    this.onObjectChange({ ...object, position: [...object.position] as [number, number, number] });
    this.refreshVisualState();
  }

  focusRelation(relation: SpatialRelationData): void {
    this.selectedId = relation.subjectId;
    this.resultIds = new Set([relation.subjectId, relation.objectId]);
    this.activeRelations = [relation];
    this.focusPredicate = relation.predicate;
    this.refreshVisualState();
    const subject = this.objectRoots.get(relation.subjectId);
    const object = this.objectRoots.get(relation.objectId);
    if (subject && object) {
      const target = subject.position.clone().add(object.position).multiplyScalar(0.5);
      target.y += 0.35;
      this.controls.target.lerp(target, 0.7);
    }
    this.onSelection(relation.subjectId);
  }

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xeaf4f2, 0x29323c, 2.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1dc, 3.6);
    key.position.set(2.5, 6.5, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88bac8, 1.2);
    fill.position.set(-4, 3, -3);
    this.scene.add(fill);
  }

  private createObject(object: SpatialObjectData): THREE.Group {
    const root = new THREE.Group();
    const color = new THREE.Color(object.color ?? "#8a99a8");
    switch (object.visualKind) {
      case "table":
        this.makeTable(root, object, color);
        break;
      case "laptop":
        this.makeLaptop(root, object, color);
        break;
      case "mug":
        this.makeMug(root, object, color);
        break;
      case "book":
        this.makeBook(root, object, color);
        break;
      case "lamp":
        this.makeLamp(root, object, color);
        break;
      case "bin":
        this.makeBin(root, object, color);
        break;
      case "package":
        this.makePackage(root, object, color);
        break;
      case "observer":
        this.makeObserver(root, object, color);
        break;
      case "floor":
        this.makeBox(root, object.width, object.height, object.depth, color, object.height / 2, 0.45);
        break;
      case "wall":
        this.makeBox(root, object.width, object.height, object.depth, color, object.height / 2, 0.22);
        break;
      default:
        this.makeBox(root, object.width, object.height, object.depth, color, object.height / 2);
    }
    if (!new Set(["floor", "wall"]).has(object.visualKind ?? "")) this.addLabel(root, object);
    return root;
  }

  private material(color: THREE.Color, opacity = 1, roughness = 0.62, metalness = 0.04): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent: opacity < 1, opacity });
    material.userData.baseOpacity = opacity;
    material.userData.baseColor = color.getHex();
    return material;
  }

  private addMesh(
    root: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    rotation?: [number, number, number],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  private makeBox(
    root: THREE.Group,
    width: number,
    height: number,
    depth: number,
    color: THREE.Color,
    y: number,
    opacity = 1,
  ): void {
    this.addMesh(root, new THREE.BoxGeometry(width, height, depth), this.material(color, opacity), [0, y, 0]);
  }

  private makeTable(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    const topHeight = 0.1;
    this.addMesh(
      root,
      new THREE.BoxGeometry(object.width, topHeight, object.depth),
      this.material(color, 1, 0.72),
      [0, object.height - topHeight / 2, 0],
    );
    const legMaterial = this.material(color.clone().multiplyScalar(0.68), 1, 0.82);
    const legHeight = object.height - topHeight;
    for (const x of [-object.width * 0.43, object.width * 0.43]) {
      for (const z of [-object.depth * 0.39, object.depth * 0.39]) {
        this.addMesh(root, new THREE.BoxGeometry(0.1, legHeight, 0.1), legMaterial, [x, legHeight / 2, z]);
      }
    }
  }

  private makeLaptop(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    this.addMesh(root, new THREE.BoxGeometry(object.width, 0.045, object.depth), this.material(color, 1, 0.4, 0.35), [0, 0.03, 0]);
    const screen = this.addMesh(
      root,
      new THREE.BoxGeometry(object.width * 0.96, object.height * 0.88, 0.035),
      this.material(color.clone().multiplyScalar(0.76), 1, 0.3, 0.38),
      [0, object.height * 0.49, -object.depth * 0.43],
      [-0.12, 0, 0],
    );
    const display = this.addMesh(
      root,
      new THREE.PlaneGeometry(object.width * 0.84, object.height * 0.72),
      new THREE.MeshBasicMaterial({ color: 0x203541 }),
      [0, object.height * 0.5, -object.depth * 0.448],
      [-0.12, Math.PI, 0],
    );
    display.position.y = screen.position.y;
  }

  private makeMug(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    const radius = Math.min(object.width, object.depth) * 0.37;
    this.addMesh(
      root,
      new THREE.CylinderGeometry(radius, radius * 0.92, object.height, 28, 1, true),
      this.material(color, 1, 0.48),
      [0, object.height / 2, 0],
    );
    this.addMesh(
      root,
      new THREE.CylinderGeometry(radius * 0.93, radius * 0.93, 0.025, 28),
      this.material(color.clone().multiplyScalar(0.8)),
      [0, 0.018, 0],
    );
    this.addMesh(
      root,
      new THREE.TorusGeometry(radius * 0.78, 0.032, 12, 24, Math.PI * 1.7),
      this.material(color),
      [radius * 1.18, object.height * 0.55, 0],
      [0, Math.PI / 2, 0.2],
    );
  }

  private makeBook(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    this.makeBox(root, object.width, object.height, object.depth, color, object.height / 2);
    this.addMesh(
      root,
      new THREE.BoxGeometry(object.width * 0.03, object.height * 1.03, object.depth * 0.98),
      this.material(color.clone().multiplyScalar(0.7)),
      [-object.width * 0.46, object.height / 2, 0],
    );
  }

  private makeLamp(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    const dark = this.material(color.clone().multiplyScalar(0.62), 1, 0.38, 0.36);
    this.addMesh(root, new THREE.CylinderGeometry(0.22, 0.24, 0.055, 28), dark, [0, 0.028, 0]);
    this.addMesh(root, new THREE.CylinderGeometry(0.028, 0.035, object.height * 0.62, 16), dark, [0, object.height * 0.33, 0]);
    this.addMesh(
      root,
      new THREE.CylinderGeometry(0.025, 0.025, object.height * 0.43, 12),
      dark,
      [0, object.height * 0.72, -0.1],
      [Math.PI / 5, 0, 0],
    );
    this.addMesh(
      root,
      new THREE.ConeGeometry(0.19, 0.28, 28, 1, true),
      this.material(color, 1, 0.48, 0.18),
      [0, object.height * 0.94, -0.2],
      [Math.PI / 2.7, 0, 0],
    );
  }

  private makeBin(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    const material = this.material(color, 0.82, 0.72);
    const wall = 0.045;
    this.addMesh(root, new THREE.BoxGeometry(object.width, wall, object.depth), material, [0, wall / 2, 0]);
    this.addMesh(root, new THREE.BoxGeometry(wall, object.height, object.depth), material, [-object.width / 2 + wall / 2, object.height / 2, 0]);
    this.addMesh(root, new THREE.BoxGeometry(wall, object.height, object.depth), material, [object.width / 2 - wall / 2, object.height / 2, 0]);
    this.addMesh(root, new THREE.BoxGeometry(object.width, object.height, wall), material, [0, object.height / 2, -object.depth / 2 + wall / 2]);
    this.addMesh(root, new THREE.BoxGeometry(object.width, object.height, wall), material, [0, object.height / 2, object.depth / 2 - wall / 2]);
  }

  private makePackage(root: THREE.Group, object: SpatialObjectData, color: THREE.Color): void {
    this.makeBox(root, object.width, object.height, object.depth, color, object.height / 2);
    const tape = this.material(new THREE.Color(0xefe1c2), 1, 0.8);
    this.addMesh(root, new THREE.BoxGeometry(object.width * 0.16, object.height * 1.01, object.depth * 1.01), tape, [0, object.height / 2, 0]);
  }

  private makeObserver(root: THREE.Group, _object: SpatialObjectData, color: THREE.Color): void {
    const body = this.material(color, 1, 0.46, 0.24);
    const dark = this.material(new THREE.Color(0x26313a), 1, 0.4, 0.36);
    this.addMesh(root, new THREE.CylinderGeometry(0.17, 0.21, 0.78, 24), body, [0, 0.62, 0]);
    this.addMesh(root, new THREE.SphereGeometry(0.19, 24, 16), body, [0, 1.19, 0]);
    this.addMesh(root, new THREE.BoxGeometry(0.23, 0.055, 0.035), dark, [0, 1.2, 0.175]);
    this.addMesh(root, new THREE.CylinderGeometry(0.19, 0.19, 0.055, 24), dark, [0, 0.03, 0]);
  }

  private addLabel(root: THREE.Group, object: SpatialObjectData): void {
    const element = document.createElement("div");
    element.className = `object-label ${object.id === "observer" ? "observer-label" : ""}`;
    element.textContent = object.label || object.id;
    const label = new CSS2DObject(element);
    label.position.set(0, object.height + 0.12, 0);
    root.add(label);
  }

  private refreshVisualState(): void {
    this.clearOverlays();
    const hasResults = this.resultIds.size > 0;
    for (const [id, root] of this.objectRoots) {
      const isResult = this.resultIds.has(id);
      const isSelected = id === this.selectedId;
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const base of materials) {
          if (!(base instanceof THREE.MeshStandardMaterial)) continue;
          const material = base;
          const baseOpacity = Number(material.userData.baseOpacity ?? 1);
          material.transparent = hasResults && !isResult ? true : baseOpacity < 1;
          material.opacity = hasResults && !isResult && !isSelected ? Math.min(baseOpacity, 0.12) : baseOpacity;
          material.emissive.setHex(isResult ? CYAN : isSelected ? AMBER : 0x000000);
          material.emissiveIntensity = isResult ? 0.72 : isSelected ? 0.22 : 0;
          material.depthWrite = material.opacity > 0.5;
        }
      });
      for (const label of root.children.filter((child) => child instanceof CSS2DObject) as CSS2DObject[]) {
        label.element.classList.toggle("is-result", isResult);
        label.element.classList.toggle("is-dimmed", hasResults && !isResult && !isSelected);
        label.element.classList.toggle("is-selected", isSelected);
      }
      if (this.showBoundingBoxes && !isResult && !isSelected) this.addBoxOverlay(id, 0xb6c0c5, 0.18);
      if (isResult) {
        this.addResultVolume(id);
        this.addBoxOverlay(id, CYAN, 1);
      }
      if (isSelected) this.addBoxOverlay(id, AMBER, 1);
    }
    this.addObserverField();
    if (this.showNearField && this.selectedId) this.addNearField(this.selectedId);
    this.addRelationOverlays();
  }

  private addResultVolume(id: string): void {
    const object = this.objects.get(id);
    if (!object) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(object.width + 0.045, object.height + 0.045, object.depth + 0.045),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.105, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.name = "result-volume";
    mesh.position.set(-object.position[0], object.position[1] + object.height / 2, object.position[2]);
    mesh.rotation.y = object.angle;
    mesh.renderOrder = 3;
    this.overlays.add(mesh);
  }

  private addBoxOverlay(id: string, color: number, opacity: number): void {
    const object = this.objects.get(id);
    if (!object) return;
    const geometry = new THREE.BoxGeometry(object.width + 0.035, object.height + 0.035, object.depth + 0.035);
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    line.position.set(-object.position[0], object.position[1] + object.height / 2, object.position[2]);
    line.rotation.y = object.angle;
    line.renderOrder = 4;
    this.overlays.add(line);
  }

  private addObserverField(): void {
    const observer = this.objects.get("observer");
    if (!observer) return;
    const origin = this.worldCenter(observer);
    origin.y = observer.position[1] + 0.04;
    const radius = 1.7;
    const halfAngle = THREE.MathUtils.degToRad(33);
    const points: number[] = [origin.x, origin.y, origin.z];
    const segments = 32;
    for (let index = 0; index <= segments; index += 1) {
      const theta = -halfAngle + (index / segments) * halfAngle * 2;
      const localX = Math.sin(theta) * radius;
      const localZ = Math.cos(theta) * radius;
      const rotatedX = localX * Math.cos(observer.angle) + localZ * Math.sin(observer.angle);
      const rotatedZ = -localX * Math.sin(observer.angle) + localZ * Math.cos(observer.angle);
      points.push(origin.x + rotatedX, origin.y, origin.z + rotatedZ);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const wedge = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.105, side: THREE.DoubleSide, depthWrite: false }),
    );
    wedge.renderOrder = 1;
    this.overlays.add(wedge);

    const direction = new THREE.Vector3(Math.sin(observer.angle), 0, Math.cos(observer.angle)).normalize();
    const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(origin.x, 0.07, origin.z), 1.08, CYAN, 0.12, 0.07);
    this.overlays.add(arrow);
  }

  private addRelationOverlays(): void {
    const resultRelations = this.activeRelations
      .filter((relation) => this.resultIds.has(relation.subjectId) || this.resultIds.has(relation.objectId))
      .sort((a, b) => Number(this.relationMatchesFocus(b)) - Number(this.relationMatchesFocus(a)));
    const chosen: SpatialRelationData[] = [];
    for (const relation of resultRelations) {
      if (!this.relationMatchesFocus(relation) && chosen.length >= 3) continue;
      if (!DIRECTIONAL.has(relation.predicate) && relation.predicate !== "near" && !CONTACT.has(relation.predicate)) continue;
      if (chosen.some((item) => item.subjectId === relation.subjectId && item.objectId === relation.objectId && item.predicate === relation.predicate)) continue;
      chosen.push(relation);
      if (chosen.length >= 7) break;
    }

    for (const relation of chosen) {
      if (DIRECTIONAL.has(relation.predicate)) this.addDirectionalCurve(relation);
      if (relation.predicate === "near") this.addNearRing(relation);
      if (CONTACT.has(relation.predicate)) {
        this.addBoxOverlay(relation.subjectId, AMBER, 0.75);
        this.addBoxOverlay(relation.objectId, AMBER, 0.5);
      }
    }
  }

  private relationMatchesFocus(relation: SpatialRelationData): boolean {
    const normalized = this.focusPredicate.replace("seenleft", "seen left").replace("seenright", "seen right");
    if (!normalized) return false;
    if (normalized.includes("left") && relation.predicate.includes("left")) return true;
    if (normalized.includes("right") && relation.predicate.includes("right")) return true;
    return relation.predicate === normalized;
  }

  private addDirectionalCurve(relation: SpatialRelationData): void {
    const subject = this.objects.get(relation.subjectId);
    const object = this.objects.get(relation.objectId);
    if (!subject || !object) return;
    const start = this.worldCenter(subject);
    const end = this.worldCenter(object);
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    midpoint.y += Math.max(0.18, start.distanceTo(end) * 0.16);
    const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(28));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.9 }));
    this.overlays.add(line);
    const tangent = curve.getTangent(0.96).normalize();
    const arrow = new THREE.ArrowHelper(tangent, curve.getPoint(0.93), 0.18, BLUE, 0.1, 0.06);
    this.overlays.add(arrow);
  }

  private addNearRing(relation: SpatialRelationData): void {
    const reference = this.objects.get(relation.objectId);
    if (!reference) return;
    const radius = Math.max(0.1, Number(reference.nearbyRadius ?? relation.delta));
    this.addRadiusRing(reference, radius, 0.7);
  }

  private addNearField(id: string): void {
    const object = this.objects.get(id);
    const radius = Number(object?.nearbyRadius ?? 0);
    if (!object || !Number.isFinite(radius) || radius <= 0) return;
    this.addRadiusRing(object, radius, 0.9, true);
  }

  private addRadiusRing(object: SpatialObjectData, radius: number, opacity: number, fill = false): void {
    const geometry = new THREE.RingGeometry(radius - 0.012, radius + 0.012, 64);
    const material = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-object.position[0], object.position[1] + 0.014, object.position[2]);
    ring.renderOrder = 2;
    this.overlays.add(ring);
    if (fill) {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 64),
        new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.copy(ring.position);
      disc.renderOrder = 1;
      this.overlays.add(disc);
    }
  }

  private clearOverlays(): void {
    while (this.overlays.children.length) {
      const child = this.overlays.children.pop();
      if (!child) continue;
      this.disposeTree(child);
    }
  }

  private disposeTree(root: THREE.Object3D): void {
    root.traverse((child) => {
      if (child instanceof CSS2DObject) child.element.remove();
      if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments)) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material?.dispose();
    });
  }

  private worldCenter(object: SpatialObjectData): THREE.Vector3 {
    return new THREE.Vector3(-object.position[0], object.position[1] + object.height / 2, object.position[2]);
  }

  private updatePointer(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private hitObject(): string | null {
    const hits = this.raycaster.intersectObjects([...this.objectRoots.values()], true);
    for (const hit of hits) {
      const id = hit.object.userData.objectId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.updatePointer(event);
    const id = this.hitObject();
    if (!id) {
      this.selectedId = null;
      this.onSelection(null);
      this.refreshVisualState();
      return;
    }
    this.selectedId = id;
    this.onSelection(id);
    this.refreshVisualState();
    const object = this.objects.get(id);
    const root = this.objectRoots.get(id);
    if (!object || !root || object.immobile || event.shiftKey) return;
    this.draggingId = id;
    this.dragMoved = false;
    this.dragPlane.set(new THREE.Vector3(0, 1, 0), -object.position[1]);
    const intersection = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) this.dragOffset.copy(root.position).sub(intersection);
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.classList.add("is-dragging");
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.draggingId) return;
    this.updatePointer(event);
    const object = this.objects.get(this.draggingId);
    const root = this.objectRoots.get(this.draggingId);
    if (!object || !root) return;
    const intersection = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) return;
    const proposed = intersection.add(this.dragOffset);
    if (object.position[1] > 0.5) {
      proposed.x = THREE.MathUtils.clamp(proposed.x, -1.48, 1.48);
      proposed.z = THREE.MathUtils.clamp(proposed.z, -1.0, 0.48);
    } else {
      proposed.x = THREE.MathUtils.clamp(proposed.x, -2.9, 2.9);
      proposed.z = THREE.MathUtils.clamp(proposed.z, -2.15, 2.25);
    }
    root.position.x = proposed.x;
    root.position.z = proposed.z;
    object.position[0] = -proposed.x;
    object.position[2] = proposed.z;
    object.center = [-proposed.x, object.position[1] + object.height / 2, proposed.z];
    this.dragMoved = true;
    this.refreshVisualState();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.draggingId) return;
    const id = this.draggingId;
    this.draggingId = null;
    this.controls.enabled = true;
    this.renderer.domElement.classList.remove("is-dragging");
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (this.dragMoved) {
      const object = this.objects.get(id);
      if (object) this.onObjectChange({ ...object, position: [...object.position] as [number, number, number] });
    }
  };

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    this.updatePointer(event as PointerEvent);
    const id = this.hitObject();
    const object = id ? this.objects.get(id) : null;
    if (!object) return;
    this.controls.target.copy(this.worldCenter(object));
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea")) return;
    if (event.key.toLowerCase() === "q") this.rotateSelected(THREE.MathUtils.degToRad(15));
    if (event.key.toLowerCase() === "e") this.rotateSelected(THREE.MathUtils.degToRad(-15));
  };

  private resize(): void {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.labelRenderer.setSize(width, height);
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}
