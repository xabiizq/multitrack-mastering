(function (global) {
  'use strict';

  function writeString(view, offset, text) {
    for (var i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function clamp(sample) {
    return sample < -1 ? -1 : sample > 1 ? 1 : sample;
  }

  function encodeWav(left, right, sampleRate) {
    var length = Math.max(left.length, right.length);
    var bytesPerSample = 2;
    var blockAlign = 2 * bytesPerSample;
    var buffer = new ArrayBuffer(44 + length * blockAlign);
    var view = new DataView(buffer);
    var offset = 0;

    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + length * blockAlign, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, 2, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, length * blockAlign, true); offset += 4;

    for (var i = 0; i < length; i += 1) {
      var l = clamp(i < left.length ? left[i] : 0);
      var r = clamp(i < right.length ? right[i] : 0);
      view.setInt16(offset, l < 0 ? l * 32768 : l * 32767, true); offset += 2;
      view.setInt16(offset, r < 0 ? r * 32768 : r * 32767, true); offset += 2;
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  global.MicrophonWavEncoder = { encodeWav: encodeWav };
}(this));
