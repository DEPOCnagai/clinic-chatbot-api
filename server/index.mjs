import "dotenv/config";
import OpenAI from "openai";
import express from "express";
import cors from "cors";
import { getClinic } from "./clinicsStore.mjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";


function makeRequestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function maskPII(text) {
  if (!text) return text;
  let t = String(text);

  // email
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]");
  // phone (ざっくり日本向け)
  t = t.replace(/(\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, "[PHONE]");
  // 長い数字列（予約番号等）
  t = t.replace(/\d{6,}/g, "[NUM]");

  return t;
}

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), "logs");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function ymdUTC(d = new Date()) {
  // 例: 2026-02-05
  return d.toISOString().slice(0, 10);
}

function logEvent(obj) {
  // 1) console（クラウド向け）
  const line = JSON.stringify(obj);
  console.log(line);

  // 2) ファイル（ローカル分析向け）
  try {
    ensureLogDir();
    const file = path.join(LOG_DIR, `chat-${ymdUTC()}.jsonl`);
    fs.appendFile(file, line + "\n", (err) => {
      if (err) {
        // ログ書き込み失敗は落とさない（必要ならstderrへ）
        console.error("log_write_failed:", err?.message ?? String(err));
      }
    });
  } catch (e) {
    console.error("log_setup_failed:", e?.message ?? String(e));
  }
}



const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server listening on port ${PORT}`);
});


app.set("trust proxy", 1);

app.use(cors({
  origin: [
    "https://your-public-site.example",  // 本番
    "http://localhost:5173"              // 開発
  ],
}));

app.use(express.json());
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分
  limit: 30,           // 1分あたり30回まで（まずはこのくらい）
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// /chat にだけ適用
app.post("/chat", chatLimiter, async (req, res) => {
  // ...あなたの既存コード...
});


// 動作確認用
app.get("/", (req, res) => {
  res.send("clinic-chatbot API is running (NEW INDEX)");
});

app.post("/chat", async (req, res) => {
  console.log("CHAT HIT FROM:", import.meta.url);
  const request_id = makeRequestId();
  const t0 = Date.now();

  try {
    const { clinicId, message } = req.body;

    if (!clinicId || !message) {
  logEvent({ event:"chat_reject", ts:new Date().toISOString(), request_id, reason:"missing_params", clinicId, message: maskPII(message) });
  return res.status(400).json({ error: "clinicId and message are required" });
}


const clinic = getClinic(clinicId);
console.log("clinicId:", clinicId);
const maskedMessage = maskPII(message);

if (!clinic) {
  logEvent({ event:"chat_reject", ts:new Date().toISOString(), request_id, reason:"unknown_clinic", clinicId, message: maskedMessage });
  return res.status(404).json({
    error: `Unknown clinicId: ${clinicId}`,
    hint: "config/clinics.json に clinicId を登録してください",
  });
}



console.log("vectorStoreId:", clinic.vectorStoreId);
console.log("siteRoot:", clinic.siteRoot);

    if (!clinic.vectorStoreId) {
      return res.status(400).json({
        error: `vectorStoreId is missing for clinicId: ${clinicId}`,
        hint: "ベクターストア作成後、config/clinics.json に vectorStoreId を保存してください",
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on server" });
    }

    // --- 医療相談の固定ブロック（最小） ---
    const MEDICAL_TRIGGERS = [
      "診断",
      "病名",
      "原因",
      "治し方",
      "治療",
      "薬",
      "処方",
      "市販薬",
      "飲んでいい",
      "危険",
      "救急",
      "緊急",
      "結果",
      "陽性",
      "陰性",
    ];
    const lower = String(message).toLowerCase();
    const isMedicalAdvice = MEDICAL_TRIGGERS.some((k) => lower.includes(k));

    if (isMedicalAdvice) {
      logEvent({ event:"chat_blocked", ts:new Date().toISOString(), request_id, clinicId, reason:"medical_advice", message: maskedMessage });
      return res.json({
        category: "refuse_medical_advice",
        can_answer: false,
        answer_text:
          "ご相談ありがとうございます。\n\n" +
          "申し訳ありませんが、このチャットでは診断・治療判断・薬の案内など医療相談にはお答えできません。\n" +
          "受診方法・受付時間・関連ページのご案内は可能です。\n\n" +
          "よろしければ「予約」「受付時間」「診療案内」などでご質問ください。",
        links: [{ label: "公式サイト", url: clinic.siteRoot }],
        quick_replies: ["予約", "受付時間", "診療案内"],
      });
    }

const CATEGORY_ENUM = [
  "reservation",
  "hours",
  "access",
  "service_scope",
  "pregnancy_care",
  "prenatal_testing",
  "gyn_menstrual",
  "gyn_infection",
  "gyn_uterus_ovary",
  "contraception",
  "pricing",
  "admin_docs",
  "refuse_medical_advice",
  null,
];
const system = `
あなたは医療機関の「案内」担当です。
- 診断・治療判断・薬の推奨・検査結果の解釈・緊急性の断定は行いません。
- 返答は必ず vector store の検索結果（file_search）に基づく。見つからない場合は「公式サイトに記載が見つからない」と伝え、問い合わせ導線を案内する。
- 返答は短く、箇条書きを基本にする。
- ユーザーの質問文が文書の表現が完全一致しなくても適切な category を選んでよい。
- 受付時間・診療時間・アクセスなど明確な情報は、完全一致がなくても検索結果から読み取れる範囲で要約して答えてよい。
- URLは公式サイト内のみ。最後に関連ページURLを1〜5件付ける。
- 「受付時間」「診療時間」「アクセス」「予約」など明確な案内は、検索結果に該当があれば必ず can_answer=true で要約して返す。
- links には公式サイト内URLのみ。外部URL（予約サイト/LINE等）は answer_text に記載してよい。
- 「見つからない」は検索結果が0件のときのみ。
- 外部URL（予約サイト/LINE等）は answer_text 内に掲載してよい。
`;

// ① 先にchunksを用意（初期値も持たせる）
let chunks = "";

// ② ベクターストア検索 → chunks生成
const query = String(message);
const search = await openai.vectorStores.search(clinic.vectorStoreId, {
  query,
  max_num_results: 5,
});

chunks = (search.data ?? [])
  .map((r) => (r.content ?? []).map((c) => c.text).join("\n"))
  .filter(Boolean)
  .join("\n---\n");

console.log("VS_SEARCH_RESULTS:", (search.data ?? []).length);

// ③ その後で user を作る（chunksを参照してOK）
const user = `
ユーザー入力: ${message}

