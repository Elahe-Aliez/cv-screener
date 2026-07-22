// app/cvs/[file]/route.ts — serves the PDF corpus from data/cvs so the
// source chips in the chat UI can open the underlying CV.

import fs from "node:fs";
import path from "node:path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  // Only corpus-shaped filenames — no traversal, no surprises.
  if (!/^[a-z0-9-]+\.pdf$/.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  const pdfPath = path.join(process.cwd(), "data", "cvs", file);
  if (!fs.existsSync(pdfPath)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(fs.readFileSync(pdfPath)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file}"`,
    },
  });
}
