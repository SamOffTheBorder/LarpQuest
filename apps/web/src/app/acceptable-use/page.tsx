import type { Metadata } from 'next';

import { LegalDocumentView } from '@/components/legal-document';
import { renderLegalDocument } from '@/lib/legal';

export const metadata: Metadata = { title: 'Acceptable Use Policy — StoryForge' };

export default async function AcceptableUsePage() {
  const { html } = await renderLegalDocument('acceptable_use');
  return <LegalDocumentView html={html} />;
}
