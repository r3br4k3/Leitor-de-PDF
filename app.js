import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const statusPanel = document.getElementById("statusPanel");
const addressList = document.getElementById("addressList");
const pdfInput = document.getElementById("pdfInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const autoOpen = document.getElementById("autoOpen");
const pdfCanvasContainer = document.getElementById("pdfCanvasContainer");
const pdfTextOutput = document.getElementById("pdfTextOutput");
const viewerHint = document.getElementById("viewerHint");

const ROUTE_URL = "https://waze.com/ul";
let selectedFile = null;
let activePdfDocument = null;

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Registro opcional; o app continua funcionando sem cache offline.
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
  if (activePdfDocument) {
    activePdfDocument.destroy().catch(() => {
      // Ignora falhas ao liberar o documento anterior.
    });
    activePdfDocument = null;
  }

  pdfCanvasContainer.innerHTML = "";
  pdfTextOutput.value = "";
}

function normalizeAddress(line) {
  return line.replace(/\s+/g, " ").replace(/[|]+/g, " ").trim();
}

const RGX = {
  street: /\b(rua|r\.|av\.?|avenida|travessa|trav\.?|estrada|rodovia|alameda|praca|pca\.?|largo|viela|logradouro|condominio|cond\.?|quadra|qd\.?|lote|lt\.?)\b/i,
  number: /\bn[o°º]?\s*[:\.]?\s*\d{1,5}\b|\b\d{1,5}\s*[,\-\/]\s*|\bno\.?\s*\d{1,5}\b|\bnumero\s*\d{1,5}\b/i,
  cep: /\b\d{5}-?\d{3}\b/,
  bairro: /\b(bairro|bro\.?|vila|jardim|jd\.?|parque|pk\.?|setor|residencial|res\.?|conjunto|cj\.?)\b/i,
  cidade: /\b[A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]{2,})*\s*[-\/,]\s*[A-Z]{2}\b/,
  label: /\b(endere[cç]o|local|localidade|destino|instalacao|entrega|cobranca|correspondencia)\s*[:\-]?/i,
  cnpj: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  cpf: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  fone: /\(?\d{2}\)?\s*\d{4,5}-?\d{4}/,
  cepSolo: /^\d{5}-?\d{3}$/,
  numOnly: /^\d{1,12}$/,
  url: /https?:\/\/|www\./i,
  email: /@\w+\.\w+/,
};

const NOISE_LINES = new Set([
  "mactel sistemas de seguranca ltda",
  "02.256.145/0001-83",
  "www.mactelrs.com.br",
  "(51) 3286-6680",
  "rua marechal mesquita , 441, conj 201",
  "teresopolis, porto alegre - rs",
  "91.720-160",
  "0962670669",
]);

function scoreLine(line) {
  const lowered = line.toLowerCase();
  let score = 0;

  if (NOISE_LINES.has(lowered)) return -99;
  if (RGX.cnpj.test(lowered)) return -99;
  if (RGX.cpf.test(lowered)) return -20;
  if (RGX.url.test(lowered)) return -20;
  if (RGX.email.test(lowered)) return -20;
  if (RGX.cepSolo.test(lowered.trim())) return -10;
  if (RGX.numOnly.test(lowered.trim())) return -10;
  if (RGX.fone.test(lowered) && lowered.trim().length < 20) return -20;

  if (RGX.label.test(lowered)) score += 30;
  if (RGX.street.test(lowered)) score += 40;
  if (RGX.number.test(lowered)) score += 20;
  if (RGX.bairro.test(lowered)) score += 15;
  if (RGX.cep.test(lowered)) score += 25;
  if (RGX.cidade.test(lowered)) score += 10;

  return score;
}

function buildBlock(lines, pivot, radius = 3) {
  const start = Math.max(0, pivot - radius);
  const end = Math.min(lines.length - 1, pivot + radius);
  const block = [];

  for (let index = start; index <= end; index += 1) {
    if (scoreLine(lines[index]) > 0) block.push(lines[index]);
  }

  return block.join(", ").replace(/,\s*,/g, ",").trim();
}

