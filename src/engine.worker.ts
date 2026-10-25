import { KokoroTTS } from "kokoro-js";
import {
  StyleTextToSpeech2Model,
  AutoTokenizer,
  Tensor,
} from "@huggingface/transformers";
import { mandarinPhonemes } from "./mandarin";
let english: KokoroTTS | undefined;
let chinese:
  | {
      model: Awaited<
        ReturnType<typeof StyleTextToSpeech2Model.from_pretrained>
      >;
      tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
    }
  | undefined;
const voices = new Map<string, Float32Array>();
const progress_callback = (progress: unknown) =>
  self.postMessage({ type: "progress", progress });
self.onmessage = async ({ data }) => {
  try {
    let samples: Float32Array,
      rate = 24000;
    if (data.voice.startsWith("z")) {
      if (english) {
        await english.model.dispose();
        english = undefined;
      }
      const modelId = "onnx-community/Kokoro-82M-v1.1-zh-ONNX";
      if (!chinese) {
        const [model, tokenizer] = await Promise.all([
          StyleTextToSpeech2Model.from_pretrained(modelId, {
            dtype: "fp32",
            device: "wasm",
            progress_callback,
          }),
          AutoTokenizer.from_pretrained(modelId, { progress_callback }),
        ]);
        chinese = { model, tokenizer };
      }
      const phones = mandarinPhonemes(data.text);
      const { input_ids } = chinese.tokenizer(phones, { truncation: false });
      if (input_ids.dims.at(-1)! > 512)
        throw Error(
          "モデル上限512トークンを超えています。文を意味のまとまりで分割してください。",
        );
      if (!voices.has(data.voice)) {
        const url = `https://huggingface.co/${modelId}/resolve/main/voices/${data.voice}.bin`;
        let cache: Cache | undefined;
        try {
          cache = await caches.open("coaching-l-zh-voices");
        } catch {
          /* storage unavailable: in-memory cache only */
        }
        let response = await cache?.match(url);
        if (!response) {
          response = await fetch(url);
          if (!response.ok)
            throw Error(`声データの取得に失敗（${response.status}）`);
          try {
            await cache?.put(url, response.clone());
          } catch {
            /* cache quota does not prevent generation */
          }
        }
        const voice = new Float32Array(await response.arrayBuffer());
        if (voice.length < 510 * 256) throw Error("声データが不完全です。");
        voices.set(data.voice, voice);
      }
      const index =
        256 * Math.min(Math.max(input_ids.dims.at(-1)! - 2, 0), 509);
      const style = voices.get(data.voice)!.slice(index, index + 256);
      const result = await chinese.model({
        input_ids,
        style: new Tensor("float32", style, [1, 256]),
        speed: new Tensor("float32", [data.speed], [1]),
      });
      samples = result.waveform.data as Float32Array;
    } else {
      if (chinese) {
        await chinese.model.dispose();
        chinese = undefined;
      }
      if (!english) {
        english = await KokoroTTS.from_pretrained(
          "onnx-community/Kokoro-82M-v1.0-ONNX",
          { dtype: "q8", device: "wasm", progress_callback },
        );
        english.tokenizer = new Proxy(english.tokenizer, {
          apply(target, self, args) {
            const ids = Reflect.apply(target, self, [
              args[0],
              { ...args[1], truncation: false },
            ]);
            if (ids.input_ids.dims.at(-1) > 512)
              throw Error(
                "モデル上限512トークンを超えています。文を分割してください。",
              );
            return ids;
          },
        });
      }
      const result = await english.generate(data.text, {
        voice: data.voice,
        speed: data.speed,
      });
      samples = result.audio;
      rate = result.sampling_rate;
    }
    self.postMessage({ type: "audio", samples, rate });
  } catch (e) {
    self.postMessage({
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
