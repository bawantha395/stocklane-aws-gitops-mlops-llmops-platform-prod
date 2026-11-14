import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Camera,
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  Activity,
  Plus,
  Printer,
  Search,
  RefreshCw,
  LogOut,
  Check,
  X,
  ScanLine,
  Home,
  ArrowRight,
  ArrowLeft,
  ClipboardCheck,
  ListChecks,
  Wrench,
  Menu as MenuIcon,
  FileText,
  PlusCircle,
  X as CloseIcon,
  Compass,
} from "lucide-react";
import {
  api,
  ApiError,
  auth,
  config,
  headers,
  shrink,
  signOut,
  type Product,
  type Match,
  type Draft,
  type Movement,
} from "./api";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./stock.css";
import "./glass.css";
import "./theme.css";
import "./tokens.css";
import { ToastHost, applyTheme, getTheme } from "./ui";
import { getDefaultReorder, setBusinessName, setDefaultReorder, useBusinessName } from "./businessName";
import { t, useLang, setLang } from "./i18n";
import { Walkthrough } from "./Walkthrough";
import { MechanicHome } from "./MechanicHome";
import { SetupWizard, setupDone } from "./SetupWizard";
import { isPractice, samplePhotoBlob, usePractice, startPractice, probe } from "./practice";
import { PracticeCoach } from "./PracticeCoach";
import { Logo } from "./Logo";
import { BizLogo } from "./BizLogo";
import { SignIn, type SignInMode } from "./SignIn";
import type { Page as WsPage } from "./workshop/common";

document.documentElement.dataset.glass = "light";
const Scanner = React.lazy(() =>
  import("./Scanner").then((module) => ({ default: module.Scanner })),
);
import { StockReport } from "./StockReport";
import { Workshop } from "./workshop";
import { DateChips, SummaryBar, ALL, inRange, useSaved, type Range } from "./workshop/DateRange";
import "./brand.css";
import { CommandBar } from "./CommandBar";
import { CountStock } from "./CountStock";
import { ReorderCard } from "./ReorderCard";
import { Counter, type Mode as CounterMode } from "./Counter";
import { saveNav, loadNav, markNativePick, lostNativePick, clearNativePick } from "./resume";
import { dock } from "./dock";
import { suggestFields, type Field, type Suggestion } from "./suggestions";
import {
  emptyTask,
  complete,
  validQuantity,
  plannedOut,
  type Direction,
  type StockTask,
  type TaskLine,
} from "./task";

type Item = Product & {
  part_number?: string;
  location?: string;
  archived?: boolean;
};
type Session = { name: string; roles: string[] };
type View =
  | "home"
  | "receive"
  | "issue"
  | "stock"
  | "find"
  | "count"
  | "analysis"
  | "activity"
  | "counter"
  | "workshop";
