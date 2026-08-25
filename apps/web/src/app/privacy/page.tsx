import type { Metadata } from 'next';

import { LegalDocumentView } from '@/components/legal-document';
import { renderLegalDocument } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy Policy — StoryForge' };

export default async function PrivacyPage() {
  const { html } = await renderLegalDocument('privacy');
  return <LegalDocumentView html={html} />;
}
