import { Pool } from 'pg'
import {
  textbookDraftSchema,
  type TextbookAnalysisJob,
  type TextbookAnalysisSegment,
  type TextbookImport,
  type TextbookImportRepository,
} from './textbook-import-service.js'

interface TextbookImportRow {
  id: string
  family_id: string
  file_name: string
  page_count: number
  extracted_characters: number
  status: 'ready_for_review' | 'confirmed'
  draft: unknown
  created_at: Date
  confirmed_at: Date | null
}

interface TextbookAnalysisJobRow {
  id: string
  family_id: string
  file_hash: string
  analysis_version: string
  file_name: string
  page_count: number
  extracted_characters: number
  status: 'analyzing' | 'failed' | 'completed'
  import_id: string | null
  error_code: string | null
  created_at: Date
  updated_at: Date
}

interface TextbookAnalysisSegmentRow {
  job_id: string
  path: string
  status: 'completed' | 'split'
  draft: unknown | null
  created_at: Date
  updated_at: Date
}

export class PostgresTextbookImportRepository
  implements TextbookImportRepository
{
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3 })
  }

  async save(item: TextbookImport): Promise<void> {
    await this.pool.query(
      `insert into textbook_import (
         id, family_id, file_name, page_count, extracted_characters,
         status, draft, created_at, confirmed_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       on conflict (id) do update
         set status = excluded.status,
             draft = excluded.draft,
             confirmed_at = excluded.confirmed_at`,
      [
        item.id,
        item.familyId,
        item.fileName,
        item.pageCount,
        item.extractedCharacters,
        item.status,
        JSON.stringify(item.draft),
        item.createdAt,
        item.confirmedAt ?? null,
      ],
    )
  }

  async get(
    familyId: string,
    id: string,
  ): Promise<TextbookImport | undefined> {
    const result = await this.pool.query<TextbookImportRow>(
      `${selectTextbookImport}
       where family_id = $1 and id = $2`,
      [familyId, id],
    )
    return result.rows[0] ? toTextbookImport(result.rows[0]) : undefined
  }

  async list(familyId: string): Promise<TextbookImport[]> {
    const result = await this.pool.query<TextbookImportRow>(
      `${selectTextbookImport}
       where family_id = $1
       order by created_at desc`,
      [familyId],
    )
    return result.rows.map(toTextbookImport)
  }

  async findAnalysisJob(
    familyId: string,
    fileHash: string,
    analysisVersion: string,
  ): Promise<TextbookAnalysisJob | undefined> {
    const result = await this.pool.query<TextbookAnalysisJobRow>(
      `${selectAnalysisJob}
       where family_id = $1 and file_hash = $2 and analysis_version = $3`,
      [familyId, fileHash, analysisVersion],
    )
    return result.rows[0] ? toAnalysisJob(result.rows[0]) : undefined
  }

  async saveAnalysisJob(job: TextbookAnalysisJob): Promise<void> {
    await this.pool.query(
      `insert into textbook_analysis_job (
         id, family_id, file_hash, analysis_version, file_name, page_count,
         extracted_characters, status, import_id, error_code, created_at,
         updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       on conflict (id) do update
         set file_name = excluded.file_name,
             page_count = excluded.page_count,
             extracted_characters = excluded.extracted_characters,
             status = excluded.status,
             import_id = excluded.import_id,
             error_code = excluded.error_code,
             updated_at = excluded.updated_at`,
      [
        job.id,
        job.familyId,
        job.fileHash,
        job.analysisVersion,
        job.fileName,
        job.pageCount,
        job.extractedCharacters,
        job.status,
        job.importId ?? null,
        job.errorCode ?? null,
        job.createdAt,
        job.updatedAt,
      ],
    )
  }

  async getAnalysisSegment(
    jobId: string,
    path: string,
  ): Promise<TextbookAnalysisSegment | undefined> {
    const result = await this.pool.query<TextbookAnalysisSegmentRow>(
      `${selectAnalysisSegment}
       where job_id = $1 and path = $2`,
      [jobId, path],
    )
    return result.rows[0] ? toAnalysisSegment(result.rows[0]) : undefined
  }

  async saveAnalysisSegment(
    segment: TextbookAnalysisSegment,
  ): Promise<void> {
    await this.pool.query(
      `insert into textbook_analysis_segment (
         job_id, path, status, draft, created_at, updated_at
       ) values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (job_id, path) do update
         set status = excluded.status,
             draft = excluded.draft,
             updated_at = excluded.updated_at`,
      [
        segment.jobId,
        segment.path,
        segment.status,
        segment.draft ? JSON.stringify(segment.draft) : null,
        segment.createdAt,
        segment.updatedAt,
      ],
    )
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

const selectTextbookImport = `
  select id, family_id, file_name, page_count, extracted_characters,
         status, draft, created_at, confirmed_at
    from textbook_import
`

const selectAnalysisJob = `
  select id, family_id, file_hash, analysis_version, file_name, page_count,
         extracted_characters, status, import_id, error_code, created_at,
         updated_at
    from textbook_analysis_job
`

const selectAnalysisSegment = `
  select job_id, path, status, draft, created_at, updated_at
    from textbook_analysis_segment
`

function toTextbookImport(row: TextbookImportRow): TextbookImport {
  return {
    id: row.id,
    familyId: row.family_id,
    fileName: row.file_name,
    pageCount: row.page_count,
    extractedCharacters: row.extracted_characters,
    status: row.status,
    draft: textbookDraftSchema.parse(withoutLegacyQuestions(row.draft)),
    createdAt: row.created_at.toISOString(),
    ...(row.confirmed_at
      ? { confirmedAt: row.confirmed_at.toISOString() }
      : {}),
  }
}

function toAnalysisJob(row: TextbookAnalysisJobRow): TextbookAnalysisJob {
  return {
    id: row.id,
    familyId: row.family_id,
    fileHash: row.file_hash,
    analysisVersion: row.analysis_version,
    fileName: row.file_name,
    pageCount: row.page_count,
    extractedCharacters: row.extracted_characters,
    status: row.status,
    ...(row.import_id ? { importId: row.import_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toAnalysisSegment(
  row: TextbookAnalysisSegmentRow,
): TextbookAnalysisSegment {
  return {
    jobId: row.job_id,
    path: row.path,
    status: row.status,
    ...(row.draft
      ? { draft: textbookDraftSchema.parse(withoutLegacyQuestions(row.draft)) }
      : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function withoutLegacyQuestions(draft: unknown): unknown {
  if (!draft || typeof draft !== 'object') return draft
  const normalized = structuredClone(draft) as {
    chapters?: Array<{
      knowledgePoints?: Array<Record<string, unknown>>
    }>
  }
  for (const chapter of normalized.chapters ?? []) {
    for (const knowledgePoint of chapter.knowledgePoints ?? []) {
      delete knowledgePoint.questions
    }
  }
  return normalized
}
