# Spatial Reasoner Workbench

An interactive research demo of [spatial-reasoner (SRpy)](https://pypi.org/project/spatial-reasoner/), accompanying Häsler and Ackermann's *Spatial Reasoner: A 3D Inference Pipeline for XR Applications* ([DOI: 10.1109/ICVARS66454.2025.11198690](https://doi.org/10.1109/ICVARS66454.2025.11198690)). It turns measured, oriented bounding boxes into inspectable spatial relations and filtered results. It is a symbolic-reasoning demonstration, not a physics simulation or navigation-safety system.

## Explore the demo

The open-roof flat has a kitchen, living/dining area, study, bedroom, and bathroom. Bundled [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) models illustrate the measured boxes. Visitors can walk the observer through doorways, move and rotate furniture, adjust box dimensions and proximity settings, and run eight preset or custom reasoning pipelines. Results appear in the scene, object inspector, relation graph, and stage-by-stage trace.

- Click an object to inspect it. Drag movable furniture or tabletop objects; `Q`/`E` or the inspector controls rotate the selection around Y. Moving the study table carries its tabletop objects.
- Choose **Explore flat** to walk with `W/A/S/D` or the arrow keys; hold `Shift` for a longer step. The observer is blocked by walls and furnishings. Tabletop objects may overlap; resolving conflicts is the user's responsibility.
- Drag empty space to orbit, right-drag or Shift-drag to pan, and scroll to zoom.
- Run a preset or edit a pipeline, then inspect the highlighted result, **Relation graph**, and **Reasoning trace**. Saved custom pipelines stay in this browser. Pipelines outside the public grammar receive a validation error rather than being deleted.

The eight preset definitions live in [`backend/app/scene.py`](backend/app/scene.py); the UI shows each plain-language question alongside its literal pipeline.

## Run locally

Docker Compose runs the web/API and isolated SRpy worker as one package. The worker installs `spatial-reasoner==0.1.0` from PyPI; no sibling SRpy checkout is needed.

```bash
docker compose -f compose.yaml -f compose.local.yaml up --build -d
docker compose -f compose.yaml -f compose.local.yaml ps
```

Open <http://127.0.0.1:8000> and check <http://127.0.0.1:8000/api/health>. Only the web service is published, on loopback. If port 8000 is occupied, set `SPATIAL_REASONER_PORT` before starting Compose. Stop the package with `docker compose -f compose.yaml -f compose.local.yaml down`.

### Develop from source

Use Python 3.12 and Node.js 22. From the repository root, prepare the Python environment:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

Start the worker in one terminal:

```bash
source .venv/bin/activate
cd backend
OPENBLAS_NUM_THREADS=1 uvicorn app.main_worker:app --host 127.0.0.1 --port 8001
```

Start the web API in another terminal, from the repository root:

```bash
source .venv/bin/activate
cd backend
REASONER_WORKER_URL=http://127.0.0.1:8001 uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Start Vite in a third terminal, from the repository root:

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>; Vite proxies `/api` to the web API. API documentation is available at <http://127.0.0.1:8000/docs> in source-development mode only.

## How it works

```text
Three.js scene and editor
  → bounded geometry and pipeline request
  → web API: authored-scene validation, canonical grammar, work limits
  → internal worker: two supervised SRpy child processes
  → result IDs, relation proofs, trace, and timing
  → scene overlays, inspector, and relation graph
```

The browser sends only editable geometry for the exact 42 authored object IDs. The server reconstructs labels and other semantics, rejects extra or malformed fields and bodies over 64 KiB, and reserializes pipelines through a bounded grammar before SRpy evaluates them. The web API limits concurrent work; the worker applies a deadline and replaces a stalled child. Both containers run non-root with read-only filesystems and resource limits. These controls reduce risk but are not a security audit.

SRpy uses base-center positions (`x`, `y`, `z`), dimensions in metres, and yaw in radians. Its predicates operate on oriented bounding boxes, not the decorative meshes. The renderer mirrors SRpy's x-axis for visual left/right consistency; the reasoning remains in Python. The returned `nearbyRadius` is computed by SRpy from the selected proximity settings, not reimplemented in Three.js.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Worker readiness |
| `GET /api/scene/default` | Authored scene and presets |
| `POST /api/reason` | Validated pipeline results, relations, and trace |
| `POST /api/relations` | Relations around one selected object |

The frontend requests selected-object relations on demand rather than transferring every relation in the flat with every pipeline result. Relevant code: [`src/main.ts`](src/main.ts) (UI state), [`src/scene/WorkbenchScene.ts`](src/scene/WorkbenchScene.ts) (scene), [`backend/app/main.py`](backend/app/main.py) (public API), [`backend/app/security.py`](backend/app/security.py) (pipeline grammar), and [`backend/app/engine_pool.py`](backend/app/engine_pool.py) (worker supervision).

## Deploy with Dokploy

Use a **Docker Compose** service with Git source and Compose path `./compose.yaml`. Do not include `compose.local.yaml`, which publishes a local host port. Enable **Isolated Deployments** and inspect Dokploy's generated Compose preview before deployment: `reasoner-worker` must have neither a published port nor a Traefik router.

For `spatial-reasoner.stevenhaesler.ch`, create one domain route to service **`spatial-reasoner`**, container port **`8000`**, external and internal paths **`/`**, **Strip Path off**, and **HTTPS on**. Never route `reasoner-worker`. Domain changes require a Compose redeploy. Remove any old route for the same hostname before cutover; a new route does not automatically inherit an old service's access-control middleware.

Before public release, verify DNS and TLS, the VPS/provider firewall and restricted admin access, `/api/health`, the default scene and all presets, worker isolation and recovery, overload responses, and representative latency without starving other services on the VPS. The production UI makes same-origin API requests. Only the worker image includes the PyPI SRpy package.

## Verify changes

With the Python environment above installed:

```bash
cd backend
../.venv/bin/python -m pytest
cd ..
npm test
npm run build
docker compose -f compose.yaml config --quiet
```

For a release, also audit the built dependencies and check the generated Dokploy Compose/network configuration on the target server.

## Scope and assets

SRpy's relations are derived from bounding boxes, not mesh contact, physical collision, camera occlusion, or a validated walking path. The flat's room colours and labels are visual guides. The pinned SRpy release can omit one similarity category for some size pairs; the adapter reports that omission in `relationWarnings` without inventing a replacement predicate.

The bundled Kenney models are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); the original license is at [`public/models/kenney/License.txt`](public/models/kenney/License.txt). They are served from this package, with measured-box fallbacks if an asset fails to load.
