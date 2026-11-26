import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, FileCheck2, FileText, Paperclip, Plus, RefreshCw, Send, ShieldCheck, Sparkles, TrendingUp, X } from "lucide-react";
import { createEditableInvoiceDraft, EditableInvoiceReviewDialog, type EditableInvoiceDraft } from "./EditableInvoiceReviewDialog";
import { InvoiceChangePreviewDialog } from "./InvoiceChangePreviewDialog";
import { ConfirmedPurchaseDialog } from "./ConfirmedPurchaseDialog";
import { api, ApiRequestError, type AskFuelNerveResponse, type CatalogProduct, type PurchaseInvoice, type Supplier } from "../lib/api";
import type { ParsedIndianInvoice } from "../lib/indian-invoice-parser";
import { assessInvoiceStation, assessSingleProductInvoicePrice } from "../lib/invoice-local-safety";
import { flushInvoiceImportPerformance, rememberInvoiceImportPerformance } from "../lib/invoice-import-performance";
import { findDuplicateInvoiceForDraft } from "../lib/confirmed-purchase-submission";

const briefTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
});

const suggestedQuestions = {
  overview: "How is the fuel station doing today?",
  stock: "Which fuel tanks are low on stock?",
  shifts: "Which shifts are still open?",
  collections: "How much was collected by payment method?",
  customers: "Which customers owe us money?",
  suppliers: "What do we owe our suppliers?",
} as const;

type QuestionTopic = keyof typeof suggestedQuestions;
type ChatExchange = {
  id: string;
  question: string;
  answer?: AskFuelNerveResponse;
  error?: string;
};

type LocalInvoice = {
  id: string;
  file: File;
  status: "checking" | "ocr" | "ready" | "error";
  extractedText?: string;
  pageCount?: number;
  characterCount?: number;
  truncated?: boolean;
  source?: "pdf_text" | "ocr";
  confidence?: number;
  progress?: number;
  progressLabel?: string;
  parsed?: ParsedIndianInvoice;
  draft?: EditableInvoiceDraft;
  reviewed?: boolean;
  submitted?: { id: string; invoiceNumber: string };
};

