/**
 * LTX 2.3 rules taken from the checked-in ComfyUI UI graph.
 * That file is the editor document (nodes, links, groups). It is not a prompt
 * ComfyUI will run. Nothing here calls a GPU.
 */

export const LTX_GENERATION_BLOCK =
  'BLOCKED: this workflow is the ComfyUI editor file. Creator OS will not send it to ComfyUI. Export the API format from the ComfyUI that already runs this graph, then generation can be connected to that file.';

export const LTX_REQUIRED_MODELS = [
  'ltx-2.3-22b-distilled-1.1-Q5_K_M.gguf',
  'mehaklora-ltx.safetensors',
  'gemma-3-12b-it-IQ4_XS.gguf',
  'ltx-2.3-22b-distilled_embeddings_connectors.safetensors',
  'ltx-2.3-22b-distilled_video_vae.safetensors',
  'ltx-2.3-22b-distilled_audio_vae.safetensors',
] as const;

export interface LtxIssue {
  field: string;
  message: string;
}

export interface LtxPreset {
  source: 'ui-graph' | 'api-prompt';
  executable: boolean;
  blockReason: string;
  nodeCount: number;
  linkCount: number;
  subgraphCount: number;
  width: number;
  height: number;
  fps: number;
  /** Live duration, from the Duration node that is wired into the trim. */
  durationSec: number;
  /** Trim start in seconds. */
  audioStartSec: number;
  /** Number stored on the trim node itself. A link overrides it, so this is not the duration that runs. */
  trimWidgetDurationSec: number;
  loraName: string;
  loraStrength: number;
  prompt: string;
  negativePrompt: string;
  upscale: { width: number; height: number; quality: string };
  models: readonly string[];
  bypassedNodeIds: number[];
  notes: string[];
}

interface UiNode {
  id: number;
  type?: string;
  mode?: number;
  title?: string;
  widgets_values_named?: Record<string, unknown>;
}

interface UiGraph {
  nodes: UiNode[];
  links: unknown[];
  definitions?: { subgraphs?: unknown[] };
}

function asGraph(graph: unknown): UiGraph {
  if (!graph || typeof graph !== 'object') throw new Error('The workflow file is not a ComfyUI graph.');
  const g = graph as Partial<UiGraph>;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.links)) {
    throw new Error('The workflow file has no nodes and links. That is not the ComfyUI editor graph.');
  }
  return g as UiGraph;
}

function node(graph: UiGraph, id: number): UiNode {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`Workflow node ${id} is missing, so the saved LTX defaults cannot be read.`);
  return found;
}

function num(n: UiNode, key: string): number {
  const v = n.widgets_values_named?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`Node ${n.id} has no numeric "${key}".`);
}

function str(n: UiNode, key: string): string {
  const v = n.widgets_values_named?.[key];
  if (typeof v === 'string' && v.trim()) return v;
  throw new Error(`Node ${n.id} has no "${key}".`);
}

/** True for a ComfyUI editor document. False for an API prompt. */
export function isComfyUiGraph(graph: unknown): boolean {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return false;
  const g = graph as { nodes?: unknown; links?: unknown };
  return Array.isArray(g.nodes) && Array.isArray(g.links);
}

/**
 * API format is a map of node id to `{ class_type, inputs }`.
 * A UI graph must never be treated as one.
 */
export function isApiPrompt(graph: unknown): boolean {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return false;
  if (isComfyUiGraph(graph)) return false;
  const values = Object.values(graph as Record<string, unknown>);
  return (
    values.length > 0 &&
    values.every(
      (v) =>
        !!v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        typeof (v as { class_type?: unknown }).class_type === 'string',
    )
  );
}

