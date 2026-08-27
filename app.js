import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = (s) => document.querySelector(s);
let questions = [],
  index = 0,
  correct = 0,
  sourceName = "";
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

async function extractPdf(file) {
  if (file.size > 50 * 1024 * 1024) throw Error("El PDF supera 50 MB.");
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() })
    .promise;
  let pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i),
      c = await p.getTextContent();
    pages.push({ page: i, text: clean(c.items.map((x) => x.str).join(" ")) });
    $("#processingStatus").textContent =
      `Leyendo página ${i} de ${doc.numPages}…`;
  }
  return pages;
}

function localQuestions(pages, count) {
  const all = pages.flatMap((p) =>
    sentences(p.text).map((text) => ({ text, page: p.page })),
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
    const clinical = i < count / 2;
    const written = i % 5 === 4;
    const distractors = [1, 2, 3].map(
      (step) =>
        pool[(i * 7 + step * 5) % pool.length]?.text ||
        "Ninguna de las anteriores",
    );
    const options = [x.text, ...distractors]
      .map((text) => text.slice(0, 210))
      .sort(() => Math.random() - 0.5);
    out.push({
      type: clinical ? "Caso clínico" : "Recuerdo activo",
      question: clinical
        ? `Un paciente presenta un cuadro relacionado con el siguiente hallazgo del material: “${x.text.slice(0, 180)}${x.text.length > 180 ? "…" : ""}”. Integra los datos y explica el diagnóstico más probable, el mecanismo fisiopatológico y la conducta inicial.`
        : `A partir del tema descrito en el material, define con precisión el concepto central de “${x.text.slice(0, 150)}${x.text.length > 150 ? "…" : ""}” y explica sus relaciones anatómicas, fisiológicas o microbiológicas relevantes.`,
      answer: x.text,
      mode: written ? "written" : "choice",
      options,
      correctIndex: options.indexOf(x.text.slice(0, 210)),
      source: `Página ${x.page}: ${x.text}`,
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
    .map((p) => `[Página ${p.page}] ${p.text}`)
    .join("\n")
    .slice(0, 90000);
  const prompt = `Genera ${count} preguntas médicas avanzadas en español basadas exclusivamente en el documento. El 80% debe ser de selección múltiple con 4 alternativas plausibles y una sola correcta; el 20% puede ser de respuesta escrita integradora. Mitad casos clínicos estilo USMLE Step 2 y mitad recuerdo anatómico/fisiológico/microbiológico. Prioriza perlas ENAM y alta frecuencia, sin repetir conceptos. Distribuye la respuesta correcta aleatoriamente entre A, B, C y D. Devuelve SOLO JSON válido: {"questions":[{"type":"Caso clínico|Recuerdo activo|Integradora","mode":"choice|written","question":"...","options":["A","B","C","D"],"correctIndex":0,"answer":"explicación detallada","source":"Página N: fragmento breve"}]}. En preguntas escritas usa options [] y correctIndex -1. Documento:\n${material}`;
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
          content: "Eres docente experto en medicina y diseño de evaluaciones.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw Error(`La IA respondió ${res.status}`);
  const data = await res.json();
  let parsed = JSON.parse(data.choices[0].message.content);
  if (!Array.isArray(parsed))
    parsed = parsed.questions || parsed.cuestionario || [];
  return unique(parsed);
}

async function process(file) {
  try {
    sourceName = file.name;
    show("#processingView");
    $("#processingTitle").textContent = "Leyendo tu PDF…";
    const pages = await extractPdf(file);
    $("#processingTitle").textContent = "Creando preguntas clínicas…";
    $("#processingStatus").textContent =
      "Priorizando perlas ENAM y conceptos de alta frecuencia.";
    const count = +(sessionStorage.getItem("medCount") || 12);
    questions =
      (await aiQuestions(pages, count).catch(() => null)) ||
      localQuestions(pages, count);
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
$("#pdfInput").addEventListener(
  "change",
  (e) => e.target.files[0] && process(e.target.files[0]),
);
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
dz.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f?.type === "application/pdf") process(f);
});
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

