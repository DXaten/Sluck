// ArcEngine presentation and input for the pure convoy simulation in TDCore.js.
const TD_TOWER_TEXT = {
    lamp: { ru: 'Гаргулья', en: 'Gargoyle', roleRu: 'броня', roleEn: 'armor',
        hintRu: 'Гаргулья крушит бронированных носильщиков', hintEn: 'Gargoyle crushes armored porters' },
    coil: { ru: 'Химера', en: 'Chimera', roleRu: 'стаи', roleEn: 'swarms',
        hintRu: 'Химера рассылает разряд по стае', hintEn: 'Chimera chains lightning through swarms' },
    signal: { ru: 'Ангел', en: 'Angel', roleRu: 'духи', roleEn: 'spirits',
        hintRu: 'Ангел раскрывает и замедляет духов', hintEn: 'Angel reveals and slows spirits' },
    projector: { ru: 'Орёл', en: 'Eagle', roleRu: 'бегуны', roleEn: 'runners',
        hintRu: 'Орёл настигает быстрых бегунов', hintEn: 'Eagle catches fast runners' },
    relay: { ru: 'Атлант', en: 'Atlas', roleRu: 'усиление', roleEn: 'support',
        hintRu: 'Атлант усиливает соседних хранителей', hintEn: 'Atlas buffs nearby guardians' }
};

const TD_MODIFIER_TEXT = {
    lamp_focus: { ru: 'Каменный кулак\nГаргулья: урон +20%', en: 'Stone fist\nGargoyle: damage +20%', tower: 'lamp' },
    coil_fork: { ru: 'Два голоса\nХимера: +1 цель', en: 'Twin voices\nChimera: +1 target', tower: 'coil' },
    signal_echo: { ru: 'Долгое эхо\nАнгел: метка дольше', en: 'Long echo\nAngel: longer mark', tower: 'signal' },
    projector_lens: { ru: 'Зоркий взгляд\nОрёл: дальность +18%', en: 'Keen gaze\nEagle: range +18%', tower: 'projector' },
    relay_circuit: { ru: 'Общий обет\nАтлант: радиус +18%', en: 'Shared oath\nAtlas: radius +18%', tower: 'relay' },
    cheap_refresh: { ru: 'Связи инспектора\nНаём дешевле', en: 'Inspector contacts\nCheaper recruitment', tower: null }
};

// A single readable street perspective. Menus show the district; on departure
// the view closes in and tracks a point just ahead of the moving convoy.
const TD_CAMERA_VIEW = {
    azimuth: -50, pitch: 64,
    phoneOverviewZoom: 0.32, desktopOverviewZoom: 0.64,
    phoneFollowZoom: 0.72, desktopFollowZoom: 1.24,
    lookAhead: 38
};

class Game {
    /** @param {{ location: Location3D, camera: CameraController }} app */
    constructor(app) {
        this.app = app;
        this.view = app.location.view;
        this.scene = this.view.scene;
        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
        this.materials = new Map();
        this.meshes = [];
        this.enemyMeshes = new Map();
        this.towerMeshes = new Map();
        this.beams = [];
        this.selectedHandIndex = 0;
        this.locale = 'ru';
        this.cameraFollowPoint = { x: 0, y: 0 };
        const saved = Store.getJSON('sluck_progress_v1', { unlocked: 0, best: [0, 0, 0] });
        this.progress = saved && !Array.isArray(saved) ? saved : { unlocked: 0, best: [0, 0, 0] };
        this.progress.towers = ['lamp', 'coil', 'signal', 'projector', 'relay'];
        this.progress.modifiers = Array.isArray(this.progress.modifiers)
            ? [...new Set(this.progress.modifiers.filter(id => !!TD_MODIFIER_TEXT[id]))] : [];
        this.progress.decks = this.progress.decks && typeof this.progress.decks === 'object'
            ? this.progress.decks : {};
        this.pointerStart = null;
        this.activePointers = new Set();
        this.pointerGesture = false;
        this.siteMarks = new Map();
        this.mergeHoverSiteId = null;
        this.tip = '';
        this.phaseTip = '';
        this.phaseTipTime = 0;
        this.uiTimer = 0;
        this.prepared = false;
        this.menuAction = () => this.showDeck();
        this.prepRemaining = 0;
        this.rewardChoices = [];
        this.dragCrewSlot = null;
        this.riftVisuals = [];
        this.bindUI();
        this.app.camera.homeOverride = () => {
            if (this.prepared || ['playing', 'paused'].includes(this.core?.state)) this.focusConvoy(true);
            else this.setOverviewCamera();
        };
        // A touch that starts on a guardian drags it for merging; touching the
        // street still pans the camera. Camera's listener runs before ours.
        this.app.camera.ignorePointer = () => false;
        this.loadLevel(Math.min(TD_LEVELS.length - 1, Math.max(0, Number(this.progress.unlocked) || 0)));
    }

    tr(ru, en) { return this.locale === 'en' ? en : ru; }

    setLocale(locale) {
        this.locale = locale === 'ru' ? 'ru' : 'en';
        if (this.core && this.core.state === 'ready' && !this.prepared) this.showHome();
        this.refreshUI();
    }

    ui(id) { return UI.get(id); }
    write(id, value) { const el = this.ui(id); if (el) el.setText(value); }

