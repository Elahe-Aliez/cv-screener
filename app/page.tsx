// app/page.tsx — server shell: counts the indexed corpus and mounts the chat.

import fs from "node:fs";
import path from "node:path";
import { ChatApp } from "@/components/chat";

export default function Home() {
  const cvsDir = path.join(process.cwd(), "data", "cvs");
  const cvCount = fs.existsSync(cvsDir)
    ? fs.readdirSync(cvsDir).filter((f) => f.endsWith(".pdf")).length
    : 0;

  // A real candidate name makes the suggested profile question answerable.
  let exampleCandidate = "Marta Alarcón Ferran";
  const personasFile = path.join(process.cwd(), "data", "personas.json");
  if (fs.existsSync(personasFile)) {
    const personas = JSON.parse(fs.readFileSync(personasFile, "utf8"));
    if (personas.length > 0) exampleCandidate = personas[0].fullName;
  }

  return <ChatApp cvCount={cvCount} exampleCandidate={exampleCandidate} />;
}
