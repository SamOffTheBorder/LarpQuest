import 'server-only';

// PDF: pdfkit draws text directly onto a PDF stream — no headless browser,
// matching this environment's no-Docker/no-headless-Chrome constraint
// (CLAUDE.md). EPUB: an EPUB file is just a zip of XHTML + a manifest, so
// jszip plus a small hand-built manifest is enough; no dedicated EPUB
// package is needed for a read-only, chapter-per-file export like this one.
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';

import { assertMember } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

export type ExportFormat = 'markdown' | 'pdf' | 'epub';

export interface ExportJobRecord {
  id: string;
  storyId: string;
  format: ExportFormat;
  status: 'queued' | 'complete' | 'failed';
  storagePath: string | null;
  error: string | null;
}

interface ExportJobRow {
  id: string;
  story_id: string;
  format: string;
  status: string;
  storage_path: string | null;
  error: string | null;
}

function toExportJobRecord(row: ExportJobRow): ExportJobRecord {
  return {
    id: row.id,
    storyId: row.story_id,
    format: row.format as ExportFormat,
    status: row.status as ExportJobRecord['status'],
    storagePath: row.storage_path,
    error: row.error,
  };
}

const EXPORT_JOB_COLUMNS = 'id, story_id, format, status, storage_path, error';
const BUCKET = 'story-exports';

interface ExportableChapter {
  turnNumber: number;
  prose: string;
}

async function readExportableChapters(storyId: string): Promise<{ title: string; chapters: ExportableChapter[] }> {
  const supabase = createServiceRoleClient();

  const [storyResult, chaptersResult] = await Promise.all([
    supabase.from('stories').select('title').eq('id', storyId).single(),
    supabase
      .from('chapters')
      .select('turn_number, prose, rolled_back_at')
      .eq('story_id', storyId)
      .is('rolled_back_at', null)
      .is('hidden_at', null)
      .order('turn_number', { ascending: true }),
  ]);

  if (storyResult.error !== null) {
    throw new Error(`Failed to read story: ${storyResult.error.message}`);
  }
  if (chaptersResult.error !== null) {
    throw new Error(`Failed to read chapters: ${chaptersResult.error.message}`);
  }

  return {
    title: storyResult.data.title,
    chapters: chaptersResult.data.map((row) => ({ turnNumber: row.turn_number, prose: row.prose })),
  };
}

/** Renders a story's published (non-rolled-back) chapters as a single Markdown document, in turn order. */
export async function renderStoryMarkdown(storyId: string): Promise<string> {
  const { title, chapters } = await readExportableChapters(storyId);

  const sections = chapters.map((chapter) => `## Chapter ${chapter.turnNumber}\n\n${chapter.prose}`);

  return [`# ${title}`, ...sections].join('\n\n');
}

