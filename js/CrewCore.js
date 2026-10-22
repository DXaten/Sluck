// Convoy-crew mode. The existing TDCore still owns the route, waves, enemy AI,
// matchups, and beacon finale; crew members replace fixed build sites.
class CrewCore extends TDCore {
    constructor(level, options = {}) {
        // In this mode souls come from defeated enemies (plus the starting purse).
        super({ ...level, phaseBonus: 0 }, options);
        this.credits = Number.isFinite(options.startingSouls)
            ? Math.max(0, Math.floor(options.startingSouls)) : CrewCore.START_SOULS;
        this.crewSlots = Array(CrewCore.SLOT_COUNT).fill(null);
        this.nextCrewId = 1;
        this.hires = 0;
        this.towers = [];
        this.offers = this._newOffers();
        this._pendingCrewEvents = [];
    }

    get souls() { return this.credits; }
    set souls(value) {
        if (Number.isFinite(value)) this.credits = Math.max(0, Math.floor(value));
    }

    get hireCost() {
        const base = Math.min(117, CrewCore.FIRST_HIRE_COST + this.hires * 12);
        return Math.max(20, base - (this.modifiers.includes('cheap_refresh') ? 10 : 0));
    }

    // Keep the former build-site API from placing permanent towers in crew mode.
    place() { return false; }
    placeCard() { return false; }
    refreshHand() { return false; }
    merge() { return false; }
    upgrade() { return false; }
    upgradeType() { return false; }
    typeUpgradeCost() { return null; }
    sell() { return false; }

    _newOffers() {
        const first = this.deck[this.randomIndex(this.deck.length)];
        const others = this.deck.filter(type => type !== first);
        const second = others.length ? others[this.randomIndex(others.length)] : first;
        return [first, second];
    }

    _emitCrew(event) {
        this.events.push(event);
        // TDCore.update clears events at its start. A button press happens
        // between frames, so carry that action into the next update once.
        this._pendingCrewEvents.push(event);
    }

    _syncActiveCrew() {
        this.towers = this.crewSlots.slice(0, CrewCore.ACTIVE_SLOTS).filter(Boolean);
        const ahead = TDCore.pointAt(this.route, Math.min(this.route.total, this.distance + 10));
        const behind = TDCore.pointAt(this.route, Math.max(0, this.distance - 10));
        let fx = ahead.x - behind.x, fy = ahead.y - behind.y;
        const length = Math.hypot(fx, fy) || 1;
        fx /= length; fy /= length;
        const rx = -fy, ry = fx;
        for (let slot = 0; slot < CrewCore.ACTIVE_SLOTS; slot++) {
            const hero = this.crewSlots[slot];
            if (!hero) continue;
            const along = slot < 2 ? 15 : -15;
            const across = slot % 2 === 0 ? -18 : 18;
            hero.slot = slot;
            hero.x = this.convoy.x + fx * along + rx * across;
            hero.y = this.convoy.y + fy * along + ry * across;
        }
    }

    _promoteReserve() {
        for (let active = 0; active < CrewCore.ACTIVE_SLOTS; active++) {
            if (this.crewSlots[active]) continue;
            const reserve = this.crewSlots.findIndex((hero, index) =>
                index >= CrewCore.ACTIVE_SLOTS && !!hero);
            if (reserve < 0) break;
            this.crewSlots[active] = this.crewSlots[reserve];
            this.crewSlots[reserve] = null;
            this._emitCrew({ kind: 'crew_promote', fromSlot: reserve, toSlot: active });
        }
        this._syncActiveCrew();
    }

    hire(offerIndex) {
        if (this.state === 'won' || this.state === 'lost' || this.state === 'paused' ||
            !Number.isInteger(offerIndex) || offerIndex < 0 || offerIndex >= this.offers.length)
            return false;
        const slot = this.crewSlots.indexOf(null);
        const cost = this.hireCost;
        if (slot < 0 || this.souls < cost) return false;
        const type = this.offers[offerIndex];
        this.souls -= cost;
        this.hires++;
        this.crewSlots[slot] = { slot, siteId: `crew-${this.nextCrewId++}`, type, level: 1,
            cooldown: 0, x: this.convoy.x, y: this.convoy.y };
        this._syncActiveCrew();
        this._emitCrew({ kind: 'crew_hire', slot, type, cost });
        this.offers = this._newOffers();
        this._emitCrew({ kind: 'crew_offers', offers: this.offers.slice(), cost: this.hireCost });
        return true;
    }

    mergeCrew(sourceSlot, targetSlot) {
        if (!Number.isInteger(sourceSlot) || !Number.isInteger(targetSlot) ||
            sourceSlot < 0 || targetSlot < 0 ||
            sourceSlot >= CrewCore.SLOT_COUNT || targetSlot >= CrewCore.SLOT_COUNT ||
            sourceSlot === targetSlot || this.state === 'won' || this.state === 'lost' ||
            this.state === 'paused') return false;
        const source = this.crewSlots[sourceSlot], target = this.crewSlots[targetSlot];
        if (!source || !target || source.level !== target.level || source.level >= CrewCore.MAX_RANK)
            return false;
        const type = this.deck[this.randomIndex(this.deck.length)];
        const level = target.level + 1;
        this.crewSlots[sourceSlot] = null;
        target.type = type;
        target.level = level;
        target.cooldown = 0;
        this._emitCrew({ kind: 'crew_merge', sourceSlot, targetSlot, type, level });
        this._promoteReserve();
        return true;
    }

    // TDCore's shot loop calls this after moving the wagon. Refresh the seat
    // coordinates at that point so every shot originates at the current wagon.
    fire(hero) {
        this._syncActiveCrew();
        return super.fire(hero);
    }

    hurt(enemy, damage, attackType) {
        const alive = enemy.hp > 0;
        const district = Math.max(0, this.level.difficulty - 1);
        const crewDamage = damage * (CrewCore.DAMAGE_BASE +
            CrewCore.DAMAGE_PER_DISTRICT * district);
        super.hurt(enemy, attackType === 'dawn' ? damage : crewDamage, attackType);
        if (alive && enemy.hp === 0)
            this.credits += TDCore.ENEMIES[enemy.type].reward * (CrewCore.SOUL_REWARD_MULTIPLIER - 1);
    }

    update(dt) {
        const pending = this._pendingCrewEvents;
        this._pendingCrewEvents = [];
        super.update(dt);
        if (pending.length) this.events.unshift(...pending);
        this._syncActiveCrew();
    }
}

CrewCore.ACTIVE_SLOTS = 4;
CrewCore.SLOT_COUNT = 6;
CrewCore.MAX_RANK = 3;
CrewCore.START_SOULS = 120;
CrewCore.FIRST_HIRE_COST = 45;
// Four mobile defenders replace six to eight fixed towers. This progression
// keeps the first district forgiving while preserving harder later routes.
CrewCore.DAMAGE_BASE = 1.8;
CrewCore.DAMAGE_PER_DISTRICT = 0.3;
CrewCore.SOUL_REWARD_MULTIPLIER = 2;
