import {
  env,
  pipeline,
  AutoModelForMaskedLM,
  AutoTokenizer,
} from "@huggingface/transformers";
import type {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
let corrector:
  | { model: PreTrainedModel; tokenizer: PreTrainedTokenizer }
  | undefined;
let recognizer: AutomaticSpeechRecognitionPipeline | undefined;
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
        self.postMessage({
          type: "status",
          message: "端末内の英語辞書でスペルを確認しています…",
        });
        const { correctEnglish } = await import("./spelling-en");
        text = correctEnglish(data.text);
      } else {
        if (/[A-Za-z\d\p{Script=Hiragana}\p{Script=Katakana}]/u.test(data.text))
          throw Error(
            "中国語のタイポ確認は漢字・句読点・空白の範囲でお試しください。",
          );
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
        const chars = [...(data.text as string)],
          positions = chars
            .map((char, index) => ({ char, index }))
            .filter((x) => !/^\s$/u.test(x.char));
        const inputs = corrector.tokenizer(data.text, { truncation: false });
        if (inputs.input_ids.dims.at(-1)! !== positions.length + 2)
          throw Error(
            "この文字の並びを安全に照合できませんでした。漢字中心の短い範囲を選んでください。",
          );
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
        for (let i = 0; i < positions.length; i++) {
          if (!/^\p{Script=Han}$/u.test(positions[i].char)) continue;
          const offset = (i + 1) * size;
          let best = 0;
          for (let j = 1; j < size; j++)
            if (scores[offset + j] > scores[offset + best]) best = j;
          const original = Number(inputs.input_ids.data[i + 1]);
          if (
            best === original ||
            scores[offset + best] - scores[offset + original] < 1
          )
            continue;
          const replacement = corrector.tokenizer
            .decode([best], { skip_special_tokens: true })
            .trim();
          if (/^\p{Script=Han}$/u.test(replacement))
            chars[positions[i].index] = replacement;
        }
        text = chars.join("");
      }
    } else if (data.kind === "transcribe") {
      if (corrector) {
        await corrector.model.dispose();
        corrector = undefined;
      }
      recognizer ??= await pipeline<"automatic-speech-recognition">(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny",
        {
          revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
          dtype: "q8",
          device: "wasm",
          progress_callback,
        },
      );
      self.postMessage({
        type: "status",
        message: "端末内で録音を文字起こししています…",
      });
      const output = await recognizer(data.samples, {
        language: data.lang === "zh" ? "chinese" : "english",
        task: "transcribe",
        max_new_tokens: 384,
      });
      if (Array.isArray(output))
        throw Error("文字起こしの形式を確認できませんでした。");
      text = output.text.trim();
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