/** Reads the live values from the editor graph. Titles on the nodes are ignored when a widget or link disagrees. */
export function ltxPresetFromUi(graph: unknown): LtxPreset {
  const g = asGraph(graph);
  const width = node(g, 368);
  const height = node(g, 382);
  const fps = node(g, 379);
  const duration = node(g, 378);
  const trim = node(g, 383);
  const lora = node(g, 446);
  const loraOff = node(g, 449);
  const prompt = node(g, 9994);
  const negative = node(g, 364);
  const upscale = node(g, 609);
  const save = node(g, 400);
  if (lora.mode !== 0) throw new Error('The active LoRA node (446) is bypassed, so the strength 0.8 is not the live value.');
  if (loraOff.mode !== 4) throw new Error('The second LoRA node (449) is not bypassed. Its strength must not be used.');
  const linked = g.links.some(
    (l) => Array.isArray(l) && l[1] === 378 && l[3] === 383 && l[5] === 'FLOAT',
  );
  if (!linked) throw new Error('Duration is not wired into the audio trim, so the stored trim number cannot be ignored.');
  const fpsLinked = g.links.some((l) => Array.isArray(l) && l[1] === 379 && l[5] === 'INT');
  if (!fpsLinked) throw new Error('The FPS node is not wired onward, so the save node’s own frame rate cannot be ignored.');
  const bypassed = [602, 601, 604].map((id) => {
    const n = node(g, id);
    if (n.mode !== 4) throw new Error(`Node ${id} is not bypassed. The manual prompt is not the one that would run.`);
    return id;
  });
  const saveFps = num(save, 'frame_rate');
  return {
    source: 'ui-graph',
    executable: false,
    blockReason: LTX_GENERATION_BLOCK,
    nodeCount: g.nodes.length,
    linkCount: g.links.length,
    subgraphCount: g.definitions?.subgraphs?.length ?? 0,
    width: num(width, 'value'),
    height: num(height, 'value'),
    fps: num(fps, 'value'),
    durationSec: num(duration, 'value'),
    audioStartSec: num(trim, 'start_index'),
    trimWidgetDurationSec: num(trim, 'duration'),
    loraName: str(lora, 'lora_name'),
    loraStrength: num(lora, 'strength_model'),
    prompt: str(prompt, 'text'),
    negativePrompt: str(negative, 'text'),
    upscale: {
      width: num(upscale, 'resize_type.width'),
      height: num(upscale, 'resize_type.height'),
      quality: str(upscale, 'quality'),
    },
    models: LTX_REQUIRED_MODELS,
    bypassedNodeIds: bypassed,
    notes: [
      `Width title says "${width.title ?? ''}" and the value is ${num(width, 'value')}.`,
      `Height title says "${height.title ?? ''}" and the value is ${num(height, 'value')}.`,
      `FPS title says "${fps.title ?? ''}" and the value is ${num(fps, 'value')}. The first save node’s own frame rate is ${saveFps} and is overridden by the FPS wire.`,
      `The trim node stores ${num(trim, 'duration')} seconds. The Duration node (${num(duration, 'value')}) is wired over it.`,
      `LoRA strength is ${num(lora, 'strength_model')} on the active loader. The bypassed loader is ${num(loraOff, 'strength_model')}.`,
      'The automatic image-to-text prompt nodes are bypassed. The manual prompt is the one that is live.',
      'A preview saved inside the graph is an old render. It is not an output of a new job.',
    ],
  };
}

export interface LtxDraftInput {
  imageFileId?: string | null;
  audioFileId?: string | null;
  audioStartSec: number;
  durationSec: number;
  /** Length of the chosen audio, when the library has probed it. */
  audioLengthSec?: number | null;
  prompt: string;
  width: number;
  height: number;
  fps: number;
  loraName: string;
  loraStrength: number;
  upscaleWidth: number;
  upscaleHeight: number;
  workerId?: string | null;
  expectedVramGb?: number | null;
  wantUpscale?: boolean;
  imageUploadName?: string | null;
  imageUploadWorkerId?: string | null;
  audioUploadName?: string | null;
  audioUploadWorkerId?: string | null;
}

