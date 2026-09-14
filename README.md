# Spatial Reasoner Workbench

Spatial Reasoner Workbench is an interactive research apparatus for the Python [spatial-reasoner](https://pypi.org/project/spatial-reasoner/) (SRpy) framework. It operationalizes the method presented in *Spatial Reasoner: A 3D Inference Pipeline for XR Applications* by Häsler and Ackermann ([doi:10.1109/ICVARS66454.2025.11198690](https://doi.org/10.1109/ICVARS66454.2025.11198690)): measured oriented bounding boxes enter an explicit inference pipeline and leave as auditable spatial predicates and filtered object sets.

This is **oriented-bounding-box symbolic inference with configurable spatial fuzziness**. It is not a physics simulation, occlusion solver, motion planner, or guarantee of collision-safe paths.

## What the demo includes

- An open-roof, single-floor flat with a living/dining space, kitchen, study, bedroom, and bathroom; measured walls leave walkable door openings
- Bundled Kenney glTF furniture and architectural models, including the study table and research objects
- Orbit, pan, zoom, object selection, furniture and tabletop dragging, observer walking, Y-axis rotation, and scene reset
- A visible observer direction and field-of-view wedge
- Preset investigations, a stage-by-stage pipeline editor, and browser-local saved pipelines
- Swept observer collision checks against walls and furnishings, including after large pointer jumps; tabletop objects may overlap by design
- Dominant result volumes and labels, strongly recessed non-results, a retained-object ratio, pipeline-proof relation arrows, proximity fields, and containment/contact boxes
- A relation-graph dialog with a pipeline-proof view and a selected-object network, including predicate filtering and one summarized edge per peer
- Width, height, and depth calibration for every selected oriented bounding box
- SRpy proximity-schema, radius-scale, and absolute-cap controls with the effective per-object radius returned to the viewport
- An object inspector with subject → predicate → object proofs, relation deltas, and yaw deviations
- A collapsible execution trace with stage input/output IDs, errors, and server timing
- Debounced updates with abortable, sequence-guarded requests so stale reasoning cannot replace newer geometry

## Run locally

The backend imports the published `spatial-reasoner==0.1.0` package from PyPI. No sibling SRpy checkout is required.

### Backend

From `SpatialReasonerThreeJsDemo`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
uvicorn app.main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### Frontend

In a second terminal, from `SpatialReasonerThreeJsDemo`:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the local FastAPI server.

## Interaction guide

- Click an object to inspect it.
- Drag any furniture across the flat floor, or drag a desktop object across the study table. Walls and floor remain fixed. Moving or turning the study table carries its desktop objects with it.
- Click **Explore flat** to select and focus the observer. Walk with `W/A/S/D` or the arrow keys; hold `Shift` for a longer step. Use `Q/E` to turn, or drag the observer to reposition it.
- Press `Q` / `E`, use the viewport rotate buttons, or use the inspector's Y-axis slider and 90° / 180° step buttons to rotate the selection.
- Drag empty space to orbit; right-drag or Shift-drag to pan; scroll to zoom.
- Choose a preset to see its plain-language question and exact pipeline together.
- Open **Relation graph** to compare the current pipeline's proof links with the selected object's broader relation network. Use its predicate filter to distinguish, for example, left-side from right-side relations. These edges are symbolic predicates, not physical paths or sightlines.
- Click a detected relation to isolate and emphasize its subject and object.
- Expand **Reasoning trace** to inspect each pipeline stage.
- Use **Inference parameters** to calibrate SRpy's near-radius schema, scale, and cap.
- Select any object and edit **W / H / D** to revise its measured bounding box in metres.
- Move the observer to change proximity, tangible, and observer-relative results.
- Expand **Pipeline editor** to add, edit, reorder, or remove stages. Run to validate, then name and save a custom pipeline in this browser.
- Tabletop objects may overlap; resolving conflicts is the user's responsibility. Objects stay on their supporting surfaces. The observer can pass through the room openings, but not walls or floor furnishings. The package starts inside the open bin to demonstrate containment.

## Architecture

```text
Three.js scene + DOM UI
  └─ stable object IDs, dimensions, base-center positions, yaw radians
       └─ POST /api/reason (debounced and abortable)
            └─ validated pipeline + Pydantic scene schema
                 └─ spatial_reasoner SpatialObject / SpatialReasoner
                      └─ result IDs, serialized objects, relations, trace, timing
                           └─ visual overlays + inspector proof
```

The boundaries are intentionally explicit:

- `src/scene/WorkbenchScene.ts` owns rendering, picking, dragging, camera controls, open-asset presentation, and reasoning overlays.
- `src/scene/collision.ts` owns support-surface bounds and swept observer–obstacle checks; it is separate from SRpy inference.
- `src/api.ts` owns transport and maps backend responses onto stable client display metadata.
- `src/main.ts` owns UI state, request sequencing, presets, the inspector, and the execution trace.
- `backend/app/srpy_adapter.py` converts Pydantic inputs to SRpy objects and serializes genuine framework output.
- `backend/app/security.py` constrains the pipeline language before it reaches SRpy's expression evaluators.
- `backend/app/scene.py` is the authoritative default scene and preset catalog.

SRpy positions are the center of the bounding-box base (`x, y, z`), dimensions are metres, and `angle` is yaw in radians. The renderer mirrors SRpy's x-axis into the visual coordinate system so a framework `left` result appears on the observer's visual left while preserving all calculations in Python.

The backend also returns `nearbyRadius` for every object. This value is evaluated by SRpy from the active schema, scale, cap, and box geometry; Three.js only renders the returned radius.

## Docker and Dokploy

The production image contains the built Vite client, bundled Kenney models, and FastAPI API in one non-root container. FastAPI serves the frontend at `/`, the API at `/api`, and the health probe at `/api/health`, so Dokploy only routes one service and one subdomain.

The image installs `spatial-reasoner==0.1.0` from PyPI through the backend's runtime
requirements. It does not clone or patch the SRPy repository, and no reasoning code is
reimplemented in JavaScript.

Build and run the production image locally:

```bash
docker build -t spatial-reasoner-workbench .
docker run --rm -p 8000:8000 spatial-reasoner-workbench
```

Then open `http://127.0.0.1:8000` and verify `http://127.0.0.1:8000/api/health`.

To test the exact Compose service locally while keeping the Dokploy definition free of public host ports, include the local override:

```bash
docker compose -f compose.yaml -f compose.local.yaml up --build
```

Open `http://127.0.0.1:8000`—`0.0.0.0` is a server bind address and is not the browser URL.

For Dokploy:

1. Push this `SpatialReasonerThreeJsDemo` repository, then create a **Docker Compose** service from that Git source.
2. Set the Compose path to `./compose.yaml`. The file intentionally uses `expose: 8000` and does not publish a host port.
3. In the service's **Domains** tab, add the desired subdomain, choose service `spatial-reasoner`, container port `8000`, path `/`, and enable HTTPS with Let's Encrypt.
4. Add an `A`/`AAAA` DNS record for the subdomain pointing to the Dokploy server, then deploy. Domain changes on a Compose service require a redeploy.

The container binds Uvicorn to `0.0.0.0`, honors reverse-proxy forwarding headers, includes an image and Compose health check, and needs no persistent volume or runtime secret.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Reports SRpy adapter readiness |
| `GET /api/scene/default` | Returns the sample scene and valid presets |
| `POST /api/reason` | Runs a validated pipeline and returns results, trace, timing, and relations scoped to the query reference plus optional `focusObjectId` |
| `POST /api/relations` | Returns all authoritative relations around one reference object |

The normal query response includes `relationScopeIds` so the browser knows which objects have complete relation proofs in that response. Selecting another object loads its proofs on demand through `/api/relations`. This avoids enumerating and transferring every relation in the full flat on each pipeline run. Every query starts from the authored scene semantics plus the user's current geometry, so one pipeline's deductions do not leak into the next. The displayed `timingMs` measures backend work; automatic geometry updates also have a short client-side debounce.

The pinned SRpy 0.1.0 release references an undefined `sameperimeter` predicate for certain size pairs. When that branch is reached, the adapter preserves the pair's other predicates and reports the omitted similarity category in `relationWarnings`; it never substitutes a different predicate as a purported result.

Requests are limited to 48 objects, bounded coordinates and dimensions, and an 800-character / 12-stage pipeline. Only `deduce`, `filter`, `pick`, `select`, `sort`, `slice`, `calc`, and `map` are exposed. Expressions are parsed into a conservative AST allowlist; dunder access, imports, arbitrary calls, unknown fields, and unsupported operations are rejected. CORS accepts only the two local Vite origins.

The advanced console is intended only for this local demonstration. It is not an unrestricted public query service.

## Preset pipelines

The friendly prompt in the interface is always shown alongside the literal pipeline sent to SRpy.

```text
# Objects left of the laptop
deduce(topology) | filter(id == 'laptop') | pick(left) | filter(supertype != 'Furniture' AND supertype != 'Building Element' AND id != 'observer')

# Objects on top of the table
deduce(topology connectivity) | filter(id == 'table') | pick(on)

# Objects near the observer (also demonstrates calc)
calc(meanHeight = average(objects.height)) | filter(id == 'observer') | pick(near) | filter(supertype != 'Building Element' AND id != 'observer')

# Objects tangible from the observer
deduce(topology visibility) | filter(id == 'observer') | pick(tangible)

# Objects inside or fitting into the storage bin
deduce(topology comparability) | filter(id == 'storage_bin') | pick(inside OR fitting)

# Largest non-building object (also demonstrates map, sort, and slice)
filter(supertype != 'Building Element' AND id != 'table' AND id != 'observer') | map(volumeLitres = volume * 1000.0) | sort(volumeLitres >) | slice(1)

# Observer-relative left/right comparison
deduce(topology visibility) | filter(id == 'laptop') | pick(seenleft OR seenright) | filter(supertype != 'Furniture' AND supertype != 'Building Element' AND id != 'observer')

# Connected or touching building elements (demonstrates select)
deduce(topology connectivity) | filter(supertype == 'Building Element') | select(meeting)
```

## Tests and production build

From `SpatialReasonerThreeJsDemo` with the Python 3.12 virtual environment activated and the PyPI requirements installed:

```bash
cd backend
../.venv/bin/python -m pytest

cd ..
npm test
npm run build
```

`backend/tests/test_adapter.py::test_moving_object_changes_left_relation_result` proves that moving the mug across the laptop changes the SRpy pipeline result. The frontend test checks stable-ID response mapping and confirms that derived backend fields are not resent as editable inputs.

## Known limitations

- SRpy reasons over oriented bounding boxes, not detailed meshes; imported and procedural models are explanatory renderings of those boxes.
- Occlusion and camera frustum rendering do not replace SRpy's observer-relative visibility predicates.
- Dragging keeps an object's base elevation fixed. Tabletop boxes may intersect, and users are responsible for resolving such conflicts. The observer is blocked by walls and furnishings, but this is not a physics simulation or a general navigation-safety guarantee.
- Kenney glTF geometry is rescaled to each measured box for illustration; SRpy evaluates the measured box, not the imported mesh. Room-floor tints and labels are visual guides, not additional inference objects.
- The flat is intentionally roofless and single-level so the measured building elements and relations remain inspectable.
- Relation thresholds are research settings. “Near” and “tangible” should be calibrated for a target robot, sensor, and task before deployment.
- Pipelines use SRpy's real formal syntax. The UI does not claim to parse unrestricted natural language.

## Open 3D asset provenance

The bundled glTF models for the flat's walls, doorways, furniture, fixtures, and study objects come from [Kenney's Furniture Kit](https://kenney.nl/assets/furniture-kit), distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The original license text is bundled at `public/models/kenney/License.txt`. Assets are served from this package, with measured-box fallbacks if a model fails to load; no third-party model host is contacted at runtime.

## 2–3 minute demo script

1. **Frame the problem (20 seconds).** “A camera gives us coordinates, but people ask relational questions. This scene sends measured bounding boxes to the Python reasoner and makes its symbolic output visible.” Point out the scope note: reasoning, not physics or path planning.
2. **Inspect the fact base (25 seconds).** Select the laptop. Show its stable ID, base-center position, dimensions, yaw, and returned relation list. Click one relation to emphasize both endpoints and the subject → predicate → object proof.
3. **Ask a preset (30 seconds).** Run **Left of laptop**. Call out the literal SRpy pipeline under the plain-language prompt, the cyan result boxes, dimmed context, directional curve, timing, and input/output IDs in the trace.
4. **Change the evidence (35 seconds).** Drag the mug across the laptop. The viewport remains fluid while the debounced request runs; the mug then enters or leaves the result. Explain that Python reran the relation logic—there is no JavaScript predicate clone.
5. **Ground the observer (30 seconds).** Click **Explore flat**, then walk through a doorway with `W/A/S/D` while **Within reach** is active. Turn with `Q/E`; use the cyan forward vector and field-of-view wedge to explain perspective-dependent relations.
6. **Show topology and limits (25 seconds).** Run **Inside the bin** and point to the amber bounding-box proof around the package and bin. Close by reiterating that these are explainable bounding-box relations that can be tested before an assistive system acts.
