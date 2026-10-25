import { Mp3Encoder } from "@breezystack/lamejs";
self.onmessage = ({
  data,
}: {
  data: { samples: Float32Array; rate: number };
}) => {
  try {
    const encoder = new Mp3Encoder(1, data.rate, 128);
    const result: Uint8Array[] = [];
    const pcm = new Int16Array(data.samples.length);
    for (let i = 0; i < pcm.length; i++)
      pcm[i] = Math.round(Math.max(-1, Math.min(1, data.samples[i])) * 32767);
    for (let i = 0; i < pcm.length; i += 1152) {
      const b = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
      if (b.length) result.push(new Uint8Array(b));
    }
    result.push(new Uint8Array(encoder.flush()));
    self.postMessage({
      blob: new Blob(result as BlobPart[], { type: "audio/mpeg" }),
    });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
