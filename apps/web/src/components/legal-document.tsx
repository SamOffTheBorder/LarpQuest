const PROSE_CLASSES =
  '[&_h1]:font-heading [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:font-heading [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-medium [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1 [&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_hr]:my-6 [&_hr]:border-border [&_a]:underline [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm';

export function LegalDocumentView({ html }: { html: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
      <div className={PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
