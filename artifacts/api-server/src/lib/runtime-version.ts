import { z } from "zod";

declare const __RUNTIME_BUILD__: unknown;

const metadataSchema = z.object({
  schema: z.literal(1),
  installation: z.enum(["replit", "vps"]),
  revision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  buildId: z.string().regex(/^(?:build-[a-f0-9-]{36}|\d{8}T\d{6}Z-[a-f0-9]{12})$/),
  builtAt: z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  if (value.installation === "vps" && (!value.revision ||
      !value.buildId.endsWith("-" + value.revision.slice(0, 12)))) {
    ctx.addIssue({ code: "custom", message: "Identificação inconsistente." });
  }
});

export function runtimeVersionSnapshot(metadata: unknown, installation: "replit" | "vps" | "unknown", startedAt: string) {
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success) {
    return Object.freeze({ installation, identified: false, revision: null, buildId: null, builtAt: null, startedAt });
  }
  const { schema: _schema, ...publicVersion } = parsed.data;
  return Object.freeze({ ...publicVersion, identified: true, startedAt });
}

// Bound to the running bundle once, never to a mutable checkout or a GitHub branch.
const runtimeVersion = runtimeVersionSnapshot(
  typeof __RUNTIME_BUILD__ === "undefined" ? null : __RUNTIME_BUILD__,
  process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN ? "replit" : "unknown",
  new Date().toISOString(),
);

export function getRuntimeVersion() {
  return runtimeVersion;
}