    bindUI() {
        for (let i = 0; i < CrewCore.SLOT_COUNT; i++) {
            const slot = this.ui('crew_' + i);
            if (!slot) continue;
            slot.onClick(() => {
                if (this.dragCrewMoved) { this.dragCrewMoved = false; return; }
                if (this.dragCrewSlot !== null || this.ui('overlay')?.visible) return;
                const hero = this.core.crewSlots[i];
                this.tip = hero
                    ? this.tr(TD_TOWER_TEXT[hero.type].ru, TD_TOWER_TEXT[hero.type].en) +
                        this.tr(' · ранг ', ' · rank ') + hero.level +
                        this.tr(' · перетащите на того же ранга', ' · drag onto the same rank')
                    : this.tr('Пустое место в экипаже', 'Empty crew seat');
                this.refreshUI();
            });
            slot.el.addEventListener('pointerdown', event => this.beginCrewDrag(event, i));
            slot.el.addEventListener('pointermove', event => this.moveCrewDrag(event));
            slot.el.addEventListener('pointerup', event => this.endCrewDrag(event));
            slot.el.addEventListener('pointercancel', () => this.clearCrewDrag());
        }
        for (let i = 0; i < 2; i++) this.ui('hire_' + i)?.onClick(() => this.hireHero(i));
        for (const choice of ['left', 'right', 'both'])
            this.ui('rift_' + choice)?.onClick(() => this.chooseRift(choice));
        for (const choice of ['hero', 'attack', 'ability'])
            this.ui('roulette_' + choice)?.onClick(() => this.chooseRoulette(choice));
        for (let i = 0; i < 3; i++) {
            const button = this.ui('card_' + i);
            if (button) button.onClick(() => this.selectCard(i));
            const reward = this.ui('reward_' + i);
            if (reward) reward.onClick(() => this.chooseReward(i));
        }
        for (const type of Object.keys(TD_TOWER_TEXT)) {
            const button = this.ui('deck_' + type);
            if (button) button.onClick(() => this.showCardInfo(type));
        }
        this.ui('card_info_back')?.onClick(() => this.showDeck());
        this.ui('card_info_toggle')?.onClick(() => {
            if (this.selectedDeckInfo) this.toggleDeckCard(this.selectedDeckInfo);
        });
        const confirm = this.ui('deck_confirm');
        if (confirm) confirm.onClick(() => this.confirmDeck());
        this.ui('deck_back')?.onClick(() => {
            this.deckDraft = this.core.deck.slice();
            this.showHome();
        });
        this.ui('home_deck')?.onClick(() => this.showDeck());
        this.ui('home_play')?.onClick(() => this.beginBattle());
        this.ui('home_prev')?.onClick(() => this.changeLevel(-1));
        this.ui('home_next')?.onClick(() => this.changeLevel(1));
        for (let i = 0; i < 4; i++) this.ui('upgrade_' + i)?.onClick(() => this.upgradeDeckType(i));
        this.ui('dawn')?.onClick(() => this.useDawnPulse());
        const reroll = this.ui('reroll');
        if (reroll) reroll.onClick(() => this.rerollHand());
        const pause = this.ui('pause');
        if (pause) pause.onClick(() => this.togglePause());
        const focus = this.ui('focus');
        if (focus) focus.onClick(() => this.focusConvoy());
        const action = this.ui('menu_action');
        if (action) action.onClick(() => this.menuAction());
        this.canvas.addEventListener('pointerdown', e => {
            this.activePointers.add(e.pointerId);
            if (this.activePointers.size > 1) {
                this.pointerGesture = true;
                this.pointerStart = null;
                this.highlightMergeSites(null);
            } else {
                const site = this.canInteractWithSites() ? this.siteAt(e) : null;
                const sourceSiteId = site && this.core.getTower(site.id) ? site.id : null;
                this.pointerStart = { id: e.pointerId, x: e.clientX, y: e.clientY, sourceSiteId };
                if (sourceSiteId) {
                    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
                    this.highlightMergeSites(sourceSiteId);
                    const tower = this.core.getTower(sourceSiteId);
                    this.tip = this.tr('Перетащите на хранителя ранга ', 'Drag onto a rank ') + tower.level +
                        this.tr(' для слияния', ' guardian to merge');
                    this.refreshUI();
                }
            }
        });
        this.canvas.addEventListener('pointermove', e => {
            const start = this.pointerStart;
            if (!start || start.id !== e.pointerId || !start.sourceSiteId || this.pointerGesture) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 9) return;
            const hover = this.siteAt(e);
            const targetId = hover && this.canMergeSites(start.sourceSiteId, hover.id) ? hover.id : null;
            if (this.mergeHoverSiteId !== targetId) this.highlightMergeSites(start.sourceSiteId, targetId);
        });
        this.canvas.addEventListener('pointerup', e => {
            const start = this.pointerStart;
            const gesture = this.pointerGesture;
            this.activePointers.delete(e.pointerId);
            if (this.activePointers.size === 0) this.pointerGesture = false;
            this.pointerStart = null;
            this.highlightMergeSites(null);
            if (gesture || !start || start.id !== e.pointerId) return;
            const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 9;
            if (start.sourceSiteId && moved) {
                const target = this.siteAt(e);
                if (target && this.canMergeSites(start.sourceSiteId, target.id) &&
                    this.core.merge(start.sourceSiteId, target.id)) {
                    const sourceMesh = this.towerMeshes.get(start.sourceSiteId);
                    const targetMesh = this.towerMeshes.get(target.id);
                    if (sourceMesh) this.removeMesh(sourceMesh);
                    if (targetMesh) this.removeMesh(targetMesh);
                    this.towerMeshes.delete(start.sourceSiteId);
                    this.towerMeshes.delete(target.id);
                    const result = this.core.getTower(target.id);
                    this.createTowerMesh(result);
                    this.tip = this.tr('Слияние! ', 'Merged! ') +
                        this.tr(TD_TOWER_TEXT[result.type].ru, TD_TOWER_TEXT[result.type].en) +
                        ' · ' + this.tr('ранг ', 'rank ') + result.level;
                } else this.tip = this.tr('Нужны два хранителя одного ранга (до 3)',
                    'Merge two guardians of the same rank (below 3)');
                this.refreshUI();
                return;
            }
            if (moved) return;
            this.pickSite(e);
        });
        this.canvas.addEventListener('pointercancel', e => {
            this.activePointers.delete(e.pointerId);
            if (this.activePointers.size === 0) this.pointerGesture = false;
            this.pointerStart = null;
            this.highlightMergeSites(null);
        });
    }

    canInteractWithSites() {
        return false;
    }

    beginCrewDrag(event, index) {
        if (this.ui('overlay')?.visible || !this.core?.crewSlots[index] ||
            !['playing', 'ready'].includes(this.core.state)) return;
        this.dragCrewSlot = index;
        this.dragCrewStart = { x: event.clientX, y: event.clientY };
        this.dragCrewMoved = false;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.markCrewMatches(index);
    }

    moveCrewDrag(event) {
        if (this.dragCrewSlot === null) return;
        if (Math.hypot(event.clientX - this.dragCrewStart.x,
            event.clientY - this.dragCrewStart.y) > 8) this.dragCrewMoved = true;
        const target = this.crewSlotAt(event.clientX, event.clientY);
        this.markCrewMatches(this.dragCrewSlot, target);
    }

    crewSlotAt(x, y) {
        for (let i = 0; i < CrewCore.SLOT_COUNT; i++) {
            const rect = this.ui('crew_' + i)?.el.getBoundingClientRect();
            if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
                return i;
        }
        return -1;
    }

    markCrewMatches(source, hover = -1) {
        const hero = this.core?.crewSlots[source];
        for (let i = 0; i < CrewCore.SLOT_COUNT; i++) {
            const button = this.ui('crew_' + i);
            if (!button) continue;
            const other = this.core.crewSlots[i];
            const match = hero && other && i !== source && hero.level === other.level && hero.level < 3;
            button.def.border = match ? (i === hover ? '#fff4a3' : '#79f1b7')
                : i === source ? '#9ceafa' : (this.ui('deck_' + (other?.type || this.core.deck[i % this.core.deck.length]))?.def.border || '#8ca4ad');
            button.apply();
        }
    }

    clearCrewDrag() {
        this.dragCrewSlot = null;
        this.markCrewMatches(-1);
    }

    endCrewDrag(event) {
        if (this.dragCrewSlot === null) return;
        const source = this.dragCrewSlot;
        const target = this.crewSlotAt(event.clientX, event.clientY);
        const moved = this.dragCrewMoved;
        this.clearCrewDrag();
        if (!moved) return;
        if (this.core.mergeCrew(source, target)) {
            const hero = this.core.crewSlots[target];
            this.tip = this.tr('Слияние → ', 'Merge → ') +
                this.tr(TD_TOWER_TEXT[hero.type].ru, TD_TOWER_TEXT[hero.type].en) +
                this.tr(' · ранг ', ' · rank ') + hero.level;
            this.syncCrewMeshes();
        } else this.tip = this.tr('Перетащите на другого героя того же ранга',
            'Drag onto another guardian of the same rank');
        this.refreshUI();
    }

    hireHero(index) {
        if (this.ui('overlay')?.visible) return;
        const type = this.core.offers[index];
        if (this.core.hire(index)) {
            this.tip = this.tr('В экипаже: ', 'Crew hired: ') +
                this.tr(TD_TOWER_TEXT[type].ru, TD_TOWER_TEXT[type].en);
            this.syncCrewMeshes();
        } else this.tip = this.tr('Не хватает душ или мест', 'Not enough souls or seats');
        this.refreshUI();
    }

    chooseRift(choice) {
        if (!this.core.riftPrompt) return;
        if (!this.core.chooseRift(choice)) {
            this.write('rift_body', this.tr('Для печати нужно 20 заряда Нити рассвета.',
                'A seal needs 20 Dawn Thread charge.'));
            return;
        }
        this.markRiftChoice(choice);
        this.hidePanels();
        this.tip = choice === 'both'
            ? this.tr('Прямо: +30 душ, обе щели открыты, след слабеет',
                'Straight ahead: +30 souls, both rifts open, trail fades')
            : this.tr('Маршрут сменён: печать удержит часть стаи',
                'Street changed: the seal holds back part of the swarm');
        this.syncGameplay();
        this.refreshUI();
    }

    chooseRoulette(choice) {
        if (!this.core.roulettePrompt || !this.core.chooseRoulette(choice)) return;
        const decision = this.core.rouletteHistory[this.core.rouletteHistory.length - 1];
        this.tip = choice === 'hero'
            ? this.tr('Колесо: новый герой — ', 'Wheel: new hero — ') +
                this.tr(TD_TOWER_TEXT[decision.heroType].ru, TD_TOWER_TEXT[decision.heroType].en)
            : choice === 'attack'
                ? this.tr('Колесо: атака экипажа усилена', 'Wheel: crew attacks empowered')
                : this.tr('Колесо: печать защищает от прорыва', 'Wheel: ward blocks a breach');
        if (this.core.roulettePrompt) {
            this.refreshRouletteUI();
            this.showPanel('roulette_panel');
        } else this.hidePanels();
        this.syncCrewMeshes();
        this.syncGameplay();
        this.refreshUI();
    }

    refreshRouletteUI() {
        const prompt = this.core.roulettePrompt;
        if (!prompt) return;
        const hero = prompt.choices.find(choice => choice.id === 'hero').heroType;
        const heroName = this.tr(TD_TOWER_TEXT[hero].ru, TD_TOWER_TEXT[hero].en);
        this.write('roulette_title', this.tr('КОЛЕСО ПОГОНИ', 'CHASE WHEEL'));
        this.write('roulette_body', this.tr('Преследователь повержен.\nВыберите одну награду для этой попытки.',
            'Pursuer defeated.\nChoose one reward for this run.'));
        this.write('roulette_hero', this.tr('СЛУЧАЙНЫЙ ГЕРОЙ', 'RANDOM HERO') + '\n' + heroName +
            (this.core.crewSlots.includes(null) ? '' : this.tr(' · ждёт места', ' · waits for a seat')));
        this.write('roulette_attack', this.tr('УСИЛЕНИЕ', 'POWER UP') + '\n' +
            this.tr('Атака экипажа +25%', 'Crew attacks +25%'));
        this.write('roulette_ability', this.tr('СПОСОБНОСТЬ', 'ABILITY') + '\n' +
            this.tr('Печать от одного прорыва', 'Ward against one breach'));
    }

    refreshRiftUI() {
        const prompt = this.core.riftPrompt;
        if (!prompt) return;
        const [left, right] = prompt.pair;
        const list = rift => this.tr(rift.ru, rift.en) + ': ' +
            rift.pattern.map(type => ({ moth: this.tr('мотыльки', 'moths'),
                runner: this.tr('бегуны', 'runners'), porter: this.tr('стражи', 'porters'),
                wraith: this.tr('духи', 'spirits') })[type]).join(' + ');
        this.write('rift_title', this.tr('РАЗВИЛКА · ВЫБОР УЛИЦЫ', 'FORK · CHOOSE A STREET'));
        this.write('rift_body', list(left) + '\n' + list(right) + '\n' +
            this.tr('Заряд: ', 'Charge: ') + this.core.dawnCharge +
            this.tr(' · цена: 20', ' · cost: 20'));
        this.ui('rift_timer')?.setValue(this.core.dawnCharge / TDCore.DAWN.maxCharge);
        this.write('rift_left', this.tr('ЛЕВЫЙ ПУТЬ · след +8 с\nПечать слева · −20 заряда',
            'LEFT STREET · trail +8 s\nSeal left · −20 charge'));
        this.write('rift_right', this.tr('ПРАВЫЙ ПУТЬ · след +4 с\nПечать справа · −20 заряда',
            'RIGHT STREET · trail +4 s\nSeal right · −20 charge'));
        this.write('rift_both', this.tr('ПРЯМО · +30 душ\nОбе щели · след −5 с',
            'STRAIGHT · +30 souls\nBoth rifts · trail −5 s'));
    }

    showRiftVisuals(pair) {
        this.clearRiftVisuals();
        this.riftVisuals = pair.map((rift, index) => {
            const color = index === 0 ? '#e6ae71' : '#78e5e6';
            const ring = BABYLON.MeshBuilder.CreateTorus('alley-rift-' + rift.id,
                { diameter: 65, thickness: 7, tessellation: 16 }, this.scene);
            ring.position.set(rift.x, 9, rift.y);
            ring.material = this.material(color, 'prop', true);
            this.track(ring, 'prop', { castShadow: false, ink: false, outline: false });
            const shaft = BABYLON.MeshBuilder.CreateCylinder('rift-beacon-' + rift.id,
                { diameterTop: 5, diameterBottom: 27, height: 66, tessellation: 8 }, this.scene);
            shaft.position.set(rift.x, 39, rift.y);
            shaft.material = this.material(color, 'prop', true);
            this.track(shaft, 'prop', { castShadow: false, ink: false, outline: false });
            const path = BABYLON.MeshBuilder.CreateTube('rift-path-' + rift.id,
                { path: [new BABYLON.Vector3(rift.x, 9, rift.y),
                    new BABYLON.Vector3(rift.entry.x, 9, rift.entry.y)],
                    radius: 2.5, tessellation: 5 }, this.scene);
            path.material = this.material(color, 'prop', true);
            this.track(path, 'prop', { castShadow: false, ink: false, outline: false });
            return { id: rift.id, meshes: [ring, shaft, path] };
        });
    }

    markRiftChoice(choice) {
        const closed = choice === 'left' ? 0 : choice === 'right' ? 1 : -1;
        if (closed >= 0 && this.riftVisuals[closed]) {
            for (const mesh of this.riftVisuals[closed].meshes) mesh.setEnabled(false);
        }
    }

    drawStreetBranch(path) {
        if (!path || path.length < 2) return;
        const line = BABYLON.MeshBuilder.CreateTube('chase-street-route', {
            path: path.map(([x, y]) => new BABYLON.Vector3(x, 7, y)),
            radius: 3.5, tessellation: 6
        }, this.scene);
        line.material = this.material('#8bf3df', 'prop', true);
        line.isPickable = false;
        this.track(line, 'prop', { castShadow: false, receiveShadows: false, ink: false, outline: false });
    }

    clearRiftVisuals() {
        for (const marker of this.riftVisuals || [])
            for (const mesh of marker.meshes) this.removeMesh(mesh);
        this.riftVisuals = [];
    }

    siteAt(event) {
        if (!this.core) return null;
        const rect = this.canvas.getBoundingClientRect();
        const point = this.view.pointerToGround(event.clientX - rect.left, event.clientY - rect.top, 0);
        if (!point) return null;
        let site = null, best = Math.max(44, 28 / Math.max(0.2, this.app.camera.zoom));
        for (const candidate of this.core.level.sites) {
            const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
            if (distance < best) { best = distance; site = candidate; }
        }
        return site;
    }

    canMergeSites(sourceSiteId, targetSiteId) {
        if (!sourceSiteId || !targetSiteId || sourceSiteId === targetSiteId) return false;
        const source = this.core.getTower(sourceSiteId), target = this.core.getTower(targetSiteId);
        return !!(source && target && source.level === target.level && source.level < 3);
    }

    highlightMergeSites(sourceSiteId, hoverSiteId = null) {
        this.mergeHoverSiteId = hoverSiteId;
        const source = sourceSiteId && this.core?.getTower(sourceSiteId);
        for (const [siteId, mark] of this.siteMarks) {
            const compatible = source && this.canMergeSites(sourceSiteId, siteId);
            const color = siteId === sourceSiteId ? '#75e5f8'
                : siteId === hoverSiteId ? '#fff2a1'
                    : compatible ? '#82e7ad' : '#ffd978';
            mark.material = this.material(color, 'prop', true);
        }
    }

    pickSite(event) {
        if (!this.canInteractWithSites()) return;
        const site = this.siteAt(event);
        if (!site) return;
        const tower = this.core.getTower(site.id);
        if (!tower) {
            if (this.core.placeCard(site.id, this.selectedHandIndex)) {
                this.createTowerMesh(this.core.getTower(site.id));
                this.tip = this.tr('Хранитель призван; карта заменена', 'Guardian summoned; card replaced');
            } else this.tip = this.tr('Не хватает монет для карты', 'Not enough coins for this card');
        } else this.tip = this.tr('Хранитель: ранг ', 'Guardian: rank ') + tower.level +
            this.tr(' · слияние перетаскиванием', ' · drag to merge');
        this.refreshUI();
    }

    selectCard(index) {
        if (!this.core || !this.core.hand[index] || this.ui('overlay')?.visible) return;
        this.selectedHandIndex = index;
        const info = TD_TOWER_TEXT[this.core.hand[index]];
        this.tip = this.tr(info.hintRu, info.hintEn);
        this.refreshUI();
    }

    upgradeDeckType(index) {
        if (this.ui('overlay')?.visible) return;
        const type = this.core.deck[index];
        if (!type) return;
        const price = this.core.typeUpgradeCost(type);
        if (this.core.upgradeType(type)) {
            for (const tower of this.core.towers) if (tower.type === type) {
                const mesh = this.towerMeshes.get(tower.siteId);
                if (mesh) mesh.scaling.y = 1 + 0.18 * (tower.level - 1);
            }
            this.tip = this.tr('Все башни типа ', 'All ') +
                this.tr(TD_TOWER_TEXT[type].ru, TD_TOWER_TEXT[type].en) +
                this.tr(' усилены', ' towers upgraded');
        } else this.tip = price === null
            ? this.tr('Максимальный ранг типа — 3', 'Maximum type rank is 3')
            : this.tr('На усиление не хватает монет', 'Not enough coins to upgrade');
        this.refreshUI();
    }

    useDawnPulse() {
        if (this.ui('overlay')?.visible) return;
        if (this.core.useDawnPulse()) {
            this.tip = this.tr('Нить рассвета очистила улицы!', 'The dawn thread cleansed the streets!');
            const end = this.core.lanterns[this.core.litLanterns - 1].distance;
            this.drawDawnPulse(end);
        } else this.tip = this.tr('Зажгите фонари: нужно 50 заряда', 'Light lanterns: 50 charge needed');
        this.refreshUI();
    }

    rerollHand() {
        if (this.ui('overlay')?.visible) return;
        if (this.core.refreshHand()) {
            this.selectedHandIndex = 0;
            this.tip = this.tr('Новая рука карт', 'New card hand');
        } else this.tip = this.core.deck.length <= 3
            ? this.tr('Все три карты уже в руке', 'All three cards are already in hand')
            : this.tr('Не хватает монет', 'Not enough coins');
        this.refreshUI();
    }

    togglePause() {
        if (this.core.riftPrompt || this.core.roulettePrompt) return;
        if (this.core.state === 'ready') {
            if (this.prepared) this.start();
            else this.showHome();
        }
        else if (this.core.state === 'playing') {
            this.core.setPaused(true);
            this.showMenu(this.tr('Пауза', 'Paused'), this.tr('Караван ждёт вашего приказа.', 'The convoy awaits your order.'),
                this.tr('Продолжить', 'Resume'), () => this.resume());
        } else if (this.core.state === 'paused') this.resume();
        this.refreshUI();
    }

    resume() {
        if (this.core.riftPrompt || this.core.roulettePrompt) return;
        this.core.setPaused(false);
        this.hidePanels();
        this.syncGameplay();
    }

    focusConvoy(resetZoom = false) {
        if (!this.core) return;
        const camera = this.app.camera;
        this.updateCameraFollowPoint();
        camera.azimuth = TD_CAMERA_VIEW.azimuth * Math.PI / 180;
        camera.pitch = TD_CAMERA_VIEW.pitch * Math.PI / 180;
        camera._zoomAnchor = null;
        camera.followLock = true;
        camera.follow(this.cameraFollowPoint);
        camera.lookAt(this.cameraFollowPoint.x, this.cameraFollowPoint.y);
        if (resetZoom) {
            const portrait = this.canvas.clientHeight > this.canvas.clientWidth;
            camera.zoomTarget = portrait ? TD_CAMERA_VIEW.phoneFollowZoom : TD_CAMERA_VIEW.desktopFollowZoom;
            camera.zoom = camera._clampZoom(camera.zoomTarget);
            camera.zoomTarget = camera.zoom;
        }
        camera._apply();
        this.refreshUI();
    }

    updateCameraFollowPoint() {
        if (!this.core) return;
        const core = this.core;
        const ahead = core.beaconActive ? core.distance
            : Math.min(core.route.total, core.distance + TD_CAMERA_VIEW.lookAhead);
        const next = TDCore.pointAt(core.route, ahead);
        this.cameraFollowPoint.x = core.convoy.x * 0.36 + next.x * 0.64;
        this.cameraFollowPoint.y = core.convoy.y * 0.36 + next.y * 0.64;
    }

    setOverviewCamera() {
        const camera = this.app.camera;
        camera.followLock = false;
        camera.follow(null);
        camera.home();
        camera.lookAt(LOCATION_WIDTH / 2, LOCATION_HEIGHT / 2 + 65);
        camera.azimuth = TD_CAMERA_VIEW.azimuth * Math.PI / 180;
        camera.pitch = TD_CAMERA_VIEW.pitch * Math.PI / 180;
        const portrait = this.canvas.clientHeight > this.canvas.clientWidth;
        camera.zoomTarget = portrait ? TD_CAMERA_VIEW.phoneOverviewZoom : TD_CAMERA_VIEW.desktopOverviewZoom;
        camera.zoom = camera._clampZoom(camera.zoomTarget);
        camera.zoomTarget = camera.zoom;
        camera._apply();
    }

    start() {
        if (!this.prepared) return;
        if (this.core.start()) {
            this.hidePanels();
            this.tip = this.tr('Держите след Рука и берегите Искру', 'Keep Rook’s trail and protect the Spark');
            this.focusConvoy();
            this.syncGameplay();
            this.refreshUI();
        }
    }

    loadLevel(index) {
        this.clearScene();
        this.levelIndex = index;
        const base = TD_LEVELS[index];
        const towerPool = this.progress.towers.slice();
        const defaultDeck = towerPool.slice(0, 4);
        this.level = { ...base, deckSize: 4, towerPool, defaultDeck };
        const savedDeck = this.progress.decks[base.id];
        const deck = TDCore.validateDeck(this.level, savedDeck) ? savedDeck : defaultDeck;
        this.core = this.newCrewRun(deck);
        this.deckDraft = deck.slice();
        this.selectedHandIndex = 0;
        this.prepared = false;
        this.prepRemaining = 0;
        this.rewardChoices = [];
        this.phaseTip = '';
        this.phaseTipTime = 0;
        this.drawDistrict();
        this.setOverviewCamera();
        this.showHome();
        this.refreshUI();
        this.syncGameplay();
    }

    newCrewRun(deck) {
        const core = new CrewChase(this.level, { deck, modifiers: this.progress.modifiers });
        // The inspector brings one guardian; the starting soul purse remains a choice.
        core.hire(0);
        core.souls += CrewCore.FIRST_HIRE_COST;
        return core;
    }

    showHome() {
        if (!this.core) return;
        const titles = [
            this.tr('Театральный квартал', 'Theater Quarter'),
            this.tr('Станция Девятая', 'Ninth Station'),
            this.tr('Туманная набережная', 'Foggy Waterfront')
        ];
        const stories = [
            this.tr('Сайлас Рук гасит маяки.\nСлед ведёт через квартал.',
                'Silas Rook is darkening beacons.\nHis trail cuts through the streets.'),
            this.tr('Рук ушёл к старой станции.\nПерехватите его людей.',
                'Rook fled toward the old station.\nIntercept his crew.'),
            this.tr('Рук ждёт у набережной.\nТуман скоро скроет след.',
                'Rook waits at the waterfront.\nFog will soon erase his trail.')
        ];
        this.write('home_stage', this.tr('МАЯК ', 'BEACON ') + (this.levelIndex + 1) + '/3');
        this.ui('home_prev')?.show(this.levelIndex > 0);
        this.ui('home_next')?.show(this.levelIndex < Math.min(2, Number(this.progress.unlocked) || 0));
        this.write('home_title', titles[this.levelIndex]);
        this.write('home_body', stories[this.levelIndex] +
            this.tr('\n\nДогоните Рука до потери следа.\nНаймите героев за души.\nНа развилке выберите путь и печать.',
                '\n\nCatch Rook before his trail fades.\nHire heroes with souls.\nChoose a street and seal at each fork.'));
        const deckNames = this.deckDraft.map(type =>
            this.tr(TD_TOWER_TEXT[type].ru, TD_TOWER_TEXT[type].en));
        this.write('home_deck_summary', this.tr('Экипаж:', 'Crew:') + '\n' +
            deckNames.slice(0, 2).join(' · ') +
            (deckNames.length > 2 ? '\n' + deckNames.slice(2).join(' · ') : '') +
            this.tr('\nМодификаций: ', '\nModifiers: ') + this.progress.modifiers.length);
        this.write('home_deck', this.tr('Собрать экипаж', 'Assemble crew'));
        this.write('home_play', this.tr('Отправить караван', 'Depart'));
        this.showPanel('home_panel');
    }

    changeLevel(direction) {
        if (this.core.state !== 'ready' || this.prepared) return;
        const max = Math.min(TD_LEVELS.length - 1, Number(this.progress.unlocked) || 0);
        const next = Math.max(0, Math.min(max, this.levelIndex + direction));
        if (next !== this.levelIndex) this.loadLevel(next);
    }

    showPanel(id) {
        for (const name of ['home_panel', 'menu', 'deck_panel', 'card_info_panel', 'reward_panel', 'rift_panel', 'roulette_panel']) {
            const panel = this.ui(name);
            if (panel) panel.show(name === id);
        }
        const overlay = this.ui('overlay');
        if (overlay) overlay.show(true);
        this.ui('controls')?.show(false);
        this.ui('hud_tip')?.show(false);
        this.ui('focus')?.show(false);
    }

    hidePanels() {
        this.ui('overlay')?.show(false);
        this.ui('controls')?.show(true);
        this.ui('hud_tip')?.show(true);
    }

    showMenu(title, body, action, handler) {
        this.write('menu_title', title);
        this.write('menu_body', body);
        this.write('menu_action', action);
        this.menuAction = handler;
        this.showPanel('menu');
        this.syncGameplay();
    }

    showDeck() {
        if (this.core.state !== 'ready' || this.prepared) return;
        this.showPanel('deck_panel');
        this.refreshDeckUI();
    }

    showCardInfo(type) {
        if (this.core.state !== 'ready' || this.prepared || !TD_TOWER_TEXT[type]) return;
        this.selectedDeckInfo = type;
        this.showPanel('card_info_panel');
        this.refreshCardInfoUI();
    }

    toggleDeckCard(type) {
        if (!this.level.towerPool.includes(type)) return;
        const at = this.deckDraft.indexOf(type);
        if (at >= 0) this.deckDraft.splice(at, 1);
        else if (this.deckDraft.length < this.level.deckSize) this.deckDraft.push(type);
        this.refreshDeckUI();
        if (this.selectedDeckInfo === type) this.refreshCardInfoUI();
    }

    refreshDeckUI() {
        this.write('deck_title', this.tr('ГЕРОИ ЭКИПАЖА', 'CREW GUARDIANS'));
        this.write('deck_body', this.tr('Выберите 4 героев из 5.\nВ бою наём будет случайным.',
            'Choose 4 of 5 heroes.\nRecruitment is random in battle.'));
        this.write('deck_slots', this.deckDraft.length + ' / ' + this.level.deckSize +
            this.tr('\nВ ЭКИПАЖЕ', '\nIN CREW'));
        for (const [type, info] of Object.entries(TD_TOWER_TEXT)) {
            const available = this.level.towerPool.includes(type);
            const selected = this.deckDraft.includes(type);
            this.write('deck_' + type + '_name', this.tr(info.ru, info.en));
            this.write('deck_' + type + '_cost', '◆');
            this.write('deck_' + type + '_rank', this.tr('РАНГ I / III', 'RANK I / III'));
            this.write('deck_' + type + '_state', available ? (selected ? '✓' : '+') : '✕');
            const card = this.ui('deck_' + type);
            this.ui('deck_' + type + '_sigil')?.show(!card?.def.art);
        }
        this.write('deck_confirm', this.deckDraft.length === this.level.deckSize
            ? this.tr('Сохранить колоду', 'Save deck')
            : this.tr('Выберите ещё карты', 'Choose more cards'));
        this.write('deck_back', this.tr('Назад', 'Back'));
    }

    refreshCardInfoUI() {
        const type = this.selectedDeckInfo;
        const info = TD_TOWER_TEXT[type];
        if (!info) return;
        const spec = TDCore.TOWERS[type];
        const available = this.level.towerPool.includes(type);
        const selected = this.deckDraft.includes(type);
        const source = this.ui('deck_' + type);
        const portrait = this.ui('card_info_art');
        if (source && portrait) {
            // The gallery card owns the palette and eventual portrait asset in UILayout.js.
            portrait.def.fill = source.def.fill;
            portrait.def.border = source.def.border;
            portrait.setArt(source.def.art || '');
        }
        const glyph = this.ui('card_info_sigil');
        if (glyph) {
            glyph.def.color = source?.def.border || '#f4c475';
            glyph.setText(this.ui('deck_' + type + '_sigil')?.def.text || '◈');
            glyph.show(!source?.def.art);
        }
        this.write('card_info_back', this.tr('‹ Назад', '‹ Back'));
        this.write('card_info_title', this.tr(info.ru, info.en).toUpperCase());
        this.write('card_info_cost', '◆');
        this.write('card_info_rank', this.tr('БОЕВОЙ РАНГ I / III', 'BATTLE RANK I / III'));
        this.write('card_info_role', this.tr('РОЛЬ · ', 'ROLE · ') + this.tr(info.roleRu, info.roleEn).toUpperCase());
        const cadence = spec.interval == null ? '' :
            this.tr(' · каждые ', ' · every ') + String(spec.interval).replace('.', this.locale === 'ru' ? ',' : '.') +
            this.tr(' с', ' s');
        const main = type === 'relay'
            ? this.tr('УСИЛЕНИЕ +', 'BOOST +') + Math.round(spec.bonus * 100) + '% · ' +
                this.tr('радиус ', 'radius ') + spec.radius
            : this.tr('УРОН ', 'DAMAGE ') + spec.damage + cadence + '\n' +
                this.tr('ДАЛЬНОСТЬ ', 'RANGE ') + spec.range;
        const special = {
            lamp: this.tr('Броненосцы получают больше урона', 'Extra damage against armored porters'),
            coil: this.tr('Цепной разряд: до ', 'Chain lightning: up to ') + spec.jumps + this.tr(' целей', ' targets'),
            signal: this.tr('Замедляет и помечает духов', 'Slows and marks spirits'),
            projector: this.tr('В первую очередь бьёт бегунов', 'Prioritizes fast runners'),
            relay: this.tr('Не атакует; усиливает соседей', 'Does not attack; boosts neighbors')
        }[type];
        this.write('card_info_stats', main + '\n' + special);
        this.write('card_info_description', this.tr(info.hintRu, info.hintEn) +
            this.tr('\nРанг растёт в бою после слияния.', '\nMerge in battle to raise rank.'));
        this.ui('card_info_toggle')?.show(available);
        this.ui('card_info_locked')?.show(!available);
        if (available) this.write('card_info_toggle', selected
            ? this.tr('Убрать из колоды', 'Remove from deck')
            : this.deckDraft.length < this.level.deckSize
                ? this.tr('Добавить в колоду', 'Add to deck')
                : this.tr('Колода заполнена', 'Deck is full'));
        else this.write('card_info_locked', type === 'relay'
            ? this.tr('Откроется после второго маяка', 'Unlocks after beacon two')
            : this.tr('Откроется после первого маяка', 'Unlocks after beacon one'));
    }

    confirmDeck() {
        if (!TDCore.validateDeck(this.level, this.deckDraft)) return;
        this.progress.decks[this.level.id] = this.deckDraft.slice();
        this.saveProgress();
        this.core = this.newCrewRun(this.deckDraft);
        this.selectedHandIndex = 0;
        this.showHome();
    }

    beginBattle() {
        if (this.core.state !== 'ready' || this.prepared) return;
        this.prepared = true;
        this.prepRemaining = TD_START_PREP_SECONDS;
        this.hidePanels();
        this.focusConvoy(true);
        this.syncCrewMeshes();
        this.tip = this.tr('Наймите героев — выезд через ', 'Hire your crew — departure in ') +
            Math.ceil(this.prepRemaining) + this.tr(' с', ' s');
        this.refreshUI();
    }

    saveProgress() { Store.set('sluck_progress_v1', JSON.stringify(this.progress)); }

    offerRewards() {
        const candidates = Object.keys(TD_MODIFIER_TEXT).filter(id =>
            !this.progress.modifiers.includes(id) &&
            (!TD_MODIFIER_TEXT[id].tower || this.progress.towers.includes(TD_MODIFIER_TEXT[id].tower)));
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        this.rewardChoices = candidates.slice(0, 3);
        const clue = [
            this.tr('Отчёты о сети не совпадают\nс записями ночных инспекторов.',
                'Grid reports contradict\nthe inspectors’ night logs.'),
            this.tr('Кабели ведут к обителям духов.\nСтраницы договора изъяты.',
                'Cables lead to spirit homes.\nPages of the pact are missing.'),
                this.tr('Сайлас Рук задержан у набережной.\nМэрия питала сеть силой духов.',
                'Silas Rook is caught at the waterfront.\nCity Hall powered the grid with spirits.')
        ][this.levelIndex];
        const unlock = '';
        if (!this.rewardChoices.length) {
            this.showMenu(this.tr('МАЯК ЗАЖЖЁН', 'BEACON LIT'), clue + unlock,
                this.nextLevelLabel(), () => this.nextLevel());
            return;
        }
        this.write('reward_title', this.tr('НАЙДЕНА УЛИКА', 'CLUE FOUND'));
        this.write('reward_body', clue + unlock + this.tr('\nВыберите модификацию:', '\nChoose a modifier:'));
        for (let i = 0; i < 3; i++) {
            const id = this.rewardChoices[i];
            const button = this.ui('reward_' + i);
            if (button) button.show(!!id);
            if (id) this.write('reward_' + i, this.tr(TD_MODIFIER_TEXT[id].ru, TD_MODIFIER_TEXT[id].en));
        }
        this.showPanel('reward_panel');
    }

    chooseReward(index) {
        const id = this.rewardChoices[index];
        if (!id || this.progress.modifiers.includes(id)) return;
        this.progress.modifiers.push(id);
        this.saveProgress();
        this.showMenu(this.levelIndex === TD_LEVELS.length - 1
            ? this.tr('САЙЛАС РУК ПОЙМАН', 'SILAS ROOK CAUGHT')
            : this.tr('МАЯК ЗАЖЖЁН', 'BEACON LIT'),
            this.tr('Свет вернулся в район.\nПолучено: ', 'Light returned to the district.\nGained: ') +
                this.tr(TD_MODIFIER_TEXT[id].ru, TD_MODIFIER_TEXT[id].en),
            this.nextLevelLabel(), () => this.nextLevel());
    }

    nextLevelLabel() {
        return this.levelIndex + 1 < TD_LEVELS.length
            ? this.tr('Следующий район', 'Next district') : this.tr('Начать заново', 'Play again');
    }

    nextLevel() { this.loadLevel((this.levelIndex + 1) % TD_LEVELS.length); }

    finish() {
        const won = this.core.state === 'won';
        if (won) {
            this.lightBeacon();
            const best = Array.isArray(this.progress.best) ? this.progress.best : [0, 0, 0];
            best[this.levelIndex] = Math.max(Number(best[this.levelIndex]) || 0, this.core.score);
            this.progress.best = best;
            this.progress.unlocked = Math.max(Number(this.progress.unlocked) || 0,
                Math.min(TD_LEVELS.length - 1, this.levelIndex + 1));
            this.newTowerUnlock = null;
            this.saveProgress();
            this.offerRewards();
        } else {
            this.showMenu(this.core.chaseTime === 0
                ? this.tr('След Рука потерян', 'Rook escaped')
                : this.tr('Караван потерян', 'Convoy lost'),
                this.tr('Нанимайте и сливайте героев.\nНа развилке выбирайте путь и печать.',
                    'Hire and merge guardians.\nChoose a street and seal at each fork.'),
                this.tr('Повторить', 'Retry'), () => this.loadLevel(this.levelIndex));
        }
        this.syncGameplay();
    }

    syncGameplay() {
        if (typeof YandexBridge !== 'undefined') YandexBridge.setGameplay(this.core && this.core.state === 'playing');
    }

    refreshUI() {
        if (!this.core) return;
        const c = this.core;
        this.write('hud_title', this.tr('SLUCK · ПОГОНЯ', 'SLUCK · CHASE'));
        this.write('hud_level', this.tr('Маяк ', 'Beacon ') + (this.levelIndex + 1) + '/3');
        this.write('hud_credits', this.tr('Души: ', 'Souls: ') + c.souls);
        this.write('hud_health', this.tr('Искра: ', 'Spark: ') + c.convoy.hp + '/' + c.convoy.maxHp);
        this.write('hud_chase', this.tr('След Сайласа Рука: ', 'Silas Rook trail: ') +
            Math.ceil(c.chaseTime) + this.tr(' с', ' s'));
        this.write('hud_phase', c.roulettePrompt
            ? this.tr('Выберите награду колеса', 'Choose a wheel reward')
            : c.riftPrompt
            ? this.tr('Выберите печать · волна ждёт', 'Choose a seal · wave awaits')
            : c.beaconActive
            ? (c.beaconPrep > 0
                ? this.tr('Перед волной: ', 'Wave in: ') + Math.ceil(c.beaconPrep) + this.tr(' с', ' s')
                : this.tr('Босс · оборона маяка: ', 'Boss · beacon defense: ') + Math.ceil(c.beaconHold) + this.tr(' с', ' s'))
            : c.state === 'ready' && this.prepared
                ? this.tr('Выезд через ', 'Departure in ') + Math.ceil(this.prepRemaining) + this.tr(' с', ' s')
                : this.tr('До маяка ', 'To beacon ') + Math.floor(c.distance / c.route.total * 100) + '% · ' +
                    this.tr('Угроза ', 'Threat ') + c.phase + '/3');
        this.write('hud_tip', c.state === 'ready' && this.prepared
            ? this.tr('Наймите героев — выезд через ', 'Hire heroes — departure in ') +
                Math.ceil(this.prepRemaining) + this.tr(' с', ' s')
            : this.tip || this.tr('Нанимайте за души · слияние перетаскиванием',
                'Hire with souls · drag to merge'));
        this.write('crew_heading', this.tr('ЭКИПАЖ · 4 МЕСТА', 'CREW · 4 SEATS'));
        this.write('crew_merge_hint', this.tr('↗ СЛИЯНИЕ', '↗ MERGE'));
        this.write('crew_reserve_heading', this.tr('ЗАПАС', 'RESERVE'));
        this.write('crew_hire_heading', this.tr('НАЙМ ЗА ДУШИ', 'SOUL RECRUITMENT'));
        for (let i = 0; i < CrewCore.SLOT_COUNT; i++) {
            const hero = c.crewSlots[i];
            const button = this.ui('crew_' + i);
            if (!button) continue;
            const palette = hero && this.ui('deck_' + hero.type);
            this.write('crew_' + i, hero
                ? this.tr(TD_TOWER_TEXT[hero.type].ru, TD_TOWER_TEXT[hero.type].en) +
                    '\n◆ ' + hero.level + '/3'
                : i < CrewCore.ACTIVE_SLOTS ? this.tr('МЕСТО\n' + (i + 1), 'SEAT\n' + (i + 1))
                    : this.tr('ЗАПАС\n' + (i - 3), 'RESERVE\n' + (i - 3)));
            const fill = palette?.def.fill || '#354b59';
            const border = palette?.def.border || '#7a96a0';
            if (button.def.fill !== fill || (this.dragCrewSlot === null && button.def.border !== border)) {
                button.def.fill = fill;
                if (this.dragCrewSlot === null) button.def.border = border;
                button.apply();
            }
        }
        for (let i = 0; i < 2; i++) {
            const type = c.offers[i], info = TD_TOWER_TEXT[type];
            const button = this.ui('hire_' + i), palette = this.ui('deck_' + type);
            if (!button || !info) continue;
            this.write('hire_' + i, this.tr('НАНЯТЬ', 'HIRE') + '\n' +
                this.tr(info.ru, info.en) + '\n◆ ' + c.hireCost);
            const affordable = c.souls >= c.hireCost && c.crewSlots.includes(null);
            const fill = affordable ? palette?.def.fill : '#3a4149';
            if (button.def.fill !== fill) {
                button.def.fill = fill;
                button.def.border = affordable ? palette?.def.border : '#66757d';
                button.apply();
            }
        }
        this.write('pause', c.state === 'ready'
            ? this.tr('В путь сейчас', 'Ride out now')
            : c.state === 'paused' ? this.tr('Продолжить', 'Resume') : this.tr('Пауза', 'Pause'));
        this.write('dawn', this.tr('НИТЬ РАССВЕТА', 'DAWN THREAD') + '\n' +
            c.dawnCharge + '/' + TDCore.DAWN.maxCharge + ' · −' + TDCore.DAWN.pulseCost);
        if (c.riftPrompt) this.refreshRiftUI();
        if (c.roulettePrompt) this.refreshRouletteUI();
        const progress = this.ui('hud_progress');
        if (progress) progress.setValue(c.beaconActive
            ? 0.85 + 0.15 * (c.beaconWaveStarted ? 1 - c.beaconHold / c.beaconHoldSeconds : 0)
            : 0.85 * c.distance / c.route.total);
        const focus = this.ui('focus');
        if (focus) focus.show(!this.ui('overlay')?.visible &&
            this.app.camera.followObj !== this.cameraFollowPoint);
        this.write('focus', this.tr('К каравану', 'To convoy'));
        this.ui('camera_mode')?.show(false);
    }

    material(hex, kind = 'prop', glow = false) {
        const key = kind + hex + glow;
        if (!this.materials.has(key)) {
            const mat = new BABYLON.StandardMaterial('td-' + key, this.scene);
            mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
            mat.specularColor = BABYLON.Color3.Black();
            if (glow) mat.emissiveColor = BABYLON.Color3.FromHexString(hex).scale(0.62);
            this.materials.set(key, mat);
        }
        return this.materials.get(key);
    }

    warmWashMaterial() {
        const key = 'warm-wash';
        if (!this.materials.has(key)) {
            const texture = new BABYLON.DynamicTexture('warm-wash-gradient',
                { width: 64, height: 64 }, this.scene, false);
            const context = texture.getContext();
            const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255,255,255,0.82)');
            gradient.addColorStop(0.42, 'rgba(255,255,255,0.43)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = gradient;
            context.fillRect(0, 0, 64, 64);
            texture.hasAlpha = true;
            texture.update();
            const material = new BABYLON.StandardMaterial('td-warm-wash', this.scene);
            material.diffuseTexture = texture;
            material.diffuseColor = BABYLON.Color3.FromHexString('#ffd7a3');
            material.emissiveColor = BABYLON.Color3.FromHexString('#ffc98c').scale(0.8);
            material.useAlphaFromDiffuseTexture = true;
            material.alpha = 0.7;
            material.disableLighting = true;
            material.backFaceCulling = false;
            material.disableDepthWrite = true;
            this.materials.set(key, material);
        }
        return this.materials.get(key);
    }

    track(mesh, kind = 'prop', opts = {}) {
        World3D.addObject(this.view, mesh, kind, opts);
        this.meshes.push(mesh);
        return mesh;
    }

    removeMesh(mesh) {
        World3D.removeObject(this.view, mesh);
        const index = this.meshes.indexOf(mesh);
        if (index >= 0) this.meshes.splice(index, 1);
    }

    box(name, w, h, d, x, y, z, hex, kind = 'prop', opts = {}) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.position.set(x, y, z);
        mesh.material = this.material(hex, kind);
        return this.track(mesh, kind, opts);
    }

    childBox(parent, name, w, h, d, x, y, z, hex, glow = false) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.parent = parent;
        mesh.position.set(x, y, z);
        mesh.material = this.material(hex, 'actor', glow);
        return mesh;
    }

    childCylinder(parent, name, diameter, height, x, y, z, hex, glow = false, tessellation = 8) {
        const mesh = BABYLON.MeshBuilder.CreateCylinder(name, { diameter, height, tessellation }, this.scene);
        mesh.parent = parent;
        mesh.position.set(x, y, z);
        mesh.material = this.material(hex, 'actor', glow);
        return mesh;
    }

    nearSegment(x, y, a, b, limit) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)) < limit;
    }

    // Buildings use a conservative bounding circle. The clearances include the road,
    // the footprint and the porter's wide shield, so no enemy can clip a facade.
    clearBuildingSite(x, y, width, alleys) {
        const radius = width * Math.SQRT2 / 2;
        return !this.nearRoute(x, y, radius + 63) &&
            !alleys.some(([a, b]) => this.nearSegment(x, y, a, b, radius + 54)) &&
            !this.core.level.sites.some(s => Math.hypot(s.x - x, s.y - y) < radius + 43);
    }

    roadMark(x, y, horizontal, color) {
        this.box('lane-mark', horizontal ? 29 : 3, 1, horizontal ? 3 : 29,
            x, 4.25, y, color, 'prop', { castShadow: false, ink: false, outline: false });
    }

    drawDistrict() {
        const level = this.core.level;
        const destination = level.path[level.path.length - 1];
        // The beacon stands next to the last road tile: its 26 px plinth stays
        // outside the 46 px road half-width and leaves room for the convoy.
        const beaconX = destination[0], beaconZ = destination[1] + 84;
        const roadColor = ['#6b8291', '#64808a', '#718998'][this.levelIndex];
        this.box('district-pavement', 1196, 2, 896, 600, 0, 450,
            ['#576a79', '#526e77', '#596c79'][this.levelIndex], 'prop',
            { castShadow: false, ink: false, outline: false });
        for (let i = 1; i < level.path.length; i++) {
            const a = level.path[i - 1], b = level.path[i];
            const horizontal = a[1] === b[1];
            const w = horizontal ? Math.abs(b[0] - a[0]) + 92 : 92;
            const d = horizontal ? 92 : Math.abs(b[1] - a[1]) + 92;
            this.box('street', w, 3, d, (a[0] + b[0]) / 2, 2, (a[1] + b[1]) / 2,
                roadColor, 'prop', { castShadow: false, ink: false, outline: false });
            const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const count = Math.max(0, Math.floor((distance - 40) / 74));
            for (let n = 1; n <= count; n++) {
                const t = n / (count + 1);
                this.roadMark(a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t, horizontal, '#e0be7f');
            }
        }
        const alleys = level.spawns.map(spawn => {
            const entry = TDCore.projectOnRoute(this.core.route, spawn[0], spawn[1]);
            const length = Math.hypot(entry.x - spawn[0], entry.y - spawn[1]);
            const road = this.box('spawn-alley', length + 42, 3, 42,
                (spawn[0] + entry.x) / 2, 3, (spawn[1] + entry.y) / 2,
                '#847e8e', 'prop', { castShadow: false, ink: false, outline: false });
            road.rotation.y = -Math.atan2(entry.y - spawn[1], entry.x - spawn[0]);
            return [spawn, [entry.x, entry.y]];
        });
        let seed = 991 + this.levelIndex * 101;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
        // A few recognizable 1990s New York silhouettes replace the former row of
        // identical pastel cubes. Every box detail of a given material shares one
        // thin-instance draw, including the bodies that cast shadows.
        const brick = ['#9c5b47', '#a8694c', '#8f584b', '#b27756'];
        const stone = ['#a58e7b', '#a99783'];
        const metal = '#354550', trim = '#ac9276', copper = '#528b82';
        const boxBatches = new Map();
        const part = (name, w, h, d, x, y, z, color, glow = false, shadow = false) => {
            const key = color + ':' + glow + ':' + shadow;
            if (!boxBatches.has(key)) boxBatches.set(key, { name, color, glow, shadow, items: [] });
            boxBatches.get(key).items.push({ x, y: z, h: y, scale: [w, h, d] });
        };
        const windows = { dark: [], warm: [], mystic: [] };
        const tanks = [], crownRoofs = [], crownSpires = [];
        const warmPools = [];
        const warmFacades = [];
        const buildSites = [];
        for (let x = 80; x < 1200; x += 115) for (let y = 80; y < 880; y += 110) {
            const cx = x + (random() - 0.5) * 22, cy = y + (random() - 0.5) * 22;
            const width = 53 + random() * 26;
            if (!this.clearBuildingSite(cx, cy, width, alleys)) continue;
            if (Math.hypot(cx - beaconX, cy - beaconZ) < width * Math.SQRT2 / 2 + 45) continue;
            buildSites.push({ cx, cy, width, x, y });
        }
        // Keep one copper-crowned landmark in every district even if a random roll
        // or a route clearance removes the other tall buildings.
        const crownSite = buildSites.find(site => site.cx > 800 && site.cy > 520)
            || buildSites[Math.floor(buildSites.length * 0.75)];
        for (const { cx, cy, width, x, y } of buildSites) {
            const roll = random();
            const kind = crownSite && cx === crownSite.cx && cy === crownSite.cy ? 'crown'
                : roll < 0.34 ? 'brownstone' : roll < 0.55 ? 'shophouse'
                : roll < 0.74 ? 'powerhouse' : roll < 0.87 ? 'bank'
                    : 'skyscraper';
            const height = kind === 'crown' ? 218 + random() * 24
                : kind === 'skyscraper' ? 178 + random() * 43
                    : kind === 'bank' ? 88 + random() * 24
                        : kind === 'powerhouse' ? 105 + random() * 30 : 94 + random() * 45;
            const wall = kind === 'bank' ? stone[Math.floor(random() * stone.length)]
                : brick[Math.floor(random() * brick.length)];
            const face = cy + width / 2;
            part(kind + '-body', width, height, width, cx, height / 2, cy, wall, false, true);
            part('stone-plinth', width + 2, 10, width + 2, cx, 5, cy, kind === 'bank' ? '#867b71' : '#806c61');
            part('roof-cap', width + 7, 5, width + 7, cx, height + 1, cy, trim);
            for (const edge of [-1, 1]) {
                part('front-quoin', 4, height - 10, 3, cx + edge * (width / 2 - 2),
                    height / 2 + 5, face + 1, trim);
                part('roof-parapet', width + 7, 7, 3, cx, height + 5,
                    cy + edge * (width / 2 + 2), metal);
                part('roof-parapet', 3, 7, width + 7, cx + edge * (width / 2 + 2),
                    height + 5, cy, metal);
            }
            if (kind === 'crown') {
                crownRoofs.push({ x: cx, y: cy, h: height + 23,
                    scale: [width * 0.91, 37, width * 0.91] });
                crownSpires.push({ x: cx, y: cy, h: height + 56,
                    scale: [5, 32, 5] });
            } else if (kind === 'skyscraper') {
                part('skyscraper-setback', width * 0.75, 20, width * 0.75,
                    cx, height + 13, cy, wall);
                part('skyscraper-cap', width * 0.8, 5, width * 0.8,
                    cx, height + 25, cy, trim);
            } else if (kind === 'powerhouse') {
                part('roof-machinery', width * 0.56, 13, width * 0.4,
                    cx - 4, height + 11, cy - 5, metal);
                part('vent', 12, 24, 12, cx + width * 0.27, height + 19,
                    cy + width * 0.2, '#655d59');
                for (const pipeX of [-width * 0.34, width * 0.34])
                    part('industrial-pipe', 3, height * 0.68, 4,
                        cx + pipeX, height * 0.39, face + 4, metal);
            } else if (random() < 0.46) {
                const tankX = cx + width * 0.19, tankZ = cy - width * 0.13;
                part('tank-stand', 19, 11, 19, tankX, height + 12, tankZ, metal);
                tanks.push({ x: tankX, y: tankZ, h: height + 27, scale: [20, 22, 20] });
            }
            const floors = Math.max(2, Math.floor((height - 34) / 24));
            const columns = kind === 'powerhouse' || kind === 'bank' ? 2 : 3;
            for (let floor = 0; floor < floors; floor++) for (let col = 0; col < columns; col++) {
                const wx = cx + (col - (columns - 1) / 2) * width * 0.28;
                const wz = cy + (col - (columns - 1) / 2) * width * 0.28;
                const wy = 43 + floor * 24;
                const lit = random();
                const group = lit < 0.035 ? 'mystic' : lit < 0.72 ? 'warm' : 'dark';
                windows[group].push({ x: wx, y: face + 2.1, h: wy });
                windows[group].push({ x: cx - width / 2 - 2.1, y: wz, h: wy,
                    heading: Math.PI / 2 });
                // Stone lintels and sills make the lit panes read as real apartment windows.
                part('window-sill', 15, 2, 3, wx, wy - 10, face + 3, trim);
            }
            part('door-recess', 18, 26, 2, cx, 17, face + 2.4, metal);
            if (kind === 'bank') {
                for (const ox of [-width * 0.28, width * 0.28])
                    part('bank-column', 5, 32, 5, cx + ox, 21, face + 6, trim);
                part('bank-portico', width * 0.78, 5, 17,
                    cx, 40, face + 7, '#8d7f70');
            } else if (kind === 'shophouse') {
                part('shop-awning', width * 0.94, 4, 15, cx, 30, face + 8, '#9d3e42');
                part('shop-sign', width * 0.71, 7, 2, cx, 37,
                    face + 3, '#f5bd79', true);
                part('shop-door-sigil', 5, 6, 2, cx, 18, face + 4,
                    '#73c5bc', true);
            } else if (kind === 'powerhouse') {
                part('factory-sign', width * 0.55, 8, 2, cx, 34, face + 3, '#d2b179');
            }
            // Shallow iron fire escapes on the side wall, kept within the site's
            // conservative clearance so the enemy route never enters this geometry.
            if ((kind === 'brownstone' || kind === 'shophouse' || kind === 'skyscraper') && random() < 0.57) {
                const escapeX = cx - width / 2 - 5;
                for (let floor = 1; floor < Math.min(floors, 5); floor++) {
                    const ey = 36 + floor * 24;
                    part('fire-escape-landing', 8, 2, width * 0.55,
                        escapeX, ey, cy, metal);
                    part('fire-escape-rail', 2, 9, width * 0.55,
                        escapeX - 4, ey + 5, cy, metal);
                    part('fire-escape-ladder', 3, 17, 2,
                        escapeX - 5, ey - 9, cy + width * 0.19, metal);
                }
            }
            const lanternHash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^
                Math.imul(this.levelIndex + 1, 83492791)) >>> 0;
            if (lanternHash % 11 < 2 || kind === 'bank' || kind === 'shophouse') {
                const sconceY = Math.max(34, height * 0.36);
                part('sconce-bracket', 4, 5, 10, cx, sconceY + 5, face + 8, metal);
                part('warm-lantern', 9, 12, 7, cx, sconceY, face + 15, '#ffd394', true);
                part('lantern-cap', 12, 3, 9, cx, sconceY + 8, face + 15, metal);
                warmPools.push({ x: cx, y: face + 38, h: 4.1, scale: [90, 1, 76] });
                warmFacades.push({ x: cx, y: face + 1.5, h: sconceY + 13,
                    scale: [width * 1.02, height * 0.56, 1] });
            }
        }
        if (this.levelIndex === 1) {
            // The Ninth Station's elevated iron line sits at the north edge of
            // the map, outside the convoy path and all enemy spawn alleys.
            part('elevated-line-deck', 850, 8, 28, 600, 74, 12, metal);
            part('elevated-line-copper-roof', 850, 4, 33, 600, 91, 12, copper);
            for (let railX = 210; railX <= 990; railX += 195) {
                part('rail-column', 8, 68, 8, railX, 37, 12, metal);
                part('rail-footing', 16, 5, 16, railX, 3, 12, trim);
                part('rail-canopy-post', 4, 15, 4, railX, 83, 12, metal);
            }
            for (const railZ of [-1, 1])
                part('station-railing', 850, 10, 3, 600, 83, 12 + railZ * 14, metal);
            for (let railX = 255; railX <= 945; railX += 230)
                part('platform-lamp', 10, 5, 6, railX, 81, 12,
                    '#ffcf8e', true);
        }
        for (const batch of boxBatches.values()) {
            const source = BABYLON.MeshBuilder.CreateBox(batch.name, { size: 1 }, this.scene);
            source.material = this.material(batch.color, 'prop', batch.glow);
            const group = World3D.addInstances(this.view, source, 'prop', batch.items,
                { castShadow: batch.shadow, ink: false, outline: false });
            if (group.ok) this.meshes.push(group.root);
            else source.dispose();
        }
        const cylinderBatch = (name, options, color, items) => {
            if (!items.length) return;
            const source = BABYLON.MeshBuilder.CreateCylinder(name, options, this.scene);
            source.material = this.material(color);
            const group = World3D.addInstances(this.view, source, 'prop', items,
                { castShadow: false, ink: false, outline: false });
            if (group.ok) this.meshes.push(group.root);
            else source.dispose();
        };
        cylinderBatch('rooftop-tanks', { diameter: 1, height: 1, tessellation: 8 },
            '#856950', tanks);
        cylinderBatch('verdigris-roofs', { diameterTop: 0.12, diameterBottom: 1,
            height: 1, tessellation: 4 }, copper, crownRoofs);
        cylinderBatch('crown-spires', { diameterTop: 0.18, diameterBottom: 1,
            height: 1, tessellation: 6 }, '#74aaa1', crownSpires);
        for (const [name, panes] of Object.entries(windows)) {
            if (!panes.length) continue;
            const source = BABYLON.MeshBuilder.CreateBox(name + '-window-batch',
                { width: 11, height: 15, depth: 2 }, this.scene);
            source.material = this.material(
                name === 'mystic' ? '#338f88' : name === 'warm' ? '#a86539' : '#3c4650',
                'prop', name !== 'dark');
            const group = World3D.addInstances(this.view, source, 'prop', panes,
                { castShadow: false, ink: false, outline: false });
            if (group.ok) this.meshes.push(group.root);
            else source.dispose();
        }
        if (warmPools.length) {
            // Soft static washes: two thin-instance draws, no per-building point lights.
            const pool = BABYLON.MeshBuilder.CreateGround('warm-light-pools',
                { width: 1, height: 1 }, this.scene);
            pool.material = this.warmWashMaterial();
            pool.isPickable = false;
            const group = World3D.addInstances(this.view, pool, 'prop', warmPools,
                { castShadow: false, receiveShadows: false, ink: false, outline: false });
            if (group.ok) this.meshes.push(group.root);
            else pool.dispose();
            const facade = BABYLON.MeshBuilder.CreatePlane('warm-facade-washes',
                { width: 1, height: 1 }, this.scene);
            facade.material = this.warmWashMaterial();
            facade.isPickable = false;
            const facadeGroup = World3D.addInstances(this.view, facade, 'prop', warmFacades,
                { castShadow: false, receiveShadows: false, ink: false, outline: false });
            if (facadeGroup.ok) this.meshes.push(facadeGroup.root);
            else facade.dispose();
        }
        for (const [spawn, entry] of alleys) {
            const mark = BABYLON.MeshBuilder.CreateCylinder('rift', { diameter: 38, height: 3, tessellation: 12 }, this.scene);
            mark.position.set(spawn[0], 5, spawn[1]);
            mark.material = this.material('#db71c5', 'prop', true);
            this.track(mark, 'prop', { castShadow: false, ink: false, outline: false });
            const dx = entry[0] - spawn[0], dy = entry[1] - spawn[1];
            const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
            for (const side of [-1, 1]) {
                this.box('rift-gate-post', 9, 68, 9, spawn[0] + nx * side * 58, 39,
                    spawn[1] + ny * side * 58, '#b49bc1', 'prop', { ink: false, outline: false });
            }
            const lintel = this.box('rift-gate-lintel', 126, 10, 10, spawn[0], 78, spawn[1],
                '#e4a4d4', 'prop', { castShadow: false, ink: false, outline: false });
            lintel.rotation.y = -Math.atan2(dy, dx) - Math.PI / 2;
        }
        const wagon = this.box('convoy', 58, 18, 32, this.core.convoy.x, 17, this.core.convoy.y, '#c18862', 'actor');
        const roof = BABYLON.MeshBuilder.CreateBox('convoy-roof', { width: 35, height: 18, depth: 30 }, this.scene);
        roof.parent = wagon;
        roof.position.set(-5, 17, 0);
        roof.material = this.material('#e2c88f', 'actor');
        const lamp = BABYLON.MeshBuilder.CreateSphere('convoy-lamp', { diameter: 13, segments: 8 }, this.scene);
        lamp.parent = wagon;
        lamp.position.set(31, 8, 0);
        lamp.material = this.material('#ffe29b', 'actor', true);
        this.convoyMesh = wagon;
        this.drawLanterns();
        this.drawBeacon(beaconX, beaconZ);
    }

    drawLanterns() {
        this.dawnLanternMeshes = [];
        this.threadMesh = null;
        for (const [index, lantern] of this.core.lanterns.entries()) {
            const before = TDCore.pointAt(this.core.route, Math.max(0, lantern.distance - 5));
            const after = TDCore.pointAt(this.core.route, Math.min(this.core.route.total, lantern.distance + 5));
            const dx = after.x - before.x, dy = after.y - before.y;
            const length = Math.hypot(dx, dy) || 1, side = index % 2 ? -1 : 1;
            const x = lantern.x - dy / length * 55 * side;
            const z = lantern.y + dx / length * 55 * side;
            const pole = BABYLON.MeshBuilder.CreateCylinder('dawn-street-lantern',
                { diameter: 9, height: 55, tessellation: 8 }, this.scene);
            pole.position.set(x, 29, z);
            pole.material = this.material('#8a6b53');
            this.track(pole, 'prop', { castShadow: false, ink: false, outline: false });
            const arm = this.childBox(pole, 'dawn-lantern-arm', 29, 5, 5,
                13, 25, 0, '#ab8b67');
            arm.rotation.z = -0.1;
            const bulb = BABYLON.MeshBuilder.CreateSphere('dawn-lantern-bulb',
                { diameter: 18, segments: 8 }, this.scene);
            bulb.parent = pole;
            bulb.position.set(27, 20, 0);
            bulb.material = this.material('#66716e');
            const pool = BABYLON.MeshBuilder.CreateGround('dawn-lantern-pool',
                { width: 105, height: 105 }, this.scene);
            pool.position.set(x + 27, 4.3, z);
            pool.material = this.warmWashMaterial();
            pool.isPickable = false;
            this.track(pool, 'prop',
                { castShadow: false, receiveShadows: false, ink: false, outline: false });
            pool.setEnabled(false);
            this.dawnLanternMeshes.push({ bulb, pool });
        }
    }

    routeLineTo(distance, height = 8) {
        const route = this.core.route;
        const points = [new BABYLON.Vector3(route.points[0][0], height, route.points[0][1])];
        for (let i = 0; i < route.lengths.length && route.lengths[i] < distance; i++)
            points.push(new BABYLON.Vector3(route.points[i + 1][0], height, route.points[i + 1][1]));
        const end = TDCore.pointAt(route, distance);
        points.push(new BABYLON.Vector3(end.x, height, end.y));
        return points;
    }

    lightLantern(index) {
        const mesh = this.dawnLanternMeshes[index];
        if (!mesh) return;
        mesh.bulb.material = this.material('#ffe5a0', 'prop', true);
        mesh.pool.setEnabled(true);
        if (this.threadMesh) this.removeMesh(this.threadMesh);
        const end = this.core.lanterns[index].distance;
        const thread = BABYLON.MeshBuilder.CreateTube('dawn-thread',
            { path: this.routeLineTo(end), radius: 3.5, tessellation: 6 }, this.scene);
        thread.material = this.material('#f3c16c', 'prop', true);
        thread.isPickable = false;
        this.threadMesh = this.track(thread, 'prop',
            { castShadow: false, receiveShadows: false, ink: false, outline: false });
    }

    drawDawnPulse(end) {
        const pulse = BABYLON.MeshBuilder.CreateTube('dawn-cleansing-pulse',
            { path: this.routeLineTo(end, 13), radius: 10, tessellation: 6 }, this.scene);
        pulse.material = this.material('#fff0b8', 'actor', true);
        this.addEffect(pulse, 0.42);
    }

    drawBeacon(x, z) {
        const foundation = BABYLON.MeshBuilder.CreateCylinder('district-beacon',
            { diameter: 52, height: 8, tessellation: 8 }, this.scene);
        foundation.position.set(x, 4, z);
        foundation.material = this.material('#77695f');
        const cylinder = (name, top, bottom, height, y, color, sides = 8) => {
            const mesh = BABYLON.MeshBuilder.CreateCylinder(name,
                { diameterTop: top, diameterBottom: bottom, height, tessellation: sides }, this.scene);
            mesh.parent = foundation;
            mesh.position.y = y;
            mesh.material = this.material(color);
            return mesh;
        };
        const detail = (name, w, h, d, dx, y, dz, color) => {
            const mesh = BABYLON.MeshBuilder.CreateBox(name,
                { width: w, height: h, depth: d }, this.scene);
            mesh.parent = foundation;
            mesh.position.set(dx, y, dz);
            mesh.material = this.material(color);
            return mesh;
        };
        cylinder('beacon-brick-shaft', 27, 38, 70, 40, '#965e4a');
        cylinder('beacon-stone-foot', 40, 44, 8, 10, '#b49a7e');
        cylinder('beacon-stone-belt', 34, 35, 5, 58, '#b49a7e');
        cylinder('beacon-lantern-floor', 38, 37, 7, 78, '#526e6b');
        cylinder('beacon-copper-roof', 4, 43, 17, 106, '#548b82');
        cylinder('beacon-finial', 2, 6, 19, 124, '#8db3a3', 6);
        detail('beacon-door', 18, 26, 2, 0, 18, 20, '#354550');
        detail('beacon-door-cap', 23, 4, 6, 0, 33, 22, '#b49a7e');
        for (const dx of [-13, 13]) for (const dz of [-13, 13])
            detail('beacon-lantern-post', 4, 24, 4, dx, 89, dz, '#385a5b');
        // A separate lens material is reset on every level; otherwise the
        // previous district's completed beacon would start the next one lit.
        const lens = this.material('#6c766f');
        lens.diffuseColor = BABYLON.Color3.FromHexString('#6c766f');
        lens.emissiveColor = BABYLON.Color3.Black();
        const glass = BABYLON.MeshBuilder.CreateCylinder('beacon-lens',
            { diameter: 27, height: 21, tessellation: 8 }, this.scene);
        glass.parent = foundation;
        glass.position.y = 89;
        glass.material = lens;
        this.beaconLensMaterial = lens;
        this.beaconMesh = this.track(foundation, 'prop', { ink: false, outline: false });
        this.beaconLit = false;

        const pool = BABYLON.MeshBuilder.CreateGround('beacon-warm-pool',
            { width: 125, height: 125 }, this.scene);
        pool.position.set(x, 4.2, z);
        pool.material = this.warmWashMaterial();
        pool.isPickable = false;
        this.beaconPool = this.track(pool, 'prop',
            { castShadow: false, receiveShadows: false, ink: false, outline: false });
        this.beaconPool.setEnabled(false);
        const halo = BABYLON.MeshBuilder.CreatePlane('beacon-halo',
            { width: 115, height: 115 }, this.scene);
        halo.position.set(x, 90, z);
        halo.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        halo.material = this.warmWashMaterial();
        halo.isPickable = false;
        this.beaconHalo = this.track(halo, 'prop',
            { castShadow: false, receiveShadows: false, ink: false, outline: false });
        this.beaconHalo.setEnabled(false);
    }

    lightBeacon() {
        if (!this.beaconMesh || this.beaconLit) return false;
        this.beaconLit = true;
        this.beaconLensMaterial.diffuseColor = BABYLON.Color3.FromHexString('#ffca7e');
        this.beaconLensMaterial.emissiveColor = BABYLON.Color3.FromHexString('#ffc16f').scale(0.85);
        this.beaconPool.setEnabled(true);
        this.beaconHalo.setEnabled(true);
        return true;
    }

    nearRoute(x, y, limit) {
        const path = this.core.level.path;
        return path.slice(1).some((b, i) => this.nearSegment(x, y, path[i], b, limit));
    }

    createTowerMesh(tower) {
        if (!tower) return;
        const base = GuardianMeshes.create(this, tower);
        base.scaling.setAll(0.48 + 0.08 * (tower.level - 1));
        base.position.y = 27;
        base.metadata = { type: tower.type, rank: tower.level };
        this.track(base, 'actor');
        this.towerMeshes.set(tower.siteId, base);
    }

    syncCrewMeshes() {
        if (!this.core?.crewSlots) return;
        const active = new Set();
        for (const hero of this.core.towers) {
            active.add(hero.siteId);
            let mesh = this.towerMeshes.get(hero.siteId);
            if (mesh && (mesh.metadata?.type !== hero.type || mesh.metadata?.rank !== hero.level)) {
                this.removeMesh(mesh);
                this.towerMeshes.delete(hero.siteId);
                mesh = null;
            }
            if (!mesh) {
                this.createTowerMesh(hero);
                mesh = this.towerMeshes.get(hero.siteId);
            }
            if (mesh) {
                mesh.position.set(hero.x, 27, hero.y);
                mesh.rotation.y = this.convoyMesh?.rotation.y || 0;
            }
        }
        for (const [id, mesh] of this.towerMeshes) if (!active.has(id)) {
            this.removeMesh(mesh);
            this.towerMeshes.delete(id);
        }
    }

    createEnemyMesh(enemy) {
        const type = enemy.type;
        const colors = { runner: '#71545c', wraith: '#965e80', moth: '#e49d52', porter: '#8294a0' };
        const mesh = BABYLON.MeshBuilder.CreateBox('enemy-' + type + '-' + enemy.id,
            { width: type === 'porter' ? 34 : 22, height: type === 'porter' ? 29 : 20,
                depth: type === 'porter' ? 28 : 18 }, this.scene);
        const baseY = type === 'porter' ? 23 : type === 'moth' ? 17 : 18;
        mesh.position.set(enemy.x, baseY, enemy.y);
        mesh.metadata = { baseY };
        mesh.material = this.material(enemy.boss === 'final' ? '#59375f' : colors[type], 'actor');
        if (enemy.boss) mesh.scaling.setAll(enemy.boss === 'final' ? 1.4 : 1.14);
        const orb = (name, diameter, x, y, z, color, glow = false) => {
            const part = BABYLON.MeshBuilder.CreateSphere(name, { diameter, segments: 6 }, this.scene);
            part.parent = mesh; part.position.set(x, y, z);
            part.material = this.material(color, 'actor', glow);
            return part;
        };
        if (type === 'runner') {
            this.childCylinder(mesh, 'bell-head', 28, 21, 0, 23, 0, '#bc9256', false, 8);
            orb('bell-eye', 9, 0, 23, -15, '#ff9e43', true);
            this.childBox(mesh, 'satchel', 13, 12, 9, 15, -1, 0, '#9c6f4f');
            this.childBox(mesh, 'ribbon-left', 5, 17, 3, -16, 7, 0, '#5ae4e8', true);
            this.childBox(mesh, 'ribbon-right', 5, 17, 3, 16, 7, 0, '#5ae4e8', true);
            this.childBox(mesh, 'runner-boot-left', 8, 8, 12, -9, -11, -2, '#493b4d');
            this.childBox(mesh, 'runner-boot-right', 8, 8, 12, 9, -11, -2, '#493b4d');
        } else if (type === 'wraith') {
            orb('ticket-mask', 25, 0, 21, 0, '#ead9be');
            this.childCylinder(mesh, 'conductor-cap', 28, 7, 0, 36, 0, '#743a51');
            this.childBox(mesh, 'ticket-left', 11, 15, 2, -19, 7, 0, '#fff0be', true);
            this.childBox(mesh, 'ticket-right', 11, 15, 2, 19, 7, 0, '#fff0be', true);
            orb('wraith-eye', 5, 0, 22, -13, '#ffbf7a', true);
        } else if (type === 'moth') {
            orb('marquee-bulb', 28, 0, 9, 0, '#ffb142', true);
            const left = this.childBox(mesh, 'moth-wing-left', 22, 3, 30, -18, 12, 0, '#52dce5', true);
            const right = this.childBox(mesh, 'moth-wing-right', 22, 3, 30, 18, 12, 0, '#e77fcf', true);
            left.rotation.z = -0.35; right.rotation.z = 0.35;
            mesh.metadata.wings = [left, right];
            orb('moth-eye', 7, 0, 1, -12, '#fff3af', true);
        } else {
            this.childBox(mesh, 'porter-shoulder-left', 16, 21, 28, -25, 7, 0, '#68747e');
            this.childBox(mesh, 'porter-shoulder-right', 16, 21, 28, 25, 7, 0, '#68747e');
            this.childBox(mesh, 'porter-gate-shield', 10, 39, 34, -37, 3, -4, '#8b654d');
            this.childCylinder(mesh, 'porter-head', 19, 20, 0, 27, 0, '#6b6e77');
            this.childBox(mesh, 'porter-eye', 12, 11, 3, 0, 27, -11, '#ec7bdb', true);
            this.childBox(mesh, 'porter-rune', 5, 23, 2, 10, 0, -15, '#57dbdf', true);
        }
        if (enemy.boss === 'final') {
            this.childCylinder(mesh, 'rook-crown', 30, 14, 0, 43, 0, '#29233e', false, 8);
            orb('rook-sigil', 10, 0, 43, -16, '#ff65d1', true);
        }
        const barY = type === 'porter' ? 55 : 47;
        this.childBox(mesh, 'enemy-health-back', 33, 5, 3, 0, barY, 0, '#172534');
        mesh.metadata.healthFill = this.childBox(mesh, 'enemy-health', 29, 3, 4,
            0, barY, -1, type === 'wraith' ? '#f0b8e5' : '#87eed1', true);
        this.track(mesh, 'actor', { ink: false, outline: false });
        this.enemyMeshes.set(enemy.id, mesh);
    }

    addEffect(mesh, life, spread = 0) {
        mesh.isPickable = false;
        this.beams.push({ mesh, life, maxLife: life, spread });
    }

    hitSpark(x, y, color, diameter = 14) {
        const spark = BABYLON.MeshBuilder.CreateSphere('hit-spark', { diameter, segments: 6 }, this.scene);
        spark.position.set(x, 29, y);
        spark.material = this.material(color, 'actor', true);
        this.addEffect(spark, 0.22, 0.9);
    }

    fireEffect(event) {
        const targets = event.targets || [];
        if (!targets.length) return;
        if (event.type === 'signal') {
            const wave = BABYLON.MeshBuilder.CreateTorus('signal-wave',
                { diameter: 42, thickness: 5, tessellation: 24 }, this.scene);
            wave.position.set(event.x, 10, event.y);
            wave.material = this.material('#e8adfa', 'actor', true);
            this.addEffect(wave, 0.5, 5.8);
            for (const target of targets) {
                const seal = BABYLON.MeshBuilder.CreateTorus('spirit-seal',
                    { diameter: 25, thickness: 3, tessellation: 12 }, this.scene);
                seal.position.set(target.x, 9, target.y);
                seal.material = this.material('#e8adfa', 'actor', true);
                this.addEffect(seal, 0.45, 1.7);
            }
            return;
        }
        if (event.type !== 'lamp' && event.type !== 'coil' && event.type !== 'projector') return;
        let from = new BABYLON.Vector3(event.x, event.type === 'projector' ? 71 : 64, event.y);
        for (const target of targets) {
            const to = new BABYLON.Vector3(target.x, 29, target.y);
            if (event.type === 'lamp') {
                const beam = BABYLON.MeshBuilder.CreateTube('lamp-beam',
                    { path: [from, to], radius: 4, tessellation: 6 }, this.scene);
                beam.material = this.material('#ffce73', 'actor', true);
                this.addEffect(beam, 0.16);
                this.hitSpark(target.x, target.y, '#ffdf8f', 17);
            } else if (event.type === 'projector') {
                const beam = BABYLON.MeshBuilder.CreateTube('projector-beam',
                    { path: [from, to], radius: 2.1, tessellation: 6 }, this.scene);
                beam.material = this.material('#fff0b5', 'actor', true);
                this.addEffect(beam, 0.12);
                const hit = BABYLON.MeshBuilder.CreateTorus('projector-hit',
                    { diameter: 20, thickness: 2.5, tessellation: 12 }, this.scene);
                hit.position.set(target.x, 30, target.y);
                hit.material = this.material('#ffc36e', 'actor', true);
                this.addEffect(hit, 0.2, 0.65);
                this.hitSpark(target.x, target.y, '#fff0bf', 10);
            } else {
                const delta = to.subtract(from), side = new BABYLON.Vector3(-delta.z, 0, delta.x).normalize();
                const wobble = (this.core.time * 19 + target.x * 0.13 + target.y * 0.07);
                const path = [from];
                for (let i = 1; i < 5; i++) {
                    const t = i / 5;
                    path.push(from.add(delta.scale(t)).add(side.scale(Math.sin(wobble + i * 3.2) * 11)));
                }
                path.push(to);
                const arc = BABYLON.MeshBuilder.CreateTube('coil-lightning',
                    { path, radius: 2.5, tessellation: 5 }, this.scene);
                arc.material = this.material('#6debf4', 'actor', true);
                this.addEffect(arc, 0.24);
                this.hitSpark(target.x, target.y, '#8df5ff', 11);
            }
            from = to;
        }
    }

    syncMeshes() {
        const c = this.core;
        this.convoyMesh.position.set(c.convoy.x, 17, c.convoy.y);
        const a = TDCore.pointAt(c.route, Math.max(0, c.distance - 3));
        const b = TDCore.pointAt(c.route, Math.min(c.route.total, c.distance + 3));
        this.convoyMesh.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
        this.syncCrewMeshes();
        const alive = new Set();
        for (const enemy of c.enemies) {
            alive.add(enemy.id);
            if (!this.enemyMeshes.has(enemy.id)) this.createEnemyMesh(enemy);
            const mesh = this.enemyMeshes.get(enemy.id);
            const dx = enemy.x - mesh.position.x, dy = enemy.y - mesh.position.z;
            if (Math.hypot(dx, dy) > 0.1) mesh.rotation.y = -Math.atan2(dy, dx);
            const bob = enemy.type === 'wraith' ? Math.sin(c.time * 4 + enemy.id) * 3
                : enemy.type === 'moth' ? Math.sin(c.time * 9 + enemy.id) * 3
                    : enemy.type === 'runner' ? Math.abs(Math.sin(c.time * 12 + enemy.id)) * 2 : 0;
            mesh.position.set(enemy.x, mesh.metadata.baseY + bob, enemy.y);
            if (mesh.metadata.healthFill) {
                const ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
                mesh.metadata.healthFill.scaling.x = ratio;
                mesh.metadata.healthFill.position.x = -(1 - ratio) * 14.5;
            }
            if (mesh.metadata.wings) {
                const flap = Math.sin(c.time * 15 + enemy.id) * 0.24;
                mesh.metadata.wings[0].rotation.z = -0.35 - flap;
                mesh.metadata.wings[1].rotation.z = 0.35 + flap;
            }
        }
        for (const [id, mesh] of this.enemyMeshes) if (!alive.has(id)) {
            this.removeMesh(mesh);
            this.enemyMeshes.delete(id);
        }
        for (const event of c.events) if (event.kind === 'shot') this.fireEffect(event);
    }

    clearScene() {
        if (this.meshes) for (const mesh of [...this.meshes]) this.removeMesh(mesh);
        if (this.beams) for (const beam of this.beams) beam.mesh.dispose();
        this.meshes = [];
        this.beams = [];
        this.enemyMeshes = new Map();
        this.towerMeshes = new Map();
        this.riftVisuals = [];
        this.siteMarks = new Map();
        this.mergeHoverSiteId = null;
        this.dawnLanternMeshes = [];
        this.threadMesh = null;
    }

    update(dt) {
        if (!this.core) return;
        if (this.core.state === 'ready' && this.prepared && !this.ui('overlay')?.visible) {
            this.prepRemaining = Math.max(0, this.prepRemaining - dt);
            if (this.prepRemaining <= 0) this.start();
        }
        const oldState = this.core.state;
        this.core.update(dt);
        if (this.prepared || ['playing', 'paused'].includes(this.core.state)) this.updateCameraFollowPoint();
        for (const event of this.core.events) {
            if (event.kind === 'rift_prompt') {
                this.showRiftVisuals(event.pair);
                this.refreshRiftUI();
                this.showPanel('rift_panel');
                this.syncGameplay();
            } else if (event.kind === 'chase_route') {
                this.drawStreetBranch(event.path);
                if (this.core.litLanterns) this.lightLantern(this.core.litLanterns - 1);
            } else if (event.kind === 'roulette_prompt' && this.core.roulettePrompt) {
                this.refreshRouletteUI();
                this.showPanel('roulette_panel');
                this.syncGameplay();
            } else if (event.kind === 'roulette_ward') {
                this.tip = this.tr('Печать остановила прорыв!', 'The ward stopped a breach!');
            } else if (event.kind === 'villain_escaped') {
                this.tip = this.tr('След Сайласа Рука потерян', 'Silas Rook escaped');
            } else if (event.kind === 'boss_defeated') {
                this.tip = event.boss === 'final' && this.levelIndex === TD_LEVELS.length - 1
                    ? this.tr('Сайлас Рук пойман!', 'Silas Rook caught!')
                    : this.tr('Преследователь повержен!', 'The pursuer is defeated!');
            } else if (event.kind === 'final_boss') {
                this.tip = this.levelIndex === TD_LEVELS.length - 1
                    ? this.tr('Сайлас Рук у маяка!', 'Silas Rook is at the beacon!')
                    : this.tr('Посланник Рука у маяка!', 'Rook’s enforcer is at the beacon!');
            }
            if (event.kind === 'phase' && event.bonus) {
                this.phaseTip = this.tr('Подкрепление +', 'Reinforcements +') + event.bonus;
                this.tip = this.phaseTip;
                this.phaseTipTime = 3.2;
            } else if (event.kind === 'beacon_prep') {
                this.phaseTip = this.tr('Финальная волна у старта — перестройте защиту!',
                    'Final wave at the route start — rebuild defenses!');
                this.tip = this.phaseTip;
                this.phaseTipTime = 3.2;
            } else if (event.kind === 'lantern_lit') {
                this.lightLantern(event.index);
                this.phaseTip = this.tr('Фонарь зажжён · заряд Нити +20',
                    'Lantern lit · Dawn Thread +20 charge');
                this.tip = this.phaseTip;
                this.phaseTipTime = 2;
            } else if (event.kind === 'beacon_wave' || event.kind === 'beacon_hold') {
                this.phaseTip = this.tr('Финальная волна идёт по дороге!', 'Final wave is coming down the road!');
                this.tip = this.phaseTip;
                this.phaseTipTime = 3.2;
            }
        }
        if (oldState === 'playing') this.syncMeshes();
        if (this.phaseTipTime > 0) {
            this.phaseTipTime -= dt;
            if (this.phaseTipTime <= 0 && this.tip === this.phaseTip) this.tip = '';
        }
        for (const beam of this.beams) {
            beam.life -= dt;
            if (beam.spread) beam.mesh.scaling.setAll(1 + beam.spread * (1 - beam.life / beam.maxLife));
        }
        this.beams = this.beams.filter(beam => {
            if (beam.life > 0) return true;
            beam.mesh.dispose();
            return false;
        });
        if (oldState === 'playing' && (this.core.state === 'won' || this.core.state === 'lost')) this.finish();
        this.uiTimer -= dt;
        if (this.uiTimer <= 0) { this.uiTimer = 0.1; this.refreshUI(); }
    }
}
