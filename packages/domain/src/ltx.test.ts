import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LTX_GENERATION_BLOCK,
  assertPrivateComfyUrl,
  buildLtxApiPrompt,
  fitRtxUpscaleInputs,
  isApiPrompt,
  isComfyUiGraph,
  ltxPresetFromApi,
  ltxPresetFromUi,
  validateLtxDraft,
} from './ltx';

const api = JSON.parse(
  readFileSync(
    resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../docs/comfy/LTX_IA2V_Production (API).json'),
    'utf8',
  ),
);

const graph = JSON.parse(
  readFileSync(
    resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../docs/comfy/LTX_IA2V_Production_Shorts-2 (1).json'),
    'utf8',
  ),
);

describe('LTX UI graph', () => {
  it('reads the live values and refuses to treat the editor file as a prompt', () => {
    expect(isComfyUiGraph(graph)).toBe(true);
    expect(isApiPrompt(graph)).toBe(false);
    const preset = ltxPresetFromUi(graph);
    expect(preset.executable).toBe(false);
    expect(preset.blockReason).toBe(LTX_GENERATION_BLOCK);
    expect(preset.nodeCount).toBe(77);
    expect(preset.width).toBe(576);
    expect(preset.height).toBe(1024);
    expect(preset.fps).toBe(30);
    expect(preset.durationSec).toBe(20);
    expect(preset.trimWidgetDurationSec).toBe(25);
    expect(preset.loraStrength).toBe(0.8);
    expect(preset.loraName).toBe('mehaklora-ltx.safetensors');
    expect(preset.upscale).toEqual({ width: 1152, height: 2048, quality: 'ULTRA' });
    expect(preset.prompt.startsWith('mehakiv OHWXPERSON')).toBe(true);
    expect(preset.bypassedNodeIds).toEqual([602, 601, 604]);
  });

  it('recognises an API prompt and still rejects the UI graph', () => {
    expect(isApiPrompt({ '1': { class_type: 'LoadImage', inputs: {} } })).toBe(true);
    expect(isApiPrompt({ nodes: [], links: [] })).toBe(false);
  });
});

describe('LTX API prompt', () => {
  it('reads the executable defaults and patches a clip without the upscale nodes', () => {
    expect(isApiPrompt(api)).toBe(true);
    expect(isComfyUiGraph(api)).toBe(false);
    const preset = ltxPresetFromApi(api);
    expect(preset.executable).toBe(true);
    expect(preset.width).toBe(576);
    expect(preset.height).toBe(1024);
    expect(preset.fps).toBe(30);
    expect(preset.durationSec).toBe(30);
    expect(preset.audioStartSec).toBe(48);
    expect(preset.loraStrength).toBe(0.88);
    const prompt = buildLtxApiPrompt(api, {
      imageName: 'clip.png',
      audioName: 'song.mp3',
      prompt: 'singing',
      negativePrompt: 'blur',
      width: 576,
      height: 1024,
      fps: 30,
      durationSec: 8,
      audioStartSec: 2,
      loraName: 'mehaklora-ltx.safetensors',
      loraStrength: 0.5,
      upscaleWidth: 1152,
      upscaleHeight: 2048,
      wantUpscale: false,
      filenamePrefix: 'CreatorOS/ltx_test',
      seed: 7,
    });
    expect(prompt['269']?.inputs.image).toBe('clip.png');
    expect(prompt['276']?.inputs.audio).toBe('song.mp3');
    expect(prompt['378']?.inputs.value).toBe(8);
    expect(prompt['383']?.inputs.start_index).toBe(2);
    expect(prompt['383']?.inputs.duration).toEqual(['378', 0]);
    expect(prompt['446']?.inputs.lora_name).toBe('mehaklora-ltx.safetensors');
    expect(prompt['346']?.inputs.noise_seed).toBe(7);
    expect(prompt['609']).toBeUndefined();
    const upscaled = buildLtxApiPrompt(api, {
      imageName: 'clip.png',
      audioName: 'song.mp3',
      prompt: 'singing',
      negativePrompt: 'blur',
      width: 960,
      height: 540,
      fps: 30,
      durationSec: 8,
      audioStartSec: 2,
      loraName: 'other.safetensors',
      loraStrength: 0.5,
      upscaleWidth: 1920,
      upscaleHeight: 1080,
      wantUpscale: true,
      filenamePrefix: 'CreatorOS/ltx_test',
      seed: 7,
    });
    expect(upscaled['609']?.inputs['resize_type.width']).toBe(1920);
    expect(upscaled['609']?.inputs['resize_type.height']).toBe(1080);
    expect(upscaled['609']?.inputs.strength).toBe(1);
    expect(upscaled['609']?.inputs.image_encoding).toBe('8-bit RGB');
    fitRtxUpscaleInputs(upscaled, ['images', 'resize_type', 'quality']);
    expect(upscaled['609']?.inputs.strength).toBeUndefined();
    expect(upscaled['609']?.inputs.image_encoding).toBeUndefined();
    expect(upscaled['609']?.inputs.quality).toBe('ULTRA');
    expect(upscaled['446']?.inputs.lora_name).toBe('other.safetensors');
    expect(prompt['400']?.inputs.filename_prefix).toBe('CreatorOS/ltx_test');
    expect(prompt['269']).not.toHaveProperty('_meta');
  });

  it('refuses to build a prompt from the editor graph', () => {
    expect(() =>
      buildLtxApiPrompt(graph, {
        imageName: 'a.png',
        audioName: 'a.mp3',
        prompt: 'x',
        negativePrompt: 'y',
        width: 576,
        height: 1024,
        fps: 30,
        durationSec: 8,
        audioStartSec: 0,
        loraName: 'mehaklora-ltx.safetensors',
        loraStrength: 0.8,
        upscaleWidth: 1152,
        upscaleHeight: 2048,
        wantUpscale: true,
        filenamePrefix: 'CreatorOS/ltx_test',
        seed: 1,
      }),
    ).toThrow(/API prompt/);
  });
});

