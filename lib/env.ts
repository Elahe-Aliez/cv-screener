// lib/env.ts — minimal .env loader for the standalone scripts.
// (Next.js loads .env itself for the app; tsx scripts need this one-liner.)

import fs from "node:fs";
import path from "node:path";

export function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8").replace(/^﻿/, ""); // strip BOM
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      // Accept optionally quoted values, like Next.js's own .env loader.
      process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
