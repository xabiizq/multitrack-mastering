(function () {
  'use strict';

  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  var STORE_KEY = 'microphonMix60sSettings';
  var SMOOTH_TIME = 0.02, CROSSFADE_TIME = 0.045, VU_REFERENCE_DBFS = -18;
  var audioContext = null, buffers = {}, graph = null, startAt = 0, offset = 0, playing = false, raf = null;
  var sourceGeneration = 0, listenRoute = 'mix', meterStates = {};
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
  function gainToDb(gain) { return gain > 0 ? 20 * Math.log(gain) / Math.LN10 : -96; }
  function setDeep(path, value) { var p = path.split('.'), o = settings; for (var i = 0; i < p.length - 1; i += 1) o = o[p[i]]; o[p[p.length - 1]] = value; }
  function getDeep(path) { var p = path.split('.'), o = settings; for (var i = 0; i < p.length; i += 1) o = o[p[i]]; return o; }
  function duration() { var d = 0; for (var k in buffers) if (Object.prototype.hasOwnProperty.call(buffers, k)) d = Math.max(d, buffers[k].duration); return d; }
  function fmt(t) { var m = Math.floor(t / 60), s = (t % 60).toFixed(1); if (s < 10) s = '0' + s; return (m < 10 ? '0' : '') + m + ':' + s; }
  function clampWidth(value) { return Math.max(0, Math.min(1.5, Number(value) || 0)); }
  function punchBodyGain(value) { return value * 4; }
  function punchAttackGain(value) { return value * 6; }

  function loadWav(url, cb) {
    var xhr = new XMLHttpRequest(); xhr.open('GET', url, true); xhr.responseType = 'arraybuffer';
    xhr.onload = function () { audioContext.decodeAudioData(xhr.response, function (b) { cb(null, b); }, function () { cb(new Error('No se pudo decodificar ' + url)); }); };
    xhr.onerror = function () { cb(new Error('No se pudo cargar ' + url)); }; xhr.send();
  }

  function makeCurve(drive, colour) {
    var n = 4096, curve = new Float32Array(n), norm = Math.tanh(drive);
    for (var i = 0; i < n; i += 1) { var x = i * 2 / (n - 1) - 1; curve[i] = Math.tanh(drive * x + (colour || 0) * x * x) / norm; }
    return curve;
  }
  function smooth(param, value, ctx, time) { var now = ctx.currentTime; param.cancelScheduledValues(now); param.setTargetAtTime(value, now, time || SMOOTH_TIME); }
  function anyTrackSoloed() { for (var i = 0; i < trackDefs.length; i += 1) if (settings.tracks[trackDefs[i].id].solo) return true; return false; }
  function audibleTrackGain(id, anySolo) { var s = settings.tracks[id]; return (s.mute || (anySolo && !s.solo)) ? 0 : dbToGain(s.volume); }

  function buildWidth(ctx, input, width) {
    var n = {}, monoNodes;
    n.splitter = ctx.createChannelSplitter(2); n.mid = ctx.createGain(); n.sideL = ctx.createGain(); n.sideR = ctx.createGain(); n.side = ctx.createGain(); n.invert = ctx.createGain(); n.output = ctx.createChannelMerger(2);
    monoNodes = [n.mid, n.sideL, n.sideR, n.side, n.invert]; monoNodes.forEach(function (node) { node.channelCount = 1; node.channelCountMode = 'explicit'; });
    n.mid.gain.value = 0.5; n.sideL.gain.value = 0.5; n.sideR.gain.value = -0.5; n.side.gain.value = clampWidth(width); n.invert.gain.value = -1;
    input.connect(n.splitter); n.splitter.connect(n.mid, 0); n.splitter.connect(n.mid, 1); n.splitter.connect(n.sideL, 0); n.splitter.connect(n.sideR, 1); n.sideL.connect(n.side); n.sideR.connect(n.side);
    n.mid.connect(n.output, 0, 0); n.mid.connect(n.output, 0, 1); n.side.connect(n.output, 0, 0); n.side.connect(n.invert); n.invert.connect(n.output, 0, 1);
    return n;
  }

  function buildVinylMaster(ctx, input) {
    var n = {}, ms = buildWidth(ctx, input, 1);
    /* A low shelf only on SIDE progressively reduces lateral bass while MID remains untouched. */
    n.sideBass = ctx.createBiquadFilter(); n.sideBass.type = 'lowshelf'; n.sideBass.frequency.value = 130; n.sideBass.gain.value = -9;
    ms.side.disconnect(); ms.side.connect(n.sideBass); n.sideBass.connect(ms.output, 0, 0); n.sideBass.connect(ms.invert); ms.invert.connect(ms.output, 0, 1);
    n.sub = ctx.createBiquadFilter(); n.sub.type = 'highpass'; n.sub.frequency.value = 24; n.sub.Q.value = 0.5;
    n.top = ctx.createBiquadFilter(); n.top.type = 'highshelf'; n.top.frequency.value = 10500; n.top.gain.value = -1.2;
    n.tape = ctx.createWaveShaper(); n.tape.curve = makeCurve(1.035, 0.012); n.tape.oversample = '2x';
    n.glue = ctx.createDynamicsCompressor(); n.glue.threshold.value = -16; n.glue.knee.value = 12; n.glue.ratio.value = 1.6; n.glue.attack.value = 0.035; n.glue.release.value = 0.3;
    n.peak = ctx.createDynamicsCompressor(); n.peak.threshold.value = -1.5; n.peak.knee.value = 3; n.peak.ratio.value = 4; n.peak.attack.value = 0.004; n.peak.release.value = 0.16;
    ms.output.connect(n.sub); n.sub.connect(n.top); n.top.connect(n.tape); n.tape.connect(n.glue); n.glue.connect(n.peak); n.output = n.peak; n.width = ms; return n;
  }

  function buildDigitalMaster(ctx, input) {
    var n = {};
    n.sub = ctx.createBiquadFilter(); n.sub.type = 'highpass'; n.sub.frequency.value = 20; n.sub.Q.value = 0.5;
    n.top = ctx.createBiquadFilter(); n.top.type = 'highshelf'; n.top.frequency.value = 12000; n.top.gain.value = -0.5;
    n.tape = ctx.createWaveShaper(); n.tape.curve = makeCurve(1.025, 0.008); n.tape.oversample = '2x';
    n.glue = ctx.createDynamicsCompressor(); n.glue.threshold.value = -15; n.glue.knee.value = 10; n.glue.ratio.value = 1.8; n.glue.attack.value = 0.025; n.glue.release.value = 0.22;
    n.peak = ctx.createDynamicsCompressor(); n.peak.threshold.value = -1; n.peak.knee.value = 1.5; n.peak.ratio.value = 12; n.peak.attack.value = 0.002; n.peak.release.value = 0.12;
    input.connect(n.sub); n.sub.connect(n.top); n.top.connect(n.tape); n.tape.connect(n.glue); n.glue.connect(n.peak); n.output = n.peak; return n;
  }

  function attachMeter(ctx, source, id, channel) {
    var input = source, splitter, analyser = ctx.createAnalyser(), sink = ctx.createGain();
    analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0; sink.gain.value = 0;
    if (channel !== undefined) { splitter = ctx.createChannelSplitter(2); source.connect(splitter); splitter.connect(analyser, channel); } else source.connect(analyser);
    analyser.connect(sink); sink.connect(ctx.destination);
    meterStates[id] = { analyser: analyser, data: new Float32Array(analyser.fftSize), vu: 0, peak: 0, held: 0, holdUntil: 0 };
    return input;
  }

  /* One graph builder is used for realtime monitoring and all three OfflineAudioContext renders. */
  function buildGraph(ctx, when, pos, options) {
    options = options || {}; var g = { context: ctx, tracks: {}, sources: [], routeGains: {} }, masterLevel = options.masterLevel;
    g.mixIn = ctx.createGain(); g.masterDrive = ctx.createWaveShaper(); g.masterDrive.curve = makeCurve(settings.master.drive); g.masterDrive.oversample = 'none';
    g.masterGain = ctx.createGain(); g.masterGain.gain.value = dbToGain(masterLevel === undefined ? settings.master.level : masterLevel);
    g.compressor = ctx.createDynamicsCompressor(); g.compressor.threshold.value = settings.master.ceiling; g.compressor.knee.value = 0; g.compressor.ratio.value = 20; g.compressor.attack.value = 0.006; g.compressor.release.value = 0.18;
    g.processedGain = ctx.createGain(); g.processedGain.gain.value = settings.master.bypass ? 0 : 1; g.bypassGain = ctx.createGain(); g.bypassGain.gain.value = settings.master.bypass ? 1 : 0; g.widthInput = ctx.createGain();
    g.mixIn.connect(g.masterDrive); g.masterDrive.connect(g.masterGain); g.masterGain.connect(g.compressor); g.compressor.connect(g.processedGain); g.processedGain.connect(g.widthInput); g.mixIn.connect(g.bypassGain); g.bypassGain.connect(g.widthInput);
    g.width = buildWidth(ctx, g.widthInput, settings.master.width); g.mixOut = g.width.output;
    g.vinyl = buildVinylMaster(ctx, g.mixOut); g.digital = buildDigitalMaster(ctx, g.mixOut);

    g.echoDelay = ctx.createDelay(1.5); g.echoFeedback = ctx.createGain(); g.echoFilter = ctx.createBiquadFilter(); g.echoReturn = ctx.createGain();
    g.echoDelay.delayTime.value = settings.effects.echo.time / 1000; g.echoFeedback.gain.value = settings.effects.echo.feedback; g.echoFilter.type = 'lowpass'; g.echoFilter.frequency.value = settings.effects.echo.dark; g.echoReturn.gain.value = settings.effects.echo.wet;
    g.echoDelay.connect(g.echoFilter); g.echoFilter.connect(g.echoFeedback); g.echoFeedback.connect(g.echoDelay); g.echoFilter.connect(g.echoReturn); g.echoReturn.connect(g.mixIn);
    g.chamberDelay = ctx.createDelay(4.5); g.chamberFeedback = ctx.createGain(); g.chamberFilter = ctx.createBiquadFilter(); g.chamberReturn = ctx.createGain();
    g.chamberDelay.delayTime.value = settings.effects.chamber.duration / 10; g.chamberFeedback.gain.value = Math.min(0.72, settings.effects.chamber.duration / 5); g.chamberFilter.type = 'lowpass'; g.chamberFilter.frequency.value = settings.effects.chamber.tone; g.chamberReturn.gain.value = settings.effects.chamber.wet;
    g.chamberDelay.connect(g.chamberFilter); g.chamberFilter.connect(g.chamberFeedback); g.chamberFeedback.connect(g.chamberDelay); g.chamberFilter.connect(g.chamberReturn); g.chamberReturn.connect(g.mixIn);

    var anySolo = anyTrackSoloed();
    trackDefs.forEach(function (t) {
      var s = settings.tracks[t.id], n = {};
      n.source = ctx.createBufferSource(); n.saturation = ctx.createWaveShaper(); n.punchBody = ctx.createBiquadFilter(); n.punchAttack = ctx.createBiquadFilter(); n.volume = ctx.createGain(); n.pan = ctx.createStereoPanner(); n.echoSend = ctx.createGain(); n.chamberSend = ctx.createGain();
      n.source.buffer = buffers[t.id]; n.saturation.curve = makeCurve(s.saturation); n.punchBody.type = 'peaking'; n.punchBody.frequency.value = 110; n.punchBody.Q.value = 0.8; n.punchBody.gain.value = t.punch ? punchBodyGain(s.punch) : 0; n.punchAttack.type = 'peaking'; n.punchAttack.frequency.value = 3200; n.punchAttack.Q.value = 0.9; n.punchAttack.gain.value = t.punch ? punchAttackGain(s.punch) : 0;
      n.volume.gain.value = audibleTrackGain(t.id, anySolo); n.pan.pan.value = s.pan; n.echoSend.gain.value = t.echo ? s.echoSend : 0; n.chamberSend.gain.value = t.chamber ? s.chamberSend : 0;
      n.source.connect(n.saturation); n.saturation.connect(n.punchBody); n.punchBody.connect(n.punchAttack); n.punchAttack.connect(n.volume); n.volume.connect(n.pan); n.pan.connect(g.mixIn); n.pan.connect(n.echoSend); n.echoSend.connect(g.echoDelay); n.pan.connect(n.chamberSend); n.chamberSend.connect(g.chamberDelay);
      if (options.realtime) attachMeter(ctx, n.pan, 'track-' + t.id); n.source.start(when, pos); g.tracks[t.id] = n; g.sources.push(n.source);
    });

    if (options.realtime) {
      attachMeter(ctx, g.mixOut, 'mix-l', 0); attachMeter(ctx, g.mixOut, 'mix-r', 1); attachMeter(ctx, g.vinyl.output, 'vinyl-l', 0); attachMeter(ctx, g.vinyl.output, 'vinyl-r', 1); attachMeter(ctx, g.digital.output, 'digital-l', 0); attachMeter(ctx, g.digital.output, 'digital-r', 1);
      g.monitorInput = ctx.createGain(); ['mix', 'vinyl', 'digital'].forEach(function (route) { var source = route === 'mix' ? g.mixOut : g[route].output; g.routeGains[route] = ctx.createGain(); g.routeGains[route].gain.value = route === listenRoute ? 1 : 0; source.connect(g.routeGains[route]); g.routeGains[route].connect(g.monitorInput); });
      g.stereoMonitorGain = ctx.createGain(); g.stereoMonitorGain.gain.value = settings.master.mono ? 0 : 1; g.monoMonitorGain = ctx.createGain(); g.monoMonitorGain.gain.value = settings.master.mono ? 1 : 0; g.monoSplitter = ctx.createChannelSplitter(2); g.monoSum = ctx.createGain(); g.monoSum.gain.value = 0.5; g.monoMerger = ctx.createChannelMerger(2);
      g.monitorInput.connect(g.stereoMonitorGain); g.stereoMonitorGain.connect(ctx.destination); g.monitorInput.connect(g.monoSplitter); g.monoSplitter.connect(g.monoSum, 0); g.monoSplitter.connect(g.monoSum, 1); g.monoSum.connect(g.monoMonitorGain); g.monoMonitorGain.connect(g.monoMerger, 0, 0); g.monoMonitorGain.connect(g.monoMerger, 0, 1); g.monoMerger.connect(ctx.destination);
    } else (options.route === 'vinyl' ? g.vinyl.output : options.route === 'digital' ? g.digital.output : g.mixOut).connect(ctx.destination);
    return g;
  }

  function updateTrackGains() { if (!graph) return; var solo = anyTrackSoloed(); trackDefs.forEach(function (t) { smooth(graph.tracks[t.id].volume.gain, audibleTrackGain(t.id, solo), graph.context); }); }
  function updateAudioParameter(path) {
    if (!graph || graph.context !== audioContext) return; var p = path.split('.'), t, s;
    if (p[0] === 'tracks') { t = graph.tracks[p[1]]; s = settings.tracks[p[1]]; if (p[2] === 'volume' || p[2] === 'mute' || p[2] === 'solo') updateTrackGains(); else if (p[2] === 'pan') smooth(t.pan.pan, s.pan, audioContext); else if (p[2] === 'echoSend') smooth(t.echoSend.gain, s.echoSend, audioContext); else if (p[2] === 'chamberSend') smooth(t.chamberSend.gain, s.chamberSend, audioContext); else if (p[2] === 'saturation') t.saturation.curve = makeCurve(s.saturation); else if (p[2] === 'punch') { smooth(t.punchBody.gain, punchBodyGain(s.punch), audioContext); smooth(t.punchAttack.gain, punchAttackGain(s.punch), audioContext); } }
    else if (path === 'effects.echo.wet') smooth(graph.echoReturn.gain, settings.effects.echo.wet, audioContext); else if (path === 'effects.echo.time') smooth(graph.echoDelay.delayTime, settings.effects.echo.time / 1000, audioContext); else if (path === 'effects.echo.feedback') smooth(graph.echoFeedback.gain, settings.effects.echo.feedback, audioContext); else if (path === 'effects.echo.dark') smooth(graph.echoFilter.frequency, settings.effects.echo.dark, audioContext); else if (path === 'effects.chamber.wet') smooth(graph.chamberReturn.gain, settings.effects.chamber.wet, audioContext); else if (path === 'effects.chamber.duration') { smooth(graph.chamberDelay.delayTime, settings.effects.chamber.duration / 10, audioContext); smooth(graph.chamberFeedback.gain, Math.min(0.72, settings.effects.chamber.duration / 5), audioContext); } else if (path === 'effects.chamber.tone') smooth(graph.chamberFilter.frequency, settings.effects.chamber.tone, audioContext);
    else if (path === 'master.level') smooth(graph.masterGain.gain, dbToGain(settings.master.level), audioContext); else if (path === 'master.drive') graph.masterDrive.curve = makeCurve(settings.master.drive); else if (path === 'master.ceiling') smooth(graph.compressor.threshold, settings.master.ceiling, audioContext); else if (path === 'master.width') smooth(graph.width.side.gain, clampWidth(settings.master.width), audioContext); else if (path === 'master.bypass') { smooth(graph.processedGain.gain, settings.master.bypass ? 0 : 1, audioContext); smooth(graph.bypassGain.gain, settings.master.bypass ? 1 : 0, audioContext); } else if (path === 'master.mono') { smooth(graph.stereoMonitorGain.gain, settings.master.mono ? 0 : 1, audioContext); smooth(graph.monoMonitorGain.gain, settings.master.mono ? 1 : 0, audioContext); }
  }
  function updateAllAudioParameters() { var nodes = document.querySelectorAll('[data-setting]'); for (var i = 0; i < nodes.length; i += 1) updateAudioParameter(nodes[i].getAttribute('data-setting')); }
  function selectRoute(route) { listenRoute = route; document.querySelectorAll('[data-route]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-route') === route); }); if (graph) Object.keys(graph.routeGains).forEach(function (key) { smooth(graph.routeGains[key].gain, key === route ? 1 : 0, audioContext, CROSSFADE_TIME); }); }

  function play() { if (playing) return; if (audioContext.state === 'suspended') audioContext.resume(); meterStates = {}; graph = buildGraph(audioContext, 0, offset, { realtime: true }); sourceGeneration += 1; startAt = audioContext.currentTime - offset; playing = true; tick(); }
  function stopSources() { if (graph) graph.sources.forEach(function (s) { try { s.stop(0); } catch (e) {} }); graph = null; meterStates = {}; }
  function stop() { stopSources(); playing = false; offset = 0; if (raf) window.cancelAnimationFrame(raf); resetMeters(); updateTime(); }
  function currentPos() { return playing ? Math.min(duration(), audioContext.currentTime - startAt) : offset; }
  function seek(v) { var p = duration() * v / 1000; offset = p; if (playing) { stopSources(); playing = false; play(); } updateTime(); }
  function tick(now) { updateTime(); updateMeters(now || performance.now()); if (playing && currentPos() >= duration()) stop(); else if (playing) raf = window.requestAnimationFrame(tick); }
  function updateTime() { var p = currentPos(), d = duration(); byId('timeDisplay').innerHTML = fmt(p) + ' / ' + fmt(d); byId('position').value = d ? Math.floor(p / d * 1000) : 0; }

  function meterHtml(id, label) { return '<div class="meter-unit" id="meter-'+id+'"><strong>'+label+'</strong><div class="meter-row"><span>VU</span><div class="meter-track vu-track"><i class="vu-fill"></i><b class="vu-zero">0</b></div><output class="vu-read">−∞</output></div><div class="meter-row"><span>PEAK</span><div class="meter-track peak-track"><i class="peak-fill"></i></div><output class="peak-read">−∞</output></div></div>'; }
  function meterPercent(db, min, max) { return Math.max(0, Math.min(100, (db - min) / (max - min) * 100)); }
  function paintMeter(id, state) { var el = byId('meter-' + id); if (!el) return; var vuDb = gainToDb(state.vu), peakDb = gainToDb(state.held); el.querySelector('.vu-fill').style.width = meterPercent(vuDb - VU_REFERENCE_DBFS, -20, 3) + '%'; el.querySelector('.peak-fill').style.width = meterPercent(peakDb, -60, 3) + '%'; el.querySelector('.vu-read').textContent = vuDb <= -90 ? '−∞' : (vuDb - VU_REFERENCE_DBFS).toFixed(1); el.querySelector('.peak-read').textContent = peakDb <= -90 ? '−∞' : peakDb.toFixed(1); el.classList.toggle('clipping', state.held >= 1); }
  function updateMeters(now) { Object.keys(meterStates).forEach(function (id) { var s = meterStates[id], sum = 0, peak = 0, i, x, rms; s.analyser.getFloatTimeDomainData(s.data); for (i = 0; i < s.data.length; i += 1) { x = Math.abs(s.data[i]); sum += x * x; if (x > peak) peak = x; } rms = Math.sqrt(sum / s.data.length); s.vu += (rms - s.vu) * (rms > s.vu ? 0.18 : 0.07); if (peak >= s.held) { s.held = peak; s.holdUntil = now + 700; } else if (now > s.holdUntil) s.held *= 0.93; paintMeter(id, s); }); }
  function resetMeters() { document.querySelectorAll('.meter-unit').forEach(function (el) { el.querySelector('.vu-fill').style.width = '0'; el.querySelector('.peak-fill').style.width = '0'; el.querySelectorAll('output').forEach(function (o) { o.textContent = '−∞'; }); el.classList.remove('clipping'); }); }

  function addChannel(def) { var el = document.createElement('div'); el.className = 'channel panel'; el.innerHTML = '<h2>'+def.name+'</h2>'+meterHtml('track-'+def.id, 'CANAL')+control('Volumen dB','tracks.'+def.id+'.volume',-24,6,.1)+control('Panorama','tracks.'+def.id+'.pan',-1,1,.01)+'<div class="mini-buttons"><label class="switch"><input data-setting="tracks.'+def.id+'.mute" type="checkbox"> Mute</label><label class="switch"><input data-setting="tracks.'+def.id+'.solo" type="checkbox"> Solo</label></div>'+(def.echo?control('Envío Tape Echo','tracks.'+def.id+'.echoSend',0,1,.01):'')+(def.chamber?control('Envío Chamber','tracks.'+def.id+'.chamberSend',0,1,.01):'')+control('Saturación cinta','tracks.'+def.id+'.saturation',1,3,.01)+(def.punch?control('Presencia / punch','tracks.'+def.id+'.punch',0,1,.01):''); byId('channels').appendChild(el); }
  function control(label,path,min,max,step) { return '<label>'+label+' <span class="value" data-value="'+path+'"></span><input data-setting="'+path+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'"></label>'; }
  function bindControls() { var nodes=document.querySelectorAll('[data-setting]'); for(var i=0;i<nodes.length;i+=1) nodes[i].oninput=function(){var path=this.getAttribute('data-setting');setDeep(path,this.type==='checkbox'?this.checked:parseFloat(this.value));refreshControls();updateAudioParameter(path);}; refreshControls(); }
  function refreshControls() { var nodes=document.querySelectorAll('[data-setting]'),i;for(i=0;i<nodes.length;i+=1){var n=nodes[i],v=getDeep(n.getAttribute('data-setting'));if(n.type==='checkbox')n.checked=!!v;else n.value=v;}var vals=document.querySelectorAll('[data-value]');for(i=0;i<vals.length;i+=1)vals[i].innerHTML=getDeep(vals[i].getAttribute('data-value')); }
  function save(){localStorage.setItem(STORE_KEY,JSON.stringify(settings));byId('renderStatus').innerHTML='Ajustes guardados.';} function normalizeSettings(){settings.master.width=clampWidth(settings.master.width===undefined?1:settings.master.width);} function restore(){var raw=localStorage.getItem(STORE_KEY);if(raw)settings=JSON.parse(raw);normalizeSettings();refreshControls();updateAllAudioParameters();byId('renderStatus').innerHTML=raw?'Ajustes restaurados.':'No había ajustes guardados.';} function initial(){settings=clone(defaults);refreshControls();updateAllAudioParameters();byId('renderStatus').innerHTML='Valores iniciales cargados.';}

  function analyseBuffer(b) { var result = { duration: b.duration, sampleRate: b.sampleRate, peak: [0,0], rms: [0,0] }; for (var c=0;c<2;c+=1){var data=b.getChannelData(c),sum=0,p=0;for(var i=0;i<data.length;i+=1){var a=Math.abs(data[i]);sum+=data[i]*data[i];if(a>p)p=a;}result.peak[c]=gainToDb(p);result.rms[c]=gainToDb(Math.sqrt(sum/data.length));}return result; }
  function render(route) { var buttons=document.querySelectorAll('[data-render]'),masterLevel=settings.master.level,names={mix:'microphon_mix.wav',vinyl:'microphon_master_vinyl.wav',digital:'microphon_master_digital.wav'};buttons.forEach(function(b){b.disabled=true;});byId('renderProgress').value=10;byId('renderStatus').innerHTML='Renderizando '+route.toUpperCase()+'…';setTimeout(function(){var sr=audioContext.sampleRate,ctx=new OfflineAudioContext(2,Math.ceil(duration()*sr),sr);buildGraph(ctx,0,0,{route:route,masterLevel:masterLevel});byId('renderProgress').value=45;ctx.startRendering().then(function(b){var stats=analyseBuffer(b),blob=MicrophonWavEncoder.encodeWav(b.getChannelData(0),b.getChannelData(1),b.sampleRate),url=URL.createObjectURL(blob),link=byId('download-'+route);link.href=url;link.download=names[route];link.className='download ready';byId('renderProgress').value=100;byId('renderStatus').innerHTML=route.toUpperCase()+': '+stats.duration.toFixed(3)+' s · '+stats.sampleRate+' Hz · Peak L/R '+stats.peak[0].toFixed(2)+' / '+stats.peak[1].toFixed(2)+' dBFS · RMS L/R '+stats.rms[0].toFixed(2)+' / '+stats.rms[1].toFixed(2)+' dBFS';buttons.forEach(function(btn){btn.disabled=false;});});},50); }

  function matrixSample(left,right,width){var mid=(left+right)*.5,side=(left-right)*.5;return{left:mid+side*width,right:mid-side*width,mid:mid,side:side*width};}
  window.microphonMixerDiagnostics=function(){var unity=matrixSample(.75,-.25,1),mono=matrixSample(.75,-.25,0),wide=matrixSample(.75,-.25,1.5);return{playing:playing,position:currentPos(),sourceGeneration:sourceGeneration,activeSources:graph?graph.sources.length:0,tracksSynchronized:!graph||graph.sources.length===3,listenRoute:listenRoute,mixMeterBeforeMastering:true,vuReferenceDbfs:VU_REFERENCE_DBFS,peakHoldMs:700,routes:{mix:'MIX BUS → MIX OUT',vinyl:'MIX BUS → VINYL MASTER → VINYL OUT',digital:'MIX BUS → DIGITAL MASTER → DIGITAL OUT'},matrixChecks:{unityPreservesChannels:unity.left===.75&&unity.right===-.25,zeroIsMono:mono.left===mono.right,widePreservesMid:wide.mid===unity.mid,wideSideRatio:wide.side/unity.side},neonPunchDb:{body110Hz:punchBodyGain(settings.tracks.neon.punch),attack3200Hz:punchAttackGain(settings.tracks.neon.punch)}};};

  function boot(){if(!AudioContextClass){byId('loadStatus').innerHTML='Web Audio API no disponible.';return;}audioContext=new AudioContextClass();trackDefs.forEach(addChannel);bindControls();document.querySelectorAll('[data-route]').forEach(function(b){b.onclick=function(){selectRoute(this.getAttribute('data-route'));};});document.querySelectorAll('[data-render]').forEach(function(b){b.onclick=function(){render(this.getAttribute('data-render'));};});selectRoute('mix');var left=trackDefs.length;trackDefs.forEach(function(t){loadWav(t.file,function(err,b){if(err){byId('loadStatus').innerHTML=err.message;return;}buffers[t.id]=b;left-=1;byId('loadStatus').innerHTML='Cargadas '+(trackDefs.length-left)+' / '+trackDefs.length+' pistas';if(!left){document.querySelectorAll('[data-audio-action]').forEach(function(el){el.disabled=false;});updateTime();byId('loadStatus').innerHTML='Tres WAV cargados y listos';}});});byId('playBtn').onclick=play;byId('stopBtn').onclick=stop;byId('position').oninput=function(){seek(parseFloat(this.value));};byId('saveBtn').onclick=save;byId('restoreBtn').onclick=restore;byId('defaultsBtn').onclick=initial;}
  boot();
}());
