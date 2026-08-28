const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-4.1";
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
};

function responseText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
}

async function openaiJson(name, schema, instructions, input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en el archivo .env");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      temperature: 0.2,
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message || `OpenAI respondió ${response.status}`,
    );
  return JSON.parse(responseText(data));
}

const unitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["units"],
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "topic",
          "fact",
          "mechanism",
          "clinicalUse",
          "commonError",
          "clinicalPotential",
          "page",
          "priority",
        ],
        properties: {
          topic: { type: "string" },
          fact: { type: "string" },
          mechanism: { type: "string" },
          clinicalUse: { type: "string" },
          commonError: { type: "string" },
          clinicalPotential: { type: "boolean" },
          page: { type: "integer" },
          priority: { type: "string", enum: ["alta", "media"] },
        },
      },
    },
  },
};
const questionItem = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "mode",
    "question",
    "options",
    "correctIndex",
    "answer",
    "source",
  ],
  properties: {
    type: {
      type: "string",
      enum: ["Caso clínico", "Concepto clave", "Integradora"],
    },
    mode: { type: "string", enum: ["choice"] },
    question: { type: "string" },
    options: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string" },
    },
    correctIndex: { type: "integer", minimum: 0, maximum: 3 },
    answer: { type: "string" },
    source: { type: "string" },
  },
};
const questionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: { questions: { type: "array", items: questionItem } },
};

async function generateQuiz(payload) {
  const count = Math.min(40, Math.max(6, Number(payload.count || 15)));
  const material = (payload.pages || [])
    .map((p) => `[Página ${p.page}] ${p.text}`)
    .join("\n")
    .slice(0, 180000);
  if (material.length < 300)
    throw new Error("Los PDFs no contienen suficiente texto extraíble");
  const analysis = await openaiJson(
    "pdf_knowledge",
    unitSchema,
    "Eres un analista médico riguroso. Extrae conocimiento verificable de la fuente; no redactes preguntas todavía.",
    `Extrae al menos ${count * 2} unidades examinables: conceptos, mecanismos, diagnóstico, tratamiento, anatomía, relaciones y errores frecuentes. Marca clinicalPotential true solo si hay base suficiente para un caso. Conserva la página. MATERIAL:\n${material}`,
  );
  const draft = await openaiJson(
    "quiz_draft",
    questionSchema,
    "Eres un comité docente médico experto en ENAM y psicometría.",
    `Genera exactamente ${count} preguntas usando estas unidades. Los enunciados deben ser autónomos, específicos y fundamentados; jamás menciones PDFs, documentos o fuentes. No copies la respuesta en el contexto. Usa casos clínicos solo con clinicalPotential=true. Crea cuatro alternativas homogéneas, una sola correcta y distractores clínicamente plausibles. Evita todas/ninguna y distribuye correctIndex entre 0-3. Explica la correcta y descarta las otras. Preguntas previas prohibidas: ${JSON.stringify(payload.previousQuestions || [])}. UNIDADES: ${JSON.stringify(analysis)}`,
  );
  const audited = await openaiJson(
    "quiz_final",
    questionSchema,
    "Eres un revisor psicométrico médico estricto. Corrige silenciosamente cualquier defecto y devuelve la versión final.",
    `Audita y conserva exactamente ${count} preguntas. Reescribe las que revelen la respuesta, no tengan suficiente contexto, sean ambiguas, tengan distractores absurdos o no estén sustentadas. Verifica correctIndex. BORRADOR: ${JSON.stringify(draft)} UNIDADES: ${JSON.stringify(analysis)}`,
  );
  return audited;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/generate") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2_000_000)
          throw new Error("Solicitud demasiado grande");
      }
      const result = await generateQuiz(JSON.parse(body || "{}"));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(result));
    }
    const requestPath =
      req.url === "/"
        ? "index.html"
        : decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const filePath = path.resolve(root, requestPath);
    if (
      !filePath.startsWith(root) ||
      !fs.existsSync(filePath) ||
      fs.statSync(filePath).isDirectory()
    ) {
      res.writeHead(404);
      return res.end("No encontrado");
    }
    res.writeHead(200, {
      "Content-Type": `${mime[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () =>
  console.log(`MédicaMente disponible en http://localhost:${port}`),
);

