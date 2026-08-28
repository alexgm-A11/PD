import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = (s) => document.querySelector(s);
let questions = [],
  index = 0,
  correct = 0,
  sourceName = "";
let selectedFiles = [];
let performance = {};
let sourcePages = [];
const usedQuestionKeys = new Set();
const usedQuestionTexts = [];
const views = ["#uploadView", "#processingView", "#quizView"];
function show(id) {
  views.forEach((v) => $(v).classList.toggle("hidden", v !== id));
}
const clean = (s) => s.replace(/\s+/g, " ").trim();
function sentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 55 && s.length < 420);
}
function unique(items) {
  const seen = new Set();
  return items.filter((x) => {
    const k = x.question.toLowerCase().replace(/\W/g, "").slice(0, 90);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function questionKey(question) {
  return clean(question || "")
    .toLowerCase()
    .replace(/[^a-záéíóúñ0-9]/g, "")
    .slice(0, 140);
}
function normalizeQuestions(items) {
  return unique(
    (Array.isArray(items) ? items : []).map((q) => {
      const options = (q.options || []).map((option) =>
        typeof option === "string" ? option : option.text || option.label || "",
      );
      let correctIndex = Number(q.correctIndex);
      if (!Number.isInteger(correctIndex) && typeof q.correct === "string")
        correctIndex = Math.max(0, q.correct.toUpperCase().charCodeAt(0) - 65);
      return {
        type: q.type || q.category || "Concepto clave",
        mode: "choice",
        question: clean(q.question || q.pregunta || ""),
        options,
        correctIndex,
        answer: q.answer || q.explanation || q.explicacion || "",
        source: q.source || "Fuente interna",
      };
    }),
  ).filter(
    (q) =>
      q.question.length > 20 &&
      q.options.length === 4 &&
      q.options.every((option) => option.trim().length > 0) &&
      q.correctIndex >= 0 &&
      q.correctIndex < 4 &&
      !usedQuestionKeys.has(questionKey(q.question)),
  );
}
function rememberQuestions(items) {
  items.forEach((q) => {
    usedQuestionKeys.add(questionKey(q.question));
    usedQuestionTexts.push(q.question);
  });
}

const stopWords = new Set([
  "para",
  "como",
  "desde",
  "entre",
  "sobre",
  "hasta",
  "donde",
  "cuando",
  "este",
  "esta",
  "estos",
  "estas",
  "también",
  "mediante",
  "puede",
  "debe",
  "tiene",
  "cada",
  "según",
  "porque",
  "aunque",
  "forma",
  "parte",
  "nivel",
]);
function topicFrom(text) {
  const normalized = text
    .replace(/^(nivel|objetivo|perla|enam|importante)\s*[^:]{0,25}:\s*/i, "")
    .replace(/[^a-záéíóúñü\s-]/gi, " ");
  const words = normalized
    .split(/\s+/)
    .filter((word) => word.length > 4 && !stopWords.has(word.toLowerCase()));
  return [...new Set(words.map((word) => word.toLowerCase()))]
    .slice(0, 4)
    .join(", ");
}
function localStem(text, number) {
  const definition = text.match(
    /^(.{5,90}?)\s+(?:es|son|se define como|consiste en)\s+(.{20,})$/i,
  );
  if (definition)
    return `¿Cuál es la descripción correcta de ${clean(definition[1])}?`;
  const colon = text.match(/^(.{5,80}?):\s+(.{20,})$/);
  if (colon) return `¿Qué afirmación explica correctamente ${clean(colon[1])}?`;
  const topic = topicFrom(text);
  return topic
    ? `En relación con ${topic}, ¿cuál de las siguientes afirmaciones es correcta?`
    : `Pregunta conceptual ${number}: ¿cuál de las siguientes afirmaciones es correcta?`;
}

async function extractPdf(file, fileIndex, fileTotal) {
  if (file.size > 50 * 1024 * 1024) throw Error("El PDF supera 50 MB.");
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() })
    .promise;
  let pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i),
      c = await p.getTextContent();
    pages.push({
      page: i,
      document: file.name,
      text: clean(c.items.map((x) => x.str).join(" ")),
    });
    $("#processingStatus").textContent =
      `PDF ${fileIndex + 1} de ${fileTotal}: ${file.name} · página ${i} de ${doc.numPages}`;
  }
  return pages;
}

