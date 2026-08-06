(function () {
  'use strict';

  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  var STORE_KEY = 'microphonMix60sSettings';
  var audioContext = null, buffers = {}, graph = null, startAt = 0, offset = 0, playing = false, raf = null;
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
    master: { level: -12.8, drive: 1.012, width: 1.08, ceiling: -1, bypass: false, mono: false }
  };
  var settings = clone(defaults);

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function byId(id) { return document.getElementById(id); }
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function setDeep(path, value) { var p = path.split('.'), o = settings; for (var i = 0; i < p.length - 1; i += 1) o = o[p[i]]; o[p[p.length - 1]] = value; }
  function getDeep(path) { var p = path.split('.'), o = settings; for (var i = 0; i < p.length; i += 1) o = o[p[i]]; return o; }
  function duration() { var d = 0; for (var k in buffers) d = Math.max(d, buffers[k].duration); return d; }
  function fmt(t) { var m = Math.floor(t / 60), s = (t % 60).toFixed(1); if (s < 10) s = '0' + s; return (m < 10 ? '0' : '') + m + ':' + s; }

  function loadWav(url, cb) {
    var xhr = new XMLHttpRequest(); xhr.open('GET', url, true); xhr.responseType = 'arraybuffer';
    xhr.onload = function () { audioContext.decodeAudioData(xhr.response, function (b) { cb(null, b); }, function () { cb(new Error('No se pudo decodificar ' + url)); }); };
    xhr.onerror = function () { cb(new Error('No se pudo cargar ' + url)); };
    xhr.send();
  }

  function makeCurve(drive) { var n = 2048, curve = new Float32Array(n); for (var i = 0; i < n; i += 1) { var x = i * 2 / n - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); } return curve; }

  function panNode(ctx, pan) {
    var input = ctx.createGain(), panner = ctx.createStereoPanner();
    panner.pan.value = pan; input.connect(panner); return { input: input, output: panner };
  }

  function buildGraph(ctx, when, pos) {
    var masterIn = ctx.createGain(), out = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    comp.threshold.value = settings.master.ceiling; comp.knee.value = 0; comp.ratio.value = 20; comp.attack.value = 0.006; comp.release.value = 0.18;
    var masterDrive = ctx.createWaveShaper(); masterDrive.curve = makeCurve(settings.master.drive); masterDrive.oversample = 'none';
    var splitter = ctx.createChannelSplitter(2), mid = ctx.createGain(), sideL = ctx.createGain(), sideR = ctx.createGain(), merger = ctx.createChannelMerger(2);
    var echoDelay = ctx.createDelay(1.5), echoFb = ctx.createGain(), echoDark = ctx.createBiquadFilter(), echoReturn = ctx.createGain();
    echoDelay.delayTime.value = settings.effects.echo.time / 1000; echoFb.gain.value = settings.effects.echo.feedback; echoDark.type = 'lowpass'; echoDark.frequency.value = settings.effects.echo.dark; echoReturn.gain.value = settings.effects.echo.wet;
    echoDelay.connect(echoDark); echoDark.connect(echoFb); echoFb.connect(echoDelay); echoDark.connect(echoReturn); echoReturn.connect(masterIn);
    var chamberDelay = ctx.createDelay(4.5), chamberFb = ctx.createGain(), chamberDark = ctx.createBiquadFilter(), chamberReturn = ctx.createGain();
    chamberDelay.delayTime.value = settings.effects.chamber.duration / 10; chamberFb.gain.value = Math.min(0.72, settings.effects.chamber.duration / 5); chamberDark.type = 'lowpass'; chamberDark.frequency.value = settings.effects.chamber.tone; chamberReturn.gain.value = settings.effects.chamber.wet;
    chamberDelay.connect(chamberDark); chamberDark.connect(chamberFb); chamberFb.connect(chamberDelay); chamberDark.connect(chamberReturn); chamberReturn.connect(masterIn);

    var anySolo = false; trackDefs.forEach(function (t) { if (settings.tracks[t.id].solo) anySolo = true; });
    var sources = [];
    trackDefs.forEach(function (t) {
      var s = settings.tracks[t.id], src = ctx.createBufferSource(), sat = ctx.createWaveShaper(), punch = ctx.createBiquadFilter(), gain = ctx.createGain(), pan = panNode(ctx, s.pan), echoSend = ctx.createGain(), chSend = ctx.createGain();
      src.buffer = buffers[t.id]; sat.curve = makeCurve(s.saturation); punch.type = 'peaking'; punch.frequency.value = 1400; punch.Q.value = 0.7; punch.gain.value = t.punch ? s.punch * 3 : 0;
      gain.gain.value = (s.mute || (anySolo && !s.solo)) ? 0 : dbToGain(s.volume);
      echoSend.gain.value = t.echo ? s.echoSend : 0; chSend.gain.value = t.chamber ? s.chamberSend : 0;
      src.connect(sat); sat.connect(punch); punch.connect(gain); gain.connect(pan.input); pan.output.connect(masterIn); pan.output.connect(echoSend); echoSend.connect(echoDelay); pan.output.connect(chSend); chSend.connect(chamberDelay);
      src.start(when, pos); sources.push(src);
    });

    if (settings.master.bypass) { masterIn.connect(out); }
    else {
      masterIn.connect(masterDrive); masterDrive.connect(splitter); splitter.connect(mid, 0); splitter.connect(mid, 1);
      splitter.connect(sideL, 0); splitter.connect(sideL, 1); splitter.connect(sideR, 1); splitter.connect(sideR, 0);
      mid.gain.value = 0.5 * dbToGain(settings.master.level); sideL.gain.value = 0.5 * settings.master.width * dbToGain(settings.master.level); sideR.gain.value = -0.5 * settings.master.width * dbToGain(settings.master.level);
      mid.connect(merger, 0, 0); mid.connect(merger, 0, 1); sideL.connect(merger, 0, 0); sideR.connect(merger, 0, 1); merger.connect(comp); comp.connect(out);
    }
    if (settings.master.mono) {
      var ms = ctx.createChannelSplitter(2), ml = ctx.createGain(), mr = ctx.createGain(), mm = ctx.createChannelMerger(2);
      ml.gain.value = 0.5; mr.gain.value = 0.5;
      out.connect(ms); ms.connect(ml, 0); ms.connect(ml, 1); ms.connect(mr, 0); ms.connect(mr, 1);
      ml.connect(mm, 0, 0); mr.connect(mm, 0, 1); mm.connect(ctx.destination);
    } else { out.connect(ctx.destination); }
    return { sources: sources };
  }

  function play() { if (playing) return; graph = buildGraph(audioContext, 0, offset); startAt = audioContext.currentTime - offset; playing = true; tick(); }
  function stop() { if (graph) graph.sources.forEach(function (s) { try { s.stop(0); } catch (e) {} }); playing = false; offset = 0; updateTime(); }
  function currentPos() { return playing ? Math.min(duration(), audioContext.currentTime - startAt) : offset; }
  function seek(v) { var p = duration() * v / 1000; offset = p; if (playing) { if (graph) graph.sources.forEach(function (s) { try { s.stop(0); } catch (e) {} }); playing = false; play(); } updateTime(); }
  function tick() { updateTime(); if (playing && currentPos() >= duration()) stop(); else if (playing) raf = window.requestAnimationFrame(tick); }
  function updateTime() { var p = currentPos(), d = duration(); byId('timeDisplay').innerHTML = fmt(p) + ' / ' + fmt(d); byId('position').value = d ? Math.floor(p / d * 1000) : 0; }

  function addChannel(def) {
    var s = settings.tracks[def.id], el = document.createElement('div'); el.className = 'channel panel';
    el.innerHTML = '<h2>' + def.name + '</h2>' + control('Volumen dB', 'tracks.'+def.id+'.volume', -24, 6, .1) + control('Panorama', 'tracks.'+def.id+'.pan', -1, 1, .01) + '<div class="mini-buttons"><label class="switch"><input data-setting="tracks.'+def.id+'.mute" type="checkbox"> Mute</label><label class="switch"><input data-setting="tracks.'+def.id+'.solo" type="checkbox"> Solo</label></div>' + (def.echo ? control('Envío Tape Echo', 'tracks.'+def.id+'.echoSend', 0, 1, .01) : '') + (def.chamber ? control('Envío Chamber', 'tracks.'+def.id+'.chamberSend', 0, 1, .01) : '') + control('Saturación cinta', 'tracks.'+def.id+'.saturation', 1, 3, .01) + (def.punch ? control('Presencia / punch', 'tracks.'+def.id+'.punch', 0, 1, .01) : '');
    byId('channels').appendChild(el);
  }
  function control(label, path, min, max, step) { return '<label>' + label + ' <span class="value" data-value="'+path+'"></span><input data-setting="'+path+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'"></label>'; }
  function bindControls() { var nodes = document.querySelectorAll('[data-setting]'); for (var i = 0; i < nodes.length; i += 1) nodes[i].oninput = function () { setDeep(this.getAttribute('data-setting'), this.type === 'checkbox' ? this.checked : parseFloat(this.value)); refreshControls(); if (playing) { seek(byId('position').value); } }; refreshControls(); }
  function refreshControls() { var nodes = document.querySelectorAll('[data-setting]'); for (var i = 0; i < nodes.length; i += 1) { var n = nodes[i], v = getDeep(n.getAttribute('data-setting')); if (n.type === 'checkbox') n.checked = !!v; else n.value = v; } var vals = document.querySelectorAll('[data-value]'); for (i = 0; i < vals.length; i += 1) vals[i].innerHTML = getDeep(vals[i].getAttribute('data-value')); }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); byId('renderStatus').innerHTML = 'Ajustes guardados.'; }
  function restore() { var raw = localStorage.getItem(STORE_KEY); if (raw) settings = JSON.parse(raw); refreshControls(); byId('renderStatus').innerHTML = raw ? 'Ajustes restaurados.' : 'No había ajustes guardados.'; }
  function initial() { settings = clone(defaults); refreshControls(); byId('renderStatus').innerHTML = 'Valores iniciales cargados.'; }

  function render() {
    byId('renderBtn').disabled = true; byId('renderProgress').value = 10; byId('renderStatus').innerHTML = 'Renderizando toda la canción…';
    setTimeout(function () { var sr = audioContext.sampleRate, ctx = new OfflineAudioContext(2, Math.ceil(duration() * sr), sr); buildGraph(ctx, 0, 0); byId('renderProgress').value = 45; ctx.startRendering().then(function (b) { byId('renderProgress').value = 85; var blob = MicrophonWavEncoder.encodeWav(b.getChannelData(0), b.getChannelData(1), b.sampleRate); var url = URL.createObjectURL(blob); byId('downloadLink').href = url; byId('downloadLink').className = 'download ready'; byId('renderProgress').value = 100; byId('renderStatus').innerHTML = 'Render terminado: microphon_mix_60s.wav'; byId('renderBtn').disabled = false; }); }, 50);
  }

  function boot() {
    if (!AudioContextClass) { byId('loadStatus').innerHTML = 'Web Audio API no disponible.'; return; }
    audioContext = new AudioContextClass(); trackDefs.forEach(addChannel); bindControls();
    var left = trackDefs.length; trackDefs.forEach(function (t) { loadWav(t.file, function (err, b) { if (err) { byId('loadStatus').innerHTML = err.message; return; } buffers[t.id] = b; left -= 1; byId('loadStatus').innerHTML = 'Cargadas ' + (trackDefs.length - left) + ' / ' + trackDefs.length + ' pistas'; if (!left) { ['playBtn','stopBtn','position','renderBtn'].forEach(function (id) { byId(id).disabled = false; }); updateTime(); byId('loadStatus').innerHTML = 'Tres WAV cargados y listos'; } }); });
    byId('playBtn').onclick = play; byId('stopBtn').onclick = stop; byId('position').oninput = function () { seek(parseFloat(this.value)); };
    byId('renderBtn').onclick = render; byId('saveBtn').onclick = save; byId('restoreBtn').onclick = restore; byId('defaultsBtn').onclick = initial;
  }
  boot();
}());
