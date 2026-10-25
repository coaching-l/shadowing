import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const dist = path.resolve("dist");
await fs.access(path.join(dist, "index.html"));
await fs.writeFile(path.join(dist, ".nojekyll"), "");
const packages = JSON.parse(
  await fs.readFile("package-lock.json", "utf8"),
).packages;
const lines = [
  "COACHING-L Shadowing Studio — third-party notices",
  "Source: https://github.com/coaching-l/shadowing",
  "User documents, recordings and generated audio are not included.",
  "",
];
await fs.mkdir(path.join(dist, "source"), { recursive: true });
execFileSync("git", [
  "archive",
  "--format=zip",
  "--output=" + path.join(dist, "source", "app-source.zip"),
  "HEAD",
]);
for (const [folder, metadata] of Object.entries(packages)) {
  if (!folder.startsWith("node_modules/") || !metadata.license) continue;
  const name = folder.split("node_modules/").at(-1);
  lines.push(`${name}@${metadata.version} — ${metadata.license}`);
  let files;
  try {
    files = await fs.readdir(folder);
  } catch {
    continue;
  }
  for (const file of files.filter((f) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(f),
  )) {
    const source = path.join(folder, file);
    if (!(await fs.stat(source)).isFile()) continue;
    const target = path.join(dist, "licenses", "dependencies", name, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}
await fs.writeFile(
  path.join(dist, "licenses", "third-party-notices.txt"),
  lines.join("\n") + "\n",
);

console.log("Prepared GitHub Pages files:", dist);
