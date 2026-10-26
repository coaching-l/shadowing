import * as ort from "onnxruntime-web";
import { AutoTokenizer } from "@huggingface/transformers";
import type { PreTrainedTokenizer } from "@huggingface/transformers";
import wasmUrl from "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import {
  filterEnglishCorrection,
  stableEnglishCorrection,
  repairEnglishFragments,
} from "./spelling-en";
const MODEL = "TonyRaju/visheratin-t5-mini-grammar-correction-onnx-int8";
const REVISION = "d66fc3a79198beab31feb7c86998c8c6ee56ed95";
const FILES = [
  {
    name: "encoder_model.onnx",
    size: 20326983,
    sha: "7e838ebc8a27984b1e770bfdc39c5dd2016510301af6cfb4fc9f9f131aa76dbd",
  },
  {
    name: "decoder_model.onnx",
    size: 35923111,
    sha: "76302541bf672a63ee26ca651cc082eafb3662d5e5b4ff61d5d4acd0c09bb64a",
  },
  {
    name: "decoder_with_past_model.onnx",
    size: 34335433,
    sha: "860330548554df5aec69bb86e5848c79a58a2d3b4d0a57b07d8937340f96f75d",
  },
];
async function weights(
  file: (typeof FILES)[number],
  progress: (message: string) => void,
): Promise<Uint8Array> {
  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${file.name}`;
  let cache: Cache | undefined;
  try {
    cache = await caches.open("coaching-l-gec-models-v1");
  } catch {
    /* Optional cache. */
  }
  let response = await cache?.match(url),
    fresh = false;
  if (!response) {
    response = await fetch(url);
    fresh = true;
  }
  if (!response.ok)
    throw Error(`英語校正モデルを取得できませんでした（${response.status}）。`);
  let data: Uint8Array;
  if (fresh && response.body) {
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let loaded = 0,
      last = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(r.value);
      loaded += r.value.length;
      if (loaded > file.size) {
        await reader.cancel();
        throw Error("英語校正モデルのサイズが一致しません。");
      }
      if (Date.now() - last > 150) {
        progress(
          `英語校正モデルを取得中… ${file.name} ${(loaded / 1048576).toFixed(1)} / ${(file.size / 1048576).toFixed(1)} MB`,
        );
        last = Date.now();
      }
    }
    data = new Uint8Array(loaded);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }
  } else data = new Uint8Array(await response.arrayBuffer());
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (data.length !== file.size || hash !== file.sha) {
    await cache?.delete(url);
    throw Error("英語校正モデルの検証に失敗しました。再度お試しください。");
  }
  if (fresh)
    try {
      await cache?.put(url, new Response(data.slice().buffer));
    } catch {
      /* Storage limits must not prevent inference. */
    }
  return data;
}
function dispose(values: Iterable<ort.Tensor>) {
  for (const tensor of new Set(values)) tensor.dispose();
}
export class EnglishContextCorrector {
  private sessions: ort.InferenceSession[] = [];
  private tokenizer?: PreTrainedTokenizer;
  private memo = new Map<string, string>();
  async load(progress: (message: string) => void) {
    if (this.sessions.length === 3 && this.tokenizer) return;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    const files = await Promise.all(
      FILES.map((file) => weights(file, progress)),
    );
    try {
      this.tokenizer = await AutoTokenizer.from_pretrained(MODEL, {
        revision: REVISION,
        progress_callback: (p) => {
          const item = p as { file?: string; progress?: number };
          if (item.file) progress(`英語校正モデルを準備中… ${item.file}`);
        },
      });
      for (const bytes of files)
        this.sessions.push(
          await ort.InferenceSession.create(bytes, {
            executionProviders: ["wasm"],
          }),
        );
    } catch (e) {
      await this.dispose();
      throw e;
    }
  }
  private async generate(text: string): Promise<string> {
    const t = this.tokenizer!(text, { truncation: false });
    if (t.input_ids.dims.at(-1)! > 256)
      throw Error("英語校正の入力が長すぎます。文を短く区切ってください。");
    const input = new ort.Tensor(
        "int64",
        t.input_ids.data as BigInt64Array,
        t.input_ids.dims,
      ),
      mask = new ort.Tensor(
        "int64",
        t.attention_mask.data as BigInt64Array,
        t.attention_mask.dims,
      );
    let hidden: ort.Tensor | undefined,
      past: Record<string, ort.Tensor> = {};
    const generated: bigint[] = [0n];
    try {
      hidden = (
        await this.sessions[0].run({ input_ids: input, attention_mask: mask })
      ).last_hidden_state;
      const limit = Math.min(
        256,
        Math.max(32, t.input_ids.dims.at(-1)! * 2 + 16),
      );
      for (let step = 0; step < limit; step++) {
        const token = new ort.Tensor("int64", [generated.at(-1)!], [1, 1]);
        let output: ort.InferenceSession.OnnxValueMapType;
        try {
          output = await this.sessions[step ? 2 : 1].run({
            input_ids: token,
            encoder_attention_mask: mask,
            encoder_hidden_states: hidden,
            ...past,
          });
        } finally {
          token.dispose();
        }
        const logits = output.logits.data as Float32Array;
        let best = 0;
        for (let k = 1; k < logits.length; k++)
          if (logits[k] > logits[best]) best = k;
        if (!Number.isFinite(logits[best])) {
          dispose(Object.values(output));
          throw Error("英語の修正候補を計算できませんでした。");
        }
        const next = { ...past };
        for (const [key, value] of Object.entries(output))
          if (key.startsWith("present."))
            next[key.replace("present.", "past_key_values.")] = value;
        dispose(
          Object.entries(past)
            .filter(([key]) => key.includes(".decoder."))
            .map(([, value]) => value),
        );
        past = next;
        output.logits.dispose();
        if (best === 1)
          return this.tokenizer!.decode(generated.slice(1), {
            skip_special_tokens: true,
          });
        generated.push(BigInt(best));
      }
      throw Error(
        "英語の修正候補が最後まで完了しませんでした。短い文でお試しください。",
      );
    } finally {
      input.dispose();
      mask.dispose();
      hidden?.dispose();
      dispose(Object.values(past));
    }
  }
  async correct(
    text: string,
    progress: (message: string) => void,
  ): Promise<string> {
    const cached = this.memo.get(text);
    if (cached !== undefined) return cached;
    await this.load(progress);
    const propose = async (source: string) => {
      const proposals: string[] = [];
      for (const line of source.split(/\r?\n/))
        for (const { segment } of new Intl.Segmenter("en", {
          granularity: "sentence",
        }).segment(line)) {
          if (!segment.trim()) continue;
          proposals.push(await this.generate(segment.trim()));
        }
      return proposals.join(" ");
    };
    progress("端末内AIで英語の文脈を確認しています…");
    const prepared = repairEnglishFragments(text);
    let result = filterEnglishCorrection(prepared, await propose(prepared));
    if (result !== text) {
      progress("英語の修正候補を再確認しています…");
      result = stableEnglishCorrection(text, result, await propose(result));
    }
    if (this.memo.size >= 32) this.memo.delete(this.memo.keys().next().value!);
    this.memo.set(text, result);
    return result;
  }
  async dispose() {
    await Promise.allSettled(this.sessions.map((s) => s.release()));
    this.sessions = [];
    this.tokenizer = undefined;
    this.memo.clear();
  }
}
