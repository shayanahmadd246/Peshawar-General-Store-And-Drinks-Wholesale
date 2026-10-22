import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectAudioFormat, validateAudioUpload, MAX_AUDIO_BYTES } from '../src/ai/voice/audioValidate';
import { buildSilentWav } from '../src/ai/voice/wavFixture';
import { isMediaRecordingSupported, pickRecorderMimeType, formatDuration } from '../src/voice/mediaSupport';

describe('voice audio validation (unit)', () => {
  it('detects WAV signature and accepts matching MIME', () => {
    const wav = buildSilentWav(500);
    assert.equal(detectAudioFormat(wav), 'wav');
    const ok = validateAudioUpload({ buffer: wav, declaredMime: 'audio/wav', durationMs: 500 });
    assert.equal(ok.format, 'wav');
    assert.equal(ok.mimeType, 'audio/wav');
  });

  it('rejects empty, oversized, and MIME/signature mismatches', () => {
    assert.throws(() => validateAudioUpload({ buffer: Buffer.alloc(10) }), /empty|short/i);
    assert.throws(
      () => validateAudioUpload({ buffer: Buffer.alloc(MAX_AUDIO_BYTES + 1), declaredMime: 'audio/wav' }),
      /maximum size/i
    );
    const wav = buildSilentWav(300);
    assert.throws(
      () => validateAudioUpload({ buffer: wav, declaredMime: 'audio/mpeg', durationMs: 300 }),
      /does not match/i
    );
  });

  it('rejects absurd durations', () => {
    const wav = buildSilentWav(300);
    assert.throws(() => validateAudioUpload({ buffer: wav, durationMs: 120_000 }), /duration/i);
  });

  it('formats durations and exposes browser helpers safely in Node', () => {
    assert.equal(formatDuration(65000), '1:05');
    assert.equal(isMediaRecordingSupported(), false);
    assert.equal(pickRecorderMimeType(), undefined);
  });
});
