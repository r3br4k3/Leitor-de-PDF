import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";

const statusPanel = document.getElementById("statusPanel");
const addressList = document.getElementById("addressList");
const pdfInput = document.getElementById("pdfInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const autoOpen = document.getElementById("autoOpen");
const pdfViewerContainer = document.getElementById("pdfViewerContainer");
const pdfViewerElement = document.getElementById("pdfViewer");
const viewerHint = document.getElementById("viewerHint");

const ROUTE_URL = "https://waze.com/ul";
let selectedFile = null;
let activePdfDocument = null;

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const pdfViewer = new PDFViewer({
  container: pdfViewerContainer,
  viewer: pdfViewerElement,
  eventBus,
  linkService,
  textLayerMode: 1,
  removePageBorders: false,
});
linkService.setViewer(pdfViewer);

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
  pdfViewer.setDocument(null);
  pdfViewerElement.innerHTML = "";
}

function normalizeAddress(line) {
  return line
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " ")
    .trim();
}

// ─── Padroes de deteccao ────────────────────────────────────────────────────

const RGX = {
  street:   /\b(rua|r\.|av\.?|avenida|travessa|trav\.?|estrada|rodovia|alameda|praca|pca\.?|largo|viela|logradouro|condominio|cond\.?|quadra|qd\.?|lote|lt\.?)\b/i,
  number:   /\bn[o°º]?\s*[:\.]?\s*\d{1,5}\b|\b\d{1,5}\s*[,\-\/]\s*|\bno\.?\s*\d{1,5}\b|\bnumero\s*\d{1,5}\b/i,
  cep:      /\b\d{5}-?\d{3}\b/,
  bairro:   /\b(bairro|bro\.?|vila|jardim|jd\.?|parque|pk\.?|setor|residencial|res\.?|conjunto|cj\.?)\b/i,
  cidade:   /\b[A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]{2,})*\s*[-\/,]\s*[A-Z]{2}\b/,
  label:    /\b(endere[cç]o|local|localidade|destino|instalacao|entrega|cobranca|correspondencia)\s*[:\-]?/i,
  cnpj:     /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  cpf:      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  fone:     /\(?\d{2}\)?\s*\d{4,5}-?\d{4}/,
  cepSolo:  /^\d{5}-?\d{3}$/,
  numOnly:  /^\d{1,12}$/,
  url:      /https?:\/\/|www\./i,
  email:    /@\w+\.\w+/,
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

// ─── Score de uma linha ──────────────────────────────────────────────────────

function scoreLine(line) {
  const l = line.toLowerCase();
  let score = 0;

  // Ruido fixo
  if (NOISE_LINES.has(l)) return -99;

  // Padroes de ruido genericos
  if (RGX.cnpj.test(l))   return -99;
  if (RGX.cpf.test(l))    return -20;
  if (RGX.url.test(l))    return -20;
  if (RGX.email.test(l))  return -20;
  if (RGX.cepSolo.test(l.trim())) return -10; // CEP isolado nao e endereco
  if (RGX.numOnly.test(l.trim())) return -10;
  if (RGX.fone.test(l) && l.trim().length < 20) return -20;

  // Pontuacao positiva
  if (RGX.label.test(l))   score += 30; // Rotulo explicito ("Endereco:")
  if (RGX.street.test(l))  score += 40; // Tipo de logradouro
  if (RGX.number.test(l))  score += 20; // Numero predial
  if (RGX.bairro.test(l))  score += 15; // Bairro/Vila/Jardim
  if (RGX.cep.test(l))     score += 25; // CEP embutido na linha
  if (RGX.cidade.test(l))  score += 10; // Cidade - UF

  return score;
}

// ─── Janela de contexto em torno de uma ancora ──────────────────────────────

function buildBlock(lines, pivot, radius = 3) {
  const start = Math.max(0, pivot - radius);
  const end   = Math.min(lines.length - 1, pivot + radius);
  const block = [];

  for (let i = start; i <= end; i += 1) {
    const s = scoreLine(lines[i]);
    if (s > 0) block.push(lines[i]);
  }

  return block.join(", ").replace(/,\s*,/g, ",").trim();
}

// ─── Motor principal de deteccao por score ───────────────────────────────────

function findAddresses(linesInput) {
  const lines = linesInput
    .map(normalizeAddress)
    .filter(Boolean);

  const THRESHOLD = 30; // Score minimo para candidato
  const usedIndexes = new Set();
  const results = [];
  const seen = new Set();

  // Passo 1 — Ancoras por CEP (precisao alta)
  for (let i = 0; i < lines.length; i += 1) {
    if (!RGX.cep.test(lines[i])) continue;

    // Tenta expandir bloco ao redor do CEP
    const block = buildBlock(lines, i, 3);
    const key = block.toLowerCase();
    if (block && !seen.has(key)) {
      seen.add(key);
      results.push({ text: block, score: 100 });
      for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 3); k++) usedIndexes.add(k);
    }
  }

  // Passo 2 — Ancoras por rotulo explicito ("Endereco:", "Local:", etc.)
  for (let i = 0; i < lines.length; i += 1) {
    if (usedIndexes.has(i)) continue;
    if (!RGX.label.test(lines[i])) continue;

    // Remove o proprio rotulo e usa o restante + proximas linhas
    const stripped = lines[i].replace(RGX.label, "").trim();
    const parts = stripped ? [stripped] : [];
    for (let k = i + 1; k <= Math.min(lines.length - 1, i + 3); k++) {
      const s = scoreLine(lines[k]);
      if (s > 5) { parts.push(lines[k]); usedIndexes.add(k); }
    }
    const block = parts.join(", ").replace(/,\s*,/g, ",").trim();
    const key = block.toLowerCase();
    if (block && !seen.has(key)) {
      seen.add(key);
      results.push({ text: block, score: 90 });
      usedIndexes.add(i);
    }
  }

  // Passo 3 — Score ponderado linha a linha para o restante
  for (let i = 0; i < lines.length; i += 1) {
    if (usedIndexes.has(i)) continue;

    const score = scoreLine(lines[i]);
    if (score < THRESHOLD) continue;

    // Agrega linhas vizinhas com score positivo
    const parts = [lines[i]];
    for (let k = i + 1; k <= Math.min(lines.length - 1, i + 2); k++) {
      const s = scoreLine(lines[k]);
      if (s > 5 && !usedIndexes.has(k)) {
        parts.push(lines[k]);
        usedIndexes.add(k);
      }
    }
    usedIndexes.add(i);

    const block = parts.join(", ").replace(/,\s*,/g, ",").trim();
    const key = block.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ text: block, score });
    }
  }

  // Ordena por score (maior primeiro) e retorna
  return results.sort((a, b) => b.score - a.score).map((r) => r.text);
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

async function renderPageSvg(pdfjsLib, page, viewport) {
  return null;
}

async function renderAndExtract(file) {
  clearPdfPreview();
  viewerHint.textContent = `Carregando: ${file.name}`;

  const data = await file.arrayBuffer();
  const doc = await getDocument({ data }).promise;
  activePdfDocument = doc;
  linkService.setDocument(doc);
  pdfViewer.setDocument(doc);
  pdfViewer.currentScaleValue = "page-width";

  const allLines = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
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
