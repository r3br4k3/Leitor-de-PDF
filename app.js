const statusPanel = document.getElementById("statusPanel");
const addressList = document.getElementById("addressList");
const pdfInput = document.getElementById("pdfInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const autoOpen = document.getElementById("autoOpen");
const pdfCanvasContainer = document.getElementById("pdfCanvasContainer");
const viewerHint = document.getElementById("viewerHint");

const ROUTE_URL = "https://waze.com/ul";
let selectedFile = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Registro do SW e opcional; o app continua sem cache offline.
  });
}

function setStatus(message, mode = "") {
  statusPanel.className = `panel status ${mode}`.trim();
  statusPanel.textContent = message;
}

function openInWaze(address) {
  const target = `${ROUTE_URL}?q=${encodeURIComponent(address)}&navigate=yes`;
  window.location.href = target;
}

function clearPdfPreview() {
  pdfCanvasContainer.innerHTML = "";
}

function normalizeAddress(line) {
  return line
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " ")
    .trim();
}

const IGNORED_EXACT_LINES = new Set([
  "mactel sistemas de seguranca ltda",
  "02.256.145/0001-83",
  "www.mactelrs.com.br",
  "(51) 3286-6680",
  "rua marechal mesquita , 441, conj 201",
  "teresopolis, porto alegre - rs",
  "91.720-160",
  "0962670669",
]);

const IGNORED_PARTIAL_REGEX = [
  /\bmactel\b/i,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, // CNPJ
  /\bwww\.mactelrs\.com\.br\b/i,
  /^\(?\d{2}\)?\s*\d{4,5}-?\d{4}$/,
  /^\d{10,12}$/,
  /^\d{2}\.\d{3}-\d{3}$/,
];

function shouldIgnoreLine(line) {
  const normalized = normalizeAddress(line).toLowerCase();
  if (!normalized) return true;

  if (IGNORED_EXACT_LINES.has(normalized)) {
    return true;
  }

  return IGNORED_PARTIAL_REGEX.some((regex) => regex.test(normalized));
}

