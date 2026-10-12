import type { FileAttachment } from "../../types/chat";

/** Keep independently selected sources when more than one attachment is sent. */
export function buildUserMessageContent(
  question: string,
  options: {
    selectedText?: string;
    selectedFromPdf?: boolean;
    pdfText?: string;
    files?: FileAttachment[];
  },
): string {
  const parts: string[] = [];
  if (options.selectedText) {
    parts.push(
      `[Selected text${options.selectedFromPdf ? " from PDF" : ""}]:\n"${options.selectedText}"`,
    );
  }
  if (options.pdfText) {
    parts.push(`[PDF Content]:\n${options.pdfText}`);
  }
  for (const file of options.files || []) {
    parts.push(`[File: ${file.name}]\n${file.content}`);
  }
  return parts.length
    ? `${parts.join("\n\n")}\n\n[Question]:\n${question}`
    : question;
}
