import fs from "fs";
import path from "path";

const CLINICS_PATH = path.resolve("config/clinics.json");

export function loadClinics() {
  if (!fs.existsSync(CLINICS_PATH)) return {};
  const raw = fs.readFileSync(CLINICS_PATH, "utf-8");
  return raw.trim() ? JSON.parse(raw) : {};
}

export function getClinic(clinicId) {
  const clinics = loadClinics();
  return clinics[clinicId] ?? null;
}

export function upsertClinic(clinicId, clinicData) {
  const clinics = loadClinics();
  clinics[clinicId] = { ...(clinics[clinicId] ?? {}), ...clinicData };

  fs.mkdirSync(path.dirname(CLINICS_PATH), { recursive: true });
  fs.writeFileSync(CLINICS_PATH, JSON.stringify(clinics, null, 2), "utf-8");
}