const uid = () => crypto.randomUUID();
function aiMessage(ai?: { status: string; code?: string; message?: string; detail?: string; provider?: string; model?: string }) {
  if (!ai || ai.status === "not_needed") return "";
  if (ai.status === "used") return "";
  if (ai.status === "not_configured") return "AI suggestions are switched off.";
  if (ai.status === "limit_reached") return "Today's AI suggestion limit is reached.";
  const why =
    ai.code === "AI_PROVIDER_QUOTA"
      ? " (the AWS Bedrock quota for this account is not approved yet)"
      : ai.code === "AI_ACCESS_DENIED"
        ? " (Bedrock model access is not enabled)"
        : ai.detail
          ? " (" + ai.detail + ")"
          : "";
  return "AI suggestions are not available right now" + why + ".";
}
function prettyModel(ai?: { provider?: string; model?: string }) {
  if (ai?.provider === "bedrock") return "Amazon Bedrock";
  const m = (ai?.model || "").replace(/^models\//, "");
  if (!m) return ai?.provider === "gemini" ? "Gemini" : "AI";
  return m.split("-").map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
const number = (n: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(Number(n));
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Colombo" });
function useCommand() {
  const pending = useRef({ body: "", key: "" });
  return async <T,>(path: string, body: unknown, method = "POST") => {
    const fingerprint = path + method + JSON.stringify(body);
    if (pending.current.body !== fingerprint)
      pending.current = { body: fingerprint, key: uid() };
    const value = await api<T>(
      path,
      { method, body: JSON.stringify(body) },
      pending.current.key,
    );
    pending.current = { body: "", key: "" };
    return value;
  };
}
async function printLabel(item: Item) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow a new window to print the label.");
  try {
    const data = await QRCode.toDataURL("stocklane:v1:" + item.id, {
      width: 260,
      margin: 2,
    });
    const doc = popup.document;
    doc.title = "Stock label — " + item.sku;
    const style = doc.createElement("style");
    style.textContent =
      "body{font:14px sans-serif;text-align:center;margin:12mm}img{width:45mm;height:45mm}h1{font-size:18px}p{margin:5px}button{margin:20px;padding:12px}@media print{button{display:none}}";
    doc.head.append(style);
    const img = doc.createElement("img");
    img.src = data;
    img.alt = "Product QR";
    doc.body.append(img);
    for (const text of [
      item.name,
      item.brand,
      item.part_number || item.sku,
      item.location || "",
    ]) {
      const p = doc.createElement("p");
      p.textContent = text;
      doc.body.append(p);
    }
    const button = doc.createElement("button");
    button.textContent = "Print / Save as PDF";
    button.onclick = () => popup.print();
    doc.body.append(button);
  } catch (error) {
    popup.close();
    throw error;
  }
}
function Photo({ id, zoom = false }: { id: string; zoom?: boolean }) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  useEffect(() => {
    let active = true;
    let object = "";
    apiPhoto(id)
      .then((blob) => {
        object = URL.createObjectURL(blob);
        if (active) setUrl(object);
        else URL.revokeObjectURL(object);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [id]);
  return url ? (
    zoom ? (
      <>
        <button type="button" className="photo-zoom-btn" aria-label="View the photo full screen" onClick={() => setOpen(true)}>
          <img className="item-photo" src={url} alt="Uploaded photo" />
        </button>
        {open && (
          <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setOpen(false)}>
            <button type="button" className="photo-viewer-close" aria-label="Close photo" onClick={() => setOpen(false)}><X /></button>
            <img src={url} alt="Uploaded photo, full size" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </>
    ) : (
      <img className="item-photo" src={url} alt="Approved item reference" />
    )
  ) : (
    <span className="photo-placeholder">
      <Package />
    </span>
  );
}
async function apiPhoto(id: string) {
  if (isPractice()) { const b = samplePhotoBlob(); if (b) return b; throw new Error("Photo unavailable"); }
  const r = await fetch(
    (config.apiBase || "") + "/api/vision/images/" + encodeURIComponent(id),
    { headers: await headers() },
  );
  if (!r.ok) throw new Error("Photo unavailable");
  return r.blob();
}
function App() {
  const [view, setView] = useState<View>(() => (loadNav().view as View) || "home");
  const [counterMode, setCounterMode] = useState<CounterMode>(() => (loadNav().mode as CounterMode) || "receive");
  useEffect(() => { saveNav(view, counterMode); }, [view, counterMode]);
  const businessName = useBusinessName();
  const lang = useLang();
  const [, setThemeTick] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen(true); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const [tourOpen, setTourOpen] = useState(false);
  const [chooser, setChooser] = useState(false);
  const pr = usePractice();
  const prevPractice = useRef(false);
  const [dockHidden, setDockHidden] = useState(() => {
    try { return localStorage.getItem("lifta.dock") === "hidden"; } catch { return false; }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsStart, setWsStart] = useState<{ page: WsPage; n: number }>({ page: { name: "home" }, n: 0 });
  const [wizardGone, setWizardGone] = useState(false);
  const [started, setStarted] = useState<{ jobs: boolean; invoices: boolean } | null>(null);
  const [startHidden, setStartHidden] = useState(() => {
    try { return localStorage.getItem("lifta.start") === "done"; } catch { return false; }
  });
  const swipeY = useRef<number | null>(null);
  function setDock(hidden: boolean) {
    setDockHidden(hidden);
    try { localStorage.setItem("lifta.dock", hidden ? "hidden" : "shown"); } catch { /* private mode */ }
  }
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => { swipeY.current = e.touches[0].clientY; },
    onTouchEnd: (e: React.TouchEvent) => {
      if (swipeY.current === null) return;
      const dy = e.changedTouches[0].clientY - swipeY.current;
      swipeY.current = null;
      if (dy < -24) setDock(true);
      else if (dy > 24) setDock(false);
    },
  };
  const [items, setItems] = useState<Item[]>([]),
    [moves, setMoves] = useState<Movement[]>([]);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityKind, setActivityKind] = useSaved("stock.kind", "ALL");
  const [activityRange, setActivityRange] = useSaved<Range>("stock.range", ALL);
  const [session, setSession] = useState<Session | null>(null),
    [status, setStatus] = useState<any>(null),
    [loading, setLoading] = useState(false);
  const [booted, setBooted] = useState(false), [gate, setGate] = useState<"" | "signedOut" | "noAccess">("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Record<Direction, StockTask>>({
    IN: emptyTask(),
    OUT: emptyTask(),
  });
  const taskRef = useRef(tasks),
    storageKey = useRef(""),
    submitting = useRef(false);
  const [selected, setSelected] = useState(""),
    [quantity, setQuantity] = useState(1),
    [qr, setQr] = useState(""),
    [search, setSearch] = useState("");
  const [scanner, setScanner] = useState(false),
    [match, setMatch] = useState<Match | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [imageId, setImageId] = useState(""),
    [preview, setPreview] = useState(""),
    [saveReference, setSaveReference] = useState(false);
  const [aiNote, setAiNote] = useState(""),
    [counterPick, setCounterPick] = useState<Item | null>(null);
  const fromCounter = useRef(false);
  const [newItem, setNewItem] = useState(false),
    [edit, setEdit] = useState<Item | null>(null),
    [labelItem, setLabelItem] = useState<Item | null>(null);
  const [counterKey, setCounterKey] = useState(0);
  const [archived, setArchived] = useState<Item[]>([]),
    [showArchived, setShowArchived] = useState(false),
    [query, setQuery] = useState(""),
    [lowOnly, setLowOnly] = useState(false);
  const [countId, setCountId] = useState("");
  const photoTarget = useRef("");
  const file = useRef<HTMLInputElement>(null),
    sequence = useRef(0),
    mutation = useCommand();
  const direction: Direction = view === "issue" ? "OUT" : "IN";
  const inTask = view === "receive" || view === "issue";
  const task = tasks[direction],
    active = items.find((item) => item.id === selected),
    owner = !!session?.roles.includes("ROLE_OWNER");
  const visibleMoves = moves.filter((movement) => {
    const query = activitySearch.trim().toLowerCase();
    const incoming = ["OPENING", "RECEIPT", "RETURN", "COUNT_IN"].includes(movement.kind);
    const outgoing = ["ISSUE", "STOCK_OUT", "COUNT_OUT"].includes(movement.kind);
    const matchesKind =
      activityKind === "ALL" ||
      (activityKind === "IN" && incoming) ||
      (activityKind === "OUT" && outgoing);
    const matchesText =
      !query ||
      [movement.name, movement.sku, movement.actor, movement.receiver_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    return matchesKind && matchesText && inRange(movement.created_at, activityRange);
  });
  const movementDirection = (kind: string) =>
    ["OPENING", "RECEIPT", "RETURN", "COUNT_IN"].includes(kind) ? "IN" : "OUT";
  const actorEmail = (actor?: string) =>
    actor?.includes("@") ? actor : "Email unavailable";
  const tell = (message: string) => setNotice(message);
  const persist = (next: Record<Direction, StockTask>) => {
    // Persist before submitting: a reload retries with the same command identity.
    if (storageKey.current)
      sessionStorage.setItem(storageKey.current, JSON.stringify(next));
    taskRef.current = next;
    setTasks(next);
  };
  const updateLine = (dir: Direction, id: string, patch: Partial<TaskLine>) => {
    const current = taskRef.current;
    persist({
      ...current,
      [dir]: {
        ...current[dir],
        lines: current[dir].lines.map((line) =>
          line.id === id ? { ...line, ...patch } : line,
        ),
      },
    });
  };
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m, s, v] = await Promise.all([
        api<Item[]>("/api/inventory/products"),
        api<Movement[]>("/api/inventory/movements"),
        api<Session>("/api/inventory/session"),
        api("/api/vision/status").catch(() => ({
          modelReady: false,
          bedrockConfigured: false,
        })),
      ]);
      setItems(p);
      setMoves(m);
      setSession(s);
      setStatus(v);
      api<{ name: string; default_reorder_level?: number }>("/api/workshop/settings").then((b) => { setBusinessName(b.name); setDefaultReorder(b.default_reorder_level); }).catch(() => undefined);
      const key = "stocklane.tasks.v2." + s.name;
      if (storageKey.current !== key) {
        storageKey.current = key;
        let restored = { IN: emptyTask(), OUT: emptyTask() };
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) || "null");
          if (
            saved &&
            Array.isArray(saved.IN?.lines) &&
            Array.isArray(saved.OUT?.lines)
          )
            restored = saved;
        } catch {
          /* Start fresh if no valid local draft. */
        }
        taskRef.current = restored;
        setTasks(restored);
      }
      setGate("");
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      if (auth && code === 401) setGate("signedOut");
      else if (auth && code === 403) setGate("noAccess");
      else setError((e as Error).message);
    } finally {
      setLoading(false);
      setBooted(true);
      if (lostNativePick()) setNotice("Your phone reloaded Lifta while its camera app was open, so the photo did not arrive. Use Open camera, then Take photo. That camera stays inside Lifta.");
    }
  }, []);
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".stock-sidebar");
    return nav ? dock(nav) : undefined;
  }, []);
  useEffect(() => {
    if (location.pathname === "/auth/callback" && auth) {
      void auth
        .signinRedirectCallback()
        .then(() => location.replace("/"))
        .catch((e) => setError(e.message));
    } else void refresh();
  }, [refresh]);
  useEffect(
    () => () => {
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (!session || !session.roles.includes("ROLE_OWNER") || startHidden || started) return;
    let live = true;
    void Promise.all([
      api<unknown[]>("/api/workshop/jobs").catch(() => null),
      api<unknown[]>("/api/workshop/invoices").catch(() => null),
    ]).then(([j, i]) => { if (live) setStarted({ jobs: !!j?.length, invoices: !!i?.length }); });
    return () => { live = false; };
  }, [session, startHidden, started]);
  useEffect(() => { probe.view = view; });
  // Entering or leaving practice swaps every screen between the dummy data and the real data.
  useEffect(() => {
    if (pr.active === prevPractice.current) return;
    prevPractice.current = pr.active;
    if (pr.active) { setMenuOpen(false); navigate("home"); void refresh(); }
    else { setStarted(null); void refresh(); }
  }, [pr.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const onCallback = typeof location !== "undefined" && location.pathname === "/auth/callback";
  const resetIdentification = () => {
    photoTarget.current = "";
    sequence.current++;
    setSelected("");
    setQuantity(1);
    setQr("");
    setSearch("");
    setMatch(null);
    setImageId("");
    setPreview("");
    setDraft(null);
    setSaveReference(false);
  };
  const navigate = (next: View, preserveCounterPick = false) => {
    if (submitting.current) return;
    setMenuOpen(false);
    setScanner(false);
    resetIdentification();
    if (next !== "counter" || !preserveCounterPick) setCounterPick(null);
    setView(next);
    setError("");
    setNotice("");
    if (next === "counter") {
      if (!preserveCounterPick) setCounterMode("receive");
      setCounterKey((key) => key + 1);
    }
  };
  const openCounter = (mode: CounterMode, picked: Item | null = null) => {
    setCounterMode(mode);
    setCounterPick(picked);
    navigate("counter", true);
  };
  // a job took a part from stock or gave it back: reload the parts so every screen shows the new quantity
  useEffect(() => { const f = () => void refresh(); window.addEventListener("lifta:stock-changed", f); return () => window.removeEventListener("lifta:stock-changed", f); }, [refresh]);
  useEffect(() => { const f = (e: Event) => { setLowOnly(e.type === "lifta:low"); navigate("stock"); }; window.addEventListener("lifta:stock", f); window.addEventListener("lifta:low", f); return () => { window.removeEventListener("lifta:stock", f); window.removeEventListener("lifta:low", f); }; });
  const openWorkshop = (page: WsPage) => {
    setWsStart((w) => ({ page, n: w.n + 1 }));
    navigate("workshop");
  };
  const chooseQR = useCallback(
    (value: string) => {
      setScanner(false);
      const text = value.trim().toLowerCase();
      if (
        !/^stocklane:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          text,
        )
      ) {
        setError(
          "This is not a Lifta item QR. Use a product photo or search by part number.",
        );
        return;
      }
      const id = text.slice("stocklane:v1:".length),
        item = items.find((p) => p.id === id);
      if (!item) {
        setError(
          "This label is not in the active catalogue. Refresh or ask the owner to check archived items.",
        );
        return;
      }
      if (view === "count") {
        setCountId(id);
      } else {
        setSelected(id);
        setQuantity(1);
        setMatch(null);
        setImageId("");
        setSaveReference(false);
      }
      setError("");
      setNotice("Item found. Check the part number.");
    },
    [items, view],
  );
  const analyse = async (photo: File) => {
    clearNativePick();
    const target = photoTarget.current;
    photoTarget.current = "";
    const run = ++sequence.current;
    setBusy(true);
    setError("");
    setSelected("");
    setMatch(null);
    setDraft(null);
    setImageId("");
    setSaveReference(false);
    setPreview(URL.createObjectURL(photo));
    try {
      const form = new FormData();
      form.append("file", await shrink(photo));
      const result = await api<{ value: string | null }>("/api/vision/qr", {
        method: "POST",
        body: form,
      });
      if (run !== sequence.current) return;
      if (result.value) {
        chooseQR(result.value);
        return;
      }
      const found = await api<Match>("/api/vision/match", {
        method: "POST",
        body: form,
      });
      if (run !== sequence.current) return;
      setMatch({
        ...found,
        candidates: found.candidates.filter((c) =>
          items.some((p) => p.id === c.product.id),
        ),
      });
      setImageId(found.imageId);
      if (target) {
        setSelected(target);
        setNotice(
          "Check that this photo belongs to the selected item, then save the verified reference.",
        );
      }
    } catch (e) {
      if (run === sequence.current) setError((e as Error).message);
    } finally {
      if (run === sequence.current) setBusy(false);
    }
  };
  const readLabel = async (id: string = imageId) => {
    setBusy(true);
    setError("");
    try {
      const result = await api<Draft>("/api/vision/drafts", {
        method: "POST",
        body: JSON.stringify({ imageId: id }),
      });
      setDraft(result);
      setAiNote(aiMessage(result.ai));
    } catch (e) {
      // Still open the form: the label could not be read, so the person types the details.
      setDraft(null);
      setAiNote(
        "No suggestions are available for this photo. " + (e as Error).message,
      );
    } finally {
      setNewItem(true);
      setBusy(false);
    }
  };
  const newItemFromCounter = (id: string) => {
    fromCounter.current = true;
    setImageId(id);
    return readLabel(id);
  };
  const newItemFromBarcode = (barcode: string, values: Record<string, string>) => {
    fromCounter.current = true;
    setImageId("");
    setDraft({
      id: "barcode-" + barcode,
      image_id: "",
      fields: {},
      suggestions: {
        name: values.product_name || "",
        brand: values.brands || "",
        category: values.categories || "",
        capacity: values.quantity || "",
      },
      labelSuggestions: {},
      source: "barcode",
      status: "PENDING",
      created_at: new Date().toISOString(),
      product_id: null,
    });
    setAiNote("Barcode information is a suggestion only. Review and manually accept each field.");
    setNewItem(true);
  };
  const addLine = () => {
    if (!active || !validQuantity(quantity, active.unit)) {
      setError(
        "Enter a positive quantity. Pieces need whole numbers; litres allow up to three decimals.",
      );
      return;
    }
    const current = taskRef.current;
    if (
      direction === "OUT" &&
      quantity + plannedOut(current.OUT.lines, active.id) >
        Number(active.quantity)
    ) {
      setError(
        "The draft requests more than the available stock. Reduce its quantity.",
      );
      return;
    }
    const line: TaskLine = {
      id: uid(),
      key: uid(),
      productId: active.id,
      name: active.name,
      part: active.part_number || active.sku,
      unit: active.unit,
      quantity,
      imageId: imageId || undefined,
      reference: saveReference && !!imageId,
      attempted: false,
    };
    try {
      persist({
        ...current,
        [direction]: {
          ...current[direction],
          lines: [...current[direction].lines, line],
        },
      });
      tell(active.name + " added to your draft. Stock has not changed.");
      resetIdentification();
    } catch {
      setError(
        "This browser cannot save the draft. Enable session storage before continuing.",
      );
    }
  };
  const commit = async () => {
    if (submitting.current || !task.lines.length) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const dir = direction;
    try {
      for (const original of taskRef.current[dir].lines) {
        let line = { ...original };
        if (complete(line)) continue;
        updateLine(dir, line.id, {
          attempted: true,
          error: undefined,
          rejected: false,
        });
        line.attempted = true;
        try {
          if (!line.movementId) {
            const movement = await api<any>(
                "/api/inventory/movements",
                {
                  method: "POST",
                  body: JSON.stringify({
                    kind: dir === "IN" ? "RECEIPT" : "STOCK_OUT",
                    productId: line.productId,
                    quantity: line.quantity,
                    jobId: null,
                    issueId: null,
                    note: "Stock " + dir + " · task " + taskRef.current[dir].id,
                  }),
                },
                line.key,
              );
            line.movementId = movement.id;
            updateLine(dir, line.id, { movementId: movement.id });
          }
          if (line.reference && line.imageId && !line.referenceSaved) {
            await api("/api/vision/references", {
              method: "POST",
              body: JSON.stringify({
                productId: line.productId,
                imageId: line.imageId,
              }),
            });
            updateLine(dir, line.id, { referenceSaved: true });
          }
        } catch (e) {
          updateLine(dir, line.id, {
            error: (e as Error).message,
            rejected:
              !line.movementId &&
              e instanceof ApiError &&
              [400, 404, 409, 422].includes(e.status),
          });
          throw e;
        }
      }
      await refresh();
      tell(
        dir === "IN"
          ? "Receipt confirmed. Stock has been updated."
          : "Stock-out confirmed. Stock has been updated.",
      );
    } catch (e) {
      setError(
        "Some lines may already be recorded. Review the statuses below, then retry unfinished lines. " +
          (e as Error).message,
      );
      await refresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const discard = () => {
    if (task.lines.some((l) => l.attempted && !complete(l))) {
      setError(
        "An attempted line is unfinished. Retry it before starting a new task.",
      );
      return;
    }
    if (
      task.lines.some((l) => !complete(l)) &&
      !confirm(
        "Discard the unconfirmed draft? Stock has not changed for those lines.",
      )
    )
      return;
    persist({ ...taskRef.current, [direction]: emptyTask() });
    resetIdentification();
    setNotice("Ready for a new task.");
  };
  const reference = async () => {
    if (!active || !imageId) return;
    setBusy(true);
    try {
      await api("/api/vision/references", {
        method: "POST",
        body: JSON.stringify({ productId: active.id, imageId }),
      });
      tell("Reference saved. Stock is unchanged.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const archive = async (p: Item, value: boolean) => {
    if (
      !confirm(
        value
          ? "Archive " + p.name + "? Stock must be zero; history remains."
          : "Restore " + p.name + "?",
      )
    )
      return;
    try {
      await mutation("/api/inventory/products/" + p.id + "/archive", {
        archived: value,
      });
      await refresh();
      if (showArchived)
        setArchived(await api<Item[]>("/api/inventory/products/archived"));
      tell(value ? "Item archived." : "Item restored.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // Every word typed must appear somewhere in the part's details; part numbers match with or without dashes and spaces.
  const filtered = (source: Item[], text: string) => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    return source.filter((p) => {
      if (lowOnly && !(Number(p.quantity) <= Number(p.reorder_level))) return false;
      const hay = [p.name, p.brand, p.part_number, p.location, p.category, p.sku, p.grade, p.capacity].join(" ").toLowerCase(), flat = hay.replace(/[^a-z0-9]/g, "");
      return words.every((w) => hay.includes(w) || flat.includes(w.replace(/[^a-z0-9]/g, "")));
    });
  };
  const allComplete = task.lines.length > 0 && task.lines.every(complete),
    locked = task.lines.some((l) => l.attempted);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("lifta.recent.parts") || "[]") as string[]; } catch { return []; } });
  useEffect(() => {
    if (view !== "find" || !selected) return;
    setRecent((r) => { const n = [selected, ...r.filter((x) => x !== selected)].slice(0, 8); try { localStorage.setItem("lifta.recent.parts", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  }, [selected, view]);
  const lowItems = items.filter((p) => Number(p.quantity) <= Number(p.reorder_level));
  const recentItems = recent.map((id) => items.find((p) => p.id === id)).filter((p): p is Item => !!p).slice(0, 6);
  const showResults = (source: Item[]) =>
    source.slice(0, 30).map((p) => (
      <button
        className="lookup-row"
        key={p.id}
        onClick={() => {
          setSelected(p.id);
          setQuantity(1);
          setError("");
        }}
      >
        <ItemPhoto item={p} />
        <span>
          <strong>{p.name}</strong>
          <small>
            {p.brand} · Part no. {p.part_number || "Not set"} · System no. {p.sku}
          </small>
          <small>{p.location || "Shelf not set"}</small>
        </span>
        <b>
          {number(p.quantity)}
          <small>{p.unit === "LITRE" ? "L" : "units"}</small>
        </b>
      </button>
    ));
  if (auth && !session) {
    const signIn = auth;
    const mode: SignInMode | "" = onCallback ? (error ? "failed" : "callback") : !booted ? "checking" : gate === "noAccess" ? "noAccess" : gate === "signedOut" ? "signedOut" : "";
    if (mode)
      return (
        <SignIn mode={mode} error={mode === "failed" ? error : ""} onSignIn={() => { setError(""); void signIn.signinRedirect(); }}
          onSignOut={() => void signOut()} />
      );
  }
  const navItems: ({ group: string } | { key: View | "tour"; full: string; short: string; sub: string; Icon: typeof Home; main?: boolean })[] = [
    { key: "home", full: t("Home"), short: t("Home"), sub: "", Icon: Home, main: true },
    { group: t("WORKSHOP MANAGEMENT") },
    { key: "workshop", full: t("Jobs & Invoices"), short: t("Jobs"), sub: t("Job cards, vehicles and bills"), Icon: Wrench, main: true },
    { group: t("STOCK MANAGEMENT") },
    { key: "counter", full: t("Parts counter"), short: t("Counter"), sub: t("A part came in or went out"), Icon: ScanLine, main: true },
    { key: "stock", full: t("Parts list"), short: t("Parts"), sub: owner ? t("All parts, photos and QR labels") : t("See what is in stock"), Icon: Package },
    { key: "activity", full: t("History"), short: t("History"), sub: t("Every part in and out"), Icon: Activity },
    ...(owner ? [{ key: "analysis" as View, full: t("Reports"), short: t("Reports"), sub: t("Stock summary and low stock"), Icon: ClipboardCheck }] : []),
    { group: t("HELP") },
    { key: "tour", full: t("Walkthrough"), short: t("Walkthrough"), sub: t("Show me how it works"), Icon: Compass },
  ];
  const pickNav = (key: View | "tour") => { if (key === "tour") { setMenuOpen(false); setChooser(true); } else navigate(key); };
  const moreActive = view === "stock" || view === "activity" || view === "analysis";
  return (
    <div className="stock-shell" data-dock={dockHidden ? "hidden" : "shown"}>
      <aside className="stock-sidebar" {...swipe}>
        <a
          className="stock-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <Logo size={44} /> <b>Lifta<span>.</span></b>
        </a>
        <p>{t("WORKSHOP SUITE")}</p>
        {navItems.map((n) =>
          "group" in n ? (
            <span className="nav-heading" key={n.group}>{n.group}</span>
          ) : (
            <button
              key={n.key}
              data-tour={"nav-" + n.key}
              disabled={busy}
              className={(view === n.key ? "chosen" : "") + (n.main ? "" : " nav-more")}
              onClick={() => pickNav(n.key)}
            >
              <n.Icon size={19} />
              <span className="nav-text">
                <span className="nav-full">{n.full}</span>
                {n.sub && <small className="nav-sub">{n.sub}</small>}
              </span>
              <span className="nav-short">{n.short}</span>
            </button>
          ),
        )}
        <button
          className={"dock-menu-btn" + (menuOpen || moreActive ? " chosen" : "")}
          aria-expanded={menuOpen}
          aria-controls="menu-sheet"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <CloseIcon size={19} /> : <MenuIcon size={19} />}
          <span className="nav-short">{t("Menu")}</span>
        </button>
        <div
          className="dock-grab"
          role="button"
          tabIndex={0}
          aria-label={dockHidden ? "Show menu" : "Hide menu"}
          onClick={() => setDock(!dockHidden)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDock(!dockHidden); }}
        />
      </aside>
      {menuOpen && (
        <div className="menu-sheet-back" onClick={() => setMenuOpen(false)}>
          <nav id="menu-sheet" className="menu-sheet" aria-label="All sections" onClick={(e) => e.stopPropagation()}>
            {navItems.map((n) =>
              "group" in n ? (
                <p className="menu-heading" key={n.group}>{n.group}</p>
              ) : (
                <button key={n.key} className={view === n.key ? "chosen" : ""} disabled={busy} onClick={() => pickNav(n.key)}>
                  <n.Icon size={22} />
                  <span><strong>{n.full}</strong>{n.sub && <small>{n.sub}</small>}</span>
                </button>
              ),
            )}
            <div className="menu-sheet-foot">
              <BizLogo name={businessName} size={84} />
              <strong>{owner ? t("Owner workspace") : t("Stock team")}</strong>
              <small>{businessName}</small>
            </div>
            {auth && (
              <button className="menu-signout" disabled={busy} onClick={() => void signOut()}>
                <LogOut size={22} /> <span><strong>{t("Sign out")}</strong></span>
              </button>
            )}
          </nav>
        </div>
      )}
      {tourOpen && <Walkthrough owner={owner} onClose={() => setTourOpen(false)} />}
      {owner && session && !pr.active && !wizardGone && !setupDone() && (
        <SetupWizard onClose={() => setWizardGone(true)} onPractice={() => startPractice(true)} onFirstPart={() => openCounter("receive")} />
      )}
      {chooser && (
        <div className="wt-back" onClick={() => setChooser(false)}>
          <section className="wt-card chooser" role="dialog" aria-modal="true" aria-label={t("Walkthrough")} onClick={(e) => e.stopPropagation()}>
            <header><h2>{t("How would you like to learn?")}</h2><button className="icon-button" aria-label={t("Close")} onClick={() => setChooser(false)}><X size={18} /></button></header>
            <button className="chooser-opt" onClick={() => { setChooser(false); setTourOpen(true); }}><strong>{t("Quick look")}</strong><small>{t("A 1 minute tour with pictures. Just watch.")}</small></button>
            <button className="chooser-opt primary" onClick={() => { setChooser(false); startPractice(owner); }}><strong>{t("Practice")}</strong><small>{t("Try it yourself with dummy data. Real screens, nothing is saved.")}</small></button>
          </section>
        </div>
      )}
      {session && <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} workshop={true} openWorkshop={openWorkshop} openPart={(q) => { setQuery(q); navigate("stock"); }} />}
      <PracticeCoach />
      <main className="stock-main">
        <header className="stock-header">
          <a className="m-brand" href="#" onClick={(e) => { e.preventDefault(); navigate("home"); }}>
            <Logo size={30} /> <b>Lifta<span>.</span></b>
          </a>
          <div className="biz" aria-label={businessName}>
            <span className="biz-logo">
              <BizLogo name={businessName} size={46} />
              <span className="online-dot" title={t("Connected")} />
            </span>
            <span className="biz-text">
              <strong>{businessName}</strong>
              <small>{owner ? t("Owner workspace") : t("Stock team")}</small>
            </span>
          </div>
          <div>
            <div className="lang-toggle" role="group" aria-label="Language">
              <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
              <button className={lang === "si" ? "on" : ""} onClick={() => setLang("si")}>සිං</button>
            </div>
            <button className="cmd-open" aria-label={t("Search anything")} onClick={() => setCmdOpen(true)}><Search size={18} /><span className="cmd-label">{t("Search")}</span><kbd>Ctrl K</kbd></button>
            <button className="theme-toggle" aria-label={t("Appearance") + ": " + t(getTheme() === "auto" ? "Auto" : getTheme() === "dark" ? "Dark" : "Light")} title={t("Appearance") + ": " + t(getTheme() === "auto" ? "Auto" : getTheme() === "dark" ? "Dark" : "Light")} onClick={() => { const c = getTheme(); applyTheme(c === "auto" ? "light" : c === "light" ? "dark" : "auto"); setThemeTick((n) => n + 1); }}>{getTheme() === "auto" ? "🌗" : getTheme() === "dark" ? "🌙" : "☀️"}</button>
            <button
              className="icon-button"
              aria-label="Refresh stock"
              disabled={loading || busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={19} />
            </button>
            {auth && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut size={16} /> {t("Sign out")}
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div className="stock-notice" role="status">
            <Check size={18} />
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="stock-error stock-error-toast" role="alert">
            <strong>{t("Something needs your attention")}</strong>
            <span>{error}</span>
            {auth && !session && (
              <button
                className="button secondary"
                onClick={() => void auth?.signinRedirect()}
              >
                {t("Sign in")}
              </button>
            )}
            <button className="toast-close" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
          </div>
        )}
        {view === "home" && session && !owner && (
          <MechanicHome disabled={busy} onFind={() => navigate("find")} onIn={() => openCounter("receive")} onOut={() => openCounter("give")} onJob={() => openWorkshop({ name: "new" })} />
        )}
        {view === "home" && !(session && !owner) && (
          <>
            <div className="workspace-intro">
              <p className="eyebrow">{t("YOUR WORKSHOP. UNDER CONTROL.")}</p>
              <h1>{t("What are we doing today?")}</h1>
              <p>{t("Pick what you want to do. New here? Follow the steps below.")} <button className="stock-link" onClick={() => setChooser(true)}>{t("Take the tour")}</button></p>
            </div>
            {owner && session && !startHidden && started && (() => {
              const steps = [
                { done: businessName !== "Workshop Suite" && businessName.trim() !== "", title: t("Add your business details"), sub: t("Name, address and phone for your bills."), go: () => openWorkshop({ name: "settings" }) },
                { done: items.length > 0, title: t("Add your first part"), sub: t("Take a photo of a part. Lifta reads the label."), go: () => openCounter("receive") },
                { done: started.jobs, title: t("Start your first job"), sub: t("One vehicle, its repairs, parts and labour."), go: () => openWorkshop({ name: "new" }) },
                { done: started.invoices, title: t("Make your first invoice"), sub: t("Open a job and press Create invoice."), go: () => openWorkshop({ name: "jobs" }) },
              ];
              const left = steps.filter((x) => !x.done).length;
              if (!left) return null;
              const next = steps.findIndex((x) => !x.done);
              return (
                <section className="start-card" aria-label="Get started">
                  <div className="start-head">
                    <div>
                      <p className="eyebrow">{t("GET STARTED")}</p>
                      <h2>{t("{done} of {total} done", { done: steps.length - left, total: steps.length })}</h2>
                    </div>
                    <button className="stock-link" onClick={() => { try { localStorage.setItem("lifta.start", "done"); } catch { /* private mode */ } setStartHidden(true); }}>{t("Hide")}</button>
                  </div>
                  <div className="start-bar" aria-hidden="true"><span style={{ width: ((steps.length - left) / steps.length) * 100 + "%" }} /></div>
                  <ol className="start-steps">
                    {steps.map((x, i) => (
                      <li key={x.title} className={x.done ? "done" : i === next ? "next" : ""}>
                        <span className="start-mark">{x.done ? <Check size={15} /> : i + 1}</span>
                        <span className="start-text"><strong>{x.title}</strong><small>{x.sub}</small></span>
                        {!x.done && <button className={"button small " + (i === next ? "primary" : "secondary")} disabled={!session || busy} onClick={x.go}>{i === next ? t("Do this") : t("Open")}</button>}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })()}
            {owner && session && <ReorderCard />}
            <p className="home-label">{t("WORKSHOP")}</p>
            <div className="counter-tiles">
              <button className="counter-tile job" disabled={!session || busy} onClick={() => openWorkshop({ name: "new" })}>
                <PlusCircle size={30} />
                <span>
                  <strong>{t("Start a job")}</strong>
                  <small>{t("A vehicle comes in for work")}</small>
                </span>
              </button>
              <button className="counter-tile bill" disabled={!session || busy} onClick={() => openWorkshop({ name: "invoices" })}>
                <FileText size={30} />
                <span>
                  <strong>{t("Invoices")}</strong>
                  <small>{t("Open a bill or take a payment")}</small>
                </span>
              </button>
            </div>
            <p className="home-label">{t("STOCK")}</p>
            <div className="counter-tiles">
              <button
                className="counter-tile receive"
                disabled={!session || busy}
                onClick={() => openCounter("receive")}
              >
                <ArrowDownLeft size={30} />
                <span>
                  <strong>{t("Part came in")}</strong>
                  <small>{t("Scan or photo what came in")}</small>
                </span>
              </button>
              <button
                className="counter-tile give"
                disabled={!session || busy}
                onClick={() => openCounter("give")}
              >
                <ArrowUpRight size={30} />
                <span>
                  <strong>{t("Part went out")}</strong>
                  <small>{t("Scan the part and confirm the quantity")}</small>
                </span>
              </button>
            </div>
            <div className="task-tiles">
              <button
                className="task-tile"
                disabled={!session || busy}
                onClick={() => navigate("find")}
              >
                <span className="tile-icon">
                  <Search />
                </span>
                <h2>{t("Find a part")}</h2>
                <p>{t("Look up a part, photo or shelf.")}</p>
                <span className="tile-bottom">
                  {t("Search stock")} <ArrowRight size={20} />
                </span>
              </button>
              <button
                className="task-tile"
                disabled={!session || busy}
                onClick={() => navigate("count")}
              >
                <span className="tile-icon">
                  <ClipboardCheck />
                </span>
                <h2>{t("Count stock")}</h2>
                <p>{t("Compare a physical count with your records.")}</p>
                <span className="tile-bottom">
                  {t("Check a quantity")} <ArrowRight size={20} />
                </span>
              </button>
            </div>
            {(tasks.IN.lines.length > 0 || tasks.OUT.lines.length > 0) && (
              <section className="resume-section">
                <h3>{t("Continue where you left off")}</h3>
                {(["IN", "OUT"] as const)
                  .filter((d) => tasks[d].lines.length > 0)
                  .map((d) => (
                    <button
                      className="resume-row"
                      key={d}
                      onClick={() => navigate(d === "IN" ? "receive" : "issue")}
                    >
                      <span>
                        {d === "IN" ? "Receipt" : "Stock-out"} ·{" "}
                        {tasks[d].lines.length} lines
                      </span>
                      <span>
                        {tasks[d].lines.every(complete)
                          ? "Completed"
                          : "Continue draft"}{" "}
                        <ArrowRight size={18} />
                      </span>
                    </button>
                  ))}
              </section>
            )}
            <div className="workspace-overview">
              <span>
                <b>{items.length}</b> catalogue items
              </span>
              <span>
                <b>
                  {
                    items.filter(
                      (p) => Number(p.quantity) <= Number(p.reorder_level),
                    ).length
                  }
                </b>{" "}
                low-stock items
              </span>
            </div>
          </>
        )}
        {(inTask || view === "find") && (
          <>
            <button
              className="back-link"
              disabled={busy}
              onClick={() => navigate("home")}
            >
              <ArrowLeft size={17} /> Home
            </button>
            <div className="stock-title">
              <div>
                <p className="eyebrow">
                  {inTask
                    ? "SCAN → REVIEW → CONFIRM"
                    : "LOOK UP YOUR CATALOGUE"}
                </p>
                <h1>
                  {view === "find"
                    ? "Find an item"
                    : direction === "IN"
                      ? "Receive stock"
                      : "Take stock out"}
                </h1>
                <p>
                  {view === "find"
                    ? "Search by part number, scan a QR or identify a photo."
                    : "Build your list first. Stock changes only when you confirm."}
                </p>
              </div>
              {inTask && (
                <span
                  className={
                    "direction-badge " + (direction === "IN" ? "in" : "out")
                  }
                >
                  {direction === "IN" ? <ArrowDownLeft /> : <ArrowUpRight />}
                  {direction === "IN" ? "RECEIVING STOCK" : "TAKING STOCK OUT"}
                </span>
              )}
            </div>
            <div className={"workflow-grid " + (!inTask ? "lookup-only" : "")}>
              <section className="stock-panel scan-panel">
                <div className="section-heading">
                  <h2>{active ? "Check this item" : "Identify an item"}</h2>
                  {active && (
                    <button
                      className="stock-link"
                      disabled={busy}
                      onClick={resetIdentification}
                    >
                      Change item
                    </button>
                  )}
                </div>
                {!active && (
                  <>
                    {view === "find" && (
                      <>
                        <div className="find-bar">
                          <label className="search-box">
                            <Search size={19} />
                            <input aria-label="Search catalogue" autoFocus={typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches} disabled={busy} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Name, part number or shelf")} />
                          </label>
                          <button type="button" className="button primary find-scan" disabled={busy} onClick={() => setScanner(true)} aria-label="Scan QR label"><ScanLine size={20} /> <span>{t("Scan")}</span></button>
                          <button type="button" className="button secondary find-scan" disabled={busy} onClick={() => { markNativePick(); file.current?.click(); }} aria-label="Identify from photo"><Camera size={20} /> <span>{t("Photo")}</span></button>
                        </div>
                        <details className="find-paste">
                          <summary>{t("Barcode scanner or paste code")}</summary>
                          <form onSubmit={(e) => { e.preventDefault(); chooseQR(qr); }}>
                            <input aria-label="QR value" value={qr} onChange={(e) => setQr(e.target.value)} placeholder="Scan or paste product QR" />
                            <button className="button secondary" disabled={!qr || busy}>Find</button>
                          </form>
                        </details>
                      </>
                    )}
                    {view !== "find" && (
                      <>
                    <button
                      className="scan-launch"
                      disabled={busy || allComplete || locked}
                      onClick={() => setScanner(true)}
                    >
                      <ScanLine size={32} />
                      <span>
                        <strong>Scan QR label</strong>
                        <small>Use your phone camera</small>
                      </span>
                      <ArrowRight />
                    </button>
                    <div className="scan-alternatives">
                      <button
                        className="button secondary"
                        disabled={busy || allComplete || locked}
                        onClick={() => { markNativePick(); file.current?.click(); }}
                      >
                        <Camera size={18} /> Identify from photo
                      </button>
                      <details>
                        <summary>QR scanner / paste code</summary>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            chooseQR(qr);
                          }}
                        >
                          <input
                            aria-label="QR value"
                            value={qr}
                            onChange={(e) => setQr(e.target.value)}
                            placeholder="Scan or paste product QR"
                          />
                          <button
                            className="button secondary"
                            disabled={!qr || busy}
                          >
                            Find
                          </button>
                        </form>
                      </details>
                    </div>
                    <div className="search-box">
                      <Search size={19} />
                      <input
                        aria-label="Search catalogue"
                        disabled={busy || allComplete || locked}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name or manufacturer part number"
                      />
                    </div>
                      </>
                    )}
                    {busy && (
                      <p role="status" className="stock-help">
                        Checking the item…
                      </p>
                    )}
                    {preview && (
                      <img
                        className="identification-photo"
                        src={preview}
                        alt="Photo being identified"
                      />
                    )}
                    {match && !busy && (
                      <div className="match-results">
                        <h3>
                          {match.candidates.length
                            ? "Could it be one of these?"
                            : "No reliable photo match"}
                        </h3>
                        <p className="stock-help">
                          Check the manufacturer part number and specification.
                        </p>
                        {match.candidates.map((c) => {
                          const p = items.find((i) => i.id === c.product.id)!;
                          return (
                            <button
                              className="lookup-row"
                              key={p.id}
                              onClick={() => setSelected(p.id)}
                            >
                              <Photo id={c.imageId} />
                              <span>
                                <strong>{p.name}</strong>
                                <small>
                                  {p.brand} · Part no. {p.part_number || "Not set"} · System no. {p.sku}
                                </small>
                              </span>
                              <ArrowRight size={18} />
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {search && (
                      <div className="lookup-results">
                        {showResults(filtered(items, search))}
                        {filtered(items, search).length === 0 && (
                          <p className="stock-help">
                            No item found. Check the part number or register it
                            below.
                          </p>
                        )}
                        {filtered(items, search).length > 30 && (
                          <p className="stock-help">
                            Type more to narrow these results.
                          </p>
                        )}
                      </div>
                    )}
                    {view === "find" && !search && !match && !busy && (
                      <>
                        {lowItems.length > 0 && (<><h3 className="find-h">{t("Running low")} <small>{lowItems.length}</small></h3><div className="lookup-results">{showResults(lowItems.slice(0, 5))}</div></>)}
                        {recentItems.length > 0 && (<><h3 className="find-h">{t("Recent")}</h3><div className="lookup-results">{showResults(recentItems)}</div></>)}
                        {!lowItems.length && !recentItems.length && <p className="stock-help">{t("Type a name, part number or shelf. Or scan the QR label.")}</p>}
                      </>
                    )}
                    {view !== "find" && !search && !match && (
                      <p className="stock-help">
                        A QR is the quickest way. No QR? Use a photo or search
                        above.
                      </p>
                    )}
                    {(!inTask || direction === "IN") &&
                      !locked &&
                      !allComplete && (view !== "find" || (search.trim() !== "" && filtered(items, search).length === 0)) && (
                        <div className="new-item-prompt">
                          <span>Not in your catalogue?</span>
                          <div>
                            {imageId && status?.bedrockConfigured && (
                              <button
                                className="stock-link"
                                disabled={busy}
                                onClick={() => void readLabel()}
                              >
                                Suggest details from label
                              </button>
                            )}
                            <button
                              className="stock-link"
                              disabled={busy}
                              onClick={() => {
                                if (view === "find" && search.trim()) {
                                  // Carry what was typed into the new item form.
                                  fromCounter.current = true; setImageId("");
                                  setDraft({ id: "barcode-typed", image_id: "", fields: {}, suggestions: { name: search.trim() }, labelSuggestions: {}, source: "barcode" } as unknown as Draft);
                                } else setDraft(null);
                                setNewItem(true);
                              }}
                            >
                              <Plus size={16} /> Register new item
                            </button>
                          </div>
                        </div>
                      )}
                  </>
                )}
                {active && (
                  <>
                    <div className="identified-item">
                      <ItemPhoto item={active} />
                      <div>
                        <span className="identified-tag">
                          <Check size={14} /> ITEM IDENTIFIED
                        </span>
                        <h2>{active.name}</h2>
                        <p>
                          {active.brand} ·{" "}
                          <strong>Part no. {active.part_number || "Not set"}</strong>
                          <small>System no. {active.sku}</small>
                        </p>
                        <p>
                          {active.grade} {active.capacity}
                        </p>
                        <span className="shelf-chip">
                          {active.location || "Shelf not set"}
                        </span>
                      </div>
                    </div>
                    <div className="available-stock">
                      <span>Available now</span>
                      <b>
                        {number(active.quantity)}{" "}
                        <small>
                          {active.unit === "LITRE" ? "litres" : "units"}
                        </small>
                      </b>
                    </div>
                    {inTask ? (
                      <>
                        <label
                          className="stock-field quantity-label"
                          htmlFor="movement-quantity"
                        >
                          {direction === "IN"
                            ? "How many arrived?"
                            : "How many are leaving?"}
                        </label>
                        <div className="quantity-control">
                          <button
                            aria-label="Decrease quantity"
                            disabled={busy || quantity <= 1}
                            onClick={() =>
                              setQuantity(
                                Math.max(
                                  active.unit === "UNIT" ? 1 : 0.001,
                                  quantity - 1,
                                ),
                              )
                            }
                          >
                            −
                          </button>
                          <input
                            id="movement-quantity"
                            type="number"
                            min={active.unit === "UNIT" ? 1 : 0.001}
                            step={active.unit === "UNIT" ? 1 : 0.001}
                            value={quantity}
                            disabled={busy}
                            onChange={(e) =>
                              setQuantity(Number(e.target.value))
                            }
                          />
                          <button
                            aria-label="Increase quantity"
                            disabled={busy}
                            onClick={() => setQuantity(quantity + 1)}
                          >
                            +
                          </button>
                        </div>
                        {direction === "OUT" &&
                          quantity + plannedOut(task.lines, active.id) >
                            Number(active.quantity) && (
                            <p className="stock-error">
                              Not enough stock for this draft.
                            </p>
                          )}
                        {imageId && (
                          <label className="stock-check">
                            <input
                              type="checkbox"
                              checked={saveReference}
                              onChange={(e) =>
                                setSaveReference(e.target.checked)
                              }
                            />{" "}
                            Save this verified photo for future identification
                          </label>
                        )}
                        <button
                          className="button primary full large"
                          disabled={
                            busy ||
                            allComplete ||
                            locked ||
                            !validQuantity(quantity, active.unit) ||
                            (direction === "OUT" &&
                              quantity + plannedOut(task.lines, active.id) >
                                Number(active.quantity))
                          }
                          onClick={addLine}
                        >
                          <Plus size={19} /> Add to{" "}
                          {direction === "IN" ? "receipt" : "stock-out list"}
                        </button>
                        <p className="stock-help">
                          You will review the full list before stock changes.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="stock-form-actions">
                          <button
                            className="button primary"
                            onClick={() => {
                              openCounter("receive", active);
                            }}
                          >
                            Receive this item
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => {
                              openCounter("give", active);
                            }}
                          >
                            Give this item
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => { setCountId(active.id); navigate("count"); }}
                          >
                            {t("Count this item")}
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => setLabelItem(active)}
                          >
                            <Printer size={17} /> QR label
                          </button>
                        </div>
                        <button
                          className="button secondary full"
                          disabled={busy}
                          onClick={() => {
                            photoTarget.current = active.id;
                            markNativePick();
                            file.current?.click();
                          }}
                        >
                          <Camera size={18} /> Add a reference photo
                        </button>
                        {imageId && (
                          <button
                            className="stock-link"
                            disabled={busy}
                            onClick={() => void reference()}
                          >
                            Save verified reference photo only
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const photo = e.target.files?.[0];
                    if (photo) void analyse(photo);
                    e.target.value = "";
                  }}
                />
              </section>
              {inTask && (
                <section className="stock-panel draft-panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {allComplete
                          ? "COMPLETED"
                          : locked
                            ? "RECORDING STATUS"
                            : "NOT YET RECORDED"}
                      </p>
                      <h2>
                        {direction === "IN"
                          ? "Your receipt"
                          : "Your stock-out list"}
                      </h2>
                    </div>
                    <span className="counter">{task.lines.length}</span>
                  </div>
                  {!task.lines.length ? (
                    <div className="draft-empty">
                      <ListChecks size={40} />
                      <h3>Your list starts here</h3>
                      <p>
                        Scan an item, check the quantity,
                        <br />
                        and add it to this list.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="draft-lines">
                        {task.lines.map((line) => (
                          <article
                            className={
                              "draft-line " +
                              (complete(line) ? "line-done" : "")
                            }
                            key={line.id}
                          >
                            <div>
                              <strong>{line.name}</strong>
                              <small>{line.part}</small>
                              <span
                                className={
                                  "line-status " +
                                  (complete(line) ? "success" : "")
                                }
                              >
                                {complete(line)
                                  ? "✓ Recorded"
                                  : line.movementId
                                    ? "Stock recorded · finishing review"
                                    : line.rejected
                                      ? "Rejected · remove this line to correct it"
                                      : line.attempted
                                        ? "Needs retry · quantity locked"
                                        : "Draft · stock unchanged"}
                              </span>
                              {line.error && (
                                <p className="stock-error">{line.error}</p>
                              )}
                            </div>
                            <b>
                              {number(line.quantity)}
                              <small>
                                {line.unit === "LITRE" ? "L" : "units"}
                              </small>
                            </b>
                            {(!locked || line.rejected) && (
                              <button
                                className="icon-button"
                                aria-label={"Remove " + line.name}
                                onClick={() =>
                                  persist({
                                    ...taskRef.current,
                                    [direction]: {
                                      ...taskRef.current[direction],
                                      lines: taskRef.current[
                                        direction
                                      ].lines.filter((l) => l.id !== line.id),
                                    },
                                  })
                                }
                              >
                                <X size={17} />
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                      <div className="draft-confirm">
                        <p>
                          {allComplete
                            ? "All items recorded. Your stock is up to date."
                            : locked
                              ? "Retry keeps the same command IDs and skips recorded movements."
                              : "Check each item and quantity. Confirming records these movements."}
                        </p>
                        {!allComplete && (
                          <button
                            className={
                              "button primary full large " +
                              (direction === "OUT" ? "out-button" : "")
                            }
                            disabled={busy || !session}
                            onClick={() => void commit()}
                          >
                            <Check size={20} />
                            {busy
                              ? "Recording…"
                              : locked
                                ? "Retry unfinished lines"
                                : direction === "IN"
                                  ? "Confirm receipt"
                                  : "Confirm stock-out"}
                          </button>
                        )}
                        <button
                          className="stock-link full"
                          disabled={busy}
                          onClick={discard}
                        >
                          {allComplete
                            ? "Start a new " +
                              (direction === "IN" ? "receipt" : "stock-out")
                            : locked
                              ? "Start a new task after resolving lines"
                              : "Clear draft"}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>
          </>
        )}
        {view === "stock" && (
          <>
            <div className="stock-title">
              <div>
                <p className="eyebrow">CATALOGUE & SHELVES</p>
                <h1>Parts list</h1>
                <p>
                  Find exact parts. Keep their labels and shelf details
                  together.
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => {
                  resetIdentification();
                  setNewItem(true);
                }}
              >
                <Plus size={18} /> Register item
              </button>
            </div>
            <section className="stock-panel">
              <div className="stock-tools">
                <div className="search-box">
                  <Search size={19} />
                  <input
                    aria-label="Search stock"
                    placeholder="Name, part number or shelf"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <label className="stock-check">
                  <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> {t("Low stock only")}
                </label>
                {owner && (
                  <label className="stock-check">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        setShowArchived(checked);
                        if (checked)
                          try {
                            setArchived(
                              await api<Item[]>(
                                "/api/inventory/products/archived",
                              ),
                            );
                          } catch (x) {
                            setError((x as Error).message);
                          }
                      }}
                    />{" "}
                    Archived items
                  </label>
                )}
              </div>
              <div className="catalogue-list">
                {filtered(showArchived ? archived : items, query).map((p) => (
                  <article className="catalogue-row" key={p.id}>
                    <ItemPhoto item={p} />
                    <div className="catalogue-description">
                      <strong>{p.name}</strong>
                      <small>
                        {p.brand} · Part no. {p.part_number || "Not set"} · System no. {p.sku}
                      </small>
                      <span className="cat-chip">
                        {p.category} · {p.location || "Shelf not set"}
                      </span>
                    </div>
                    <div className="catalogue-quantity">
                      <span className="cq-line">
                        <b>{number(p.quantity)}</b>
                        <small>{p.unit === "LITRE" ? "litres" : "units"}</small>
                        {Number(p.quantity) <= Number(p.reorder_level) &&
                          !p.archived && (
                            <span className="low-stock">Low stock</span>
                          )}
                      </span>
                      <i className="stock-bar" aria-hidden="true">
                        <u
                          className={Number(p.quantity) <= Number(p.reorder_level) ? "low" : ""}
                          style={{ width: Math.max(4, Math.min(100, (Number(p.quantity) / Math.max(1, Number(p.reorder_level) * 4)) * 100)) + "%" }}
                        />
                      </i>
                    </div>
                    <div className="stock-row-actions">
                      <button onClick={() => setLabelItem(p)}>
                        <Printer size={16} /> QR label
                      </button>
                      {!p.archived && (
                        <button
                          onClick={() => {
                            navigate("find");
                            setSelected(p.id);
                          }}
                        >
                          View item
                        </button>
                      )}
                      {owner && (
                        <details>
                          <summary aria-label={"Actions for " + p.name}>
                            More
                          </summary>
                          <button onClick={() => setEdit(p)}>
                            Edit details
                          </button>
                          <button onClick={() => void archive(p, !p.archived)}>
                            {p.archived ? "Restore item" : "Archive item"}
                          </button>
                        </details>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {filtered(showArchived ? archived : items, query).length ===
                0 && (
                <div className="stock-empty">
                  <Package size={38} />
                  <h3>
                    {query
                      ? t("No matching items")
                      : t("No parts yet")}
                  </h3>
                  <p>
                    {query
                      ? t("Try the manufacturer part number.")
                      : t("This is the list of every part you keep. Go to the Parts counter, take a photo of a part and Lifta reads the label. Then print its QR label.")}
                  </p>
                </div>
              )}
            </section>
          </>
        )}
        {view === "count" && (
          <>
            <button className="back-link" onClick={() => navigate("home")}>
              <ArrowLeft size={17} /> Home
            </button>
            <div className="stock-title">
              <div>
                <p className="eyebrow">{t("PHYSICAL STOCK CHECK")}</p>
                <h1>{t("Count stock")}</h1>
                <p>{t("Compare what is on the shelf with the recorded quantity.")}</p>
              </div>
            </div>
            <CountStock items={items} countId={countId} setCountId={setCountId} find={(q) => filtered(items, q)} openScanner={() => setScanner(true)}
              owner={owner} photo={(p) => <ItemPhoto item={p as Item} />} onChanged={() => void refresh()} />
          </>
        )}
        {view === "analysis" && owner && <StockReport />}
        {view === "workshop" && session && <Workshop key={wsStart.n} owner={owner} start={wsStart.page} />}
        {view === "counter" && session && (
          <Counter
            key={counterKey}
            items={items}
            moves={moves}
            photo={(p) => <ItemPhoto item={p} />}
            initialMode={counterMode}
            picked={counterPick}
            onNewItem={newItemFromCounter}
            onBarcodeSuggestion={newItemFromBarcode}
            onChanged={() => void refresh()}
          />
        )}
        {view === "activity" && (
          <>
            <div className="stock-title">
              <div>
                <p className="eyebrow">CONFIRMED MOVEMENTS</p>
                <h1>Stock activity</h1>
                <p>
                  A clear history of what changed, when and who recorded it.
                  Asia/Colombo.
                </p>
              </div>
            </div>
            <section className="activity-filters" aria-label="Activity filters">
              <label className="stock-field">
                Search activity
                <input value={activitySearch} placeholder="Part, number or email" onChange={(event) => setActivitySearch(event.target.value)} />
              </label>
              <label className="stock-field">
                Movement
                <select value={activityKind} onChange={(event) => setActivityKind(event.target.value)}>
                  <option value="ALL">All movements</option>
                  <option value="IN">In</option>
                  <option value="OUT">Out</option>
                </select>
              </label>
              <button className="button secondary small" onClick={() => { setActivitySearch(""); setActivityKind("ALL"); setActivityRange(ALL); }}>Clear filters</button>
            </section>
            <DateChips value={activityRange} onChange={setActivityRange} />
            <SummaryBar text={"Movements: " + visibleMoves.length} file="stock-history"
              rows={visibleMoves.map((m) => ({ Time: when(m.created_at), Item: m.name, SKU: m.sku, Direction: movementDirection(m.kind), Movement: m.kind, Quantity: m.quantity, "Recorded by": actorEmail(m.actor) }))} />
            <section className="stock-panel stock-table-wrap">
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Item</th>
                    <th>In / Out</th>
                    <th>Movement</th>
                    <th>Quantity</th>
                    <th>Recorded by email</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMoves.map((m) => (
                    <tr key={m.id}>
                      <td>{when(m.created_at)}</td>
                      <td>
                        <strong>{m.name}</strong>
                        <small>{m.sku}</small>
                      </td>
                      <td>
                        <span
                          className={
                            "direction-badge " +
                            (movementDirection(m.kind) === "OUT" ? "out" : "in")
                          }
                        >
                          {movementDirection(m.kind)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            "movement-chip " +
                            (["STOCK_OUT", "ISSUE", "COUNT_OUT"].includes(m.kind)
                              ? "out"
                              : "in")
                          }
                        >
                          {m.kind === "COUNT_IN" ? t("Count: found extra") : m.kind === "COUNT_OUT" ? t("Count: found missing") : m.kind === "STOCK_OUT" || m.kind === "ISSUE"
                            ? m.kind === "ISSUE"
                              ? "Issued to workshop"
                              : "Given out"
                            : m.kind === "RECEIPT" || m.kind === "OPENING"
                              ? "Received"
                              : m.kind === "RETURN"
                                ? "Returned from job"
                                : m.kind}
                        </span>
                      </td>
                      <td>{number(m.quantity)}</td>
                      <td>
                        <strong>{actorEmail(m.actor)}</strong>
                        <small>
                          {m.actor?.includes("@")
                            ? "Authenticated operator"
                            : "Email was not supplied by the identity provider"}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleMoves.length && (
                <div className="stock-empty"><h3>No history yet</h3><p>Every part you receive or give out will be listed here, with who did it and when.</p></div>
              )}
            </section>
          </>
        )}
      </main>
      {scanner && (
        <React.Suspense
          fallback={
            <div className="stock-notice" role="status">
              Opening camera…
            </div>
          }
        >
          <Scanner onScan={chooseQR} onClose={() => setScanner(false)} />
        </React.Suspense>
      )}
      {(newItem || edit) && (
        <ProductEditor
          item={edit}
          draft={draft}
          aiNote={edit ? "" : aiNote}
          imageId={edit?.image_id || imageId}
          inTask={(inTask || fromCounter.current) && !edit}
          products={items}
          onClose={() => {
            setNewItem(false);
            setEdit(null);
            fromCounter.current = false;
          }}
          onAddedAnother={async (message) => { tell(message); await refresh(); }}
          onSaved={async (p, message) => {
            const wasEdit = !!edit;
            setNewItem(false);
            setEdit(null);
            setDraft(null);
            tell(message);
            await refresh();
            if (p && !wasEdit && fromCounter.current) {
              fromCounter.current = false;
              setCounterPick(p);
              setLabelItem(p);
              return;
            }
            if (p && !wasEdit) {
              setLabelItem(p);
              if (inTask) {
                setSelected(p.id);
                setQuantity(1);
              } else {
                setView("find");
                setSelected(p.id);
              }
            }
          }}
        />
      )}
      {labelItem && (
        <LabelDialog item={labelItem} onClose={() => setLabelItem(null)} />
      )}
    </div>
  );
}
function ItemPhoto({ item }: { item: Item }) {
  return item.image_id ? (
    <Photo id={item.image_id} />
  ) : (
    <span className="photo-placeholder">
      <Package size={28} />
    </span>
  );
}
function LabelDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [data, setData] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL("stocklane:v1:" + item.id, { width: 360, margin: 3 })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => setError("QR generation failed. Reopen Print QR to retry."));
    return () => {
      active = false;
    };
  }, [item.id]);
  return (
    <div className="stock-modal-shade">
      <section
        className="stock-modal stock-label-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Printable QR label"
      >
        <button
          className="stock-close"
          aria-label="Close label"
          onClick={onClose}
        >
          <X />
        </button>
        <h2>Product QR label</h2>
        <p>Print and attach this label to the item or its storage bin.</p>
        {data && (
          <img
            className="stock-qr-preview"
            src={data}
            alt="Generated Lifta product QR"
          />
        )}
        <h3>{item.name}</h3>
        <p>
          {item.brand} · Part no. {item.part_number || "Not set"} · System no. {item.sku}
          <br />
          {item.location}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="stock-form-actions">
          <a
            className="button secondary"
            href={data}
            download={item.sku + "-qr.png"}
          >
            Download PNG
          </a>
          <button
            className="button primary"
            disabled={!data}
            onClick={() =>
              void printLabel(item).catch((e) => setError(e.message))
            }
          >
            <Printer size={18} /> Print / Save PDF
          </button>
        </div>
      </section>
    </div>
  );
}
function ProductEditor({
  item,
  draft,
  aiNote = "",
  imageId,
  inTask = false,
  products,
  onClose,
  onSaved,
  onAddedAnother,
}: {
  onAddedAnother?: (message: string) => void | Promise<void>;
  item: Item | null;
  draft: Draft | null;
  aiNote?: string;
  imageId: string;
  inTask?: boolean;
  products: Item[];
  onClose: () => void;
  onSaved: (p: Item | null, message: string) => void;
}) {
  const d = draft?.fields || {};
  const [suggested] = useState(() =>
    item ? {} : suggestFields(
      d as Partial<Record<Field, string>>,
      { ...(draft?.suggestions || {}), ...(draft?.labelSuggestions || {}) } as Partial<Record<Field, string>>,
      products,
    ),
  );
  // Where a suggestion came from: the AI, the label text read directly, or the shop's own history.
  const sourceOf = (field: Field): "ai" | "label" | "history" => {
    const s = suggested[field];
    if (!s) return "history";
    if (draft?.labelSuggestions?.[field] === s.value) return "label";
    if (draft?.suggestions?.[field] === s.value) return "ai";
    return field === "name" && s.why === "built from the label" ? "label" : "history";
  };
  const FILLABLE: Field[] = ["name", "brand", "partNumber", "category", "grade", "capacity"];
  const prefillOk = (f: Field) => !item && FILLABLE.includes(f) && !!suggested[f] && sourceOf(f) !== "history";
  const pre = (f: Field) => (prefillOk(f) ? suggested[f]!.value : "");
  const [name, setName] = useState(item?.name || pre("name")),
    [brand, setBrand] = useState(item?.brand || pre("brand")),
    [part, setPart] = useState(item?.part_number || pre("partNumber")),
    [category, setCategory] = useState(item?.category || pre("category")),
    [spec, setSpec] = useState(item?.grade || pre("grade")),
    [size, setSize] = useState(item?.capacity || pre("capacity")),
    [location, setLocation] = useState(item?.location || ""),
    [quantity, setQuantity] = useState(0),
    [unit, setUnit] = useState(item?.unit || "UNIT"),
    [reorder, setReorder] = useState(item ? Number(item.reorder_level) : getDefaultReorder()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  // Fields still showing a value the AI or the label filled in; editing or clearing one removes its badge.
  const [filled, setFilled] = useState<Partial<Record<Field, "ai" | "label">>>(() =>
    Object.fromEntries(FILLABLE.filter(prefillOk).map((f) => [f, sourceOf(f) as "ai" | "label"])),
  );
  const [moreOpen, setMoreOpen] = useState(() => !!(pre("grade") || pre("capacity")));
  const sku = useRef("ITEM-" + uid().slice(0, 8).toUpperCase());
  const command = useCommand();
  // A photo can be added while registering: it is stored now and attached to the new item on save.
  const [photoId, setPhotoId] = useState(imageId), [photoBusy, setPhotoBusy] = useState(false), [savedNote, setSavedNote] = useState("");
  const addAnother = useRef(false), formEl = useRef<HTMLFormElement>(null);
  const pickPhoto = async (f?: File) => {
    if (!f) return;
    setPhotoBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", await shrink(f));
      const found = await api<Match>("/api/vision/match", { method: "POST", body: form });
      setPhotoId(found.imageId);
    } catch (x) { setError((x as Error).message); }
    finally { setPhotoBusy(false); }
  };
  const fieldState: Record<Field, [string, (v: string) => void]> = {
    name: [name, setName], brand: [brand, setBrand], partNumber: [part, setPart], category: [category, setCategory],
    grade: [spec, setSpec], capacity: [size, setSize], location: [location, setLocation], unit: [unit, setUnit],
  };
  const edit = (field: Field, value: string) => {
    fieldState[field][1](value);
    setFilled((f) => { if (!f[field]) return f; const next = { ...f }; delete next[field]; return next; });
  };
  const clearAll = () => { (Object.keys(filled) as Field[]).forEach((f) => fieldState[f][1]("")); setFilled({}); };
  const nAi = Object.values(filled).filter((x) => x === "ai").length;
  const nLabel = Object.values(filled).filter((x) => x === "label").length;
  const open = (Object.entries(suggested) as [Field, Suggestion][]).filter(
    ([field, s]) => !prefillOk(field) && field !== "unit" && fieldState[field][0] !== s.value && !fieldState[field][0].trim(),
  );
  const hint = (field: Field) => {
    if (field === "unit") {
      const u = suggested.unit;
      if (!u) return null;
      const label = u.value === "LITRE" ? t("Measured litres") : t("Piece / sealed unit / defined set");
      if (unit !== u.value)
        return <span className="field-suggestion">{sourceOf("unit") === "ai" ? t("AI suggests") : t("Suggested")}: <b>{label}</b> <button type="button" onClick={() => setUnit(u.value)}>{t("Use")}</button></span>;
      return sourceOf("unit") === "ai" ? <span className="field-suggestion muted">{t("AI agrees")}: {label}</span> : null;
    }
    const s = open.find(([f]) => f === field)?.[1];
    return s ? (
      <span className="field-suggestion">
        {t("Suggested")}: <b>{s.value}</b> <button type="button" onClick={() => fieldState[field][1](s.value)}>{t("Use")}</button>
      </span>
    ) : null;
  };
  const badge = (field: Field) => filled[field] ? (
    <>
      <span className={"fill-badge " + filled[field]}>{filled[field] === "ai" ? "AI" : t("Label")}</span>
      <button type="button" className="fill-clear" aria-label={t("Clear")} onClick={() => edit(field, "")}>×</button>
    </>
  ) : null;
  const modelName = prettyModel(draft?.ai);
  let banner = "", bannerKind = "";
  if (!item && draft) {
    if (draft.ai?.status === "used") {
      bannerKind = "used";
      banner = nAi && nLabel ? t("AI filled the blue fields ({model}). The green ones are read straight from the label. Please check them.", { model: modelName })
        : nAi ? t("AI filled the blue fields ({model}). Please check them.", { model: modelName })
        : nLabel ? t("Filled from the label text (green). Please check them.")
        : t("Nothing could be read from this photo. Type the details from the label.");
    } else {
      banner = (aiNote ? aiNote + " " : "") + (nLabel ? t("Filled from the label text (green). Please check them.") : t("Nothing could be read from this photo. Type the details from the label."));
    }
  }
  const duplicate = products.find(
    (p) =>
      p.id !== item?.id &&
      part.trim() &&
      p.brand.trim().toLowerCase() === brand.trim().toLowerCase() &&
      p.part_number?.trim().toLowerCase() === part.trim().toLowerCase(),
  );
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (duplicate) {
      setError(
        "This manufacturer and part number already exist. Use the existing product.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = {
        name,
        brand,
        category,
        grade: spec,
        capacity: size,
        partNumber: part,
        location,
        reorderLevel: reorder,
      };
      let result: Item;
      if (item)
        result = await command<Item>(
          "/api/inventory/products/" + item.id,
          data,
          "PATCH",
        );
      else
        result = await command<Item>("/api/inventory/products", {
          ...data,
          sku: sku.current,
          barcode: null,
          unit,
          openingQuantity: quantity,
          sellingPrice: 0,
          imageId: photoId || null,
        });
      let message = item
        ? "Catalogue updated. QR identity and stock history retained."
        : inTask
          ? "Item registered with zero stock. Add its quantity to your receipt."
          : "Item registered. Print its QR label to start scanning.";
      if (!item && draft && draft.source !== "barcode") {
        try {
          await api("/api/vision/drafts/" + draft.id, {
            method: "PATCH",
            body: JSON.stringify({ status: "APPROVED", productId: result.id }),
          });
        } catch {
          message +=
            " AI draft resolution is pending; stock was already recorded.";
        }
      }
      if (addAnother.current && !item && !draft && !inTask && onAddedAnother) {
        // Keep the form open for the next part: the shelf, brand, category and unit usually stay the same.
        addAnother.current = false;
        await onAddedAnother(message);
        setSavedNote(t("Saved {name}. Add the next one.", { name: result.name }));
        setName(""); setPart(""); setQuantity(0); setPhotoId(""); setSpec(""); setSize("");
        sku.current = "ITEM-" + uid().slice(0, 8).toUpperCase();
        setTimeout(() => (formEl.current?.querySelector("input:not([type=file])") as HTMLInputElement | null)?.focus(), 30);
        return;
      }
      onSaved(result, message);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      addAnother.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="stock-modal-shade">
      <section
        className="stock-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-title"
      >
        <button
          className="stock-close"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X />
        </button>
        <h2 id="product-title">
          {item ? "Edit catalogue item" : "Register a new item"}
        </h2>
        <p>
          {draft
            ? t("Check the filled fields, fix anything wrong, then save. Nothing is saved until you press Save item.")
            : "Use the visible manufacturer and part number where available."}
        </p>
        {photoId && <Photo id={photoId} zoom />}
        {!item && (
          <div className="reg-photo">
            <label className={"button secondary" + (photoBusy || busy ? " disabled" : "")}>
              <Camera size={18} /> {photoBusy ? t("Uploading…") : photoId ? t("Change photo") : t("Add photo")}
              <input type="file" accept="image/*" hidden disabled={photoBusy || busy} onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <small>{t("Optional. Helps Lifta recognise this part later.")}</small>
          </div>
        )}
        {savedNote && <p className="reg-saved" role="status"><Check size={16} /> {savedNote}</p>}
        {banner && (
          <div className={"ai-note" + (bannerKind ? " " + bannerKind : "")} role="status">
            <span>{banner}</span>
            {Object.keys(filled).length > 0 && <button type="button" className="stock-link" onClick={clearAll}>{t("Clear all")}</button>}
          </div>
        )}
        <form ref={formEl} onSubmit={(e) => void save(e)}>
          {inTask && (
            <p className="stock-help">
              Save the item first, then confirm how many came in.
            </p>
          )}
          <div className="stock-form-grid">
            {(
              [
                ["Item name", name, setName, true, "name"],
                ["Manufacturer / brand", brand, setBrand, true, "brand"],
                ["Actual manufacturer part number", part, setPart, true, "partNumber"],
                ["Category", category, setCategory, true, "category"],
                ["Shelf / location", location, setLocation, false, "location"],
              ] as const
            ).map(([label, value, , required, field]) => (
              <label className={"stock-field" + (filled[field] ? " filled-" + filled[field] : "")} key={label}>
                {t(label)}
                <span className="input-wrap"><input
                  required={required}
                  maxLength={
                    label === "Manufacturer / brand"
                      ? 100
                      : label === "Category"
                        ? 80
                        : 180
                  }
                  value={value}
                  list={field === "category" ? "category-options" : field === "brand" ? "brand-options" : undefined}
                  autoComplete={field === "category" || field === "brand" ? "off" : undefined}
                  onChange={(e) => edit(field, e.target.value)}
                />{badge(field)}</span>
                {hint(field)}
              </label>
            ))}
            <datalist id="category-options">
              {[...new Set(products.filter((p) => !p.archived).map((p) => (p.category || "").trim()).filter(Boolean))].sort().map((c) => <option key={c} value={c} />)}
            </datalist>
            <datalist id="brand-options">
              {[...new Set(products.filter((p) => !p.archived).map((p) => (p.brand || "").trim()).filter(Boolean))].sort().map((b) => <option key={b} value={b} />)}
            </datalist>
            {!item && (
              <>
                <label className="stock-field">
                  Counting unit
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  >
                    <option value="UNIT">
                      Piece / sealed unit / defined set
                    </option>
                    <option value="LITRE">Measured litres</option>
                  </select>
                  {hint("unit")}
                </label>
                {!inTask && (
                  <label className="stock-field">
                    Initial physical quantity
                    <input
                      type="number"
                      required
                      min={0}
                      step={unit === "LITRE" ? 0.001 : 1}
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                    />
                  </label>
                )}
              </>
            )}
            <details className="product-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>{t("More details")}</summary>
              <label className={"stock-field" + (filled.grade ? " filled-" + filled.grade : "")}>
                {t("Specification")}
                <span className="input-wrap"><input
                  maxLength={80}
                  value={spec}
                  onChange={(e) => edit("grade", e.target.value)}
                />{badge("grade")}</span>
                {hint("grade")}
              </label>
              <label className={"stock-field" + (filled.capacity ? " filled-" + filled.capacity : "")}>
                {t("Size / pack description")}
                <span className="input-wrap"><input
                  maxLength={60}
                  value={size}
                  onChange={(e) => edit("capacity", e.target.value)}
                />{badge("capacity")}</span>
                {hint("capacity")}
              </label>
              <label className="stock-field">
                Low-stock threshold
                <input
                  type="number"
                  min="0"
                  step={unit === "LITRE" ? 0.001 : 1}
                  required
                  value={reorder}
                  onChange={(e) => setReorder(Number(e.target.value))}
                />
              </label>
            </details>
          </div>
          {duplicate && (
            <p className="stock-error">
              Existing item: {duplicate.name}. Close this form and select it
              instead.
            </p>
          )}
          {error && (
            <p className="stock-error" role="alert">
              {error}
            </p>
          )}
          <div className="stock-form-actions sticky-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            {!item && !draft && !inTask && onAddedAnother && (
              <button className="button secondary" disabled={busy || !!duplicate} onClick={() => { addAnother.current = true; }}>
                {t("Save and add another")}
              </button>
            )}
            <button className="button primary" disabled={busy || !!duplicate}>
              {busy ? t("Saving…") : item ? "Save changes" : t("Save item")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

applyTheme(getTheme());
createRoot(document.getElementById("root")!).render(<><App /><ToastHost /></>);
