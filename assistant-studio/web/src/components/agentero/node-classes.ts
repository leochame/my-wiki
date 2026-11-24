import { cva } from "class-variance-authority";

/** Typography & node classes ported directly from @poco-ai/agentero-dsh-notes. */
export const headingVariants = cva(
  "relative mb-1 transition-colors duration-300",
  {
    variants: {
      variant: {
        h1: "mt-5 pb-1 font-bold text-2xl tracking-tight",
        h2: "mt-5 pb-1 font-semibold text-xl tracking-tight border-b border-border/60",
        h3: "mt-4 pb-px font-semibold text-lg tracking-tight",
        h4: "mt-3 font-semibold text-base tracking-tight",
        h5: "mt-3 font-semibold text-sm tracking-tight",
        h6: "mt-3 font-semibold text-sm tracking-tight text-muted-foreground",
      },
    },
  },
);

export const paragraphClassName = "relative m-0 px-0 py-1";
export const blockquoteClassName =
  "relative my-2 border-l-2 border-primary/60 bg-muted/35 rounded-r-md py-1.5 pl-4 pr-3 text-muted-foreground italic";
export const hrClassName = "my-4 h-px rounded-sm border-none bg-border";
export const linkClassName =
  "cursor-pointer font-medium text-primary underline decoration-primary/40 underline-offset-2";
export const codeLeafClassName =
  "whitespace-pre-wrap rounded-md bg-muted px-[0.35em] py-[0.15em] font-mono text-[0.86em]";
export const codeBlockPreClassName =
  "my-2 max-w-full overflow-x-auto rounded-lg border border-border bg-muted/60 p-3.5 font-mono text-xs leading-relaxed whitespace-pre [tab-size:2]";
export const codeBlockCodeClassName = "block w-max min-w-full";
