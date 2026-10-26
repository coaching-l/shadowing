declare module "nspell" {
  export default function nspell(
    aff: string,
    dic: string,
  ): { correct(word: string): boolean; suggest(word: string): string[] };
}

declare module "onnxruntime-web" {
  export * from "onnxruntime-common";
}
