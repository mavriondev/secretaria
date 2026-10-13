import { readFileSync } from "node:fs";
import path from "node:path";

/** The commit this installation was built from: written by the update routine into VERSION at the root of the release. Without it (development) it says so. */
export function versaoInstalada(): string {
  const doAmbiente = process.env.TATO_VERSAO?.trim();
  if (doAmbiente) return doAmbiente.slice(0, 40);
  for (const caminho of [path.resolve(process.cwd(), "../../VERSION"), path.resolve(process.cwd(), "VERSION")]) {
    try { const sha = readFileSync(caminho, "utf8").trim(); if (/^[a-f0-9]{7,40}$/.test(sha)) return sha; } catch { /* next */ }
  }
  return "desenvolvimento";
}
