import {
  env,
  pipeline,
  AutoModelForMaskedLM,
  AutoTokenizer,
} from "@huggingface/transformers";
import {
  mapHanPositions,
  protectedChineseRanges,
  plausibleChineseChange,
  chineseChangeConfidence,
} from "./spelling-zh";
import type {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import wasmUrl from "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import {
  asrProfile,
  asrSegments,
  validateAsrAudio,
  ASR_SAMPLE_RATE,
} from "./asr-config";
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.wasmPaths = { wasm: wasmUrl };
let corrector:
  | { model: PreTrainedModel; tokenizer: PreTrainedTokenizer }
  | undefined;
let recognizer: AutomaticSpeechRecognitionPipeline | undefined;
let recognizerLanguage: "en" | "zh" | undefined;
let english: import("./english-context").EnglishContextCorrector | undefined;
let working = false;
self.onmessage = async ({ data }) => {
  if (working) return;
  working = true;
  const progress_callback = (progress: unknown) =>
    self.postMessage({ type: "progress", progress });
  try {
    let text: string;
    if (data.kind === "correct") {
      if (recognizer) {
        await recognizer.dispose();
        recognizer = undefined;
      }
      if (data.lang === "en") {
        if (corrector) {
          await corrector.model.dispose();
          corrector = undefined;
        }
        const { EnglishContextCorrector } = await import("./english-context");
        english ??= new EnglishContextCorrector();
        text = await english.correct(data.text, (message) =>
          self.postMessage({ type: "status", message }),
        );
      } else {
        if (english) {
          await english.dispose();
          english = undefined;
        }
        if (!/\p{Script=Han}/u.test(data.text)) {
          self.postMessage({ type: "result", text: data.text });
          return;
        }
        if (!corrector) {
          const modelId = "Xenova/macbert4csc-base-chinese";
          const revision = "7ebfe81cf502576e93c844b95354840b2ecb5c28";
          const [model, tokenizer] = await Promise.all([
            AutoModelForMaskedLM.from_pretrained(modelId, {
              revision,
              dtype: "q8",
              device: "wasm",
              progress_callback,
            }),
            AutoTokenizer.from_pretrained(modelId, {
              revision,
              progress_callback,
            }),
          ]);
          corrector = { model, tokenizer };
        }
        const source = data.text as string;
        const inputs = corrector.tokenizer(source, { truncation: false });
        const mapped = mapHanPositions(source, (part) =>
          corrector!.tokenizer.encode(part, { add_special_tokens: false }),
        );
        const actual = Array.from(inputs.input_ids.data, Number);
        if (
          actual.length !== mapped.ids.length + 2 ||
          mapped.ids.some((id, i) => id !== actual[i + 1])
        )
          throw Error(
            "文字位置を安全に照合できませんでした。短い範囲を選んでください。",
          );
        const protectedRanges = protectedChineseRanges(source);
        self.postMessage({
          type: "status",
          message: "端末内AIで中国語の誤字を確認しています…",
        });
        const { logits } = await corrector.model(inputs);
        const size = logits.dims.at(-1),
          scores = logits.data as Float32Array;
        if (!scores.every(Number.isFinite))
          throw Error(
            "中国語の修正候補を計算できませんでした。短い範囲でお試しください。",
          );
        const replacements: { start: number; end: number; text: string }[] = [];
        for (const position of mapped.positions) {
          if (
            protectedRanges.some(
              (range) =>
                position.start < range.end && position.end > range.start,
            )
          )
            continue;
          const originalId = actual[position.token];
          if (originalId === corrector.tokenizer.unk_token_id) continue;
          const { best, probability, margin } = chineseChangeConfidence(
            scores,
            position.token * size,
            size,
            originalId,
          );
          if (best === originalId || probability < 0.9 || margin < 2) continue;
          const replacement = corrector.tokenizer
            .decode([best], { skip_special_tokens: true })
            .trim();
          if (
            /^\p{Script=Han}$/u.test(replacement) &&
            plausibleChineseChange(position.original, replacement)
          )
            replacements.push({ ...position, text: replacement });
        }
        text = source;
        for (const replacement of replacements.reverse())
          text =
            text.slice(0, replacement.start) +
            replacement.text +
            text.slice(replacement.end);
      }
    } else if (data.kind === "transcribe") {
      validateAsrAudio(data.samples);
      if (data.lang !== "en" && data.lang !== "zh")
        throw Error("文字起こしの言語を選んでください。");
      if (english) {
        await english.dispose();
        english = undefined;
      }
      if (corrector) {
        await corrector.model.dispose();
        corrector = undefined;
      }
      if (recognizer && recognizerLanguage !== data.lang) {
        await recognizer.dispose();
        recognizer = undefined;
      }
      const profile = asrProfile(data.lang);
      recognizer ??= await pipeline<"automatic-speech-recognition">(
        "automatic-speech-recognition",
        profile.model,
        {
          revision: profile.revision,
          dtype: "q8",
          device: "wasm",
          progress_callback,
        },
      );
      recognizerLanguage = data.lang;
      const parts: string[] = [];
      for (const segment of asrSegments(data.samples)) {
        self.postMessage({
          type: "status",
          message: `端末内で音声を文字起こししています… ${Math.round(segment.start / ASR_SAMPLE_RATE)}〜${Math.round(segment.end / ASR_SAMPLE_RATE)}秒 / ${Math.ceil(data.samples.length / ASR_SAMPLE_RATE)}秒`,
        });
        let energy = 0;
        for (const sample of segment.samples) energy += sample * sample;
        // Avoid hallucinated speech in fully silent sections of long files.
        if (Math.sqrt(energy / segment.samples.length) < 0.0001) continue;
        const output = await recognizer(segment.samples, {
          ...profile.generation,
          max_new_tokens: 384,
          num_beams: 1,
          return_timestamps: false,
        });
        if (Array.isArray(output))
          throw Error("文字起こしの形式を確認できませんでした。");
        parts.push(output.text.trim());
      }
      text = parts.filter(Boolean).join(data.lang === "en" ? " " : "");
    } else throw Error("対応していない処理です。");
    self.postMessage({ type: "result", text });
  } catch (e) {
    self.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    working = false;
  }
};
