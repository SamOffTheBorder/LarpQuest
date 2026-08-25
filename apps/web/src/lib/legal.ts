import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { marked } from 'marked';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Legal documents (launch plan B1.4): served in-app straight from
 * legal/*.md, one level above apps/web — no content duplicated into the app,
 * so editing a draft is the only step needed to update the live page.
 *
 * Version is a hash of the file's own bytes, not the drafts' own
 * `Last updated: [DATE]` header, which is still an unresolved bracket today.
 * A content hash needs nothing filled in and changes automatically the
 * moment the draft's text changes.
 */

export type LegalDocument = 'terms' | 'privacy' | 'acceptable_use';

const FILES: Record<LegalDocument, string> = {
  terms: 'TERMS_OF_SERVICE.md',
  privacy: 'PRIVACY_POLICY.md',
  acceptable_use: 'ACCEPTABLE_USE.md',
};

const LEGAL_DIR = path.join(process.cwd(), '..', '..', 'legal');

async function readLegalFile(document: LegalDocument): Promise<string> {
  const filePath = path.join(LEGAL_DIR, FILES[document]);
  return readFile(filePath, 'utf8');
}

export function versionOf(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * The drafts cross-link each other with relative Markdown paths
 * (`./PRIVACY_POLICY.md`) so they stay readable as plain files outside the
 * app (e.g. on GitHub). Rewritten to the in-app routes here rather than in
 * the source files, which should stay portable.
 */
const MD_LINK_ROUTES: Record<string, string> = {
  './TERMS_OF_SERVICE.md': '/terms',
  './PRIVACY_POLICY.md': '/privacy',
  './ACCEPTABLE_USE.md': '/acceptable-use',
};

function rewriteCrossDocumentLinks(html: string): string {
  let rewritten = html;
  for (const [mdPath, route] of Object.entries(MD_LINK_ROUTES)) {
    rewritten = rewritten.split(`href="${mdPath}"`).join(`href="${route}"`);
  }
  return rewritten;
}

export async function renderLegalDocument(document: LegalDocument): Promise<{ html: string; version: string }> {
  const content = await readLegalFile(document);
  const html = rewriteCrossDocumentLinks(await marked.parse(content));
  return { html, version: versionOf(content) };
}

const ALL_DOCUMENTS: readonly LegalDocument[] = ['terms', 'privacy', 'acceptable_use'];

/**
 * Record that `email` confirmed agreement to the current version of every
 * legal document. Called from the sign-in action, before an account
 * necessarily exists — see design.md for why this is keyed by email rather
 * than user_id.
 */
export async function recordLegalAcceptance(email: string): Promise<void> {
  const contents = await Promise.all(ALL_DOCUMENTS.map((document) => readLegalFile(document)));

  const rows = ALL_DOCUMENTS.map((document, index) => ({
    email,
    document,
    version: versionOf(contents[index] as string),
  }));

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('legal_acceptances').insert(rows);

  if (error !== null) {
    throw new Error(`Failed to record legal acceptance: ${error.message}`);
  }
}
