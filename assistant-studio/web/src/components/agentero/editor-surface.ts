import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Editor scrollport & surface styles ported from @poco-ai/agentero-dsh-notes. */
export const editorContainerClassName = cn(
  "relative h-full w-full cursor-text select-text overflow-y-auto caret-foreground selection:bg-primary/20 focus-visible:outline-none",
);

export const editorClassName = cn(
  "group/editor",
  "relative w-full cursor-text select-text overflow-x-hidden whitespace-break-spaces break-words",
  "rounded-md focus-visible:outline-none",
  "[&_strong]:font-bold",
);

export const editorContentClassName =
  "min-h-full px-5 pt-3 pb-16 [&>*:first-child]:mt-0";

export const editorTextStyle: CSSProperties = {
  fontSize: 14.5,
  lineHeight: 1.72,
};