以下は公式サイト（ベクターストア）から見つかった関連抜粋です。
この抜粋だけを根拠に、案内文を作ってください。

--- 抜粋ここから ---
${chunks || "（検索結果なし）"}
--- 抜粋ここまで ---

要求:
- category を決める（該当なしは null）
- can_answer を true/false（検索結果なしのときだけ false）
- answer_text（案内文）
- links（公式サイト内のみ）
- quick_replies
`;



const params = {
  model: "gpt-4.1",
  input: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
   text: {
    format: {
      type: "json_schema",
      name: "clinic_bot_reply",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { enum: CATEGORY_ENUM },
          can_answer: { type: "boolean" },
          answer_text: { type: "string" },
          links: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                url: { type: "string" },
              },
              required: ["label", "url"],
            },
          },
          quick_replies: { type: "array", items: { type: "string" } },
        },
        required: ["category", "can_answer", "answer_text", "links", "quick_replies"],
      },
    },
  },
};

console.log("PARAM KEYS:", Object.keys(params));
console.log("HAS response_format?", Object.prototype.hasOwnProperty.call(params, "response_format"));

const response = await openai.responses.create(params);
console.log("OUTPUT_TEXT:", response.output_text);

// 追加：どんなツール出力が返ってきてるか（file_searchの結果が入る）
console.log("RAW_OUTPUT (first item):", JSON.stringify(response.output?.[0] ?? null, null, 2));
console.log("OUTPUT_LEN:", response.output?.length);

const text = response.output_text;
const out = response.output ?? [];
const fileSearchCalls = out.filter((x) => x.type === "file_search_call");
console.log("FILE_SEARCH_CALLS:", fileSearchCalls.length);

const hitCount = (search.data ?? []).length;
console.log("VS_SEARCH_RESULTS:", hitCount);

if (hitCount === 0) {
  logEvent({
    event:"chat",
    ts:new Date().toISOString(),
    request_id,
    clinicId,
    message: maskedMessage,
    category: "hours",
    can_answer: false,
    hitCount: 0,
    links_count: 1,
    latency_ms: Date.now() - t0,
    note: "no_vector_hits"
    
  });
  return res.json({
    category: "hours",
    can_answer: false,
    answer_text:
      "公式サイト内（当院データ）から該当情報が見つかりませんでした。\n" +
      "恐れ入りますが、下記ページをご確認ください。",
    links: [{ label: "診療時間・アクセス", url: "https://www.hiroo-ladies.com/information" }],
    quick_replies: ["予約", "アクセス", "電話番号"],
  });
}


console.log("FILE_SEARCH_CALLS:", fileSearchCalls.length);

// （任意）中身確認
console.log("FILE_SEARCH_CALL_SAMPLE:", JSON.stringify(fileSearchCalls[0] ?? null, null, 2));



let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = {
    category: null,
    can_answer: false,
    answer_text: "回答の生成に失敗しました。しばらくしてからお試しください。",
    links: [{ label: "公式サイト", url: clinic.siteRoot }],
    quick_replies: ["予約", "受付時間", "診療案内"],
  };
}

function toAbsUrl(urlOrPath, siteRoot) {
  try {
    return new URL(urlOrPath, siteRoot).href; // 相対も絶対もOK
  } catch {
    return null;
  }
}

function isSameOrigin(url, siteRoot) {
  try {
    const u = new URL(url);
    const root = new URL(siteRoot);
    return u.origin === root.origin;
  } catch {
    return false;
  }
}


// 念のため公式サイト以外のリンクは落とす（安全）
let safeLinks = (parsed.links || [])
  .map(l => {
    const abs = toAbsUrl(l?.url, clinic.siteRoot);
    if (!abs) return null;
    return { label: l?.label || "関連ページ", url: abs };
  })
  .filter(Boolean)
  .filter(l => isSameOrigin(l.url, clinic.siteRoot));


// ★ links が空なら fallback（カテゴリ別）
if (!safeLinks.length) {
  const fallbackByCategory = {
    reservation: "/guidance",
    hours: "/information",
    access: "/information",
  };
  const path = fallbackByCategory[parsed.category] || "/";
  const fallbackUrl = toAbsUrl(path, clinic.siteRoot) || clinic.siteRoot;

  safeLinks = [{ label: "関連ページ（公式サイト）", url: fallbackUrl }];
}

console.log("CLINIC.siteRoot:", clinic.siteRoot);
console.log("PARSED.links:", parsed.links);
console.log("SAFE.links:", safeLinks);
const latency_ms = Date.now() - t0;

logEvent({
  event: "chat",
  ts: new Date().toISOString(),
  request_id,
  clinicId,
  message: maskedMessage,
  category: parsed.category ?? null,
  can_answer: Boolean(parsed.can_answer),
  hitCount: (search.data ?? []).length,
  links_count: safeLinks.length,
  latency_ms,
  answer_preview: String(parsed.answer_text ?? "").slice(0, 200),
});

return res.json({
  ...parsed,
  links: safeLinks,
});

  } catch (err) {
  const latency_ms = Date.now() - t0;
  logEvent({
    event: "chat_error",
    ts: new Date().toISOString(),
    request_id,
    clinicId: req?.body?.clinicId,
    message: maskPII(req?.body?.message),
    latency_ms,
    error: err?.message ?? String(err),
  });

  console.error(err);
  return res.status(500).json({ error: "Server error", detail: err?.message ?? String(err) });
}

});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