describe('LTX draft checks', () => {
  const base = {
    imageFileId: 'img',
    audioFileId: 'aud',
    audioStartSec: 0,
    durationSec: 20,
    audioLengthSec: 180,
    prompt: 'singing',
    width: 576,
    height: 1024,
    fps: 30,
    loraName: 'mehaklora-ltx.safetensors',
    loraStrength: 0.8,
    upscaleWidth: 1152,
    upscaleHeight: 2048,
    workerId: 'pc',
    expectedVramGb: 24,
  };

  it('accepts the saved defaults', () => {
    expect(validateLtxDraft(base, { requireMedia: true, requireWorker: true }).errors).toEqual([]);
  });

  it('stops a trim that runs past the song and warns on a 12GB card', () => {
    const over = validateLtxDraft(
      { ...base, audioStartSec: 170, durationSec: 20, expectedVramGb: 12, wantUpscale: true },
      { requireMedia: true, requireWorker: true },
    );
    expect(over.errors.some((e) => e.field === 'durationSec')).toBe(true);
    expect(over.warnings.some((w) => w.message.includes('12GB'))).toBe(true);
    expect(over.warnings.some((w) => w.message.includes('1152×2048'))).toBe(true);
  });

  it('accepts an upload on the same PC and a 1920×1080 upscale', () => {
    const uploaded = validateLtxDraft(
      {
        ...base,
        imageFileId: null,
        audioFileId: null,
        imageUploadName: 'cos_up_photo.png',
        imageUploadWorkerId: 'pc',
        audioUploadName: 'cos_up_song.mp3',
        audioUploadWorkerId: 'pc',
        upscaleWidth: 1920,
        upscaleHeight: 1080,
      },
      { requireMedia: true, requireWorker: true },
    );
    expect(uploaded.errors).toEqual([]);
  });
});

describe('ComfyUI addresses', () => {
  it('keeps a Tailscale or LAN address and drops a public one', () => {
    expect(assertPrivateComfyUrl('http://100.64.1.2:8188/')).toBe('http://100.64.1.2:8188');
    expect(assertPrivateComfyUrl('http://192.168.1.20:8188')).toBe('http://192.168.1.20:8188');
    expect(assertPrivateComfyUrl('https://gpu.tailnet.ts.net:8188')).toBe('https://gpu.tailnet.ts.net:8188');
    expect(() => assertPrivateComfyUrl('http://8.8.8.8:8188')).toThrow(/private/);
    expect(() => assertPrivateComfyUrl('http://example.com:8188')).toThrow(/private/);
    expect(() => assertPrivateComfyUrl('http://100.64.1.2:8188/prompt')).toThrow(/path/);
  });
});