function findAddresses(linesInput) {
  const lines = linesInput.map((line) => normalizeAddress(line)).filter((line) => line && !shouldIgnoreLine(line));

  const streetRegex =
    /\b(rua|r\.|av\.?|avenida|travessa|estrada|rodovia|alameda|praca|largo|viela|logradouro|condominio)\b/i;
  const cepRegex = /\b\d{5}-?\d{3}\b/;
  const numberRegex = /\b\d{1,5}\b/;
  const numeroMarcadorRegex = /\bn\s*[oº°]\s*[:\.]?\s*\d{1,5}\b/i;
  const bairroRegex = /\bbairro\s*[:\-]?\s*[a-z0-9\s\-]+$/i;

  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";

    const hasStreet = streetRegex.test(line);
    const hasCep = cepRegex.test(line);
    const hasNumber = numberRegex.test(line);
    const hasNumeroMarcador = numeroMarcadorRegex.test(line);
    const nextHasBairro = bairroRegex.test(nextLine);
    const thisHasBairro = bairroRegex.test(line);

    if ((hasStreet && (hasNumber || hasNumeroMarcador || hasCep)) || (hasStreet && nextHasBairro) || (hasStreet && thisHasBairro)) {
      const merged = nextHasBairro ? `${line}, ${nextLine}` : line;
      candidates.push(merged);
      if (nextHasBairro) index += 1;
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function extractPageLines(items) {
  // Agrupa fragmentos por coordenada Y para recompor linhas reais do PDF.
  const rowsByY = new Map();

  for (const item of items) {
    if (!item?.str || !item.str.trim()) continue;

    const x = typeof item.transform?.[4] === "number" ? item.transform[4] : 0;
    const yRaw = typeof item.transform?.[5] === "number" ? item.transform[5] : 0;
    const yKey = String(Math.round(yRaw));

    if (!rowsByY.has(yKey)) {
      rowsByY.set(yKey, []);
    }

    rowsByY.get(yKey).push({ x, text: item.str });
  }

  const sortedY = [...rowsByY.keys()].map(Number).sort((a, b) => b - a);
  const lines = [];

  for (const y of sortedY) {
    const tokens = rowsByY.get(String(y)).sort((a, b) => a.x - b.x);
    const line = tokens.map((token) => token.text).join(" ");
    const normalized = normalizeAddress(line);
    if (normalized) lines.push(normalized);
  }

  return lines;
}

function renderAddresses(addresses) {
  addressList.innerHTML = "";

  if (!addresses.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum endereco identificado automaticamente.";
    addressList.appendChild(li);
    return;
  }

  for (const address of addresses) {
    const item = document.createElement("li");
    item.className = "address-item";

    const text = document.createElement("div");
    text.className = "address-text";
    text.textContent = address;

    const button = document.createElement("button");
    button.className = "waze-btn";
    button.type = "button";
    button.textContent = "Abrir no Waze";
    button.addEventListener("click", () => openInWaze(address));

    item.append(text, button);
    addressList.appendChild(item);
  }
}

async function renderAndExtract(file) {
  const pdfjsLib = globalThis.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("Biblioteca PDF.js nao carregou.");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

  clearPdfPreview();
  viewerHint.textContent = `Carregando: ${file.name}`;

  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const containerWidth = Math.max(pdfCanvasContainer.clientWidth - 22, 280);
  const dpr = window.devicePixelRatio || 1;
  const allLines = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(containerWidth / baseViewport.width, 0.8);

    // Viewport em CSS pixels (para texto e dimensoes do wrapper)
    const viewport = page.getViewport({ scale });
    // Viewport em pixels fisicos (para canvas nitido em telas Retina/HDPI)
    const renderViewport = page.getViewport({ scale: scale * dpr });

    // Wrapper posicionado
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.style.width = `${Math.floor(viewport.width)}px`;
    wrapper.style.height = `${Math.floor(viewport.height)}px`;

    // Canvas renderizado em alta resolucao
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    // Camada de texto invisivel e selecionavel
    const textLayer = document.createElement("div");
    textLayer.className = "pdf-text-layer";
    textLayer.style.width = `${Math.floor(viewport.width)}px`;
    textLayer.style.height = `${Math.floor(viewport.height)}px`;

    wrapper.append(canvas, textLayer);
    pdfCanvasContainer.appendChild(wrapper);

    const context = canvas.getContext("2d", { alpha: false });
    const textContent = await page.getTextContent();

    await page.render({ canvasContext: context, viewport: renderViewport }).promise;

    if (typeof pdfjsLib.renderTextLayer === "function") {
      pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport });
    }

    allLines.push(...extractPageLines(textContent.items));
  }

  viewerHint.textContent = `${file.name} — ${doc.numPages} pagina(s)`;
  return allLines;
}

async function analyzeFile(file) {
  setStatus("Lendo PDF...", "");

  try {
    const lines = await renderAndExtract(file);
    const addresses = findAddresses(lines);

    renderAddresses(addresses);

    if (addresses.length) {
      setStatus(`Analise concluida: ${addresses.length} endereco(s) encontrado(s).`, "ok");
      if (autoOpen.checked) {
        openInWaze(addresses[0]);
      }
    } else {
      setStatus("PDF analisado, mas sem endereco claro para rota.", "error");
    }
  } catch (error) {
    clearPdfPreview();
    viewerHint.textContent = "Nao foi possivel exibir o PDF.";
    setStatus("Falha ao analisar PDF. Verifique se o arquivo nao esta protegido.", "error");
  }
}

pdfInput.addEventListener("change", (event) => {
  selectedFile = event.target.files?.[0] || null;
  if (selectedFile) {
    viewerHint.textContent = `Arquivo selecionado: ${selectedFile.name}`;
  }
});

analyzeBtn.addEventListener("click", async () => {
  const file = selectedFile || pdfInput.files?.[0] || null;
  if (!file) {
    setStatus("Selecione um PDF primeiro.", "error");
    return;
  }

  await analyzeFile(file);
});

async function handleIncomingFile(file) {
  if (!file || file.type !== "application/pdf") return;

  selectedFile = file;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  pdfInput.files = transfer.files;
  viewerHint.textContent = `Arquivo recebido: ${file.name}`;

  await analyzeFile(file);
}

if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (launchParams) => {
    const handles = launchParams?.files || [];
    for (const handle of handles) {
      const file = await handle.getFile();
      await handleIncomingFile(file);
    }
  });
}
