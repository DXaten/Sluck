// Compact, chibi architectural guardians built from simple low-poly shapes.
// The gameplay keeps its tower type keys; this module only defines silhouettes.
/** @satisfies {Record<string, any>} */
const GuardianMeshes = {
    /** @param {Game} game @param {{type: string, x: number, y: number}} tower */
    create(game, tower) {
        const scene = game.scene;
        const baseColor = {
            lamp: '#62566a', coil: '#475a6a', signal: '#8a86a1',
            projector: '#73685d', relay: '#637b77'
        }[tower.type] || '#62566a';
        const root = BABYLON.MeshBuilder.CreateCylinder('guardian-' + tower.type,
            { diameter: 38, height: 14, tessellation: 8 }, scene);
        root.position.set(tower.x, 18, tower.y);
        root.material = game.material(baseColor, 'actor');

        if (tower.type === 'lamp') {
            // Armor breaker: a low, broad gargoyle with a massive head and claws.
            game.childCylinder(root, 'gargoyle-torso', 34, 25, 0, 23, 3, '#666374', false, 6);
            game.childCylinder(root, 'gargoyle-head', 31, 20, 0, 44, -6, '#77717e', false, 6);
            for (const side of [-1, 1]) {
                const wing = game.childBox(root, 'gargoyle-wing', 25, 6, 24,
                    side * 26, 34, 11, '#4d5368');
                wing.rotation.y = side * 0.32;
                wing.rotation.z = -side * 0.24;
                const horn = game.childBox(root, 'gargoyle-horn', 7, 17, 7,
                    side * 12, 60, -4, '#c6b59c');
                horn.rotation.z = -side * 0.22;
                game.childBox(root, 'gargoyle-claw', 13, 7, 16,
                    side * 20, 13, -15, '#4c4753');
            }
            game.childBox(root, 'gargoyle-ember-eyes', 20, 4, 3,
                0, 46, -23, '#ffd075', true);
        } else if (tower.type === 'coil') {
            // Chain attack: two distinct heads linked by a cyan stone arc.
            game.childCylinder(root, 'chimera-torso', 32, 22, 0, 22, 3, '#536274', false, 6);
            for (const side of [-1, 1]) {
                game.childCylinder(root, 'chimera-neck', 12, 20,
                    side * 12, 37, -5, '#425365', false, 6);
                game.childCylinder(root, 'chimera-head', 21, 17,
                    side * 15, 52, -8, '#728596', false, 6);
                game.childBox(root, 'chimera-eye', 10, 4, 3,
                    side * 15, 53, -21, '#72e4f4', true);
            }
            game.childBox(root, 'chimera-arc', 44, 5, 5,
                0, 66, -2, '#63dae8', true);
            const fin = game.childBox(root, 'chimera-spine', 14, 20, 8,
                0, 35, 16, '#81c8d3');
            fin.rotation.x = -0.4;
        } else if (tower.type === 'signal') {
            // Spirit reveal: a cloaked stone angel with a violet halo.
            const robe = BABYLON.MeshBuilder.CreateCylinder('angel-robe',
                { diameterTop: 17, diameterBottom: 35, height: 36, tessellation: 6 }, scene);
            robe.parent = root;
            robe.position.set(0, 30, 0);
            robe.material = game.material('#b2aeb7', 'actor');
            game.childCylinder(root, 'angel-head', 23, 19, 0, 59, -5, '#ded2c8', false, 8);
            for (const side of [-1, 1]) {
                const wing = game.childBox(root, 'angel-wing', 17, 38, 7,
                    side * 25, 43, 8, '#b7bdc5');
                wing.rotation.z = -side * 0.34;
            }
            game.childBox(root, 'angel-violet-seal', 14, 14, 3,
                0, 39, -18, '#c99ae8', true);
            const halo = BABYLON.MeshBuilder.CreateTorus('angel-halo',
                { diameter: 33, thickness: 4, tessellation: 12 }, scene);
            halo.parent = root;
            halo.position.y = 77;
            halo.material = game.material('#d9aeed', 'actor', true);
        } else if (tower.type === 'projector') {
            // Fast-target hunter: a watchful roof eagle, wings spread in plan view.
            game.childCylinder(root, 'eagle-body', 27, 28, 0, 29, 2, '#8d8176', false, 6);
            for (const side of [-1, 1]) {
                const wing = game.childBox(root, 'eagle-wing', 37, 6, 20,
                    side * 27, 43, 9, '#594f52');
                wing.rotation.y = side * 0.24;
                wing.rotation.z = side * 0.13;
                game.childBox(root, 'eagle-talon', 9, 9, 14,
                    side * 13, 13, -14, '#d0a871');
            }
            game.childCylinder(root, 'eagle-head', 22, 18,
                0, 53, -13, '#c4b2a0', false, 6);
            const beak = BABYLON.MeshBuilder.CreateCylinder('eagle-beak',
                { diameterTop: 0, diameterBottom: 12, height: 17, tessellation: 4 }, scene);
            beak.parent = root;
            beak.position.set(0, 49, -27);
            beak.rotation.x = -Math.PI / 2;
            beak.material = game.material('#e6b165', 'actor');
            game.childBox(root, 'eagle-watch-eyes', 16, 3, 3,
                0, 56, -25, '#ffdc8a', true);
        } else if (tower.type === 'relay') {
            // Support: a tall Atlas figure carrying a glowing district orb.
            game.childCylinder(root, 'atlas-column', 19, 39,
                0, 31, 0, '#79918b', false, 8);
            game.childBox(root, 'atlas-shoulders', 39, 9, 18,
                0, 51, 0, '#a2ada4');
            for (const side of [-1, 1]) {
                const arm = game.childBox(root, 'atlas-arm', 10, 31, 11,
                    side * 23, 55, 0, '#849b92');
                arm.rotation.z = -side * 0.24;
            }
            game.childCylinder(root, 'atlas-head', 24, 19,
                0, 66, -2, '#c0c8b7', false, 8);
            game.childCylinder(root, 'atlas-orb', 19, 19,
                0, 90, 0, '#75ded5', true, 8);
            const aura = BABYLON.MeshBuilder.CreateTorus('atlas-aura',
                { diameter: 34, thickness: 4, tessellation: 12 }, scene);
            aura.parent = root;
            aura.position.y = 90;
            aura.material = game.material('#99eee2', 'actor', true);
        }
        return root;
    }
};
