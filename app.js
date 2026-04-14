const statusPanel = document.getElementById("statusPanel");
const addressList = document.getElementById("addressList");
const pdfInput = document.getElementById("pdfInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const autoOpen = document.getElementById("autoOpen");

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

function findAddresses(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeAddress(line))
    .filter((line) => line && !shouldIgnoreLine(line));

  const keywordRegex =
    /\b(rua|av\.?|avenida|travessa|estrada|rodovia|alameda|praca|largo|viela|logradouro|condominio)\b/i;
  const cepRegex = /\b\d{5}-?\d{3}\b/;
  const numberRegex = /\b\d{1,5}\b/;

  const candidates = [];
  for (const line of lines) {
    const hasStreet = keywordRegex.test(line);
    const hasCep = cepRegex.test(line);
    const hasNumber = numberRegex.test(line);

    if ((hasStreet && hasNumber) || (hasStreet && hasCep)) {
      candidates.push(line);
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

async function extractTextFromPdf(file) {
  const pdfjsLib = globalThis.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("Biblioteca PDF.js nao carregou.");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const parts = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    parts.push(pageText);
  }

  return parts.join("\n");
}

async function analyzeFile(file) {
  setStatus("Lendo PDF...", "");

  try {
    const text = await extractTextFromPdf(file);
    const addresses = findAddresses(text);

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
    setStatus("Falha ao analisar PDF. Verifique se o arquivo nao esta protegido.", "error");
  }
}

pdfInput.addEventListener("change", (event) => {
  selectedFile = event.target.files?.[0] || null;
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
