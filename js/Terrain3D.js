// Terrain3D.js — the location's ground: a height field from noise, one grid over the rectangle
// [0..W]×[0..H] and a coarse ground ring beyond the edge (otherwise, at a low camera angle,
// the sky would gape beyond the edge).
//
// Height — TERRAIN_BASE + noise (SimplexNoise(TERRAIN_NOISE_SEED), two octaves,
// amplitude TERRAIN_NOISE_AMP, hill size TERRAIN_NOISE_SCALE). heightAt()
// reads THE SAME triangles the mesh draws: objects stand exactly on the
// surface. Do not replace it with bilinear interpolation — on slopes objects
// would start to sink or float.
//
// Material — a texture tile (setGroundImage), repeated every GROUND_TILE_SIZE px on the playable
// ground. Outside it is a quieter city block backdrop: a solid asphalt ground and a few instanced
// docks, rail tracks, warehouses and roof silhouettes. The boundary reads as a small diorama,
// instead of extending the playable ground's repeated square texture to the horizon.
//
// THE TERRAIN IS A PICTURE. Game logic does not ask 3D for height: the grid cell depends
// on the device (mobile — larger), and the computation would diverge between them.

class Terrain3D {
    // cfg: { worldW, worldH, groundImage?, cell?, noise?: { amp, scale, seed, base } }
    constructor(view, cfg) {
        const U = 'undefined';
        this.view = view;
        this.scene = view.scene;
        this.worldW = Math.max(64, cfg.worldW);
        this.worldH = Math.max(64, cfg.worldH);
        this.cell = Math.max(4, cfg.cell || (typeof TERRAIN_CELL !== U ? TERRAIN_CELL : 8));
        if (IS_MOBILE) this.cell = Math.max(this.cell, 12);
        const nz = cfg.noise || {};
        this.noiseAmp = nz.amp != null ? nz.amp : (typeof TERRAIN_NOISE_AMP !== U ? TERRAIN_NOISE_AMP : 28);
        this.noiseScale = Math.max(40, nz.scale != null ? nz.scale : (typeof TERRAIN_NOISE_SCALE !== U ? TERRAIN_NOISE_SCALE : 800));
        this.noiseBase = nz.base != null ? nz.base : (typeof TERRAIN_BASE !== U ? TERRAIN_BASE : 0);
        this.noiseSeed = nz.seed != null ? nz.seed : (typeof TERRAIN_NOISE_SEED !== U ? TERRAIN_NOISE_SEED : 5);
        this._noise = (typeof SimplexNoise !== U) ? new SimplexNoise(String(this.noiseSeed)) : null;
        // The camera pitch limit reads the ring width: the ring edge must not get into the frame.
        this.outerRing = Terrain3D.OUTER_RING;
        this.meshes = [];
        this.texture = null;
        this._buildMaterials();
        this._buildField();
        this._buildGeometry();
        this._buildOuterRing();
        this._buildPerimeter();
        if (cfg.groundImage) this.setGroundImage(cfg.groundImage);
    }

    // --- Material ------------------------------------------------------------------

    // The location gets the texture; the ring stays solid asphalt so its repeated grid does not
    // compete with the route. Fog provides the blend into the sky at the far edge.
    _buildMaterials() {
        const mat = new BABYLON.StandardMaterial('terrainMat', this.scene);
        mat.metadata = { toonGroup: 'ground' };
        mat.diffuseColor = new BABYLON.Color3(0.25, 0.4, 0.18);
        World3D.applyMaterialConstants(mat);
        this.material = mat;
        const outer = new BABYLON.StandardMaterial('terrainOuterMat', this.scene);
        outer.metadata = { toonGroup: 'ground' };
        outer.diffuseColor = new BABYLON.Color3(0.18, 0.25, 0.28);
        World3D.applyMaterialConstants(outer);
        this.outerMaterial = outer;
    }

    // Ground texture tile (Image or Canvas). DynamicTexture with invertY = false:
    // V goes down the map, like y.
    setGroundImage(img) {
        if (!img || !(img.width > 0)) return;
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const tex = new BABYLON.DynamicTexture('groundTile', c, this.scene, true,
            BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTUREFORMAT_RGBA, false);
        tex.update(false);
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.anisotropicFilteringLevel = IS_MOBILE ? 2 : 8;
        const old = this.texture;
        this.texture = tex;
        this.applyTileSize();
        // The outer ground deliberately has no texture: its broad shape is defined by the
        // waterfront, rail yard and distant city, not the repeated tiles of the play field.
        this.material.diffuseTexture = tex;
        this.material.diffuseColor = new BABYLON.Color3(1, 1, 1);
        if (old) { try { old.dispose(); } catch (e) { /* ok */ } }
    }

