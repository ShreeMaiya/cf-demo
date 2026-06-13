import { cp, mkdir, rm } from "node:fs/promises";

const outputDirectory = new URL("../../dist/", import.meta.url);
const projectRoot = new URL("../../", import.meta.url);
const staticFiles = ["index.html", "script.js", "style.css"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const file of staticFiles) {
  await cp(new URL(file, projectRoot), new URL(file, outputDirectory));
}

console.log(`Built ${staticFiles.length} static files in dist/.`);