function localQuestions(pages, count) {
  const all = pages.flatMap((p) =>
    sentences(p.text).map((text) => ({
      text,
      page: p.page,
      document: p.document,
    })),
  );
  const priority = all.filter((x) =>
    /ENAM|perla|frecuen|diagn[oó]st|tratamiento|signo|s[ií]ndrome|complicaci[oó]n|arteria|nervio|microorganismo|fisiopat/i.test(
      x.text,
    ),
  );
  const pool = [...priority, ...all].filter(
    (x, i, a) => a.findIndex((y) => y.text === x.text) === i,
  );
  const out = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const x = pool[(i * 7) % pool.length];
    const clinical = false;
    const written = false;
    const distractors = [1, 2, 3].map(
      (step) =>
        pool[(i * 7 + step * 5) % pool.length]?.text ||
        "Ninguna de las anteriores",
    );
    const options = [x.text, ...distractors]
      .map((text) => text.slice(0, 210))
      .sort(() => Math.random() - 0.5);
    out.push({
      type: "Concepto clave",
      question: localStem(x.text, i + 1),
      answer: x.text,
      mode: written ? "written" : "choice",
      options,
      correctIndex: options.indexOf(x.text.slice(0, 210)),
      source: `Fuente interna, página ${x.page}: ${x.text}`,
    });
  }
  return normalizeQuestions(out);
}

