export type TextReferenceSourceSurface = "main" | "side";

export type TextReference = {
  id: string;
  text: string;
  preview: string;
  sourceThreadId: string | null;
  sourceSurface: TextReferenceSourceSurface;
  sourceSideConversationId?: string | null;
  createdAtMs: number;
};

export type ComposerTextReference = Pick<TextReference, "id" | "text" | "preview">;

export type ParsedReferencedPrompt = {
  references: ComposerTextReference[];
  request: string;
};

const SELECTED_TEXT_HEADER = "# Selected text:";
const FILES_MENTIONED_HEADER = "# Files mentioned by the user:";
const REQUEST_HEADER = "## My request for Codex:";
const SELECTION_HEADER_PATTERN = /^## Selection \d+\n/gm;

function compactPreviewText(text: string): string {
  const normalized = normalizeSelectionText(text).replace(/\s+/g, " ");
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function nextTextReferenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `text-reference-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeSelectionText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

export function createTextReference(input: {
  text: string;
  sourceThreadId: string | null;
  sourceSurface: TextReferenceSourceSurface;
  sourceSideConversationId?: string | null;
}): TextReference {
  const normalized = normalizeSelectionText(input.text);
  return {
    id: nextTextReferenceId(),
    text: normalized,
    preview: compactPreviewText(normalized),
    sourceThreadId: input.sourceThreadId,
    sourceSurface: input.sourceSurface,
    sourceSideConversationId: input.sourceSideConversationId ?? null,
    createdAtMs: Date.now(),
  };
}

export function formatReferenceQuote(text: string): string {
  return `"${normalizeSelectionText(text)}"`;
}

export function formatReferencedPrompt(
  userText: string,
  references: ComposerTextReference[],
): string {
  const request = userText.trim();
  if (references.length === 0) return request;

  const selectedText = references
    .map(
      (reference, index) =>
        `## Selection ${index + 1}\n${normalizeSelectionText(reference.text)}`,
    )
    .join("\n\n");

  return [
    SELECTED_TEXT_HEADER,
    selectedText,
    "",
    REQUEST_HEADER,
    request,
  ].join("\n");
}

export function parseReferencedPrompt(text: string): ParsedReferencedPrompt | null {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith(`${SELECTED_TEXT_HEADER}\n`)) return null;

  const body = normalized.slice(SELECTED_TEXT_HEADER.length + 1);
  const requestHeaderPattern = new RegExp(`\\n\\n${escapeRegExp(REQUEST_HEADER)}\\n?`, "g");
  const requestHeaderMatches = Array.from(body.matchAll(requestHeaderPattern));
  const requestHeaderMatch = requestHeaderMatches.at(-1);
  if (!requestHeaderMatch || requestHeaderMatch.index === undefined) return null;

  const selectionsBlock = body.slice(0, requestHeaderMatch.index);
  const request = body.slice(requestHeaderMatch.index + requestHeaderMatch[0].length).trimEnd();
  const selectionMatches = Array.from(selectionsBlock.matchAll(SELECTION_HEADER_PATTERN));
  if (selectionMatches.length === 0) return null;

  const references = selectionMatches
    .map((match, index): ComposerTextReference | null => {
      if (match.index === undefined) return null;
      const start = match.index + match[0].length;
      const next = selectionMatches[index + 1];
      const end = next?.index ?? selectionsBlock.length;
      const referenceText = normalizeSelectionText(selectionsBlock.slice(start, end));
      if (!referenceText) return null;
      return {
        id: `parsed-selection-${index + 1}`,
        text: referenceText,
        preview: compactPreviewText(referenceText),
      };
    })
    .filter((reference): reference is ComposerTextReference => Boolean(reference));

  return references.length ? { references, request } : null;
}

export function displayTextFromReferencedPrompt(text: string): string {
  const request = requestTextFromStructuredUserPrompt(text);
  if (request === null) return text;
  const trimmedRequest = request.trim();
  if (trimmedRequest) return trimmedRequest;
  return parseReferencedPrompt(text)?.references[0]?.preview ?? "";
}

export function userRequestTextFromReferencedPrompt(text: string): string {
  const request = requestTextFromStructuredUserPrompt(text);
  return request === null ? text : request.trim();
}

function requestTextFromStructuredUserPrompt(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (
    !normalized.startsWith(`${SELECTED_TEXT_HEADER}\n`) &&
    !normalized.startsWith(`${FILES_MENTIONED_HEADER}\n`)
  ) {
    return null;
  }

  const requestHeaderPattern = new RegExp(
    `\\n\\n${escapeRegExp(REQUEST_HEADER)}\\n?`,
    "g",
  );
  const requestHeaderMatches = Array.from(
    normalized.matchAll(requestHeaderPattern),
  );
  const requestHeaderMatch = requestHeaderMatches.at(-1);
  if (!requestHeaderMatch || requestHeaderMatch.index === undefined) {
    return null;
  }

  return normalized
    .slice(requestHeaderMatch.index + requestHeaderMatch[0].length)
    .trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
