/** Lossless YAML Front Matter split/join ported from @poco-ai/agentero-dsh-notes. */
export interface NoteFrontmatter {
  /** Original fenced block, including the newline after the closing fence. */
  raw: string;
  body: string;
}

export function splitNoteFrontmatter(markdown: string): NoteFrontmatter {
  const source = markdown.replace(/^\uFEFF/, "");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { raw: "", body: markdown };
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return { raw: "", body: markdown };
  return {
    raw: `${lines.slice(0, end + 1).join(newline)}${newline}`,
    body: lines.slice(end + 1).join(newline),
  };
}

export function joinNoteFrontmatter(raw: string, body: string): string {
  if (raw === "") return body;
  const fence = raw.endsWith("\n") ? raw : `${raw}\n`;
  return `${fence}${body.replace(/^\n+/, "")}`;
}
