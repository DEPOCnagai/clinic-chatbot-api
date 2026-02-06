import "dotenv/config";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { getClinic } from "../server/clinicsStore.mjs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function usage() {
  console.log("Usage: node scripts/ingestClinic.mjs <clinicId>");
  console.log("Example: node scripts/ingestClinic.mjs hiroo-ladies");
}

async function main() {
  const clinicId = process.argv[2];
  if (!clinicId) {
    usage();
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY is missing in .env");
    process.exit(1);
  }

  const clinic = getClinic(clinicId);
  if (!clinic) {
    console.error(`ERROR: Unknown clinicId "${clinicId}" (config/clinics.json)`);
    process.exit(1);
  }
  if (!clinic.vectorStoreId) {
    console.error(`ERROR: vectorStoreId missing for "${clinicId}"`);
    process.exit(1);
  }

  const dir = path.resolve("data", clinicId);
  if (!fs.existsSync(dir)) {
    console.error(`ERROR: data directory not found: ${dir}`);
    console.error(`→ mkdir data\\${clinicId} して txt/md を置いてください`);
    process.exit(1);
  }

  const filePaths = fs
    .readdirSync(dir)
    .filter((f) => /\.(txt|md)$/i.test(f))
    .map((f) => path.join(dir, f));

  if (filePaths.length === 0) {
    console.error(`ERROR: No .txt/.md files in ${dir}`);
    process.exit(1);
  }

  console.log(`Uploading ${filePaths.length} files to vector store ${clinic.vectorStoreId}...`);

  // ★ポイント：自前で files.create → fileBatches.create → retrieve で待たない
  // SDKの uploadAndPoll を使って「アップロード＋追加＋完了待ち」をまとめてやる
  const streams = filePaths.map((p) => fs.createReadStream(p));

  const batch = await openai.vectorStores.fileBatches.uploadAndPoll(clinic.vectorStoreId, {
    files: streams,
  });

  console.log("✅ uploadAndPoll done.");
  console.log(`status: ${batch.status}`);
  console.log(`file_counts: ${JSON.stringify(batch.file_counts)}`);

  if (batch.status !== "completed") {
    console.error("❌ batch did not complete successfully.");
    console.error(batch);
    process.exit(1);
  }

  console.log("✅ Indexing completed.");
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