async function aiQuestions(pages, count) {
  const key = sessionStorage.getItem("medKey");
  if (!key) return null;
  const endpoint =
    sessionStorage.getItem("medEndpoint") || $("#endpointInput").value;
  const model = sessionStorage.getItem("medModel") || $("#modelInput").value;
  const material = pages
    .map((p) => `[Documento: ${p.document} | Página ${p.page}] ${p.text}`)
    .join("\n")
    .slice(0, 180000);
  const focus = sessionStorage.getItem("medFocus") || "ENAM";
  const level = sessionStorage.getItem("medLevel") || "advanced";
  const format = sessionStorage.getItem("medFormat") || "balanced";
  const previousQuestions = usedQuestionTexts
    .slice(-80)
    .map((key, i) => `${i + 1}. ${key}`)
    .join("\n");
  async function requestAI(system, prompt, temperature = 0.25) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw Error(`La IA respondió ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  }

  $("#processingTitle").textContent = "Etapa 1 de 3 · Analizando contenido";
  $("#processingStatus").textContent =
    "Extrayendo hechos examinables, relaciones, mecanismos y posibles casos clínicos.";
  const analysis = await requestAI(
    "Eres un analista médico riguroso. No redactes preguntas todavía. Extrae conocimiento verificable solo de la fuente.",
    `Analiza el material y devuelve JSON {"units":[{"topic":"","fact":"","mechanism":"","clinicalUse":"","commonError":"","clinicalPotential":true,"page":1,"priority":"alta|media"}]}. Crea al menos ${Math.max(count * 2, 20)} unidades diversas. Separa hechos distintos, identifica qué puede convertirse legítimamente en caso clínico y conserva la página. Prioriza ${focus} con dificultad ${level}. No menciones nombres de archivos en los campos. MATERIAL:\n${material}`,
    0.15,
  );

  $("#processingTitle").textContent = "Etapa 2 de 3 · Redactando preguntas";
  $("#processingStatus").textContent =
    "Construyendo enunciados autónomos y distractores clínicamente plausibles.";
  const draft = await requestAI(
    "Eres un comité de docentes médicos expertos en ENAM, razonamiento clínico y psicometría. Redacta preguntas claras, autosuficientes y sin pistas.",
    `Genera exactamente ${count} preguntas usando las unidades analizadas. Formato solicitado: ${format}. REGLAS: no menciones archivos, PDFs, fuentes ni “el material”; no copies el hecho correcto en el enunciado; el contexto debe aportar datos para razonar sin contener la respuesta; usa casos clínicos solo cuando clinicalPotential sea verdadero; si no, formula una pregunta conceptual específica; crea cuatro opciones homogéneas y plausibles; una sola correcta; distribuye correctIndex equilibradamente; evita “todas/ninguna”; no repitas conceptos ni estas preguntas previas:\n${previousQuestions || "Ninguna"}\nDevuelve {"questions":[{"type":"Caso clínico|Concepto clave|Integradora","mode":"choice","question":"","options":["","","",""],"correctIndex":0,"answer":"justifica la correcta y descarta las otras tres","source":"Fuente interna, página N: fundamento"}]}. UNIDADES ANALIZADAS:\n${JSON.stringify(analysis).slice(0, 100000)}`,
    0.35,
  );

  $("#processingTitle").textContent = "Etapa 3 de 3 · Auditando calidad";
  $("#processingStatus").textContent =
    "Eliminando ambigüedades, pistas involuntarias y respuestas expuestas.";
  const audited = await requestAI(
    "Eres un revisor psicométrico médico estricto. Corrige preguntas defectuosas y devuelve únicamente la versión final.",
    `Audita cada pregunta. Reescribe cualquier enunciado que revele la respuesta, dependa de conocer el documento, carezca de contexto, tenga más de una respuesta defendible, use distractores absurdos o no esté sustentado por las unidades. Comprueba silenciosamente que correctIndex corresponda realmente a la opción correcta. Conserva exactamente ${count} preguntas, cuatro opciones por pregunta y el esquema JSON original. Devuelve {"questions":[...]}. BORRADOR:\n${JSON.stringify(draft).slice(0, 100000)}\nUNIDADES DE VERIFICACIÓN:\n${JSON.stringify(analysis).slice(0, 70000)}`,
    0.1,
  );
  const parsed = audited.questions || audited.cuestionario || audited;
  const finalQuestions = normalizeQuestions(parsed);
  if (finalQuestions.length >= Math.min(count, 5))
    return finalQuestions.slice(0, count);
  return normalizeQuestions(
    draft.questions || draft.cuestionario || draft,
  ).slice(0, count);
}

async function process(fileList) {
  try {
    if (!sessionStorage.getItem("medKey")) {
      $("#settingsDialog").showModal();
      throw Error("Configura la API key para activar el análisis real con IA.");
    }
    const files = Array.from(fileList || []).filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
    );
    if (!files.length) throw Error("Selecciona al menos un archivo PDF.");
    if (files.length > 10) throw Error("Puedes subir un máximo de 10 PDFs.");
    sourceName =
      files.length === 1
        ? "1 PDF analizado"
        : `${files.length} PDFs analizados`;
    show("#processingView");
    $("#processingTitle").textContent = "Leyendo tus PDFs…";
    const pages = [];
    for (let i = 0; i < files.length; i++) {
      pages.push(...(await extractPdf(files[i], i, files.length)));
    }
    sourcePages = pages;
    $("#processingTitle").textContent = "Creando preguntas clínicas…";
    $("#processingStatus").textContent =
      "Analizando relaciones, perlas ENAM y conceptos de alta frecuencia.";
    const count = +(sessionStorage.getItem("medCount") || 12);
    const generated = await aiQuestions(pages, count);
    questions = generated || [];
    if (!questions.length)
      throw Error(
        "La IA no pudo crear preguntas válidas. Revisa la configuración e inténtalo nuevamente.",
      );
    questions.sort(() => Math.random() - 0.5);
    rememberQuestions(questions);
    index = 0;
    correct = 0;
    performance = {};
    render();
    show("#quizView");
  } catch (e) {
    alert(e.message);
    show("#uploadView");
  }
}
function render() {
  const q = questions[index];
  $("#resultSummary").classList.add("hidden");
  $("#questionText").classList.remove("hidden");
  $("#submitBtn").classList.remove("hidden");
  $("#skipBtn").textContent = "Omitir";
  $("#category").textContent = q.type.toUpperCase();
  $("#quizTitle").textContent = sourceName;
  $("#questionNumber").textContent =
    `Pregunta ${index + 1} de ${questions.length}`;
  $("#questionText").textContent = q.question;
  $("#progressBar").style.width = `${(index / questions.length) * 100}%`;
  $("#scoreText").textContent = `${correct} correctas`;
  const isWritten = q.mode === "written";
  $("#choiceArea").classList.toggle("hidden", isWritten);
  $("#writtenArea").classList.toggle("hidden", !isWritten);
  $("#answerInput").value = "";
  $("#answerInput").disabled = false;
  $("#choices").innerHTML = "";
  if (!isWritten) {
    (q.options || []).forEach((option, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.dataset.index = i;
      button.innerHTML = `<span class="choice-letter">${String.fromCharCode(65 + i)}</span><span></span>`;
      button.lastElementChild.textContent = option;
      button.addEventListener("click", () => {
        document
          .querySelectorAll(".choice")
          .forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      });
      $("#choices").appendChild(button);
    });
  }
  $("#submitBtn").disabled = false;
  $("#feedback").classList.add("hidden");
}
function evaluate() {
  const q = questions[index];
  const expected = q.answer || "";
  let good = false;
  if (q.mode !== "written") {
    const selected = document.querySelector(".choice.selected");
    if (!selected) return;
    const selectedIndex = Number(selected.dataset.index);
    good = selectedIndex === Number(q.correctIndex);
    document.querySelectorAll(".choice").forEach((item, i) => {
      item.disabled = true;
      if (i === Number(q.correctIndex)) item.classList.add("correct");
      else if (i === selectedIndex) item.classList.add("wrong");
    });
  } else {
    const answer = clean($("#answerInput").value);
    if (answer.length < 8) {
      $("#answerInput").focus();
      return;
    }
    const terms = expected.toLowerCase().match(/[a-záéíóúñ]{5,}/g) || [];
    const hits = [...new Set(terms)].filter((t) =>
      answer.toLowerCase().includes(t),
    ).length;
    good =
      hits >= Math.min(3, Math.max(1, Math.floor(new Set(terms).size * 0.08)));
  }
  if (good) correct++;
  const category = q.type || "Concepto clave";
  performance[category] ||= { correct: 0, total: 0 };
  performance[category].total++;
  if (good) performance[category].correct++;
  $("#feedbackLabel").textContent = good
    ? "✓ Respuesta con conceptos clave"
    : "↗ Revisa y completa tu razonamiento";
  $("#expectedAnswer").textContent = expected;
  $("#sourceText").textContent =
    questions[index].source || "Fuente: documento cargado";
  $("#feedback").classList.remove("hidden");
  $("#answerInput").disabled = true;
  $("#submitBtn").disabled = true;
  $("#scoreText").textContent = `${correct} correctas`;
  $("#feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function next() {
  if (index < questions.length - 1) {
    index++;
    render();
    scrollTo({ top: 0, behavior: "smooth" });
  } else {
    const percentage = Math.round((correct / questions.length) * 100);
    const categories = Object.entries(performance).sort(
      (a, b) => b[1].correct / b[1].total - a[1].correct / a[1].total,
    );
    $("#questionText").classList.add("hidden");
    $("#choiceArea").classList.add("hidden");
    $("#writtenArea").classList.add("hidden");
    $("#submitBtn").classList.add("hidden");
    $("#skipBtn").textContent = "Crear otro examen";
    $("#feedback").classList.add("hidden");
    $("#progressBar").style.width = "100%";
    const summary = $("#resultSummary");
    summary.innerHTML = `<p class="result-score">${correct}/${questions.length} · ${percentage}%</p><p>Examen completado. La siguiente iteración analizará nuevamente los PDFs para crear preguntas diferentes sin recargar la página.</p><div class="result-grid"><div class="result-box"><strong>Fortaleza</strong><span></span></div><div class="result-box"><strong>Por reforzar</strong><span></span></div></div>`;
    const labels = summary.querySelectorAll(".result-box span");
    labels[0].textContent = categories[0]?.[0] || "Sin datos suficientes";
    labels[1].textContent = categories.at(-1)?.[0] || "Sin datos suficientes";
    summary.classList.remove("hidden");
  }
}
async function restartQuiz() {
  show("#processingView");
  $("#processingTitle").textContent = "Creando una nueva iteración…";
  $("#processingStatus").textContent =
    "Evitando preguntas anteriores y buscando nuevos conceptos evaluables.";
  const count = +(sessionStorage.getItem("medCount") || 12);
  const generated = await aiQuestions(sourcePages, count).catch((error) => {
    alert(`No fue posible generar la nueva iteración: ${error.message}`);
    return null;
  });
  const fresh = generated || [];
  if (!fresh.length) {
    alert(
      "Ya se utilizaron los conceptos disponibles. Agrega más PDFs para crear preguntas nuevas.",
    );
    show("#quizView");
    return;
  }
  questions = fresh.sort(() => Math.random() - 0.5);
  rememberQuestions(questions);
  index = 0;
  correct = 0;
  performance = {};
  render();
  show("#quizView");
  scrollTo({ top: 0, behavior: "smooth" });
}
function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function addFiles(fileList) {
  const incoming = Array.from(fileList || []).slice(0, 1);
  for (const file of incoming) {
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;
    if (file.size > 50 * 1024 * 1024) {
      alert(`${file.name} supera el límite de 50 MB.`);
      continue;
    }
    const duplicate = selectedFiles.some(
      (item) => item.name === file.name && item.size === file.size,
    );
    if (!duplicate && selectedFiles.length < 10) selectedFiles.push(file);
  }
  if (incoming.length && selectedFiles.length >= 10)
    $("#dropzone strong").textContent = "Límite de 10 PDFs alcanzado";
  renderFileQueue();
}
function renderFileQueue() {
  $("#fileQueue").classList.toggle("hidden", !selectedFiles.length);
  $("#fileCount").textContent = `${selectedFiles.length} de 10`;
  $("#fileList").innerHTML = "";
  selectedFiles.forEach((file, fileIndex) => {
    const item = document.createElement("li");
    item.className = "file-item";
    item.innerHTML = `<div class="file-info"><strong></strong><span>${formatSize(file.size)}</span></div><button type="button" class="remove-file">Quitar</button>`;
    item.querySelector("strong").textContent = file.name;
    item.querySelector("button").addEventListener("click", () => {
      selectedFiles.splice(fileIndex, 1);
      $("#dropzone strong").textContent = "Agrega un PDF";
      renderFileQueue();
    });
    $("#fileList").appendChild(item);
  });
}
$("#pdfInput").addEventListener("change", (e) => {
  addFiles(e.target.files);
  e.target.value = "";
});
$("#acceptFilesBtn").addEventListener("click", () => process(selectedFiles));
const dz = $("#dropzone");
["dragenter", "dragover"].forEach((x) =>
  dz.addEventListener(x, (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((x) =>
  dz.addEventListener(x, (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
  }),
);
dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
$("#submitBtn").onclick = evaluate;
$("#nextBtn").onclick = next;
$("#skipBtn").onclick = () => {
  if (index >= questions.length - 1) {
    restartQuiz();
  } else next();
};
$("#newPdfBtn").onclick = () => {
  selectedFiles = [];
  sourcePages = [];
  usedQuestionKeys.clear();
  usedQuestionTexts.length = 0;
  renderFileQueue();
  show("#uploadView");
};
$("#settingsBtn").onclick = () => $("#settingsDialog").showModal();
$("#saveSettings").onclick = () => {
  const key = $("#keyInput").value.trim();
  if (key) sessionStorage.setItem("medKey", key);
  else sessionStorage.removeItem("medKey");
  sessionStorage.setItem("medEndpoint", $("#endpointInput").value);
  sessionStorage.setItem("medModel", $("#modelInput").value);
  sessionStorage.setItem("medCount", $("#countInput").value);
  updateAIStatus();
};
function updateAIStatus() {
  const ready = Boolean(sessionStorage.getItem("medKey"));
  $("#aiStatus").textContent = ready ? "IA configurada" : "IA no configurada";
  $("#aiStatus").classList.toggle("ready", ready);
}
updateAIStatus();

