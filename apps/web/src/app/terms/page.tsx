import type { Metadata } from 'next';

import { LegalDocumentView } from '@/components/legal-document';
import { renderLegalDocument } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms of Service — StoryForge' };

export default async function TermsPage() {
  const { html } = await renderLegalDocument('terms');
  return <LegalDocumentView html={html} />;
}
