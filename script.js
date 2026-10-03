(function () {
	'use strict';

	// ---------------------------------------------------------------------
	// Storage (all keys prefixed with the game slug)
	// ---------------------------------------------------------------------
	var KEY_BEST = 'color-collision:best';
	var KEY_MUTED = 'color-collision:muted';

	function load(key, fallback) {
		try {
			var v = localStorage.getItem(key);
			return v === null ? fallback : v;
		} catch (e) { return fallback; }
	}
	function save(key, value) {
		try { localStorage.setItem(key, String(value)); } catch (e) { /* storage unavailable */ }
	}

	// ---------------------------------------------------------------------
	// Utility functions
	// ---------------------------------------------------------------------
	function rand(min, max) { return Math.random() * (max - min) + min; }
	function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

	// ---------------------------------------------------------------------
	// DOM
	// ---------------------------------------------------------------------
	var canvas = document.getElementById('game');
	var ctx = canvas.getContext('2d');
	var hud = document.getElementById('hud');
	var scoreEl = document.getElementById('score');
	var bestEl = document.getElementById('best');
	var pauseBtn = document.getElementById('pauseBtn');
	var muteBtn = document.getElementById('muteBtn');
	var startScreen = document.getElementById('startScreen');
	var startBest = document.getElementById('startBest');
	var playBtn = document.getElementById('playBtn');
	var overScreen = document.getElementById('overScreen');
	var overTitle = document.getElementById('overTitle');
	var finalScore = document.getElementById('finalScore');
	var finalBest = document.getElementById('finalBest');
	var retryBtn = document.getElementById('retryBtn');
	var pauseScreen = document.getElementById('pauseScreen');
	var resumeBtn = document.getElementById('resumeBtn');

	// Split the "Game Over!" title into animated characters
	(function splitTitle() {
		var text = overTitle.textContent;
		overTitle.textContent = '';
		overTitle.setAttribute('aria-label', text);
		Array.prototype.forEach.call(text, function (ch, i) {
			var span = document.createElement('span');
			span.className = 'char';
			span.setAttribute('aria-hidden', 'true');
			span.textContent = ch === ' ' ? ' ' : ch;
			span.style.setProperty('--char-index', i);
			overTitle.appendChild(span);
		});
	})();

	// ---------------------------------------------------------------------
	// Sound (Web Audio, created on the first user gesture)
	// ---------------------------------------------------------------------
	var audio = null;
	var muted = load(KEY_MUTED, '0') === '1';

	function ensureAudio() {
		if (audio) {
			if (audio.state === 'suspended') audio.resume();
			return;
		}
		var AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		try { audio = new AC(); } catch (e) { audio = null; }
	}

	function tone(freq, dur, type, vol, slide) {
		if (muted || !audio || audio.state !== 'running') return;
		var t = audio.currentTime;
		var o = audio.createOscillator();
		var g = audio.createGain();
		o.type = type || 'sine';
		o.frequency.setValueAtTime(freq, t);
		if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(audio.destination);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	function noiseBurst(dur, vol) {
		if (muted || !audio || audio.state !== 'running') return;
		var len = Math.floor(audio.sampleRate * dur);
		var buf = audio.createBuffer(1, len, audio.sampleRate);
		var d = buf.getChannelData(0);
		for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
		var src = audio.createBufferSource();
		var g = audio.createGain();
		var f = audio.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = 900;
		g.gain.value = vol;
		src.buffer = buf;
		src.connect(f).connect(g).connect(audio.destination);
		src.start();
	}

	var sfx = {
		swap: function () { tone(520, 0.07, 'triangle', 0.08, 680); },
		match: function (color) { tone(color === COLORS[0] ? 784 : 988, 0.16, 'sine', 0.16, color === COLORS[0] ? 1046 : 1318); },
		crash: function () { noiseBurst(0.6, 0.5); tone(160, 0.5, 'sawtooth', 0.12, 40); }
	};

	function updateMuteButton() {
		muteBtn.classList.toggle('muted', muted);
		muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
	}

	// ---------------------------------------------------------------------
	// Canvas sizing (fills the whole window, sharp on high-DPI screens)
	// ---------------------------------------------------------------------
	var W = 0, H = 0, DPR = 1, U = 1;
	var background = null;

	function resize() {
		var oldW = W, oldH = H;
		W = Math.max(1, window.innerWidth);
		H = Math.max(1, window.innerHeight);
		DPR = Math.min(window.devicePixelRatio || 1, 3);
		canvas.width = Math.round(W * DPR);
		canvas.height = Math.round(H * DPR);
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		U = clamp(Math.min(W, H) / 560, 0.85, 1.7);
		background = ctx.createLinearGradient(0, 0, W, H);
		background.addColorStop(0, '#2c3e50');
		background.addColorStop(1, '#34495e');
		if (oldW && oldH) relayout(oldW, oldH);
		// resizing clears the canvas: redraw immediately if the loop is not drawing (paused)
		if (paused && typeof render === 'function') render(0);
	}

	// ---------------------------------------------------------------------
	// Game objects
	// ---------------------------------------------------------------------
	var COLORS = ['#e74c3c', '#3498db']; // red, blue
	var BASE_RADIUS = 18;
	var BASE_SEPARATION = 35;
	var REF_TRAVEL = 339; // travel distance (px) the original speeds were tuned for

	function Particle(x, y, radius, color, spread, gravity) {
		this.x = x;
		this.y = y;
		this.vx = (Math.random() - 0.5) * rand(-spread, spread);
		this.vy = (Math.random() - 0.5) * rand(-spread, spread);
		this.radius = radius;
		this.color = color;
		this.ttl = 250;
		this.opacity = 1;
		this.gravity = gravity;
	}
	Particle.prototype.update = function (f) {
		this.x += this.vx * f * U;
		this.y += this.vy * f * U;
		this.vy += this.gravity * f;
		this.ttl -= f;
		this.opacity -= f / Math.max(this.ttl, 1);
	};
	Particle.prototype.draw = function () {
		if (this.opacity <= 0) return;
		ctx.globalAlpha = Math.max(0, this.opacity);
		ctx.fillStyle = this.color;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius * U, 0, Math.PI * 2);
		ctx.fill();
	};

	function drawBall(x, y, r, color, alpha) {
		ctx.globalAlpha = alpha === undefined ? 1 : alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}

	// Bouncing decoration balls (start screen)
	var floaters = [];
	function initFloaters() {
		floaters = [];
		for (var i = 0; i < 20; i++) {
			floaters.push({
				x: W / 2, y: H / 2,
				vx: rand(-5, 5), vy: rand(-5, 5),
				r: rand(5, 10),
				color: pick(COLORS)
			});
		}
	}
	function updateFloaters(f) {
		floaters.forEach(function (b) {
			var r = b.r * U;
			b.x += b.vx * f * U;
			b.y += b.vy * f * U;
			if (b.x - r < 0) { b.x = r; b.vx = Math.abs(b.vx); }
			if (b.x + r > W) { b.x = W - r; b.vx = -Math.abs(b.vx); }
			if (b.y - r < 0) { b.y = r; b.vy = Math.abs(b.vy); }
			if (b.y + r > H) { b.y = H - r; b.vy = -Math.abs(b.vy); }
			drawBall(b.x, b.y, r, b.color, 1);
		});
	}

	// ---------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------
	var STATE_MENU = 0, STATE_PLAY = 1, STATE_DYING = 2, STATE_OVER = 3;
	var state = STATE_MENU;
	var paused = false;
	var score = 0;
	var best = parseInt(load(KEY_BEST, '0'), 10) || 0;
	var scoreColor = '#fff';
	var topColor, bottomColor;       // colors of the two central balls
	var incoming = null;             // { fromTop, y, color }
	var spawnTimer = 0;
	var speed = 2.5;                 // original px-per-frame speed, scaled to the screen
	var speedTimer = 0;
	var particles = [];
	var dyingTimer = 0;
	var overShownAt = 0;
	var centralAlpha = 1;
	var shake = 0;

	function radius() { return BASE_RADIUS * U; }
	function separation() { return BASE_SEPARATION * U; }
	function topY() { return H / 2 - separation(); }
	function bottomY() { return H / 2 + separation(); }

	function relayout(oldW, oldH) {
		floaters.forEach(function (b) { b.x = b.x / oldW * W; b.y = b.y / oldH * H; });
		particles.forEach(function (p) { p.x = p.x / oldW * W; p.y = p.y / oldH * H; });
		if (incoming) {
			// keep the incoming ball at the same distance from the center, relative to the screen
			var frac = clamp((incoming.y - oldH / 2) / (oldH / 2), -1.5, 1.5);
			incoming.y = H / 2 + frac * (H / 2);
		}
	}

	function setScore(v, color) {
		score = v;
		scoreEl.textContent = score;
		if (color) {
			scoreColor = color;
			scoreEl.parentNode.style.color = color;
			scoreEl.classList.remove('bump');
			void scoreEl.offsetWidth;
			scoreEl.classList.add('bump');
		}
	}

	function updateBest() {
		bestEl.textContent = best;
		startBest.textContent = best > 0 ? 'Best score: ' + best : '';
	}

	function startGame() {
		ensureAudio();
		state = STATE_PLAY;
		paused = false;
		particles = [];
		incoming = null;
		spawnTimer = 0.35;
		speed = 2.5;
		speedTimer = 0;
		centralAlpha = 1;
		topColor = COLORS[1];
		bottomColor = COLORS[0];
		scoreColor = '#fff';
		scoreEl.parentNode.style.color = '#fff';
		setScore(0);
		startScreen.classList.add('hide');
		overScreen.classList.add('hide');
		pauseScreen.classList.add('hide');
		hud.classList.remove('playing-hidden');
	}

	function swapColors() {
		if (state !== STATE_PLAY || paused) return;
		var t = topColor;
		topColor = bottomColor;
		bottomColor = t;
		sfx.swap();
	}

	function spawnBall() {
		var fromTop = Math.random() < 0.5;
		incoming = {
			fromTop: fromTop,
			y: fromTop ? -50 * U : H + 50 * U,
			color: pick(COLORS)
		};
	}

	function matchBurst(x, y, color) {
		var n = Math.floor(rand(20, 26));
		for (var i = 0; i < n; i++) particles.push(new Particle(x, y, rand(0.4, 0.8), color, 20, 0.25));
	}

	function explode() {
		var balls = [
			{ x: W / 2, y: topY(), c: topColor },
			{ x: W / 2, y: bottomY(), c: bottomColor },
			{ x: W / 2, y: incoming.y, c: incoming.color }
		];
		var n = Math.floor(rand(40, 55));
		for (var i = 0; i < n; i++) {
			balls.forEach(function (b) {
				particles.push(new Particle(b.x, b.y, rand(2, 5), b.c, 20, 0));
			});
		}
		incoming = null;
		centralAlpha = 0;
		shake = 14;
		sfx.crash();
		state = STATE_DYING;
		dyingTimer = 0.9;
		hud.classList.add('playing-hidden');
	}

	function showGameOver() {
		state = STATE_OVER;
		var record = score > best;
		if (record) {
			best = score;
			save(KEY_BEST, best);
		}
		updateBest();
		finalScore.textContent = score;
		finalBest.textContent = record && score > 0 ? 'New best score!' : 'Best score: ' + best;
		finalBest.classList.toggle('record', record && score > 0);
		overScreen.classList.remove('hide');
		overShownAt = performance.now();
	}

	function setPaused(p) {
		if (state !== STATE_PLAY) return;
		paused = p;
		pauseScreen.classList.toggle('hide', !p);
		if (!p) last = performance.now();
	}

	// ---------------------------------------------------------------------
	// Main loop
	// ---------------------------------------------------------------------
	var last = performance.now();

	function update(dt) {
		var f = dt * 60; // original game ran in 60fps frame steps

		if (state === STATE_PLAY) {
			// The balls keep getting faster (as in the original: +0.08 every 1.5 s, up to ~7)
			speedTimer += dt;
			while (speedTimer >= 1.5) {
				speedTimer -= 1.5;
				if (speed <= 7) speed += 0.08;
			}

			if (!incoming) {
				spawnTimer -= dt;
				if (spawnTimer <= 0) spawnBall();
			} else {
				var r = radius();
				var travel = H / 2 - separation() - 2 * r + 50 * U;
				var pxPerFrame = speed * travel / REF_TRAVEL;
				incoming.y += (incoming.fromTop ? 1 : -1) * pxPerFrame * f;
				var targetY = incoming.fromTop ? topY() : bottomY();
				var targetColor = incoming.fromTop ? topColor : bottomColor;
				if (Math.abs(incoming.y - targetY) < 2 * r) {
					if (incoming.color === targetColor) {
						var cy = incoming.fromTop ? targetY - r : targetY + r;
						matchBurst(W / 2, cy, incoming.color);
						setScore(score + 10, incoming.color);
						sfx.match(incoming.color);
						incoming = null;
						spawnTimer = rand(0.08, 0.3);
					} else {
						explode();
					}
				}
			}
		} else if (state === STATE_DYING) {
			dyingTimer -= dt;
			if (dyingTimer <= 0) showGameOver();
		}

		for (var i = particles.length - 1; i >= 0; i--) {
			particles[i].update(f);
			if (particles[i].opacity <= 0.05 || particles[i].ttl <= 1) particles.splice(i, 1);
		}
		if (shake > 0) shake = Math.max(0, shake - f * 0.8);
	}

	function render(dt) {
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.globalAlpha = 1;
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, W, H);

		if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

		if (state === STATE_MENU) {
			updateFloaters(dt * 60);
		} else {
			// guide line along the path of the incoming balls
			ctx.globalAlpha = 0.06;
			ctx.fillStyle = '#fff';
			ctx.fillRect(W / 2 - 1, 0, 2, H);

			var r = radius();
			if (centralAlpha > 0) {
				drawBall(W / 2, topY(), r, topColor, centralAlpha);
				drawBall(W / 2, bottomY(), r, bottomColor, centralAlpha);
			}
			if (incoming) drawBall(W / 2, incoming.y, r, incoming.color, 1);
		}

		particles.forEach(function (p) { p.draw(); });
		ctx.globalAlpha = 1;
	}

	function frame(now) {
		requestAnimationFrame(frame);
		var dt = Math.min((now - last) / 1000, 1 / 20);
		last = now;
		if (paused) return;
		update(dt);
		render(dt);
	}

	// ---------------------------------------------------------------------
	// Input
	// ---------------------------------------------------------------------
	canvas.addEventListener('pointerdown', function (e) {
		e.preventDefault();
		ensureAudio();
		if (state === STATE_PLAY) swapColors();
	});

	function bindButton(el, fn) {
		el.addEventListener('pointerdown', function (e) { e.stopPropagation(); ensureAudio(); });
		el.addEventListener('click', function (e) { e.preventDefault(); fn(); el.blur(); });
	}

	bindButton(playBtn, startGame);
	bindButton(retryBtn, function () {
		if (performance.now() - overShownAt > 350) startGame();
	});
	bindButton(resumeBtn, function () { setPaused(false); });
	bindButton(pauseBtn, function () { setPaused(!paused); });
	bindButton(muteBtn, function () {
		muted = !muted;
		save(KEY_MUTED, muted ? '1' : '0');
		updateMuteButton();
	});

	window.addEventListener('keydown', function (e) {
		var k = e.key;
		if (k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'ArrowUp' || k === 'ArrowDown') {
			e.preventDefault();
			if (e.repeat) return;
			ensureAudio();
			if (state === STATE_PLAY) {
				if (paused) setPaused(false); else swapColors();
			} else if (state === STATE_MENU) {
				startGame();
			} else if (state === STATE_OVER && performance.now() - overShownAt > 500) {
				startGame();
			}
		} else if (k === 'p' || k === 'P' || k === 'Escape') {
			if (state === STATE_PLAY) setPaused(!paused);
		} else if (k === 'm' || k === 'M') {
			muted = !muted;
			save(KEY_MUTED, muted ? '1' : '0');
			updateMuteButton();
		}
	});

	document.addEventListener('visibilitychange', function () {
		if (document.hidden) setPaused(true);
	});
	window.addEventListener('blur', function () { setPaused(true); });
	document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
	window.addEventListener('resize', resize);
	window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

	// ---------------------------------------------------------------------
	// Boot
	// ---------------------------------------------------------------------
	resize();
	initFloaters();
	updateBest();
	updateMuteButton();
	hud.classList.add('playing-hidden');
	scoreEl.textContent = '0';
	requestAnimationFrame(frame);

	// Small read-only hook used for automated testing (no effect on the game)
	window.__colorCollision = {
		get state() { return ['menu', 'play', 'dying', 'over'][state]; },
		get score() { return score; },
		get incoming() { return incoming ? { fromTop: incoming.fromTop, y: incoming.y, color: incoming.color } : null; },
		get colors() { return { top: topColor, bottom: bottomColor }; },
		get height() { return H; },
		get radius() { return radius(); }
	};
})();