function findAddresses(linesInput) {
  const lines = linesInput.map(normalizeAddress).filter(Boolean);
  const threshold = 30;
  const usedIndexes = new Set();
  const results = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!RGX.cep.test(lines[index])) continue;

    const block = buildBlock(lines, index, 3);
    const key = block.toLowerCase();
    if (block && !seen.has(key)) {
      seen.add(key);
      results.push({ text: block, score: 100 });
      for (let cursor = Math.max(0, index - 3); cursor <= Math.min(lines.length - 1, index + 3); cursor += 1) {
        usedIndexes.add(cursor);
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (usedIndexes.has(index) || !RGX.label.test(lines[index])) continue;

    const stripped = lines[index].replace(RGX.label, "").trim();
    const parts = stripped ? [stripped] : [];
    for (let cursor = index + 1; cursor <= Math.min(lines.length - 1, index + 3); cursor += 1) {
      if (scoreLine(lines[cursor]) > 5) {
        parts.push(lines[cursor]);
        usedIndexes.add(cursor);
      }
    }

    const block = parts.join(", ").replace(/,\s*,/g, ",").trim();
    const key = block.toLowerCase();
    if (block && !seen.has(key)) {
      seen.add(key);
      results.push({ text: block, score: 90 });
      usedIndexes.add(index);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (usedIndexes.has(index)) continue;

    const score = scoreLine(lines[index]);
    if (score < threshold) continue;

    const parts = [lines[index]];
    for (let cursor = index + 1; cursor <= Math.min(lines.length - 1, index + 2); cursor += 1) {
      if (scoreLine(lines[cursor]) > 5 && !usedIndexes.has(cursor)) {
        parts.push(lines[cursor]);
        usedIndexes.add(cursor);
      }
    }

    usedIndexes.add(index);

    const block = parts.join(", ").replace(/,\s*,/g, ",").trim();
    const key = block.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ text: block, score });
    }
  }

  return results.sort((left, right) => right.score - left.score).map((item) => item.text);
}

function extractPageLines(items) {
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
    const tokens = rowsByY.get(String(y)).sort((left, right) => left.x - right.x);
    const line = tokens.map((token) => token.text).join(" ");
    const normalized = normalizeAddress(line);
    if (normalized) lines.push(normalized);
  }

  return lines;
}

function renderAddresses(addresses) {
  addressList.innerHTML = "";

  if (!addresses.length) {
    const item = document.createElement("li");
    item.textContent = "Nenhum endereco identificado automaticamente.";
    addressList.appendChild(item);
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

async function renderPdfPreview(doc) {
  const containerWidth = Math.min(Math.max(pdfCanvasContainer.clientWidth - 20, 280), 900);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(containerWidth / baseViewport.width, 0.8);
    const viewport = page.getViewport({ scale });
    const renderViewport = page.getViewport({ scale: scale * dpr });

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.style.width = `${Math.floor(viewport.width)}px`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    const context = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;

    const image = document.createElement("img");
    image.className = "pdf-page-image";
    image.alt = `Pagina ${pageNumber} do PDF`;
    image.width = Math.floor(viewport.width);
    image.height = Math.floor(viewport.height);
    image.src = canvas.toDataURL("image/jpeg", 0.92);

    wrapper.append(image);
    pdfCanvasContainer.appendChild(wrapper);
  }
}

function renderExtractedText(pages) {
  pdfTextOutput.value = pages
    .map((lines, index) => `===== PAGINA ${index + 1} =====\n${lines.join("\n")}`)
    .join("\n\n");
}

async function renderAndExtract(file) {
  clearPdfPreview();
  viewerHint.textContent = `Carregando: ${file.name}`;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await getDocument({ data }).promise;
  activePdfDocument = doc;

  const extractedPages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    extractedPages.push(extractPageLines(textContent.items));
  }

  renderExtractedText(extractedPages);

  try {
    await renderPdfPreview(doc);
    viewerHint.textContent = `${file.name} — ${doc.numPages} pagina(s)`;
  } catch {
    viewerHint.textContent = `${file.name} — texto carregado, mas a visualizacao falhou.`;
  }

  return extractedPages.flat();
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
    console.error("Falha ao analisar PDF:", error);
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
