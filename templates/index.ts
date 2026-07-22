// templates/index.ts — pick the right HTML template for a persona.

import type { Persona } from "../lib/schemas";
import { renderTemplate1 } from "./template-1";
import { renderTemplate2 } from "./template-2";
import { renderTemplate3 } from "./template-3";

export function renderCvHtml(persona: Persona): string {
  switch (persona.templateId) {
    case 1:
      return renderTemplate1(persona);
    case 2:
      return renderTemplate2(persona);
    case 3:
      return renderTemplate3(persona);
  }
}