    // Tile repeat — via the texture scale: u' = (x/W)·(W/tile) = x/tile.
    // GROUND_TILE_SIZE changed (editor) — only this.
    applyTileSize() {
        if (!this.texture) return;
        const tile = Math.max(16, (typeof GROUND_TILE_SIZE !== 'undefined') ? GROUND_TILE_SIZE : 512);
        this.texture.uScale = this.worldW / tile;
        this.texture.vScale = this.worldH / tile;
    }

    // --- Height field ----------------------------------------------------------------

    terrainNoise(x, y) {
        if (!this._noise || !(this.noiseAmp > 0)) return this.noiseBase;
        const s = this.noiseScale;
        const n = this._noise.noise2D(x / s, y / s) * 0.72 +
                  this._noise.noise2D(x / s * 2.3 + 17.1, y / s * 2.3 - 9.7) * 0.28;
        return this.noiseBase + n * this.noiseAmp;
    }

    // Heights at the nodes of the grid [0..W]×[0..H] with step cell. The last cell may
    // extend beyond the edge (UV there > 1 — the tile simply continues).
    _buildField() {
        const cs = this.cell;
        this.nx = Math.ceil(this.worldW / cs) + 1;
        this.ny = Math.ceil(this.worldH / cs) + 1;
        const nx = this.nx, ny = this.ny;
        const H = new Float32Array(nx * ny);
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const h = this.terrainNoise(i * cs, j * cs);
                H[j * nx + i] = h;
                if (h < lo) lo = h;
                if (h > hi) hi = h;
            }
        }
        this.hgrid = H;
        // Height range — for the pointer ray (View3D.pointerToGround) and the camera limit.
        this.hMin = lo;
        this.hMax = hi;
    }

    // Surface height under a point — exactly the one that is drawn: the cell is split by
    // the diagonal (i,j)-(i+1,j+1) into triangles (00,10,11) and (00,11,01), as in the
    // mesh. Beyond the grid edge — noise, as for the ring.
    heightAt(x, y) {
        const cs = this.cell, n = this.nx;
        const fx = x / cs, fy = y / cs;
        if (fx < 0 || fy < 0 || fx > n - 1 || fy > this.ny - 1) return this.terrainNoise(x, y);
        const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
        const tx = fx - i, ty = fy - j;
        const g = this.hgrid;
        const h00 = g[j * n + i], h10 = g[j * n + i + 1];
        const h01 = g[(j + 1) * n + i], h11 = g[(j + 1) * n + i + 1];
        if (tx >= ty) return h00 + (h10 - h00) * tx + (h11 - h10) * ty;
        return h00 + (h01 - h00) * ty + (h11 - h01) * tx;
    }

    // Surface tilt along the heading (rad): longitudinal and lateral slope from the
    // four points of the object's base — for the body's pitch and roll.
    tiltAt(x, y, headingRad, halfLen, halfWid) {
        const cx = Math.cos(headingRad), sy = Math.sin(headingRad);
        const hf = this.heightAt(x + cx * halfLen, y + sy * halfLen);
        const hb = this.heightAt(x - cx * halfLen, y - sy * halfLen);
        const hl = this.heightAt(x - sy * halfWid, y + cx * halfWid);
        const hr = this.heightAt(x + sy * halfWid, y - cx * halfWid);
        return {
            pitch: Math.atan2(hf - hb, halfLen * 2),   // nose higher than stern -> positive
            roll: Math.atan2(hl - hr, halfWid * 2)     // left side higher -> positive
        };
    }

    // --- Grids --------------------------------------------------------------------

    // Indices of a regular nx×ny grid: triangles (a,b,d)(a,d,c) along the diagonal
    // a-d; swap — reversed winding.
    static gridIndices(nx, ny, swap) {
        const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
        let p = 0;
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
                if (swap) { idx[p++] = a; idx[p++] = d; idx[p++] = b; idx[p++] = a; idx[p++] = c; idx[p++] = d; }
                else { idx[p++] = a; idx[p++] = b; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = c; }
            }
        }
        return idx;
    }

    // Location grid. ORIENTATION: the ground needs a +Y normal. ComputeNormals takes the
    // face normal (p1−p2)×(p3−p2) — the winding is chosen by it, and a safeguard
    // after ComputeNormals flips it if the engine computed otherwise. Do not
    // "fix" the order by hand: the right-handed scene already cost an iteration.
    _buildGeometry() {
        const nx = this.nx, ny = this.ny, cs = this.cell, NV = nx * ny, H = this.hgrid;
        const W = this.worldW, HH = this.worldH;
        const pos = new Float32Array(NV * 3), uvs = new Float32Array(NV * 2);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const k = j * nx + i, x = i * cs, y = j * cs;
                pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = y;
                uvs[k * 2] = x / W; uvs[k * 2 + 1] = y / HH;
            }
        }
        // Normal of the first triangle (a, b, d): (a − b) × (d − b), Y component.
        const b = 3, d = (nx + 1) * 3;
        const ax = pos[0] - pos[b], az = pos[2] - pos[b + 2];
        const qx = pos[d] - pos[b], qz = pos[d + 2] - pos[b + 2];
        let swap = (az * qx - ax * qz) < 0;
        let idx = Terrain3D.gridIndices(nx, ny, swap);
        const normals = new Float32Array(pos.length);
        BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        if (normals[1] < 0) {
            swap = !swap;
            idx = Terrain3D.gridIndices(nx, ny, swap);
            BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        }
        this._swap = swap;   // same winding — for the ring

        const mesh = new BABYLON.Mesh('terrain', this.scene);
        const vd = new BABYLON.VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.normals = normals;
        vd.uvs = uvs;
        vd.applyToMesh(mesh, false);
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
        mesh.material = this.material;
        this.mesh = mesh;
        this.triangles = idx.length / 3;
        this.meshes.push(mesh);
    }

    // Ground ring around the location: pure noise, cell RING_CELL. The hole in it is the location
    // grid; the ring cells at its edge stay and lie 1 px LOWER (under the grid, no further than one
    // and a half cells) — the T-junction of the coarse and fine grids doesn't let the sky show.
    _buildOuterRing() {
        const extent = this.outerRing, cell = Terrain3D.RING_CELL;
        const W = this.worldW, H = this.worldH;
        const x0 = -extent, y0 = -extent;
        const nx = Math.ceil((W + 2 * extent) / cell) + 1, ny = Math.ceil((H + 2 * extent) / cell) + 1;
        const positions = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const k = j * nx + i, x = x0 + i * cell, y = y0 + j * cell;
                positions[k * 3] = x; positions[k * 3 + 1] = this.terrainNoise(x, y) - 1; positions[k * 3 + 2] = y;
                uvs[k * 2] = x / W; uvs[k * 2 + 1] = y / H;
            }
        }
        // Cells — only outside the location grid (with a one-cell margin at its edge).
        const X1 = (this.nx - 1) * this.cell, Y1 = (this.ny - 1) * this.cell;
        const inside = (x, y) => x > 0 && x < X1 && y > 0 && y < Y1;
        const indices = [];
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const cx = x0 + (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell;
                if (inside(cx, cy) && inside(cx - cell, cy - cell) && inside(cx + cell, cy + cell)) continue;
                const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
                if (this._swap) indices.push(a, d, b, a, c, d); else indices.push(a, b, d, a, d, c);
            }
        }
        const normals = new Float32Array(positions.length);
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        const mesh = new BABYLON.Mesh('terrainOuter', this.scene);
        const vd = new BABYLON.VertexData();
        vd.positions = positions;
        vd.indices = indices;
        vd.normals = normals;
        vd.uvs = uvs;
        vd.applyToMesh(mesh, false);
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.freezeWorldMatrix();
        mesh.material = this.outerMaterial;
        this.outer = mesh;
        this.meshes.push(mesh);
    }

    // The streets outside [0..W]×[0..H] are scenery, never playable space. Primitive batches
    // keep the silhouette readable at the portrait camera's small scale. Each material/shape
    // costs one draw call regardless of the number of windows, sleepers or curb sections.
    _buildPerimeter() {
        const W = this.worldW, H = this.worldH;
        const boxes = new Map();
        const cylinders = new Map();
        const put = (set, kind, x, z, width, height, depth, base = 0) => {
            if (!set.has(kind)) set.set(kind, []);
            set.get(kind).push({ x, y: z, h: base + height * 0.5,
                scale: [width, height, depth] });
        };
        const box = (kind, x, z, width, height, depth, base = 0) =>
            put(boxes, kind, x, z, width, height, depth, base);
        const cylinder = (kind, x, z, diameter, height, base = 0) =>
            put(cylinders, kind, x, z, diameter, height, diameter, base);

        // A raised stone lip and short retaining rail separate the action from the scenery.
        // Everything is outside the playable rectangle, so routes and build sites stay clear.
        box('curb', W * 0.5, -12, W + 32, 7, 24);
        box('curb', W * 0.5, H + 12, W + 32, 7, 24);
        box('curb', -12, H * 0.5, 24, 7, H + 24);
        box('curb', W + 12, H * 0.5, 24, 7, H + 24);
        box('rail', W * 0.5, -24, W + 36, 3, 3, 9);
        box('rail', W * 0.5, H + 24, W + 36, 3, 3, 9);
        box('rail', -24, H * 0.5, 3, 3, H + 36, 9);
        box('rail', W + 24, H * 0.5, 3, 3, H + 36, 9);
        for (let x = 0; x <= W; x += 80) {
            box('rail', x, -24, 4, 13, 4);
            box('rail', x, H + 24, 4, 13, 4);
        }
        for (let z = 0; z <= H; z += 80) {
            box('rail', -24, z, 4, 13, 4);
            box('rail', W + 24, z, 4, 13, 4);
        }

        // East waterfront: a dark canal with concrete quays and piers. A few bridge deck
        // fragments make the water read as part of the industrial city rather than a moat.
        const waterX = W + 365;
        box('water', waterX, H * 0.5, 390, 2, H + 2100, -1);
        box('quay', W + 147, H * 0.5, 32, 5, H + 2100, -1);
        box('quay', W + 584, H * 0.5, 32, 5, H + 2100, -1);
        for (let z = -500; z < H + 950; z += 210) {
            box('waterLine', waterX - 70 + (Math.floor(z / 210) % 3) * 36,
                z, 70, 1, 3, 1);
        }
        for (const z of [-310, H + 390]) {
            box('quay', waterX, z, 450, 11, 32, 2);
            box('rail', waterX, z - 15, 450, 3, 3, 13);
            box('rail', waterX, z + 15, 450, 3, 3, 13);
        }

        // West rail yard: two parallel tracks, occasional sleepers and low freight sheds.
        // The tracks remain low because this is the foreground of the default camera.
        for (const x of [-160, -200, -300, -340])
            box('track', x, H * 0.5, 3, 3, H + 2100, 1);
        for (let z = -620; z <= H + 650; z += 45) {
            box('sleeper', -180, z, 82, 3, 10, 0);
            box('sleeper', -320, z, 82, 3, 10, 0);
        }
        for (let z = -410; z <= H + 510; z += 240) {
            box('brick', -480, z, 118, 26 + ((z + 410) / 240 % 3) * 8, 146);
            box('roof', -480, z, 125, 4, 154, 28 + ((z + 410) / 240 % 3) * 8);
        }

        // South service apron is kept low to preserve sight lines over the board.
        box('asphalt', W * 0.5, H + 190, W + 700, 2, 270, -1);
        for (let i = 0; i < 11; i++) {
            const x = -140 + i * (W + 280) / 10;
            box('paving', x, H + 75, 5, 1, 90, 1);
            if (i % 2 === 0) {
                box('brick', x + 22, H + 245, 92, 20, 72);
                box('roof', x + 22, H + 245, 98, 4, 78, 20);
            }
        }

        // North/east skyline: stepped masonry blocks, a copper roof, chimneys and a small
        // selection of lit windows. These sit behind the route at the default view angle.
        const skyline = [];
        for (let i = 0; i < 14; i++) {
            const x = -570 + i * (W + 1080) / 13;
            const depth = 94 + (i % 3) * 21;
            const height = 74 + (i * 31 % 115);
            const z = -160 - (i % 2) * 34;
            skyline.push({ x, z, height, width: 100 + i % 3 * 22, depth });
        }
        for (let i = 0; i < 7; i++) {
            const x = W + 720 + (i % 2) * 108;
            const z = -440 + i * (H + 860) / 6;
            skyline.push({ x, z, height: 90 + i * 27 % 130,
                width: 110 + i % 3 * 20, depth: 112 });
        }
        for (let i = 0; i < skyline.length; i++) {
            const b = skyline[i];
            const tone = i % 5 === 0 ? 'stone' : 'brick';
            box(tone, b.x, b.z, b.width, b.height, b.depth);
            box(i === 8 ? 'copper' : 'roof', b.x, b.z, b.width + 8, 5, b.depth + 8, b.height);
            if (i % 3 === 0) {
                box('stone', b.x, b.z, b.width * 0.55, 14, b.depth * 0.55, b.height + 5);
                box('copper', b.x, b.z, b.width * 0.61, 3, b.depth * 0.61, b.height + 19);
            }
            if (i % 4 === 1) cylinder('chimney', b.x - b.width * 0.23,
                b.z - b.depth * 0.2, 14, 38, b.height + 5);
            if (i < 14) {
                for (let row = 0; row < Math.min(3, Math.floor(b.height / 36)); row++) {
                    for (let col = -1; col <= 1; col++) {
                        const key = (i + row * 2 + col * 3) % 4 === 0 ? 'windowWarm' : 'windowDim';
                        box(key, b.x + col * b.width * 0.25, b.z + b.depth * 0.5 + 1,
                            10, 12, 2, 17 + row * 30);
                    }
                }
            }
        }
        // Water towers and rusted rooftop tanks provide recognisable New York silhouettes.
        for (const [x, z, base] of [
            [W * 0.15, -160, 135], [W * 0.72, -193, 140], [W + 775, H * 0.63, 105]
        ]) {
            cylinder('tank', x, z, 30, 19, base);
            cylinder('roof', x, z, 36, 3, base + 18);
            for (const offset of [-10, 10]) {
                box('track', x + offset, z, 3, 18, 3, base - 17);
            }
        }

        const palette = {
            curb: 0x5c6969, rail: 0x7f9295, water: 0x174653,
            waterLine: 0x397986, quay: 0x465a5e, track: 0x7b8081,
            sleeper: 0x564d48, asphalt: 0x2c3d41, paving: 0x566366,
            brick: 0x71514b, stone: 0x6e7475, roof: 0x3d4d52,
            copper: 0x4d826d, chimney: 0x6b6865, tank: 0x775f50,
            windowWarm: 0xffc478, windowDim: 0x87a69f
        };
        this.perimeterMaterials = [];
        this.perimeterGroups = [];
        const addBatch = (kind, items, shape) => {
            if (!items.length) return;
            const source = shape === 'cylinder'
                ? BABYLON.MeshBuilder.CreateCylinder('perimeter-' + kind,
                    { diameter: 1, height: 1, tessellation: 8 }, this.scene)
                : BABYLON.MeshBuilder.CreateBox('perimeter-' + kind, { size: 1 }, this.scene);
            source.isPickable = false;
            const material = new BABYLON.StandardMaterial('perimeter-' + kind + '-mat', this.scene);
            material.diffuseColor = World3D.hexColor3(palette[kind]);
            material.metadata = { toonGroup: 'prop' };
            if (kind === 'windowWarm' || kind === 'waterLine') {
                material.emissiveColor = World3D.hexColor3(palette[kind]).scale(0.4);
            }
            World3D.applyMaterialConstants(material);
            source.material = material;
            const group = World3D.addInstances(this.view, source, 'prop', items,
                { castShadow: false, receiveShadows: false, ink: false, outline: false });
            this.perimeterMaterials.push(material);
            this.perimeterGroups.push(group);
        };
        for (const [kind, items] of boxes) addBatch(kind, items, 'box');
        for (const [kind, items] of cylinders) addBatch(kind, items, 'cylinder');
    }

    dispose() {
        if (this.perimeterGroups) {
            for (const group of this.perimeterGroups) group.dispose();
            this.perimeterGroups = [];
        }
        if (this.perimeterMaterials) {
            for (const material of this.perimeterMaterials) material.dispose(false, false);
            this.perimeterMaterials = [];
        }
        for (const m of this.meshes) { try { m.dispose(false, false); } catch (e) { /* ok */ } }
        this.meshes = [];
        this.mesh = null;
        this.outer = null;
        for (const mat of [this.material, this.outerMaterial]) {
            if (mat) { try { mat.dispose(false, false); } catch (e) { /* ok */ } }
        }
        if (this.texture) { try { this.texture.dispose(); } catch (e) { /* ok */ } this.texture = null; }
    }
}

// Width of the ground ring beyond the location edge (px) and its cell.
Terrain3D.OUTER_RING = 4700;
Terrain3D.RING_CELL = 64;