function renderStoryPdf(title: string, chapters: readonly ExportableChapter[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.addPage();
    doc.fontSize(24).text(title, { align: 'center' });

    for (const chapter of chapters) {
      doc.addPage();
      doc.fontSize(18).text(`Chapter ${chapter.turnNumber}`);
      doc.moveDown();
      doc.fontSize(11).text(chapter.prose, { align: 'left' });
    }

    doc.end();
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function renderStoryEpub(storyId: string, title: string, chapters: readonly ExportableChapter[]): Promise<Buffer> {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF')?.file(
    'container.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
      '</container>\n',
  );

  const oebps = zip.folder('OEBPS');
  if (oebps === null) {
    throw new Error('Failed to create EPUB OEBPS directory.');
  }

  const manifestItems: string[] = [];
  const spineItems: string[] = [];

  chapters.forEach((chapter, index) => {
    const id = `chapter-${index + 1}`;
    const filename = `${id}.xhtml`;

    oebps.file(
      filename,
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>' +
        escapeXml(`Chapter ${chapter.turnNumber}`) +
        '</title></head><body>' +
        `<h1>Chapter ${chapter.turnNumber}</h1>` +
        `<p>${escapeXml(chapter.prose).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>')}</p>` +
        '</body></html>\n',
    );

    manifestItems.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
  });

  oebps.file(
    'content.opf',
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      `    <dc:identifier id="bookid">urn:uuid:${storyId}</dc:identifier>\n` +
      `    <dc:title>${escapeXml(title)}</dc:title>\n` +
      '    <dc:language>en</dc:language>\n' +
      '  </metadata>\n' +
      `  <manifest>${manifestItems.join('')}</manifest>\n` +
      `  <spine>${spineItems.join('')}</spine>\n` +
      '</package>\n',
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Owner/GM/any member with read access — scoped to chapters that member can already read. */
export async function requestExport(storyId: string, userId: string, format: ExportFormat): Promise<ExportJobRecord> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();

  const { data: created, error: insertError } = await supabase
    .from('export_jobs')
    .insert({ story_id: storyId, requested_by: userId, format, status: 'queued' })
    .select(EXPORT_JOB_COLUMNS)
    .single();

  if (insertError !== null) {
    throw new Error(`Failed to create export job: ${insertError.message}`);
  }

  const job = toExportJobRecord(created);

  // Markdown/PDF/EPUB generation is fast enough for a story of any realistic
  // length to run inline rather than needing its own durable job — unlike
  // video generation, there's no external provider call or minutes-long
  // wait. The job row still exists so status/download is queryable the same
  // way regardless of format.
  try {
    const { title, chapters } = await readExportableChapters(storyId);
    let bytes: Buffer;
    let contentType: string;
    let extension: string;

    if (format === 'markdown') {
      bytes = Buffer.from(await renderStoryMarkdown(storyId), 'utf8');
      contentType = 'text/markdown';
      extension = 'md';
    } else if (format === 'pdf') {
      bytes = await renderStoryPdf(title, chapters);
      contentType = 'application/pdf';
      extension = 'pdf';
    } else {
      bytes = await renderStoryEpub(storyId, title, chapters);
      contentType = 'application/epub+zip';
      extension = 'epub';
    }

    const storagePath = `${storyId}/${job.id}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });

    if (uploadError !== null) {
      throw new Error(`Failed to upload export: ${uploadError.message}`);
    }

    const { data: updated, error: updateError } = await supabase
      .from('export_jobs')
      .update({ status: 'complete', storage_path: storagePath, error: null })
      .eq('id', job.id)
      .select(EXPORT_JOB_COLUMNS)
      .single();

    if (updateError !== null) {
      throw new Error(`Failed to update export job: ${updateError.message}`);
    }

    return toExportJobRecord(updated);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    const { data: updated, error: updateError } = await supabase
      .from('export_jobs')
      .update({ status: 'failed', error: message.slice(0, 2000) })
      .eq('id', job.id)
      .select(EXPORT_JOB_COLUMNS)
      .single();

    if (updateError !== null) {
      throw new Error(`Failed to update export job: ${updateError.message}`);
    }

    return toExportJobRecord(updated);
  }
}

/** List a story's export jobs, most recent first. Any member may read. */
export async function listExportJobs(storyId: string, userId: string): Promise<ExportJobRecord[]> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('export_jobs')
    .select(EXPORT_JOB_COLUMNS)
    .eq('story_id', storyId)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list export jobs: ${error.message}`);
  }

  return data.map(toExportJobRecord);
}

/** A short-expiry signed download URL for a completed export job. Any member may read. */
export async function getExportDownloadUrl(exportJobId: string, userId: string): Promise<string> {
  const supabase = createServiceRoleClient();

  const { data: job, error: readError } = await supabase
    .from('export_jobs')
    .select('story_id, storage_path, status')
    .eq('id', exportJobId)
    .single();

  if (readError !== null) {
    throw new Error(`Failed to read export job: ${readError.message}`);
  }

  await assertMember(job.story_id, userId);

  if (job.status !== 'complete' || job.storage_path === null) {
    throw new Error('Export is not complete.');
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(job.storage_path, 300);

  if (error !== null || data === null) {
    throw new Error(`Failed to create download URL: ${error?.message ?? 'no data'}`);
  }

  return data.signedUrl;
}
