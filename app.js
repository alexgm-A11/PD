import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = (s) => document.querySelector(s);
let questions = [],
  index = 0,
  correct = 0,
  sourceName = "";
let selectedFiles = [];
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
      question: `Pregunta ${i + 1}: ¿cuál de las siguientes afirmaciones describe correctamente el concepto médico evaluado?`,
      answer: x.text,
      mode: written ? "written" : "choice",
      options,
      correctIndex: options.indexOf(x.text.slice(0, 210)),
      source: `Fuente interna, página ${x.page}: ${x.text}`,
    });
  }
  return unique(out);
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
  const prompt = `Realiza primero un análisis médico interno de todos los PDFs: identifica temas centrales, afirmaciones examinables, perlas ENAM, relaciones causa-efecto, mecanismos fisiopatológicos, criterios diagnósticos, tratamientos, anatomía relevante y errores frecuentes. Después selecciona los conceptos de mayor valor educativo y genera ${count} preguntas de selección múltiple en español. Enfoque: ${focus}. Dificultad: ${level}. Formato: ${format}.

REGLAS OBLIGATORIAS:
1) Evalúa el contenido interno; nunca menciones nombres de archivos, PDFs, documentos, diapositivas, autores ni expresiones como “según el material”.
2) El enunciado no puede copiar ni citar la oración que contiene la respuesta. Tampoco debe revelar la respuesta con pistas léxicas.
3) Cuando haya base clínica, transforma el conocimiento en un caso clínico nuevo, breve y realista con datos discriminativos. Pregunta por diagnóstico, mecanismo, prueba confirmatoria, complicación o conducta.
4) Cuando no haya base clínica suficiente, crea una pregunta conceptual clara. No inventes pacientes ni datos clínicos sin sustento.
5) Integra conceptos de distintos apartados cuando exista una relación médica válida.
6) Cada pregunta tiene exactamente cuatro alternativas plausibles, homogéneas en longitud y categoría, con una sola correcta.
7) Los distractores deben representar errores clínicos razonables; evita opciones absurdas, “todas”, “ninguna” y pistas gramaticales.
8) Equilibra y aleatoriza correctIndex entre 0, 1, 2 y 3. No repitas conceptos, casos ni alternativas.
9) La explicación debe justificar la correcta y descartar brevemente cada distractor; solo será visible después de responder.
10) source debe usar únicamente “Fuente interna, página N” seguido de un fundamento breve, sin nombres de archivos.
11) Prioriza lo marcado como ENAM, perla, importante, frecuente, diagnóstico, tratamiento, complicación o mecanismo.

Devuelve SOLO JSON válido: {"questions":[{"type":"Caso clínico|Concepto clave|Integradora","mode":"choice","question":"enunciado autónomo sin mencionar la fuente","options":["A","B","C","D"],"correctIndex":0,"answer":"explicación razonada","source":"Fuente interna, página N: fundamento breve"}]}. MATERIAL PARA ANÁLISIS INTERNO:\n${material}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Eres un comité de docentes médicos expertos en razonamiento clínico, ENAM y diseño psicométrico. Analiza primero, redacta después y evita cualquier filtración de la respuesta.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.45,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw Error(`La IA respondió ${res.status}`);
  const data = await res.json();
  let parsed = JSON.parse(data.choices[0].message.content);
  if (!Array.isArray(parsed))
    parsed = parsed.questions || parsed.cuestionario || [];
  return unique(
    parsed.filter(
      (q) =>
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        Number.isInteger(Number(q.correctIndex)) &&
        Number(q.correctIndex) >= 0 &&
        Number(q.correctIndex) < 4,
    ),
  );
}

async function process(fileList) {
  try {
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
    $("#processingTitle").textContent = "Creando preguntas clínicas…";
    $("#processingStatus").textContent =
      "Analizando relaciones, perlas ENAM y conceptos de alta frecuencia.";
    const count = +(sessionStorage.getItem("medCount") || 12);
    const generated = await aiQuestions(pages, count).catch(() => null);
    questions = generated?.length ? generated : localQuestions(pages, count);
    if (!questions.length)
      throw Error("No se encontró texto suficiente en el PDF.");
    questions.sort(() => Math.random() - 0.5);
    index = 0;
    correct = 0;
    render();
    show("#quizView");
  } catch (e) {
    alert(e.message);
    show("#uploadView");
  }
}
function render() {
  const q = questions[index];
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
    $("#questionText").textContent =
      `Completaste el examen: ${correct} de ${questions.length} respuestas con conceptos clave.`;
    $("#answerInput").classList.add("hidden");
    $("#submitBtn").classList.add("hidden");
    $("#skipBtn").textContent = "Crear otro examen";
    $("#feedback").classList.add("hidden");
    $("#progressBar").style.width = "100%";
  }
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
    location.reload();
  } else next();
};
$("#newPdfBtn").onclick = () => location.reload();
$("#settingsBtn").onclick = () => $("#settingsDialog").showModal();
$("#saveSettings").onclick = () => {
  sessionStorage.setItem("medKey", $("#keyInput").value);
  sessionStorage.setItem("medEndpoint", $("#endpointInput").value);
  sessionStorage.setItem("medModel", $("#modelInput").value);
  sessionStorage.setItem("medCount", $("#countInput").value);
};

