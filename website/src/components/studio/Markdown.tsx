import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Markdown renderer with Tailwind-styled elements (no typography plugin needed). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed text-foreground/90", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...p }) => <h1 className="mb-2 mt-4 text-lg font-bold first:mt-0" {...p} />,
          h2: ({ node, ...p }) => <h2 className="mb-2 mt-4 text-base font-bold first:mt-0" {...p} />,
          h3: ({ node, ...p }) => <h3 className="mb-1.5 mt-3 text-sm font-bold first:mt-0" {...p} />,
          h4: ({ node, ...p }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0" {...p} />,
          p: ({ node, ...p }) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
          ul: ({ node, ...p }) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
          ol: ({ node, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
          li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
          strong: ({ node, ...p }) => <strong className="font-semibold text-foreground" {...p} />,
          em: ({ node, ...p }) => <em className="italic" {...p} />,
          a: ({ node, ...p }) => <a className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
          blockquote: ({ node, ...p }) => (
            <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground" {...p} />
          ),
          hr: () => <hr className="my-3 border-border/60" />,
          code: ({ node, className: c, children, ...p }) => {
            const inline = !String(c ?? "").includes("language-");
            return inline ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" {...p}>
                {children}
              </code>
            ) : (
              <code className={cn("font-mono text-[0.85em]", c)} {...p}>
                {children}
              </code>
            );
          },
          pre: ({ node, ...p }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-3 text-[0.85em]" {...p} />
          ),
          table: ({ node, ...p }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs" {...p} />
            </div>
          ),
          th: ({ node, ...p }) => <th className="border border-border/60 bg-muted/50 px-2.5 py-1.5 font-semibold" {...p} />,
          td: ({ node, ...p }) => <td className="border border-border/60 px-2.5 py-1.5" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