export function AskNerveChat({ stationId, stationName, isDemo = false, asOf, priorityTopic = "overview", onRecordsChanged }: {
  stationId: string | null;
  stationName?: string | undefined;
  isDemo?: boolean;
  asOf?: string;
  priorityTopic?: QuestionTopic | undefined;
  onRecordsChanged: () => void;
}) {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [exchange, setExchange] = useState<ChatExchange | null>(null);
  const requestPending = useRef(false);
  const asking = Boolean(exchange && !exchange.answer && !exchange.error);
  const exchangeId = exchange?.id;
  const [chatOpen, setChatOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const chat = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const submittedQuestion = useRef<HTMLParagraphElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dsrRouteTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const viewport = window.visualViewport;
    const dialog = chat.current;
    if (!chatOpen || !viewport || !dialog) return;

    const updateViewport = () => {
      const bottomInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      dialog.style.setProperty("--nerve-chat-keyboard-inset", `${bottomInset}px`);
      dialog.style.setProperty("--nerve-chat-visible-height", `${viewport.height}px`);
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
    };
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen && exchangeId && content.current && submittedQuestion.current) {
      content.current.scrollTop = submittedQuestion.current.offsetTop - 16;
    }
  }, [chatOpen, exchangeId]);
  const [error, setError] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [importEnabled, setImportEnabled] = useState(false);
  const [dsrRecognition, setDsrRecognition] = useState<{ fileName: string; status: "recognised" | "routing" } | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [purchaseRecords, setPurchaseRecords] = useState<{ suppliers: Supplier[]; invoices: PurchaseInvoice[] }>({ suppliers: [], invoices: [] });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const attachmentMenu = useRef<HTMLDivElement | null>(null);
  const invoiceChecks = useRef(new Map<string, AbortController>());

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!attachmentMenu.current?.contains(event.target as Node)) setAttachmentMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setAttachmentMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [attachmentMenuOpen]);

  useEffect(() => () => {
    window.clearTimeout(dsrRouteTimer.current);
    for (const controller of invoiceChecks.current.values()) controller.abort();
    invoiceChecks.current.clear();
  }, []);
  useEffect(() => {
    let active = true;
    setCatalogProducts([]);
    setPurchaseRecords({ suppliers: [], invoices: [] });
    if (!stationId) return () => { active = false; };
    const purchases = typeof api.purchasesBootstrap === "function" ? api.purchasesBootstrap().catch(() => null) : Promise.resolve(null);
    void Promise.all([api.catalog(), purchases]).then(([catalog, records]) => { if (active) { setCatalogProducts(catalog.products.filter(product => product.active)); if (records) setPurchaseRecords({ suppliers: records.suppliers.filter(supplier => supplier.active), invoices: records.invoices }); } }).catch(() => undefined);
    return () => { active = false; };
  }, [stationId]);
  useEffect(() => {
    let active = true;
    setImportEnabled(false);
    if (isDemo || !stationId) return () => { active = false; };
    void api.invoiceImportPolicy().then(policy => {
      if (active) setImportEnabled(policy.enabled);
      return flushInvoiceImportPerformance(policy.monitored);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [isDemo, stationId]);

  const processInvoices = async (items: LocalInvoice[]) => {
    const routeDsr = (item: LocalInvoice, text: string, classifiedProduct?: "HSD" | "MS" | "UNKNOWN") => {
      if (!invoiceChecks.current.has(item.id) || dsrRouteTimer.current !== undefined) return;
      if (item.file.size > 5 * 1024 * 1024) {
        setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "error", progressLabel: "This DSR is larger than 5 MB. Compress it and try again." } : invoice));
        return;
      }
      invoiceChecks.current.get(item.id)?.abort();
      invoiceChecks.current.delete(item.id);
      setDsrRecognition({ fileName: item.file.name, status: "recognised" });
      setInvoices(current => current.filter(invoice => invoice.id !== item.id));
      dsrRouteTimer.current = window.setTimeout(() => {
        setDsrRecognition({ fileName: item.file.name, status: "routing" });
        navigate("/sales/history/import", { state: { intelligenceDocument: { kind: "DSR", file: item.file, stationId, productCode: classifiedProduct && classifiedProduct !== "UNKNOWN" ? classifiedProduct : detectDsrProduct(text) } } });
      }, 650);
    };
    const classifyAmbiguous = async (item: LocalInvoice) => {
      if (item.file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(item.file.type || mimeFromFileName(item.file.name))) return { kind: 'UNKNOWN' as const, confidence: 0, productCode: 'UNKNOWN' as const };
      setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "ocr", progress: .9, progressLabel: "Nerve Intelligence is identifying the document…" } : invoice));
      try {
        return await api.classifyFuelDocument({ sourceFileName: item.file.name, sourceMimeType: (item.file.type || mimeFromFileName(item.file.name)) as 'application/pdf' | 'image/jpeg' | 'image/png', sourceSize: item.file.size, sourceContentBase64: await fileToBase64(item.file) });
      } catch {
        return { kind: 'UNKNOWN' as const, confidence: 0, productCode: 'UNKNOWN' as const };
      }
    };
    const pdfItems = items.filter(item => isPdfFile(item.file));
    const ocrItems = items.filter(item => !isPdfFile(item.file));
    if (pdfItems.length) {
      try {
        const { extractLocalPdfText } = await import("../lib/local-pdf-text");
        for (const item of pdfItems) {
          const startedAt = performance.now();
          try {
            const result = await extractLocalPdfText(item.file);
            if (result.text.trim()) {
              if (looksLikeDsr(result.text)) { routeDsr(item, result.text); rememberInvoiceImportPerformance("PDF_TEXT", startedAt, "SUCCESS"); continue; }
              if (!looksLikeInvoice(result.text)) {
                const classification = await classifyAmbiguous(item);
                if (classification.kind === 'DSR' && classification.confidence >= .65) { routeDsr(item, result.text, classification.productCode); rememberInvoiceImportPerformance("PDF_TEXT", startedAt, "SUCCESS"); continue; }
                if (classification.kind !== 'INVOICE' || classification.confidence < .65) { setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "error", progressLabel: "This document could not be identified confidently. Choose a clearer scan." } : invoice)); invoiceChecks.current.delete(item.id); continue; }
              }
              const { parseIndianInvoice } = await import("../lib/indian-invoice-parser");
              const parsed = parseIndianInvoice(result.text);
              const draft = createEditableInvoiceDraft(parsed);
              setInvoices(current => current.map(invoice => invoice.id !== item.id ? invoice : { ...invoice, status: "ready", source: "pdf_text", extractedText: result.text, pageCount: result.pageCount, characterCount: result.characterCount, truncated: result.truncated, parsed, draft }));
              invoiceChecks.current.delete(item.id);
              rememberInvoiceImportPerformance("PDF_TEXT", startedAt, "SUCCESS");
            } else {
              ocrItems.push(item);
              setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "ocr", pageCount: result.pageCount, progress: 0, progressLabel: "Preparing scanned pages" } : invoice));
              rememberInvoiceImportPerformance("PDF_TEXT", startedAt, "WITHHELD");
            }
          } catch {
            // Safari can reject PDF.js text-layer work even when the same PDF can
            // still be rendered page-by-page. Keep the file alive and use OCR.
            ocrItems.push(item);
            setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "ocr", progress: 0, progressLabel: "Text layer unavailable · preparing OCR" } : invoice));
            rememberInvoiceImportPerformance("PDF_TEXT", startedAt, "WITHHELD");
          }
        }
      } catch {
        const failedIds = new Set(pdfItems.map(item => item.id));
        setInvoices(current => current.map(invoice => failedIds.has(invoice.id) ? { ...invoice, status: "error" } : invoice));
        for (const id of failedIds) invoiceChecks.current.delete(id);
      }
    }

    if (!ocrItems.length) return;
    const ocrStartedAt = performance.now();
    try {
      const { recognizeLocalInvoices } = await import("../lib/local-invoice-ocr");
      let readableResult = false;
      for (const item of ocrItems) {
        const controller = invoiceChecks.current.get(item.id);
        if (!controller || controller.signal.aborted) continue;
        try {
          const [result] = await recognizeLocalInvoices([{ id: item.id, file: item.file, signal: controller.signal }], (id, progress) => {
            setInvoices(current => current.map(invoice => invoice.id === id ? { ...invoice, status: "ocr", progress: progress.progress, progressLabel: progress.status } : invoice));
          });
          if (!result?.text.trim()) {
            setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "error", ...(result ? { pageCount: result.pageCount } : {}), progress: 1, progressLabel: "No readable text was found" } : invoice));
            continue;
          }
          readableResult = true;
          if (looksLikeDsr(result.text)) { routeDsr(item, result.text); continue; }
          if (!looksLikeInvoice(result.text)) {
            const classification = await classifyAmbiguous(item);
            if (classification.kind === 'DSR' && classification.confidence >= .65) { routeDsr(item, result.text, classification.productCode); continue; }
            if (classification.kind !== 'INVOICE' || classification.confidence < .65) { setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "error", progressLabel: "This document could not be identified confidently. Choose a clearer scan." } : invoice)); continue; }
          }
          const parsed = (await import("../lib/indian-invoice-parser")).parseIndianInvoice(result.text);
          const draft = createEditableInvoiceDraft(parsed);
          setInvoices(current => current.map(invoice => invoice.id === result.id
            ? { ...invoice, status: "ready", source: "ocr", extractedText: result.text, pageCount: result.pageCount, characterCount: result.text.length, confidence: result.confidence, truncated: result.truncated, progress: 1, parsed, draft }
            : invoice));
        } catch (caught) {
          if (!controller.signal.aborted) {
            const message = caught instanceof Error && /too long/i.test(caught.message)
              ? "This invoice is taking too long. Try again with a clearer image."
              : "This browser could not finish reading the invoice. Try a clearer image or retry the PDF.";
            setInvoices(current => current.map(invoice => invoice.id === item.id ? { ...invoice, status: "error", progressLabel: message } : invoice));
          }
        } finally {
          invoiceChecks.current.delete(item.id);
        }
      }
      rememberInvoiceImportPerformance("OCR", ocrStartedAt, readableResult ? "SUCCESS" : "WITHHELD");
    } catch {
      const failedIds = new Set(ocrItems.map(item => item.id));
      setInvoices(current => current.map(invoice => failedIds.has(invoice.id) ? { ...invoice, status: "error", progressLabel: "Local OCR could not finish" } : invoice));
      for (const id of failedIds) invoiceChecks.current.delete(id);
      rememberInvoiceImportPerformance("OCR", ocrStartedAt, "FAILED");
    }
  };

  const chooseInvoices = (files: FileList | null) => {
    if (!files) return;
    setError("");
    const accepted = Array.from(files).filter(isInvoiceFile);
    const withinLimit = accepted.filter(file => file.size <= 10 * 1024 * 1024);
    if (accepted.length !== files.length) setError("Choose PDF, JPEG, PNG or WebP invoices.");
    else if (withinLimit.length !== accepted.length) setError("Each invoice must be 10 MB or smaller.");
    const existing = new Set(invoices.map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    const uniqueFiles = withinLimit.filter(file => !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
    const additions: LocalInvoice[] = uniqueFiles
      .slice(0, Math.max(0, 5 - invoices.length))
      .map(file => isPdfFile(file)
        ? { id: crypto.randomUUID(), file, status: "checking", progress: 0 }
        : { id: crypto.randomUUID(), file, status: "ocr", progress: 0, progressLabel: "Preparing image" });
    for (const addition of additions) invoiceChecks.current.set(addition.id, new AbortController());
    if (uniqueFiles.length > additions.length) setError("You can check up to five invoices at a time.");
    setInvoices(current => [...current, ...additions].slice(0, 5));
    void processInvoices(additions);
    setAttachmentMenuOpen(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const ask = async (value: string, fromComposer = false) => {
    if (!stationId || value.length < 3 || requestPending.current) return;

    const id = crypto.randomUUID();
    requestPending.current = true;
    setExchange({ id, question: value });
    try {
      const [answer] = await Promise.all([
        api.askFuelNerve({ requestId: id, question: value, stationId, ...(asOf ? { asOf } : {}) }),
        new Promise<void>(resolve => window.setTimeout(resolve, 320)),
      ]);
      setExchange({ id, question: value, answer });
      if (fromComposer) setQuestion(current => current.trim() === value ? "" : current);
    } catch (caught) {
      const message = caught instanceof ApiRequestError && caught.message
        ? caught.message : "Nerve Intelligence could not answer right now.";
      setExchange({ id, question: value, error: message });
    } finally {
      requestPending.current = false;
    }
  };

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void ask(question.trim(), true);
  };

  const reviewingInvoice = invoices.find(invoice => invoice.id === reviewingId && invoice.draft);
  const previewingInvoice = invoices.find(invoice => invoice.id === previewingId && invoice.draft && invoice.reviewed);
  const submittingInvoice = invoices.find(invoice => invoice.id === submittingId && invoice.draft && invoice.reviewed && !invoice.submitted);

  const openChat = () => {
    chat.current?.showModal();
    setChatOpen(true);
    if (window.matchMedia?.("(pointer: fine)").matches) composer.current?.focus();
  };

  const closeChat = () => {
    chat.current?.close();
    setChatOpen(false);
    setAttachmentMenuOpen(false);
    launcher.current?.focus();
  };

  const documentReviewOpen = Boolean(reviewingInvoice || previewingInvoice || submittingInvoice);
  const answer = exchange?.answer;
  const questions = [
    suggestedQuestions[priorityTopic],
    ...Object.entries(suggestedQuestions).filter(([topic]) => topic !== priorityTopic).map(([, value]) => value),
  ];

  return <>
    <button ref={launcher} type="button" className="nerve-chat-launcher" aria-haspopup="dialog" aria-controls="nerve-chat" aria-expanded={chatOpen} onClick={openChat}>
      <Sparkles aria-hidden="true" /> Ask Nerve Intelligence
    </button>
    <dialog ref={chat} id="nerve-chat" className="nerve-chat-dialog" aria-modal="true" aria-labelledby="nerve-chat-title" onCancel={event => {
      event.preventDefault();
      if (!documentReviewOpen) closeChat();
    }} onKeyDown={event => {
      if (event.key === "Escape" && attachmentMenuOpen) {
        event.preventDefault();
        setAttachmentMenuOpen(false);
        attachmentMenu.current?.querySelector("button")?.focus();
      }
    }}>
      <section className="nerve-ask-bar" inert={documentReviewOpen}>
        <header className="nerve-ask-heading">
          <Sparkles aria-hidden="true" />
          <div><h2 id="nerve-chat-title">Ask Nerve Intelligence</h2><p>{stationName ?? "Selected fuel station"}</p>{asOf && <p>Records checked {briefTime.format(new Date(asOf))} IST</p>}</div>
          <button type="button" aria-label="Close chat" onClick={closeChat}><X aria-hidden="true" /></button>
        </header>
        <div className="nerve-chat-content" ref={content}>
          {stationId && <div className="nerve-chat-suggestions" role="group" aria-label="Suggested questions">
            <p>Suggested questions</p>
            <div>{questions.map(value => (
              <button type="button" key={value} aria-disabled={asking} onClick={() => void ask(value)}>
                {value}<ArrowRight size={14} aria-hidden="true" />
              </button>
            ))}</div>
          </div>}
          {dsrRecognition && <div className="nerve-dsr-route" role="status" aria-live="polite"><span className="nerve-dsr-scan"><FileText/><i/><i/><i/></span><div><small>Nerve Intelligence recognised</small><strong>Daily sales register</strong><p>{dsrRecognition.fileName} · {dsrRecognition.status === "recognised" ? "Preparing the historical register workspace…" : "Opening the review grid…"}</p></div><ArrowRight/></div>}
          {invoices.length > 0 && <div className="nerve-local-invoices" aria-label="Invoices selected on this device" aria-live="polite">
            {invoices.map(invoice => { const duplicate = invoice.draft ? findDuplicateInvoiceForDraft(invoice.draft, purchaseRecords.suppliers, purchaseRecords.invoices) : undefined; return <div key={invoice.id} className={invoice.status}><InvoiceStatusIcon status={invoice.status}/><span><strong>{invoice.file.name}</strong><small>{invoiceStatusText(invoice)}</small></span><button type="button" aria-label={`Remove ${invoice.file.name}`} onClick={() => { invoiceChecks.current.get(invoice.id)?.abort(); invoiceChecks.current.delete(invoice.id); setInvoices(current => current.filter(item => item.id !== invoice.id)); }}><X/></button>{invoice.parsed && invoice.draft && <InvoiceDetails invoice={invoice.parsed} draft={invoice.draft} stationName={stationName} catalogProducts={catalogProducts} duplicate={duplicate} reviewed={Boolean(invoice.reviewed)} submitted={invoice.submitted} onReview={() => setReviewingId(invoice.id)} onPreview={() => setPreviewingId(invoice.id)}/>} {invoice.extractedText && <details className="nerve-text-preview"><summary>View the text read from this document</summary><p>{invoice.extractedText.slice(0, 1_200)}{invoice.extractedText.length > 1_200 ? "…" : ""}</p></details>}</div>; })}
          </div>}
          {error && <p className="ask-error" role="alert">{error}</p>}
          {exchange && <p className="nerve-chat-question" ref={submittedQuestion}>{exchange.question}</p>}
          {asking && <div className="nerve-chat-typing" role="status">
            <span className="nerve-chat-dots" aria-hidden="true"><i/><i/><i/></span>
            <span>Checking fuel station records…</span>
          </div>}
          {exchange?.error && <p className="ask-error" role="alert">{exchange.error}</p>}
          {answer && <div className="ask-answer" aria-live="polite">
            <header><Sparkles/><div><small>{answer.answerMode === "AI_EXPLAINED" ? "Nerve Intelligence" : "Verified answer"}</small><h3>{answer.answer.title}</h3></div></header>
            <p>{answer.answer.explanation}</p>
            {answer.missingInformation?.map(item => <p key={item}>{item}</p>)}
            {answer.answer.facts.length > 0 && <div className="ask-facts">
              {answer.answer.facts.map(fact => <div key={fact.id}><span>
                <small>{fact.label}</small><strong>{fact.value}</strong><em>{fact.context}</em>
                {fact.evidencePath && <Link to={fact.evidencePath}>{fact.evidenceLabel || "View record"} <ArrowRight size={14} aria-hidden="true"/></Link>}
              </span></div>)}
            </div>}
            <footer>{answer.answer.action}</footer>
          </div>}
        </div>
        <form onSubmit={submitQuestion}>
          <div className="nerve-attach" ref={attachmentMenu}>
            <button type="button" className="nerve-add-button" aria-label="Add invoice" aria-expanded={attachmentMenuOpen} onClick={() => setAttachmentMenuOpen(open => !open)}><Plus/></button>
            {attachmentMenuOpen && <div className="nerve-attach-menu" role="menu"><button type="button" role="menuitem" onClick={() => fileInput.current?.click()}><Paperclip/><span><strong>Upload invoices or DSRs</strong><small>Automatic document recognition · PDF, JPEG, PNG or WebP</small></span></button></div>}
            <input ref={fileInput} type="file" hidden multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => chooseInvoices(event.target.files)}/>
          </div>
          <input ref={composer} type="text" aria-label="Ask Nerve Intelligence" value={question} maxLength={300} onChange={event => setQuestion(event.target.value)} placeholder="Ask what needs your attention…"/>
          <button type="submit" className="nerve-send-button" aria-label={asking ? "Checking" : "Ask"} disabled={!stationId || question.trim().length < 3 || asking}>{asking ? <RefreshCw className="spinning"/> : <Send/>}<span>{asking ? "Checking" : "Ask"}</span></button>
        </form>
      </section>
      {reviewingInvoice?.draft && <EditableInvoiceReviewDialog
        fileName={reviewingInvoice.file.name}
        initialDraft={reviewingInvoice.draft}
        onCancel={() => setReviewingId(null)}
        onKeep={draft => {
          setInvoices(current => current.map(invoice => invoice.id === reviewingInvoice.id ? { ...invoice, draft, reviewed: true } : invoice));
          setReviewingId(null);
        }}
      />}
      {previewingInvoice?.draft && <InvoiceChangePreviewDialog
        fileName={previewingInvoice.file.name}
        draft={previewingInvoice.draft}
        stationName={stationName ?? "the selected fuel station"}
        isDemo={isDemo}
        catalogProducts={catalogProducts}
        onBack={() => { setPreviewingId(null); setReviewingId(previewingInvoice.id); }}
        onClose={() => setPreviewingId(null)}
        {...(importEnabled && assessInvoiceStation(previewingInvoice.draft.consigneeName, stationName).status === "MATCH" ? { onContinue: () => { setPreviewingId(null); setSubmittingId(previewingInvoice.id); } } : {})}
      />}
      {submittingInvoice?.draft && stationId && <ConfirmedPurchaseDialog
        draft={submittingInvoice.draft}
        stationId={stationId}
        stationName={stationName ?? "the selected fuel station"}
        isDemo={isDemo}
        onBack={() => { setSubmittingId(null); setPreviewingId(submittingInvoice.id); }}
        onClose={() => setSubmittingId(null)}
        onSubmitted={(created) => {
          setInvoices(current => current.map(invoice => invoice.id === submittingInvoice.id ? { ...invoice, submitted: { id: created.id, invoiceNumber: created.invoiceNumber } } : invoice));
          setPurchaseRecords(current => ({ ...current, invoices: current.invoices.some(invoice => invoice.id === created.id) ? current.invoices : [created, ...current.invoices] }));
          onRecordsChanged();
        }}
      />}
    </dialog>
  </>;
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isInvoiceFile(file: File) {
  return file.type === "application/pdf" || ["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function looksLikeDsr(text: string) {
  const value = text.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  const dsrSignals = ["OPENING STOCK", "WATER DIP", "TANK 1", "PUMPS", "TESTING", "CUMULATIVE SALES", "TOTAL STOCK"];
  const invoiceSignals = ["TAX INVOICE", "INVOICE NUMBER", "GSTIN", "HSN", "BILL TO", "SUPPLIER"];
  const dsrScore = dsrSignals.filter(signal => value.includes(signal)).length;
  const invoiceScore = invoiceSignals.filter(signal => value.includes(signal)).length;
  return dsrScore >= 3 && dsrScore > invoiceScore;
}

function looksLikeInvoice(text: string) {
  const value = text.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  const signals = ["TAX INVOICE", "INVOICE NUMBER", "INVOICE NO", "GSTIN", "HSN", "BILL TO", "GRAND TOTAL", "INVOICE DATE"];
  return signals.filter(signal => value.includes(signal)).length >= 2;
}

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
const mimeFromFileName = (name: string) => /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';

function detectDsrProduct(text: string): "HSD" | "MS" | undefined {
  const value = ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  if (value.includes(" HSD ") || value.includes(" HIGH SPEED DIESEL ")) return "HSD";
  if (value.includes(" MOTOR SPIRIT ") || value.includes(" PETROL ") || value.includes(" MS ")) return "MS";
  return undefined;
}

function InvoiceStatusIcon({ status }: { status: LocalInvoice["status"] }) {
  if (status === "checking" || status === "ocr") return <RefreshCw className="spinning"/>;
  if (status === "ready") return <CheckCircle2/>;
  if (status === "error") return <AlertTriangle/>;
  return <FileText/>;
}

function invoiceStatusText(invoice: LocalInvoice) {
  if (invoice.status === "checking") return `${fileSize(invoice.file.size)} · Opening invoice…`;
  if (invoice.status === "ocr") return invoice.progressLabel ?? "Reading invoice…";
  if (invoice.status === "ready") return `${invoice.pageCount} page${invoice.pageCount === 1 ? "" : "s"} · ${new Intl.NumberFormat("en-IN").format(invoice.characterCount ?? 0)} characters ${invoice.source === "ocr" ? "read with OCR—please review" : "found"}${invoice.truncated ? " · Preview limited" : ""}`;
  if (invoice.progressLabel) return invoice.progressLabel;
  return `This ${isPdfFile(invoice.file) ? "PDF" : "image"} could not be read on this device.`;
}

function InvoiceDetails({ invoice, draft, stationName, catalogProducts, duplicate, reviewed, submitted, onReview, onPreview }: { invoice: ParsedIndianInvoice; draft: EditableInvoiceDraft; stationName?: string | undefined; catalogProducts: CatalogProduct[]; duplicate?: PurchaseInvoice | undefined; reviewed: boolean; submitted?: LocalInvoice["submitted"]; onReview: () => void; onPreview: () => void }) {
  const stationAssessment = assessInvoiceStation(draft.consigneeName, stationName);
  const priceAssessment = assessSingleProductInvoicePrice(draft, catalogProducts);
  const productRows = draft.lines.map((line, index) => {
    const quantity = Number(line.quantity) || 0;
    const unitRate = Number(line.unitRate) || 0;
    const base = quantity * unitRate;
    const taxRate = Number(line.taxRate) || 0;
    const gross = !reviewed ? invoice.lines[index]?.grossAmount : null;
    const amount = gross ?? base * (1 + taxRate / 100);
    const match = findMatchingCatalogProduct(line.description, line.product, line.hsnCode, catalogProducts);
    return { line, quantity, unitRate, base, taxRate, amount, match };
  });
  return <section className={`nerve-invoice-details ${invoice.status === "NEEDS_REVIEW" ? "needs-review" : ""}`} aria-label="Invoice details found">
    <header><div><strong>{submitted ? "This invoice is now in Purchases" : reviewed ? "You reviewed this invoice" : invoice.status === "READY_FOR_REVIEW" ? "I found a new invoice" : "I found an invoice, but some details need checking"}</strong><small>{submitted ? `Invoice ${submitted.invoiceNumber} was created as unpaid. Stock and payment were not changed.` : reviewed ? "Your edits are kept only in this browser tab." : "No FuelNerve record has been changed."}</small></div><span>{submitted ? "Created" : reviewed ? "Reviewed" : invoice.status === "READY_FOR_REVIEW" ? "Ready to review" : "Check details"}</span></header>
    <dl>
      <div><dt>Supplier</dt><dd>{draft.supplierName || "Not clearly found"}</dd></div>
      <div><dt>Delivered to</dt><dd>{draft.consigneeName || "Not clearly found"}</dd></div>
      <div><dt>Invoice number</dt><dd>{draft.invoiceNumber || "Not clearly found"}</dd></div>
      <div><dt>Invoice date</dt><dd>{draft.invoiceDate ? formatInvoiceDate(draft.invoiceDate) : "Not clearly found"}</dd></div>
      <div><dt>Total</dt><dd>{Number(draft.totalAmount) > 0 ? formatInvoiceMoney(Number(draft.totalAmount)) : "Not clearly found"}</dd></div>
      <div><dt>Taxes & charges</dt><dd>{draft.taxAmount !== "" ? formatInvoiceMoney(Number(draft.taxAmount) || 0) : "Not clearly found"}</dd></div>
    </dl>
    {duplicate && <div className="nerve-invoice-duplicate" role="alert"><AlertTriangle/><div><strong>This invoice is already updated</strong><p>{duplicate.supplier.name} invoice {duplicate.invoiceNumber} is already in Purchases, dated {formatInvoiceDate(duplicate.invoiceDate.slice(0, 10))}, for {formatInvoiceMoney(Number(duplicate.totalAmount))}. It will not be added again.</p></div></div>}
    <section className="nerve-invoice-products" aria-label="Products recognised on invoice">
      <header><div><strong>Products</strong><small>{productRows.length ? `${productRows.length} line${productRows.length === 1 ? "" : "s"} recognised` : "No product lines found"}</small></div></header>
      {productRows.length ? productRows.map(({ line, quantity, unitRate, base, taxRate, amount, match }) => <article key={line.id}>
        <div className="nerve-invoice-product-name"><strong>{line.description || "Unnamed product"}</strong><small>{line.product || "Unclassified"}{line.hsnCode ? ` · HSN ${line.hsnCode}` : ""}</small></div>
        <div><span>Quantity</span><strong>{formatInvoiceNumber(quantity)} {line.unit || "units"}</strong></div>
        <div><span>Price</span><strong>{formatInvoiceMoney(unitRate)}</strong></div>
        <div><span>Tax</span><strong>{formatInvoiceNumber(taxRate)}%</strong></div>
        <div><span>Base</span><strong>{formatInvoiceMoney(base)}</strong></div>
        <div><span>Total</span><strong>{formatInvoiceMoney(amount)}</strong></div>
        <em className={match ? "matched" : "new"}>{match ? `Matched · ${match.name}` : "New product · confirm before adding"}</em>
      </article>) : <p className="nerve-invoice-products-empty">Review the document text and add at least one product.</p>}
    </section>
    <div className={`nerve-invoice-station ${stationAssessment.status.toLowerCase()}`}><ShieldCheck/><p>{stationAssessment.message}</p></div>
    {priceAssessment && priceAssessment.direction !== "UNCHANGED" && <div className={`nerve-invoice-price ${priceAssessment.direction.toLowerCase()}`}><TrendingUp/><div><strong>{priceAssessment.productName} purchase price {priceAssessment.direction === "INCREASE" ? "increased" : "decreased"}</strong><p>{formatInvoiceMoney(priceAssessment.previousPrice)} to {formatInvoiceMoney(priceAssessment.invoicePrice)} per {priceAssessment.unit}. Review and update the retail selling price if required before the next sale.</p></div></div>}
    {!reviewed && invoice.warnings.length > 0 && <div className="nerve-invoice-warnings"><AlertTriangle/>{invoice.warnings.slice(0, 2).map(warning => <p key={warning}>{warning}</p>)}</div>}
    <div className="nerve-invoice-actions">{submitted || duplicate ? <Link className="nerve-purchase-link" to="/purchases"><FileCheck2/> View existing invoice</Link> : <><button type="button" className="nerve-review-invoice" onClick={onReview}><FileCheck2/>{reviewed ? "Edit reviewed details" : "Review and edit details"}</button>{reviewed && stationAssessment.status === "MATCH" && <button type="button" className="nerve-preview-invoice" onClick={onPreview}><ShieldCheck/> Preview record changes</button>}</>}</div>
  </section>;
}

function findMatchingCatalogProduct(description: string, classification: string, hsnCode: string, products: CatalogProduct[]) {
  const normalize = (value: string | null | undefined) => (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hsn = normalize(hsnCode);
  if (hsn) {
    const matches = products.filter(product => normalize(product.hsnCode) === hsn);
    if (matches.length === 1) return matches[0];
  }
  const names = new Set([normalize(description), normalize(classification)].filter(Boolean));
  const matches = products.filter(product => names.has(normalize(product.name)) || names.has(normalize(product.code)));
  return matches.length === 1 ? matches[0] : undefined;
}

function formatInvoiceMoney(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function formatInvoiceNumber(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);
}

function formatInvoiceDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
