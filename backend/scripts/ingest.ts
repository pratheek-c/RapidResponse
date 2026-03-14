/**
 * Protocol ingestion script.
 *
 * Reads .txt, .md, and .pdf files from backend/protocols/,
 * chunks them, embeds with Titan Embeddings v2, and upserts into LanceDB.
 *
 * Usage: bun run ingest:protocols
 *
 * Chunking strategy:
 *   - Split on section headers (# / ## / lines in ALL CAPS followed by newline)
 *   - Max 512 tokens per chunk (~2048 chars), 50-token overlap (~200 chars)
 *   - Each chunk stored with: id, source_file, section, chunk_text, priority_keywords, embedding
 *
 * Priority keywords: auto-extracted from chunk text (fire, cardiac, overdose, etc.)
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve, extname, basename } from "node:path";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { getLanceDb, initCollections } from "../src/db/lancedb.ts";

const PROTOCOLS_DIR = resolve(import.meta.dir, "../protocols");

const BEDROCK_REGION = process.env["AWS_REGION"] ?? "us-east-1";
const BEDROCK_KEY = process.env["AWS_ACCESS_KEY_ID"] ?? "";
const BEDROCK_SECRET = process.env["AWS_SECRET_ACCESS_KEY"] ?? "";
const EMBED_MODEL = process.env["BEDROCK_TITAN_EMBED_MODEL_ID"] ?? "amazon.titan-embed-text-v2:0";

const MAX_CHUNK_CHARS = 2048;
const OVERLAP_CHARS = 200;

const PRIORITY_KEYWORDS = [
  "fire", "cardiac", "arrest", "overdose", "stroke", "trauma", "hemorrhage",
  "unconscious", "breathing", "chest pain", "seizure", "drowning", "choking",
  "hazmat", "chemical", "explosion", "shooting", "stabbing", "vehicle",
  "structural", "collapse", "flood", "evacuation", "missing", "child",
];

// ---------------------------------------------------------------------------
// Bedrock embedding
// ---------------------------------------------------------------------------

const bedrockClient = new BedrockRuntimeClient({
  region: BEDROCK_REGION,
  credentials: {
    accessKeyId: BEDROCK_KEY,
    secretAccessKey: BEDROCK_SECRET,
  },
});

async function embedText(text: string): Promise<Float32Array> {
  const command = new InvokeModelCommand({
    modelId: EMBED_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });

  const response = await bedrockClient.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding: number[];
  };
  return new Float32Array(body.embedding);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function extractSectionHeader(line: string): string | null {
  // Markdown headers
  if (/^#{1,3}\s/.test(line)) return line.replace(/^#+\s*/, "").trim();
  // ALL CAPS lines (at least 5 chars)
  if (/^[A-Z][A-Z\s\-/]{4,}$/.test(line.trim())) return line.trim();
  return null;
}

type Chunk = {
  section: string;
  text: string;
};

function chunkDocument(content: string, sourceFile: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentSection = sourceFile;
  let currentText = "";

  function flush() {
    if (currentText.trim().length < 50) return; // Skip tiny chunks

    // Split long sections by character limit with overlap
    const text = currentText.trim();
    if (text.length <= MAX_CHUNK_CHARS) {
      chunks.push({ section: currentSection, text });
      return;
    }

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + MAX_CHUNK_CHARS, text.length);
      chunks.push({ section: currentSection, text: text.slice(start, end) });
      start = end - OVERLAP_CHARS;
      if (start >= text.length) break;
    }
  }

  for (const line of lines) {
    const header = extractSectionHeader(line);
    if (header) {
      flush();
      currentSection = header;
      currentText = "";
    } else {
      currentText += line + "\n";
    }
  }
  flush();

  return chunks;
}

// ---------------------------------------------------------------------------
// Priority keyword extraction
// ---------------------------------------------------------------------------

function extractPriorityKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return PRIORITY_KEYWORDS.filter((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

async function ingestFile(filePath: string): Promise<number> {
  const ext = extname(filePath).toLowerCase();
  const sourceFile = basename(filePath);

  let content: string;

  if (ext === ".txt" || ext === ".md") {
    content = await readFile(filePath, "utf-8");
  } else if (ext === ".pdf") {
    // Basic PDF: read raw bytes and extract text-like content
    // For production, use a proper PDF parser. For now, read as buffer and extract printable chars.
    const buffer = await readFile(filePath);
    content = buffer
      .toString("latin1")
      .replace(/[^\x20-\x7E\n\r\t]/g, " ")
      .replace(/\s{3,}/g, "\n");
  } else {
    console.log(`  Skipping unsupported file type: ${sourceFile}`);
    return 0;
  }

  const rawChunks = chunkDocument(content, sourceFile);
  console.log(`  ${sourceFile}: ${rawChunks.length} chunks`);

  const db = await getLanceDb();
  const table = await db.openTable("protocols");

  let count = 0;
  for (const chunk of rawChunks) {
    const id = crypto.randomUUID();
    const keywords = extractPriorityKeywords(chunk.text);
    const embedding = await embedText(chunk.text);

    try {
      await table.delete(`source_file = '${sourceFile}' AND section = '${chunk.section.replace(/'/g, "''")}'`);
    } catch {
      // Table may be empty — ignore
    }

    await table.add([{
      id,
      source_file: sourceFile,
      section: chunk.section,
      chunk_text: chunk.text,
      priority_keywords: JSON.stringify(keywords),
      embedding,
    }]);

    count++;
    process.stdout.write(`\r    Embedded ${count}/${rawChunks.length} chunks...`);
  }
  process.stdout.write("\n");

  return count;
}

async function main() {
  console.log("RapidResponse.ai — Protocol Ingestion");
  console.log("======================================");
  console.log(`Reading protocols from: ${PROTOCOLS_DIR}`);

  // Init LanceDB collections
  const db = await getLanceDb();
  await initCollections(db);

  let files: string[];
  try {
    const entries = await readdir(PROTOCOLS_DIR);
    files = entries
      .filter((f) => [".txt", ".md", ".pdf"].includes(extname(f).toLowerCase()))
      .map((f) => join(PROTOCOLS_DIR, f));
  } catch {
    console.error(`Error reading protocols directory: ${PROTOCOLS_DIR}`);
    console.error("Create backend/protocols/ and add .txt, .md, or .pdf files.");
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No protocol files found in backend/protocols/");
    console.log("Add .txt, .md, or .pdf files and run again.");
    process.exit(0);
  }

  console.log(`Found ${files.length} protocol file(s):`);
  let totalChunks = 0;

  for (const file of files) {
    const count = await ingestFile(file);
    totalChunks += count;
  }

  console.log(`\nIngestion complete. Total chunks stored: ${totalChunks}`);
}

main().catch((err: unknown) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
