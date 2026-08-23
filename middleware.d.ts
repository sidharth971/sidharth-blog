// Ambient declaration for the HTMLRewriter global provided by the Vercel
// (and Cloudflare Workers-compatible) Edge Runtime — not part of standard
// TypeScript DOM/Node libs, so editors need this to stop flagging it.
declare class HTMLRewriter {
  on(selector: string, handlers: { element?(element: { append(content: string, options?: { html?: boolean }): void }): void }): HTMLRewriter
  transform(response: Response): Response
}
