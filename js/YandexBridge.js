// Small optional platform layer. Local development keeps working without /sdk.js.
/** @satisfies {Record<string, any>} */
const YandexBridge = {
    /** @type {any} */ sdk: null,
    /** @type {Game | null} */ game: null,
    gameReady: false,
    gameplayActive: false,
    pausedByPlatform: false,
    wasPlaying: false,
    initialized: false,

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        this.listenForFocus();
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
        const loaded = await new Promise(resolve => {
            const script = document.createElement('script');
            script.src = '/sdk.js';
            script.async = true;
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
        if (!loaded) { console.warn('Yandex SDK unavailable outside Yandex Games.'); return; }
        try {
            const api = /** @type {any} */ (window).YaGames;
            if (!api) return;
            this.sdk = await api.init();
            this.applyLanguage();
            this.sdk.on('game_api_pause', () => this.pause());
            this.sdk.on('game_api_resume', () => this.resume());
            if (this.gameReady && this.sdk.features && this.sdk.features.LoadingAPI)
                this.sdk.features.LoadingAPI.ready();
            const active = !!(this.game && this.game.core && this.game.core.state === 'playing');
            this.gameplayActive = !active;
            this.setGameplay(active);
        } catch (error) { console.warn('Yandex SDK init failed:', error); }
    },

    setGame(game) { this.game = game; this.applyLanguage(); },

    applyLanguage() {
        if (!this.game || !this.sdk) return;
        const language = this.sdk.environment && this.sdk.environment.i18n && this.sdk.environment.i18n.lang;
        this.game.setLocale(language === 'ru' ? 'ru' : 'en');
    },

    ready() {
        this.gameReady = true;
        if (this.sdk && this.sdk.features && this.sdk.features.LoadingAPI)
            this.sdk.features.LoadingAPI.ready();
    },

    setGameplay(active) {
        active = !!active && !this.pausedByPlatform;
        if (active === this.gameplayActive) return;
        this.gameplayActive = active;
        if (this.sdk && this.sdk.features && this.sdk.features.GameplayAPI) {
            if (active) this.sdk.features.GameplayAPI.start();
            else this.sdk.features.GameplayAPI.stop();
        }
    },

    pause() {
        if (this.pausedByPlatform) return;
        this.pausedByPlatform = true;
        this.wasPlaying = !!(this.game && this.game.core && this.game.core.state === 'playing');
        if (this.wasPlaying) this.game.core.setPaused(true);
        Sound3D.setMuted(true);
        this.setGameplay(false);
    },

    resume() {
        if (!this.pausedByPlatform) return;
        this.pausedByPlatform = false;
        if (this.wasPlaying && this.game && this.game.core && this.game.core.state === 'paused')
            this.game.core.setPaused(false);
        this.wasPlaying = false;
        Sound3D.setMuted(false);
        this.setGameplay(this.game && this.game.core && this.game.core.state === 'playing');
    },

    listenForFocus() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.pause();
            else this.resume();
        });
        window.addEventListener('blur', () => this.pause());
        window.addEventListener('focus', () => { if (!document.hidden) this.resume(); });
    }
};
