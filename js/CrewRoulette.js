// A short reward stop after each street miniboss. This layer keeps the rift,
// crew and convoy rules in their own cores; UI only reads roulettePrompt and
// calls chooseRoulette with one of the three choice IDs.
class CrewRoulette extends CrewRifts {
    constructor(level, options = {}) {
        super(level, options);
        this.roulettePrompt = null;
        this.rouletteQueue = [];
        this.rouletteHistory = [];
        this.rewardedMinibossIds = new Set();
        this.nextRouletteRound = 1;
        this.crewAttackBonus = 0;
        this.wardCharges = 0;
        this.pendingHeroes = [];
        this._inRouletteUpdate = false;
    }

    static get ATTACK_BONUS() { return 0.25; }
    static get WARD_SLOW() { return 3; }

    get attackMultiplier() { return 1 + this.crewAttackBonus; }

    _emitRoulette(event) {
        this.events.push(event);
        // Button choices happen between frames; preserve them through the next
        // TDCore.update, which clears events before simulation advances.
        if (!this._inRouletteUpdate) this._pendingCrewEvents.push(event);
    }

    _activateRoulette() {
        if (this.roulettePrompt || !this.rouletteQueue.length ||
            this.state === 'lost' || this.state === 'won') return;
        this.roulettePrompt = this.rouletteQueue.shift();
        this.state = 'paused';
        this._emitRoulette({ kind: 'roulette_prompt', prompt: this.roulettePrompt });
    }

    _queueMinibossReward(enemy) {
        if (this.rewardedMinibossIds.has(enemy.id)) return;
        this.rewardedMinibossIds.add(enemy.id);
        const heroType = this.deck[this.randomIndex(this.deck.length)];
        const prompt = {
            round: this.nextRouletteRound++, bossId: enemy.id,
            choices: [
                { id: 'hero', category: 'hero', heroType },
                { id: 'attack', category: 'attack', bonus: CrewRoulette.ATTACK_BONUS },
                { id: 'ability', category: 'ability', ability: 'ward' }
            ]
        };
        this.rouletteQueue.push(prompt);
        this._activateRoulette();
    }

    _grantFreeHero(type) {
        const slot = this.crewSlots.indexOf(null);
        if (slot < 0) {
            this.pendingHeroes.push(type);
            this._emitRoulette({ kind: 'roulette_hero_queued', type, waiting: this.pendingHeroes.length });
            return false;
        }
        this.crewSlots[slot] = {
            slot, siteId: `crew-${this.nextCrewId++}`, type, level: 1,
            cooldown: 0, x: this.convoy.x, y: this.convoy.y
        };
        this._syncActiveCrew();
        this._emitRoulette({ kind: 'crew_hire', slot, type, cost: 0, source: 'roulette' });
        return true;
    }

    _deliverPendingHeroes() {
        while (this.pendingHeroes.length && this.crewSlots.includes(null))
            this._grantFreeHero(this.pendingHeroes.shift());
    }

    mergeCrew(sourceSlot, targetSlot) {
        if (!super.mergeCrew(sourceSlot, targetSlot)) return false;
        this._deliverPendingHeroes();
        return true;
    }

    chooseRoulette(choiceId) {
        const prompt = this.roulettePrompt;
        if (!prompt || this.state !== 'paused' ||
            !['hero', 'attack', 'ability'].includes(choiceId)) return false;
        this.roulettePrompt = null;
        if (choiceId === 'hero') this._grantFreeHero(prompt.choices[0].heroType);
        else if (choiceId === 'attack') this.crewAttackBonus += CrewRoulette.ATTACK_BONUS;
        else this.wardCharges++;
        const decision = { round: prompt.round, bossId: prompt.bossId,
            choice: choiceId, heroType: choiceId === 'hero' ? prompt.choices[0].heroType : null,
            attackMultiplier: this.attackMultiplier, wardCharges: this.wardCharges };
        this.rouletteHistory.push(decision);
        this._emitRoulette({ kind: 'roulette_choice', ...decision });
        if (this.rouletteQueue.length) this._activateRoulette();
        else this.state = 'playing';
        return true;
    }

    hurt(enemy, damage, attackType) {
        const alive = enemy.hp > 0;
        const crewAttack = !!TDCore.TOWERS[attackType] && attackType !== 'relay';
        super.hurt(enemy, crewAttack ? damage * this.attackMultiplier : damage, attackType);
        if (alive && enemy.hp === 0 && enemy.boss === 'miniboss' &&
            this.state !== 'won' && this.state !== 'lost') this._queueMinibossReward(enemy);
    }

    _resolveWard() {
        if (!this.wardCharges || this.state === 'won' ||
            this.events.some(event => event.kind === 'boss_breach')) return;
        const breaches = this.events.filter(event => event.kind === 'breach');
        if (!breaches.length) return;
        const blocked = breaches.reduce((sum, event) =>
            sum + (TDCore.ENEMIES[event.type]?.breach || 0), 0);
        this.wardCharges--;
        this.convoy.hp = Math.min(this.convoy.maxHp, this.convoy.hp + blocked);
        for (const event of breaches) {
            event.blocked = true;
            event.hp = this.convoy.hp;
        }
        for (const enemy of this.enemies) if (enemy.hp > 0) {
            enemy.slow = Math.max(enemy.slow, CrewRoulette.WARD_SLOW);
            enemy.marked = Math.max(enemy.marked, CrewRoulette.WARD_SLOW);
        }
        if (this.convoy.hp > 0 && this.state === 'lost') {
            this.state = 'playing';
            this.events = this.events.filter(event => event.kind !== 'lost');
        }
        this._emitRoulette({ kind: 'roulette_ward', blocked,
            hp: this.convoy.hp, charges: this.wardCharges });
    }

    update(dt) {
        this._inRouletteUpdate = true;
        try {
            super.update(dt);
            this._resolveWard();
            if (this.state === 'won' || this.state === 'lost') {
                this.roulettePrompt = null;
                this.rouletteQueue.length = 0;
                this.events = this.events.filter(event => event.kind !== 'roulette_prompt');
            }
        } finally {
            this._inRouletteUpdate = false;
        }
    }
}
