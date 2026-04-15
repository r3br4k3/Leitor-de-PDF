import { Capacitor, registerPlugin } from "@capacitor/core";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const statusPanel = document.getElementById("statusPanel");
const addressList = document.getElementById("addressList");
const pdfInput = document.getElementById("pdfInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const autoOpen = document.getElementById("autoOpen");
const openNativeBtn = document.getElementById("openNativeBtn");
const pdfCanvasContainer = document.getElementById("pdfCanvasContainer");
const viewerPanel = document.getElementById("viewerPanel");
const viewerHint = document.getElementById("viewerHint");
const darkToggle = document.getElementById("darkToggle");

const requiredNodes = [
  ["statusPanel", statusPanel],
  ["addressList", addressList],
  ["pdfInput", pdfInput],
  ["analyzeBtn", analyzeBtn],
  ["autoOpen", autoOpen],
  ["openNativeBtn", openNativeBtn],
  ["pdfCanvasContainer", pdfCanvasContainer],
  ["viewerHint", viewerHint],
];

const missingNodes = requiredNodes.filter(([, node]) => !node).map(([name]) => name);
if (missingNodes.length) {
  console.error("Estrutura da pagina desatualizada. Elementos ausentes:", missingNodes.join(", "));

  const hasRetried = sessionStorage.getItem("rotapdf_cache_recover") === "1";
  sessionStorage.setItem("rotapdf_cache_recover", "1");

  if (!hasRetried && "caches" in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("rotapdf-")).map((key) => caches.delete(key))))
      .finally(() => window.location.reload());
  } else if (!hasRetried) {
    window.location.reload();
  }

  throw new Error("Atualizando arquivos do app. Reabra em alguns segundos.");
}

// ── Dark Mode ──
function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  if (darkToggle) {
    darkToggle.textContent = dark ? "☀️" : "🌙";
  }
}
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
const savedTheme = localStorage.getItem("theme");
applyTheme(savedTheme ? savedTheme === "dark" : prefersDark.matches);
if (darkToggle) {
  darkToggle.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    darkToggle.textContent = isDark ? "☀️" : "🌙";
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });
}

const ROUTE_URL = "https://waze.com/ul";
let selectedFile = null;
let activePdfDocument = null;
let nativePdfUrl = "";
let isCheckingNativePdf = false;

const PdfIntent = registerPlugin("PdfIntent");

GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/legacy/build/pdf.worker.min.mjs";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      let refreshed = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshed) return;
        refreshed = true;
        window.location.reload();
      });
    })
    .catch(() => {
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
    activePdfDocument.destroy().catch(() => {});
    activePdfDocument = null;
  }

  if (nativePdfUrl) {
    URL.revokeObjectURL(nativePdfUrl);
    nativePdfUrl = "";
  }

  if (pdfCanvasContainer) {
    pdfCanvasContainer.innerHTML = "";
  }
  if (openNativeBtn) {
    openNativeBtn.disabled = true;
  }
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

async function renderPdfImages(doc) {
  if (!pdfCanvasContainer) {
    throw new Error("Container de visualizacao nao encontrado.");
  }

  pdfCanvasContainer.innerHTML = "";
  const containerWidth =
    pdfCanvasContainer.clientWidth ||
    Math.max(280, (viewerPanel?.clientWidth || window.innerWidth) - 36);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const offscreen = document.createElement("canvas");
    offscreen.width = Math.floor(viewport.width * dpr);
    offscreen.height = Math.floor(viewport.height * dpr);

    const ctx = offscreen.getContext("2d");
    if (!ctx) {
      throw new Error("Nao foi possivel criar contexto de renderizacao.");
    }
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const image = document.createElement("img");
    image.className = "pdf-page-image";
    image.alt = `Pagina ${pageNumber} do PDF`;
    image.loading = "lazy";
    image.decoding = "async";
    image.src = offscreen.toDataURL("image/jpeg", 0.92);
    pdfCanvasContainer.appendChild(image);
  }
}

function base64ToFile(base64Data, fileName, mimeType) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fileName || "documento.pdf", { type: mimeType || "application/pdf" });
}

async function loadPendingNativePdf() {
  if (!Capacitor.isNativePlatform() || isCheckingNativePdf) {
    return false;
  }

  isCheckingNativePdf = true;

  try {
    const result = await PdfIntent.getPendingPdf();
    if (!result?.hasPayload || !result.data?.base64Data) {
      return false;
    }

    const file = base64ToFile(result.data.base64Data, result.data.fileName, result.data.mimeType);
    await PdfIntent.clearPendingPdf();
    await handleIncomingFile(file);
    return true;
  } catch {
    return false;
  } finally {
    isCheckingNativePdf = false;
  }
}

async function loadSharedPdfFromServiceWorker() {
  const response = await fetch("/shared-pdf", { cache: "no-store" });
  if (!response.ok) return false;

  const contentType = response.headers.get("Content-Type") || "application/pdf";
  if (!contentType.includes("pdf")) return false;

  const fileNameHeader = response.headers.get("X-File-Name");
  const fileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : "documento.pdf";
  const blob = await response.blob();
  const file = new File([blob], fileName, { type: contentType });

  await handleIncomingFile(file);

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "DELETE_SHARED_PDF" });
  }

  const url = new URL(window.location.href);
  if (url.searchParams.has("shared")) {
    url.searchParams.delete("shared");
    history.replaceState({}, "", `${url.pathname}${url.search}` || url.pathname);
  }

  return true;
}

async function renderAndExtract(file) {
  clearPdfPreview();
  viewerHint.textContent = `Carregando: ${file.name}`;
  nativePdfUrl = URL.createObjectURL(file);

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  activePdfDocument = doc;

  const extractedPages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    extractedPages.push(extractPageLines(textContent.items));
  }

  try {
    await renderPdfImages(doc);
  } catch {
    viewerHint.textContent = `${file.name} — nao foi possivel gerar a visualizacao interna.`;
  }
  if (openNativeBtn) {
    openNativeBtn.disabled = false;
  }
  if (!pdfCanvasContainer.children.length) {
    viewerHint.textContent = `${file.name} — use "Abrir no padrao" para visualizar.`;
  } else {
    viewerHint.textContent = `${file.name} — ${doc.numPages} pagina(s)`;
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
    const message = error instanceof Error && error.message ? error.message : "Erro desconhecido ao abrir o PDF.";
    setStatus(`Falha ao analisar PDF: ${message}`, "error");
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

if (openNativeBtn) {
  openNativeBtn.addEventListener("click", () => {
    if (!nativePdfUrl) {
      setStatus("Carregue um PDF antes de abrir no padrao.", "error");
      return;
    }

    const popup = window.open(nativePdfUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      window.location.href = nativePdfUrl;
    }
  });
}

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

window.addEventListener("focus", () => {
  void loadPendingNativePdf();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void loadPendingNativePdf();
  }
});

void loadPendingNativePdf();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready
    .then(async () => {
      if (window.location.search.includes("shared=1")) {
        await loadSharedPdfFromServiceWorker();
      }
    })
    .catch(() => {
      // Ignora falhas no bootstrap do compartilhamento.
    });
}
