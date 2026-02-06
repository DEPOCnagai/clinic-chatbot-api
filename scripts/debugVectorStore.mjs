import "dotenv/config";
import OpenAI from "openai";
import { getClinic } from "../server/clinicsStore.mjs";

const clinicId = process.argv[2];
if (!clinicId) {
  console.log("Usage: node scripts/debugVectorStore.mjs <clinicId>");
  process.exit(1);
}

const clinic = getClinic(clinicId);
if (!clinic?.vectorStoreId) {
  console.log("Missing clinic or vectorStoreId:", clinicId, clinic);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("clinicId:", clinicId);
console.log("vectorStoreId:", clinic.vectorStoreId);

const files = await openai.vectorStores.files.list(clinic.vectorStoreId, { limit: 20 });
console.log("files count:", files.data?.length ?? 0);
for (const f of files.data ?? []) {
  console.log("-", f.id, f.status);
}