/** Local checks only. This does not contact a machine. */
export function validateLtxDraft(
  input: LtxDraftInput,
  opts: { requireMedia: boolean; requireWorker: boolean },
): { errors: LtxIssue[]; warnings: LtxIssue[] } {
  const errors: LtxIssue[] = [];
  const warnings: LtxIssue[] = [];
  const need = (field: string, ok: boolean, message: string) => {
    if (!ok) errors.push({ field, message });
  };
  if (opts.requireMedia) {
    const imageReady = !!input.imageFileId || (!!input.imageUploadName && input.imageUploadWorkerId === input.workerId);
    const audioReady = !!input.audioFileId || (!!input.audioUploadName && input.audioUploadWorkerId === input.workerId);
    need('imageFileId', imageReady, input.imageUploadName && input.imageUploadWorkerId !== input.workerId
      ? 'That image was uploaded to a different PC. Upload it again, or choose one from the library.'
      : 'Choose a starting image from the library, or upload one to the PC you picked.');
    need('audioFileId', audioReady, input.audioUploadName && input.audioUploadWorkerId !== input.workerId
      ? 'That song was uploaded to a different PC. Upload it again, or choose one from the library.'
      : 'Choose a song from the library, or upload one to the PC you picked.');
    need('prompt', input.prompt.trim().length > 0, 'The prompt is empty.');
  }
  need('audioStartSec', input.audioStartSec >= 0 && input.audioStartSec <= 3600, 'The start time has to be zero or later.');
  need(
    'durationSec',
    input.durationSec > 0 && input.durationSec <= 120,
    'Duration has to be between 1 and 120 seconds.',
  );
  if (
    input.audioLengthSec != null &&
    Number.isFinite(input.audioLengthSec) &&
    input.audioStartSec + input.durationSec > input.audioLengthSec + 0.05
  ) {
    errors.push({
      field: 'durationSec',
      message: `That trim runs past the end of the audio (${input.audioLengthSec.toFixed(1)}s).`,
    });
  } else if (opts.requireMedia && input.audioFileId && input.audioLengthSec == null) {
    warnings.push({
      field: 'audioFileId',
      message: 'This audio has no duration yet, so the trim was not checked against the file length.',
    });
  }
  need('width', Number.isInteger(input.width) && input.width >= 64 && input.width <= 2048, 'Width must be a whole number from 64 to 2048. The saved graph uses 576.');
  need('height', Number.isInteger(input.height) && input.height >= 64 && input.height <= 2048, 'Height must be a whole number from 64 to 2048. The saved graph uses 1024.');
  if (errors.every((e) => e.field !== 'width' && e.field !== 'height') && (input.width % 32 !== 0 || input.height % 32 !== 0)) {
    warnings.push({ field: 'width', message: 'Width or height is not a multiple of 32. The saved graph uses 576×1024.' });
  }
  need('fps', Number.isInteger(input.fps) && input.fps >= 1 && input.fps <= 60, 'Frame rate must be a whole number from 1 to 60. The saved graph uses 30.');
  need(
    'loraName',
    input.loraName.trim().length > 0 && input.loraName.length <= 180 && !/[\\/]/.test(input.loraName),
    'Choose a LoRA file name, without a folder.',
  );
  need('loraStrength', input.loraStrength >= 0 && input.loraStrength <= 2, 'LoRA strength must be from 0 to 2.');
  need('upscaleWidth', Number.isInteger(input.upscaleWidth) && input.upscaleWidth >= 64 && input.upscaleWidth <= 4096, 'Upscale width must be a whole number from 64 to 4096.');
  need('upscaleHeight', Number.isInteger(input.upscaleHeight) && input.upscaleHeight >= 64 && input.upscaleHeight <= 4096, 'Upscale height must be a whole number from 64 to 4096.');
  if (opts.requireWorker && !input.workerId) {
    errors.push({ field: 'workerId', message: 'Choose the PC that should run this.' });
  } else if (!input.workerId) {
    warnings.push({ field: 'workerId', message: 'No PC is selected yet. Add the 3090 or the 3060 and choose one before generating.' });
  }
  if (input.expectedVramGb != null && input.expectedVramGb < 20) {
    warnings.push({
      field: 'workerId',
      message: input.wantUpscale
        ? `This graph was built for a 24GB card, and the upscale goes to ${input.upscaleWidth}×${input.upscaleHeight}. A 12GB card can be selected. It will fail if the models do not fit.`
        : 'This graph was built for a 24GB card. A 12GB card can be selected. It will fail if the models do not fit.',
    });
  }
  return { errors, warnings };
}

/** Accepts a loopback, LAN, Tailscale CGNAT, or MagicDNS address. Refuses a public host. */
export function assertPrivateComfyUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter the full address, such as http://100.x.x.x:8188');
  }
  if (url.username || url.password) throw new Error('Do not put a username or password in the address.');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use http or https.');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Use the ComfyUI address only, without a path.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isPrivateHost(host)) {
    throw new Error('Use the private Tailscale or LAN address of that PC. A public address is refused.');
  }
  return url.origin;
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host.endsWith('.ts.net')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

type ApiNode = { class_type: string; inputs: Record<string, unknown> };

function apiNodes(graph: unknown): Record<string, ApiNode> {
  if (!isApiPrompt(graph)) throw new Error('Expected the ComfyUI API prompt.');
  return graph as Record<string, ApiNode>;
}

function apiNum(nodes: Record<string, ApiNode>, id: string, key: string): number {
  const v = nodes[id]?.inputs?.[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`API node ${id} has no numeric ${key}.`);
  return v;
}

