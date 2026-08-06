(function () {
  'use strict';

  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  var STORE_KEY = 'microphonMix60sSettings';
  var SMOOTH_TIME = 0.02;
  var audioContext = null, buffers = {}, graph = null, startAt = 0, offset = 0, playing = false, raf = null;
  var sourceGeneration = 0;
  var trackDefs = [
    { id: 'evolving', name: 'Evolving Circles', file: '../audio/Evolving_Circles_RAW.wav', echo: true, chamber: true, punch: false },
    { id: 'sharp', name: 'Sharp Chorus', file: '../audio/Sharp_Chorus_RAW.wav', echo: false, chamber: true, punch: false },
    { id: 'neon', name: 'Neon GB', file: '../audio/Neon_GB_RAW.wav', echo: false, chamber: false, punch: true }
  ];
  var defaults = {
    tracks: {
      evolving: { volume: -1.6, pan: 0.23, mute: false, solo: false, echoSend: 0.42, chamberSend: 0.38, saturation: 1.035, punch: 0 },
      sharp: { volume: -6.2, pan: -0.23, mute: false, solo: false, echoSend: 0, chamberSend: 0.35, saturation: 1.055, punch: 0 },
      neon: { volume: -1.2, pan: 0, mute: false, solo: false, echoSend: 0, chamberSend: 0, saturation: 1.025, punch: 0.12 }
    },
    effects: { echo: { wet: 1, time: 430, feedback: 0.34, dark: 2750 }, chamber: { wet: 1, duration: 1.8, tone: 3600 } },
    master: { level: -12.8, drive: 1.012, width: 1, ceiling: -1, bypass: false, mono: false }
  };
  var settings = clone(defaults);

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function byId(id) { return document.getElementById(id); }
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function setDeep(path, value) { var p = path.split('.'), o = settings; for (var i = 0; i < p.length - 1; i += 1) o = o[p[i]]; o[p[p.length - 1]] = value; }
  function getDeep(path) { var p = path.split('.'), o = settings; for (var i = 0; i < p.length; i += 1) o = o[p[i]]; return o; }
  function duration() { var d = 0; for (var k in buffers) if (Object.prototype.hasOwnProperty.call(buffers, k)) d = Math.max(d, buffers[k].duration); return d; }
  function fmt(t) { var m = Math.floor(t / 60), s = (t % 60).toFixed(1); if (s < 10) s = '0' + s; return (m < 10 ? '0' : '') + m + ':' + s; }

  function loadWav(url, cb) {
    var xhr = new XMLHttpRequest(); xhr.open('GET', url, true); xhr.responseType = 'arraybuffer';
    xhr.onload = function () { audioContext.decodeAudioData(xhr.response, function (b) { cb(null, b); }, function () { cb(new Error('No se pudo decodificar ' + url)); }); };
    xhr.onerror = function () { cb(new Error('No se pudo cargar ' + url)); };
    xhr.send();
  }

  function makeCurve(drive) { var n = 2048, curve = new Float32Array(n); for (var i = 0; i < n; i += 1) { var x = i * 2 / n - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); } return curve; }
  function smooth(param, value, ctx) {
    var now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, SMOOTH_TIME);
  }
  function anyTrackSoloed() {
    for (var i = 0; i < trackDefs.length; i += 1) if (settings.tracks[trackDefs[i].id].solo) return true;
    return false;
  }
  function audibleTrackGain(id, anySolo) {
    var s = settings.tracks[id];
    return (s.mute || (anySolo && !s.solo)) ? 0 : dbToGain(s.volume);
  }

  /* This graph is also used to create an entirely independent OfflineAudioContext graph. */
  function buildGraph(ctx, when, pos, masterLevel) {
    var g = { context: ctx, tracks: {}, sources: [] };
    g.masterIn = ctx.createGain();
    g.masterDrive = ctx.createWaveShaper(); g.masterDrive.curve = makeCurve(settings.master.drive); g.masterDrive.oversample = 'none';
    g.masterGain = ctx.createGain(); g.masterGain.gain.value = dbToGain(masterLevel === undefined ? settings.master.level : masterLevel);
    g.compressor = ctx.createDynamicsCompressor();
    g.compressor.threshold.value = settings.master.ceiling; g.compressor.knee.value = 0; g.compressor.ratio.value = 20; g.compressor.attack.value = 0.006; g.compressor.release.value = 0.18;
    g.processedGain = ctx.createGain(); g.processedGain.gain.value = settings.master.bypass ? 0 : 1;
    g.bypassGain = ctx.createGain(); g.bypassGain.gain.value = settings.master.bypass ? 1 : 0;
    g.outputIn = ctx.createGain();

    /* Stable stereo master: no Mid/Side split, inversion, or channel reconstruction. */
    g.masterIn.connect(g.masterDrive); g.masterDrive.connect(g.masterGain); g.masterGain.connect(g.compressor); g.compressor.connect(g.processedGain); g.processedGain.connect(g.outputIn);
    g.masterIn.connect(g.bypassGain); g.bypassGain.connect(g.outputIn);

    /* Permanent stereo and mono monitor routes, switched with smoothed gains. */
    g.stereoMonitorGain = ctx.createGain(); g.stereoMonitorGain.gain.value = settings.master.mono ? 0 : 1;
    g.monoMonitorGain = ctx.createGain(); g.monoMonitorGain.gain.value = settings.master.mono ? 1 : 0;
    g.monoSplitter = ctx.createChannelSplitter(2); g.monoSum = ctx.createGain(); g.monoSum.gain.value = 0.5; g.monoMerger = ctx.createChannelMerger(2);
    g.outputIn.connect(g.stereoMonitorGain); g.stereoMonitorGain.connect(ctx.destination);
    g.outputIn.connect(g.monoSplitter); g.monoSplitter.connect(g.monoSum, 0); g.monoSplitter.connect(g.monoSum, 1);
    g.monoSum.connect(g.monoMonitorGain); g.monoMonitorGain.connect(g.monoMerger, 0, 0); g.monoMonitorGain.connect(g.monoMerger, 0, 1); g.monoMerger.connect(ctx.destination);

    g.echoDelay = ctx.createDelay(1.5); g.echoFeedback = ctx.createGain(); g.echoFilter = ctx.createBiquadFilter(); g.echoReturn = ctx.createGain();
    g.echoDelay.delayTime.value = settings.effects.echo.time / 1000; g.echoFeedback.gain.value = settings.effects.echo.feedback; g.echoFilter.type = 'lowpass'; g.echoFilter.frequency.value = settings.effects.echo.dark; g.echoReturn.gain.value = settings.effects.echo.wet;
    g.echoDelay.connect(g.echoFilter); g.echoFilter.connect(g.echoFeedback); g.echoFeedback.connect(g.echoDelay); g.echoFilter.connect(g.echoReturn); g.echoReturn.connect(g.masterIn);
    g.chamberDelay = ctx.createDelay(4.5); g.chamberFeedback = ctx.createGain(); g.chamberFilter = ctx.createBiquadFilter(); g.chamberReturn = ctx.createGain();
    g.chamberDelay.delayTime.value = settings.effects.chamber.duration / 10; g.chamberFeedback.gain.value = Math.min(0.72, settings.effects.chamber.duration / 5); g.chamberFilter.type = 'lowpass'; g.chamberFilter.frequency.value = settings.effects.chamber.tone; g.chamberReturn.gain.value = settings.effects.chamber.wet;
    g.chamberDelay.connect(g.chamberFilter); g.chamberFilter.connect(g.chamberFeedback); g.chamberFeedback.connect(g.chamberDelay); g.chamberFilter.connect(g.chamberReturn); g.chamberReturn.connect(g.masterIn);

    var anySolo = anyTrackSoloed();
    trackDefs.forEach(function (t) {
      var s = settings.tracks[t.id], nodes = {};
      nodes.source = ctx.createBufferSource(); nodes.saturation = ctx.createWaveShaper(); nodes.punchBody = ctx.createBiquadFilter(); nodes.punchAttack = ctx.createBiquadFilter(); nodes.volume = ctx.createGain(); nodes.pan = ctx.createStereoPanner(); nodes.echoSend = ctx.createGain(); nodes.chamberSend = ctx.createGain();
      nodes.source.buffer = buffers[t.id]; nodes.saturation.curve = makeCurve(s.saturation);
      nodes.punchBody.type = 'peaking'; nodes.punchBody.frequency.value = 110; nodes.punchBody.Q.value = 0.8; nodes.punchBody.gain.value = t.punch ? s.punch * 2 : 0;
      nodes.punchAttack.type = 'peaking'; nodes.punchAttack.frequency.value = 3200; nodes.punchAttack.Q.value = 0.9; nodes.punchAttack.gain.value = t.punch ? s.punch * 6 : 0;
      nodes.volume.gain.value = audibleTrackGain(t.id, anySolo); nodes.pan.pan.value = s.pan; nodes.echoSend.gain.value = t.echo ? s.echoSend : 0; nodes.chamberSend.gain.value = t.chamber ? s.chamberSend : 0;
      nodes.source.connect(nodes.saturation); nodes.saturation.connect(nodes.punchBody); nodes.punchBody.connect(nodes.punchAttack); nodes.punchAttack.connect(nodes.volume); nodes.volume.connect(nodes.pan);
      nodes.pan.connect(g.masterIn); nodes.pan.connect(nodes.echoSend); nodes.echoSend.connect(g.echoDelay); nodes.pan.connect(nodes.chamberSend); nodes.chamberSend.connect(g.chamberDelay);
      nodes.source.start(when, pos); g.tracks[t.id] = nodes; g.sources.push(nodes.source);
    });
    return g;
  }

  function updateTrackGains() {
    if (!graph) return;
    var anySolo = anyTrackSoloed();
    trackDefs.forEach(function (t) { smooth(graph.tracks[t.id].volume.gain, audibleTrackGain(t.id, anySolo), graph.context); });
  }
  function updateAudioParameter(path) {
    if (!graph || graph.context !== audioContext) return;
    var parts = path.split('.'), t, s;
    if (parts[0] === 'tracks') {
      t = graph.tracks[parts[1]]; s = settings.tracks[parts[1]];
      if (parts[2] === 'volume' || parts[2] === 'mute' || parts[2] === 'solo') updateTrackGains();
      else if (parts[2] === 'pan') smooth(t.pan.pan, s.pan, audioContext);
      else if (parts[2] === 'echoSend') smooth(t.echoSend.gain, s.echoSend, audioContext);
      else if (parts[2] === 'chamberSend') smooth(t.chamberSend.gain, s.chamberSend, audioContext);
      else if (parts[2] === 'saturation') t.saturation.curve = makeCurve(s.saturation);
      else if (parts[2] === 'punch') { smooth(t.punchBody.gain, s.punch * 2, audioContext); smooth(t.punchAttack.gain, s.punch * 6, audioContext); }
    } else if (path === 'effects.echo.wet') smooth(graph.echoReturn.gain, settings.effects.echo.wet, audioContext);
    else if (path === 'effects.echo.time') smooth(graph.echoDelay.delayTime, settings.effects.echo.time / 1000, audioContext);
    else if (path === 'effects.echo.feedback') smooth(graph.echoFeedback.gain, settings.effects.echo.feedback, audioContext);
    else if (path === 'effects.echo.dark') smooth(graph.echoFilter.frequency, settings.effects.echo.dark, audioContext);
    else if (path === 'effects.chamber.wet') smooth(graph.chamberReturn.gain, settings.effects.chamber.wet, audioContext);
    else if (path === 'effects.chamber.duration') { smooth(graph.chamberDelay.delayTime, settings.effects.chamber.duration / 10, audioContext); smooth(graph.chamberFeedback.gain, Math.min(0.72, settings.effects.chamber.duration / 5), audioContext); }
    else if (path === 'effects.chamber.tone') smooth(graph.chamberFilter.frequency, settings.effects.chamber.tone, audioContext);
    else if (path === 'master.level') smooth(graph.masterGain.gain, dbToGain(settings.master.level), audioContext);
    else if (path === 'master.drive') graph.masterDrive.curve = makeCurve(settings.master.drive);
    else if (path === 'master.ceiling') smooth(graph.compressor.threshold, settings.master.ceiling, audioContext);
    else if (path === 'master.bypass') { smooth(graph.processedGain.gain, settings.master.bypass ? 0 : 1, audioContext); smooth(graph.bypassGain.gain, settings.master.bypass ? 1 : 0, audioContext); }
    else if (path === 'master.mono') { smooth(graph.stereoMonitorGain.gain, settings.master.mono ? 0 : 1, audioContext); smooth(graph.monoMonitorGain.gain, settings.master.mono ? 1 : 0, audioContext); }
    /* master.width is deliberately inert until a reliable stereo implementation exists. */
  }
  function updateAllAudioParameters() {
    var nodes = document.querySelectorAll('[data-setting]');
    for (var i = 0; i < nodes.length; i += 1) updateAudioParameter(nodes[i].getAttribute('data-setting'));
  }

  function play() { if (playing) return; if (audioContext.state === 'suspended') audioContext.resume(); graph = buildGraph(audioContext, 0, offset); sourceGeneration += 1; startAt = audioContext.currentTime - offset; playing = true; tick(); }
  function stopSources() { if (graph) graph.sources.forEach(function (s) { try { s.stop(0); } catch (e) {} }); graph = null; }
  function stop() { stopSources(); playing = false; offset = 0; if (raf) window.cancelAnimationFrame(raf); updateTime(); }
  function currentPos() { return playing ? Math.min(duration(), audioContext.currentTime - startAt) : offset; }
  function seek(v) { var p = duration() * v / 1000; offset = p; if (playing) { stopSources(); playing = false; play(); } updateTime(); }
  function tick() { updateTime(); if (playing && currentPos() >= duration()) stop(); else if (playing) raf = window.requestAnimationFrame(tick); }
  function updateTime() { var p = currentPos(), d = duration(); byId('timeDisplay').innerHTML = fmt(p) + ' / ' + fmt(d); byId('position').value = d ? Math.floor(p / d * 1000) : 0; }

  function addChannel(def) {
    var el = document.createElement('div'); el.className = 'channel panel';
    el.innerHTML = '<h2>' + def.name + '</h2>' + control('Volumen dB', 'tracks.'+def.id+'.volume', -24, 6, .1) + control('Panorama', 'tracks.'+def.id+'.pan', -1, 1, .01) + '<div class="mini-buttons"><label class="switch"><input data-setting="tracks.'+def.id+'.mute" type="checkbox"> Mute</label><label class="switch"><input data-setting="tracks.'+def.id+'.solo" type="checkbox"> Solo</label></div>' + (def.echo ? control('Envío Tape Echo', 'tracks.'+def.id+'.echoSend', 0, 1, .01) : '') + (def.chamber ? control('Envío Chamber', 'tracks.'+def.id+'.chamberSend', 0, 1, .01) : '') + control('Saturación cinta', 'tracks.'+def.id+'.saturation', 1, 3, .01) + (def.punch ? control('Presencia / punch', 'tracks.'+def.id+'.punch', 0, 1, .01) : '');
    byId('channels').appendChild(el);
  }
  function control(label, path, min, max, step) { return '<label>' + label + ' <span class="value" data-value="'+path+'"></span><input data-setting="'+path+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'"></label>'; }
  function bindControls() {
    var nodes = document.querySelectorAll('[data-setting]');
    for (var i = 0; i < nodes.length; i += 1) nodes[i].oninput = function () { var path = this.getAttribute('data-setting'); setDeep(path, this.type === 'checkbox' ? this.checked : parseFloat(this.value)); if (path === 'master.width') settings.master.width = 1; refreshControls(); updateAudioParameter(path); };
    var width = document.querySelector('[data-setting="master.width"]'); if (width) { width.disabled = true; width.value = 1; width.parentNode.title = 'Temporalmente no disponible'; }
    refreshControls();
  }
  function refreshControls() { var nodes = document.querySelectorAll('[data-setting]'); for (var i = 0; i < nodes.length; i += 1) { var n = nodes[i], v = getDeep(n.getAttribute('data-setting')); if (n.type === 'checkbox') n.checked = !!v; else n.value = v; } var vals = document.querySelectorAll('[data-value]'); for (i = 0; i < vals.length; i += 1) vals[i].innerHTML = getDeep(vals[i].getAttribute('data-value')); }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); byId('renderStatus').innerHTML = 'Ajustes guardados.'; }
  function normalizeSettings() { settings.master.width = 1; }
  function restore() { var raw = localStorage.getItem(STORE_KEY); if (raw) settings = JSON.parse(raw); normalizeSettings(); refreshControls(); updateAllAudioParameters(); byId('renderStatus').innerHTML = raw ? 'Ajustes restaurados.' : 'No había ajustes guardados.'; }
  function initial() { settings = clone(defaults); refreshControls(); updateAllAudioParameters(); byId('renderStatus').innerHTML = 'Valores iniciales cargados.'; }

  function render() {
    /* Capture the audible fader value at the click, before the deferred offline graph is built. */
    var renderMasterLevel = settings.master.level;
    byId('renderBtn').disabled = true; byId('renderProgress').value = 10; byId('renderStatus').innerHTML = 'Renderizando toda la canción…';
    setTimeout(function () { var sr = audioContext.sampleRate, ctx = new OfflineAudioContext(2, Math.ceil(duration() * sr), sr); buildGraph(ctx, 0, 0, renderMasterLevel); byId('renderProgress').value = 45; ctx.startRendering().then(function (b) { byId('renderProgress').value = 85; var blob = MicrophonWavEncoder.encodeWav(b.getChannelData(0), b.getChannelData(1), b.sampleRate); var url = URL.createObjectURL(blob); byId('downloadLink').href = url; byId('downloadLink').className = 'download ready'; byId('renderProgress').value = 100; byId('renderStatus').innerHTML = 'Render terminado: microphon_mix_60s.wav'; byId('renderBtn').disabled = false; }); }, 50);
  }

  /* Read-only diagnostics for checking transport/source stability while moving controls. */
  window.microphonMixerDiagnostics = function () {
    var positions = [], i;
    if (graph) for (i = 0; i < trackDefs.length; i += 1) positions.push(currentPos());
    return { playing: playing, position: currentPos(), sourceGeneration: sourceGeneration, activeSources: graph ? graph.sources.length : 0, tracksSynchronized: positions.length === 0 || Math.max.apply(Math, positions) - Math.min.apply(Math, positions) < 0.001, stereoWidth: 1, masterBypass: settings.master.bypass, mono: settings.master.mono };
  };

  function boot() {
    if (!AudioContextClass) { byId('loadStatus').innerHTML = 'Web Audio API no disponible.'; return; }
    audioContext = new AudioContextClass(); trackDefs.forEach(addChannel); bindControls();
    var left = trackDefs.length; trackDefs.forEach(function (t) { loadWav(t.file, function (err, b) { if (err) { byId('loadStatus').innerHTML = err.message; return; } buffers[t.id] = b; left -= 1; byId('loadStatus').innerHTML = 'Cargadas ' + (trackDefs.length - left) + ' / ' + trackDefs.length + ' pistas'; if (!left) { ['playBtn','stopBtn','position','renderBtn'].forEach(function (id) { byId(id).disabled = false; }); updateTime(); byId('loadStatus').innerHTML = 'Tres WAV cargados y listos'; } }); });
    byId('playBtn').onclick = play; byId('stopBtn').onclick = stop; byId('position').oninput = function () { seek(parseFloat(this.value)); };
    byId('renderBtn').onclick = render; byId('saveBtn').onclick = save; byId('restoreBtn').onclick = restore; byId('defaultsBtn').onclick = initial;
  }
  boot();
}());
