// lib/slug.ts — turn a person's name into a filesystem/URL-safe slug.
// Used by generation (to name files) and ingestion (to find the name line
// in extracted PDF text by matching it against the PDF's filename).

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