function apiStr(nodes: Record<string, ApiNode>, id: string, key: string): string {
  const v = nodes[id]?.inputs?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`API node ${id} has no ${key}.`);
  return v;
}

/** Defaults from the API prompt, which is the file ComfyUI actually runs. */
export function ltxPresetFromApi(graph: unknown): LtxPreset {
  const nodes = apiNodes(graph);
  const width = apiNum(nodes, '368', 'value');
  const height = apiNum(nodes, '382', 'value');
  const fps = apiNum(nodes, '379', 'value');
  const durationSec = apiNum(nodes, '378', 'value');
  const audioStartSec = apiNum(nodes, '383', 'start_index');
  return {
    source: 'api-prompt',
    executable: true,
    blockReason: '',
    nodeCount: Object.keys(nodes).length,
    linkCount: 0,
    subgraphCount: 0,
    width,
    height,
    fps,
    durationSec,
    audioStartSec,
    trimWidgetDurationSec: durationSec,
    loraName: apiStr(nodes, '446', 'lora_name'),
    loraStrength: apiNum(nodes, '446', 'strength_model'),
    prompt: apiStr(nodes, '9994', 'text'),
    negativePrompt: apiStr(nodes, '364', 'text'),
    upscale: {
      width: apiNum(nodes, '609', 'resize_type.width'),
      height: apiNum(nodes, '609', 'resize_type.height'),
      quality: apiStr(nodes, '609', 'quality'),
    },
    models: LTX_REQUIRED_MODELS,
    bypassedNodeIds: [],
    notes: ['This file is the API prompt. Generate sends it to the PC you pick.'],
  };
}

export interface LtxPromptPatch {
  imageName: string;
  audioName: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  audioStartSec: number;
  loraName: string;
  loraStrength: number;
  upscaleWidth: number;
  upscaleHeight: number;
  wantUpscale: boolean;
  filenamePrefix: string;
  seed: number;
}

const UPSCALE_NODES = ['609', '610', '611'];

/** Copies the API prompt and applies this clip. The editor graph is never accepted. */
export function buildLtxApiPrompt(graph: unknown, patch: LtxPromptPatch): Record<string, ApiNode> {
  const source = apiNodes(graph);
  const prompt = structuredClone(source);
  const set = (id: string, key: string, value: unknown) => {
    const node = prompt[id];
    if (!node) throw new Error(`API workflow is missing node ${id}.`);
    node.inputs[key] = value;
  };
  set('269', 'image', patch.imageName);
  set('276', 'audio', patch.audioName);
  set('9994', 'text', patch.prompt);
  set('364', 'text', patch.negativePrompt);
  set('368', 'value', patch.width);
  set('382', 'value', patch.height);
  set('379', 'value', patch.fps);
  set('378', 'value', patch.durationSec);
  set('383', 'start_index', patch.audioStartSec);
  set('446', 'lora_name', patch.loraName);
  set('446', 'strength_model', patch.loraStrength);
  set('346', 'noise_seed', patch.seed);
  set('400', 'filename_prefix', patch.filenamePrefix);
  if (patch.wantUpscale) {
    set('609', 'resize_type.width', patch.upscaleWidth);
    set('609', 'resize_type.height', patch.upscaleHeight);
    set('610', 'filename_prefix', `${patch.filenamePrefix}_upscale`);
    set('610', 'frame_rate', patch.fps);
    // The 3090's RTX Video Super Resolution node requires these. The 3060's older node does not.
    // fitRtxUpscaleInputs keeps or drops them after the PC is known.
    if (prompt['609'].inputs.strength == null) prompt['609'].inputs.strength = 1;
    if (prompt['609'].inputs.image_encoding == null) prompt['609'].inputs.image_encoding = '8-bit RGB';
  } else {
    for (const id of UPSCALE_NODES) delete prompt[id];
  }
  for (const node of Object.values(prompt)) delete (node as { _meta?: unknown })._meta;
  return prompt;
}

/**
 * RTX Video Super Resolution gained `strength` and `image_encoding` on newer ComfyUI.
 * Older installs reject those inputs. `accepted` is the input names that PC's node allows.
 * Null means the PC could not be asked, so the newer required inputs are left in place.
 */
export function fitRtxUpscaleInputs(prompt: Record<string, ApiNode>, accepted: string[] | null): void {
  const node = prompt['609'];
  if (!node) return;
  const extras = ['strength', 'image_encoding'] as const;
  if (accepted == null) return;
  const ok = new Set(accepted);
  for (const key of extras) {
    if (!ok.has(key)) delete node.inputs[key];
  }
}
