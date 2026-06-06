/** Trigger a client-side file download from text content. */
export function downloadText(filename: string, text: string, mime = "text/markdown") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Safe-ish filename from a title (keeps CJK, strips path/illegal chars). */
export function safeFilename(title: string, ext = "md") {
  const base =
    (title || "ao-output")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "ao-output";
  return `${base}.${ext}`;
}
