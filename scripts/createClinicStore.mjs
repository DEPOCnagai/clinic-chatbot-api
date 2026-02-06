import "dotenv/config";
import OpenAI from "openai";
import { getClinic, upsertClinic } from "../server/clinicsStore.mjs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function usage() {
  console.log('Usage: node scripts/createClinicStore.mjs <clinicId> "<clinicName>"');
  console.log('Example: node scripts/createClinicStore.mjs hiroo-ladies "広尾レディースクリニック"');
}

async function main() {
  const clinicId = process.argv[2];
  const clinicName = process.argv[3];

  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY is missing. Put it in .env at project root.");
    process.exit(1);
  }

  if (!clinicId || !clinicName) {
    usage();
    process.exit(1);
  }

  const existing = getClinic(clinicId);
  if (!existing) {
    console.error(`ERROR: clinicId "${clinicId}" is not registered in config/clinics.json`);
    console.error(`→ 先に config/clinics.json に "${clinicId}" を追加してください`);
    process.exit(1);
  }

  // すでにあるなら作らない（事故防止）
  if (existing.vectorStoreId && String(existing.vectorStoreId).trim() !== "") {
    console.log(`Already has vectorStoreId: ${existing.vectorStoreId}`);
    process.exit(0);
  }

  // Vector Store を作成
  const vs = await openai.vectorStores.create({
    name: `${clinicName} (${clinicId})`,
  });

  // clinics.json に保存
  upsertClinic(clinicId, {
    name: existing.name ?? clinicName,
    vectorStoreId: vs.id,
  });

  console.log("✅ Vector store created!");
  console.log(`clinicId: ${clinicId}`);
  console.log(`vectorStoreId: ${vs.id}`);
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
