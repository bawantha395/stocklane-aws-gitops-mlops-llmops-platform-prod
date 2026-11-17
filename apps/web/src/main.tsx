import { Crash } from "./Crash";
import React, { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Track } from "./workshop/Track";
import { printerConnected } from "./workshop/printer";
import { Camera, Package, ArrowDownLeft, ArrowUpRight, Activity, Plus, Printer, Search, RefreshCw, LogOut, Check, X, ScanLine, Home, ArrowRight, ArrowLeft, ClipboardCheck, ListChecks, Truck, Wrench, Warehouse, Menu as MenuIcon, FileText, PlusCircle, X as CloseIcon, Compass, Settings2 } from "lucide-react";
import { api, ApiError, auth, openPdf, userEmail, shrink, signOut, type Match, type Draft, type Movement } from "./api";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./stock.css";
import "./glass.css";
import "./theme.css";
import "./tokens.css";
import { ToastHost, ConfirmHost, askConfirm, applyTheme, getTheme, toast } from "./ui";
import { setBusinessName, setDefaultReorder, useBusinessName } from "./businessName";
import { t, useLang, setLang, setSinhalaAllowed, useSinhalaAllowed } from "./i18n";
import { Walkthrough } from "./Walkthrough";
import { QuickMove } from "./QuickMove";
import { BatchIn } from "./BatchIn";
import { BatchOut } from "./BatchOut";
import { NumPadHost } from "./NumPad";
import { OfflineBar } from "./OfflineBar";
import { flush as flushOffline } from "./offline";
import { MechanicHome } from "./MechanicHome";
import { SetupWizard, setupDone } from "./SetupWizard";
import { usePractice, startPractice, probe } from "./practice";
import { PracticeCoach } from "./PracticeCoach";
import { Logo } from "./Logo";
import { BizLogo } from "./BizLogo";
import { SignIn, type SignInMode } from "./SignIn";
import type { Page as WsPage } from "./workshop/common";

document.documentElement.dataset.glass = "light";
const Scanner = React.lazy(() =>
  import("./Scanner").then((module) => ({ default: module.Scanner })),
);
import { StockReport, MovementPdf } from "./StockReport";
import { Orders } from "./Orders";
import { setModules, useModules } from "./modules";
import { BulkTools } from "./BulkTools";
import { StoreMap, SHELF_FOCUS } from "./StoreMap";
import { PriceReview } from "./Pricing";
import { Suppliers } from "./Suppliers";
import { Workshop } from "./workshop";
import { PlatformSection } from "./workshop/PlatformSection";
import { DateChips, SummaryBar, ALL, bounds, inRange, useSaved, type Range } from "./workshop/DateRange";
import "./brand.css";
import { CommandBar } from "./CommandBar";
import { CountStock } from "./CountStock";
import { ReorderCard } from "./ReorderCard";
import { Counter, type Mode as CounterMode } from "./Counter";
import { saveNav, loadNav, markNativePick, lostNativePick, clearNativePick } from "./resume";
import { dock } from "./dock";
import { emptyTask, complete, validQuantity, plannedOut, type Direction, type StockTask, type TaskLine } from "./task";

import { Item, uid, aiMessage, number, when, useCommand, Photo } from "./partsShared";
import { ItemPhoto, LabelDialog } from "./LabelDialog";
import { ProductEditor } from "./ProductEditor";
import { can, canAny, setPermissions } from "./perms";
type Session = { name: string; roles: string[]; permissions?: string[] };
type View =
  | "home"
  | "receive"
  | "issue"
  | "stock"
  | "find"
  | "count"
  | "analysis"
  | "suppliers"
  | "orders"
  | "prices"
  | "shelf"
  | "activity"
  | "counter"
  | "workshop";
function App() {
  const [view, setView] = useState<View>(() => (loadNav().view as View) || "home");
  const [counterMode, setCounterMode] = useState<CounterMode>(() => (loadNav().mode as CounterMode) || "receive");
  useEffect(() => { saveNav(view, counterMode); }, [view, counterMode]);
  const businessName = useBusinessName();
  const lang = useLang(), sinhalaOn = useSinhalaAllowed();
  const [, setThemeTick] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen(true); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const [tourOpen, setTourOpen] = useState(false);
  const [chooser, setChooser] = useState(false);
  const pr = usePractice();
  const prevPractice = useRef(false);
  const mods = useModules();
  const [dockHidden, setDockHidden] = useState(() => {
    try { return localStorage.getItem("lifta.dock") === "hidden"; } catch { return false; }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsNow, setWsNow] = useState("home");
  const [roomBatch, setRoomBatch] = useState(false), [roomBatchOut, setRoomBatchOut] = useState(false);
  const [intent, setIntent] = useState<"give" | "receive" | null>(null);
  const [quick, setQuick] = useState<{ part: Item; mode: "give" | "receive" } | null>(null);
  const [isDesk, setIsDesk] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 761px)").matches);
  // by default a computer has the store room (take out and put in by hand) and a phone has the parts counter (camera and QR); the owner can switch the other one on in Settings
  const roomOn = mods.storeRoom && (isDesk || mods.roomPhone), counterOn = mods.counter && (!isDesk || mods.counterWeb);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 761px)"), on = () => setIsDesk(mq.matches), page = (e: Event) => setWsNow(String((e as CustomEvent).detail || "home"));
    mq.addEventListener("change", on); window.addEventListener("lifta:ws-page", page);
    return () => { mq.removeEventListener("change", on); window.removeEventListener("lifta:ws-page", page); };
  }, []);
  const [wsStart, setWsStart] = useState<{ page: WsPage; n: number }>({ page: { name: "home" }, n: 0 });
  const [wizardGone, setWizardGone] = useState(false);
  const [started, setStarted] = useState<{ jobs: boolean; invoices: boolean } | null>(null);
  const [startHidden, setStartHidden] = useState(() => {
    try { return localStorage.getItem("lifta.start") === "done"; } catch { return false; }
  });
  const swipeY = useRef<number | null>(null);
  // Phones: the top bar slides away while reading down the page and returns the moment you scroll back up. The tabs stay.
  const [hdrHidden, setHdrHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY, ticking = false;
    const f = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        ticking = false; const y = window.scrollY, d = y - last;
        if (y < 90) setHdrHidden(false); else if (d > 8) setHdrHidden(true); else if (d < -8) setHdrHidden(false);
        if (Math.abs(d) > 8) last = y;
      });
    };
    window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f);
  }, []);
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
      if (dy > 24) setDock(true);
      else if (dy < -24) setDock(false);
    },
  };
  const [items, setItems] = useState<Item[]>([]),
    [moves, setMoves] = useState<Movement[]>([]);
  const [activitySearch, setActivitySearch] = useState("");
  const [partsShown, setPartsShown] = useState(50), [movesShown, setMovesShown] = useState(50);
  const [activityKind, setActivityKind] = useSaved("stock.kind", "ALL");
  const [activityRange, setActivityRange] = useSaved<Range>("stock.range", ALL);
  const [session, setSession] = useState<Session | null>(null),
    [status, setStatus] = useState<any>(null),
    [loading, setLoading] = useState(false);
  const [booted, setBooted] = useState(false), [gate, setGate] = useState<"" | "signedOut" | "noAccess" | "platform">("");
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
    [labelItem, setLabelItem] = useState<Item | null>(null),
    [bulkOpen, setBulkOpen] = useState(false);
  const [counterKey, setCounterKey] = useState(0);
  const [archived, setArchived] = useState<Item[]>([]),
    [showArchived, setShowArchived] = useState(false),
    [query, setQuery] = useState(""),
    [lowOnly, setLowOnly] = useState(false);
  useEffect(() => { setPartsShown(50); }, [query, lowOnly, showArchived]);
  useEffect(() => { setMovesShown(50); }, [activitySearch, activityKind, activityRange]);

  const [countId, setCountId] = useState("");
  const [costEdit, setCostEdit] = useState<{ id: string; value: string; busy?: boolean } | null>(null);
  const saveCost = async (id: string, value: string) => {
    setCostEdit({ id, value, busy: true });
    try {
      await api("/api/inventory/movements/" + id + "/cost", { method: "POST", body: JSON.stringify({ unitCost: value.trim() }) }, crypto.randomUUID());
      setCostEdit(null); toast(t("Cost price saved"));
      void refresh();
    } catch (e) { setCostEdit({ id, value }); toast((e as Error).message, { bad: true }); }
  };
  const photoTarget = useRef("");
  const file = useRef<HTMLInputElement>(null),
    sequence = useRef(0),
    mutation = useCommand();
  const direction: Direction = view === "issue" ? "OUT" : "IN";
  const inTask = view === "receive" || view === "issue";
  const task = tasks[direction],
    active = items.find((item) => item.id === selected),
    owner = !!session?.roles.includes("ROLE_OWNER");
  // "Part came in / went out" from Home: find the part first, then the quick box opens by itself
  const goFind = (mode: "give" | "receive") => { setSelected(""); setIntent(mode); navigate("find"); };
  useEffect(() => { if (view !== "find") { setIntent(null); return; } if (intent && active) { setQuick({ part: active, mode: intent }); setIntent(null); } }, [view, intent, active]);
  const visibleMoves = moves.filter((movement) => {
    const query = activitySearch.trim().toLowerCase();
    const incoming = ["OPENING", "RECEIPT", "RETURN", "COUNT_IN"].includes(movement.kind);
    const outgoing = ["ISSUE", "STOCK_OUT", "COUNT_OUT", "SUPPLIER_RETURN"].includes(movement.kind);
    const matchesKind =
      activityKind === "ALL" ||
      (activityKind === "IN" && incoming) ||
      (activityKind === "OUT" && outgoing) ||
      (activityKind === "RECEIVED" && ["RECEIPT", "OPENING"].includes(movement.kind)) ||
      (activityKind === "ISSUED" && movement.kind === "ISSUE") ||
      (activityKind === "RETURNED" && movement.kind === "RETURN") ||
      (activityKind === "GIVEN" && ["STOCK_OUT", "SUPPLIER_RETURN"].includes(movement.kind)) ||
      (activityKind === "COUNTED" && ["COUNT_IN", "COUNT_OUT"].includes(movement.kind));
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
    ["OPENING", "RECEIPT", "RETURN", "COUNT_IN"].includes(kind) ? "IN" : kind === "SHELF_MOVE" ? "MOVE" : "OUT";
  const actorEmail = (m: Movement) =>
    m.actor_email || (m.actor?.includes("@") ? m.actor : t("Staff member"));
  // an error must show where the person is looking, not only at the top of a long page
  useEffect(() => { if (error) toast(error, { bad: true }); }, [error]);
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
      const email = await userEmail();
      const [p, m, s, v] = await Promise.all([
        api<Item[]>("/api/inventory/products"),
        api<Movement[]>("/api/inventory/movements"),
        api<Session>("/api/inventory/session" + (email ? "?email=" + encodeURIComponent(email) : "")),
        api("/api/vision/status").catch(() => ({
          modelReady: false,
          bedrockConfigured: false,
        })),
      ]);
      setItems(p);
      setMoves(m);
      setPermissions(s.roles, s.permissions);  // before the session is set, so the first draw already knows
      setSession(s);
      try { const dl = sessionStorage.getItem("lifta.deeplink"); if (dl) { sessionStorage.removeItem("lifta.deeplink"); openWorkshop({ name: "job", id: dl }); } } catch { /* ignore */ }
      setStatus(v);
      api<{ name: string; default_reorder_level?: number; sinhala?: boolean; store_room_on?: boolean; counter_on?: boolean; store_room_phone?: boolean; counter_web?: boolean }>("/api/workshop/settings").then((b) => { setModules(b); setBusinessName(b.name); setDefaultReorder(b.default_reorder_level); setSinhalaAllowed(!!b.sinhala); }).catch(() => undefined);
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
      else if (auth && code === 403) {
        // the person who runs the system has no workshop of their own: show them the workshops screen instead of "No access"
        try { await api("/api/platform/shops"); setGate("platform"); } catch { setGate("noAccess"); }
      }
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
  useEffect(() => { if (session) void flushOffline(); }, [session]); // anything saved while there was no internet goes out after sign-in
  useEffect(() => { const a = () => { try { sessionStorage.removeItem("lifta.putaway"); } catch { /* ignore */ } setRoomBatch(true); }, b = () => setRoomBatchOut(true); window.addEventListener("lifta:batch-in", a); window.addEventListener("lifta:batch-out", b); return () => { window.removeEventListener("lifta:batch-in", a); window.removeEventListener("lifta:batch-out", b); }; });
  useEffect(() => { const out = (e: Event) => { const p = items.find((x) => x.id === (e as CustomEvent).detail); if (p) setQuick({ part: p, mode: "give" }); }; window.addEventListener("lifta:take-out", out); return () => window.removeEventListener("lifta:take-out", out); });
  useEffect(() => { const go = () => { if (can("see_cost") && can("price_edit")) navigate("prices"); }; window.addEventListener("lifta:open-prices", go); return () => window.removeEventListener("lifta:open-prices", go); });
  useEffect(() => { const go = () => navigate("shelf"); window.addEventListener("lifta:open-shelf", go); return () => window.removeEventListener("lifta:open-shelf", go); });
  useEffect(() => { const here = (e: Event) => { const id = (e as CustomEvent).detail, p = id && items.find((x) => x.id === id); if (p) { setQuick({ part: p, mode: "receive" }); return; } setRoomBatch(true); }; window.addEventListener("lifta:receive-here", here); return () => window.removeEventListener("lifta:receive-here", here); });
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
  const discard = async () => {
    if (task.lines.some((l) => l.attempted && !complete(l))) {
      setError(
        "An attempted line is unfinished. Retry it before starting a new task.",
      );
      return;
    }
    if (
      task.lines.some((l) => !complete(l)) &&
      !(await askConfirm("Stock has not changed for those lines.", { title: "Discard the unconfirmed draft?", confirm: "Discard", danger: true }))
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
    document.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
    if (value && Number(p.quantity) !== 0) {
      // the reason used to appear only at the top of the page, out of sight: say it where the person is looking
      toast(t("{name} still has {n} in stock. Record them as went out (Parts counter) first, then archive.", { name: p.name, n: String(p.quantity) }), { bad: true });
      return;
    }
    if (
      !(await askConfirm(
        value ? "Stock must be zero. The history stays." : "It comes back to the parts list.",
        { title: value ? "Archive " + p.name + "?" : "Restore " + p.name + "?", confirm: value ? "Archive" : "Restore", danger: value },
      ))
    )
      return;
    try {
      await mutation("/api/inventory/products/" + p.id + "/archive", {
        archived: value,
      });
      await refresh();
      if (showArchived)
        setArchived(await api<Item[]>("/api/inventory/products/archived"));
      toast(value ? t("Item archived.") : t("Item restored."));
    } catch (e) {
      toast((e as Error).message, { bad: true });
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
        <ItemPhoto item={p} peek />
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
  if (auth && !session && booted && gate === "platform" && !onCallback) {
    return (
      <main className="si-page"><section className="si-card" style={{ maxWidth: 560 }}>
        <div className="si-brand"><Logo size={48} /><span className="si-word">Lifta<span>.</span></span></div>
        <p className="si-eyebrow">PLATFORM</p>
        <PlatformSection />
        <button className="si-button" onClick={() => void signOut()}>Sign out</button>
      </section></main>
    );
  }
  if (auth && !session) {
    const signIn = auth;
    const mode: SignInMode | "" = onCallback ? (error ? "failed" : "callback") : !booted ? "checking" : gate === "noAccess" ? "noAccess" : gate === "signedOut" ? "signedOut" : "";
    if (mode)
      return (
        <SignIn mode={mode} error={mode === "failed" ? error : ""} onSignIn={() => { setError(""); void signIn.signinRedirect(); }}
          onSignOut={() => void signOut()} />
      );
  }
  const navItems: ({ group: string } | { key: View | "settings" | "tour"; full: string; short: string; sub: string; Icon: typeof Home; main?: boolean })[] = [
    { key: "home", full: t("Home"), short: t("Home"), sub: "", Icon: Home, main: true },
    ...(can("jobs_view") ? [{ group: t("WORKSHOP MANAGEMENT") }, { key: "workshop" as View, full: t("Jobs & Invoices"), short: t("Jobs"), sub: t("Job cards, vehicles and bills"), Icon: Wrench, main: true }] : []),
    { group: t("STOCK MANAGEMENT") },
    { key: "stock", full: t("Parts list"), short: t("Parts"), sub: owner ? t("All parts, photos and QR labels") : t("See what is in stock"), Icon: Package, main: true },
    ...(counterOn && canAny("stock_in", "stock_out") ? [{ key: "counter" as View, full: t("Parts counter"), short: t("Counter"), sub: t("A part came in or went out"), Icon: ScanLine, main: true }] : []),
    ...(roomOn ? [{ key: "shelf" as View, full: t("Store room"), short: t("Store room"), sub: t("Where every part sits"), Icon: Warehouse }] : []),
    { key: "activity", full: t("History"), short: t("History"), sub: t("Every part in and out"), Icon: Activity },
    ...(can("orders") ? [{ key: "orders" as View, full: t("To order"), short: t("To order"), sub: t("Parts to buy, and WhatsApp orders"), Icon: ListChecks }] : []),
    ...(can("suppliers_view") ? [{ key: "suppliers" as View, full: t("Suppliers"), short: t("Suppliers"), sub: t("Who you buy parts from"), Icon: Truck }] : []),
    { group: t("BUSINESS") },
    ...(can("reports") ? [{ key: "analysis" as View, full: t("Reports"), short: t("Reports"), sub: t("Stock summary and low stock"), Icon: ClipboardCheck }] : []),
    ...(can("see_cost") && can("price_edit") ? [{ key: "prices" as View, full: t("Price review"), short: t("Prices"), sub: t("Cost plus markup, set prices"), Icon: ClipboardCheck }] : []),
    ...(can("settings") ? [{ key: "settings" as View, full: t("Settings"), short: t("Settings"), sub: t("Business details, staff, shelves"), Icon: Settings2 }] : []),
    { group: t("HELP") },
    { key: "tour", full: t("Walkthrough"), short: t("Walkthrough"), sub: t("Show me how it works"), Icon: Compass },
  ];
  // the pages inside Jobs & Invoices, listed under it in the side menu (laptop); phones use the tabs on the page
  const wsSubs: { key: string; label: string; page: WsPage; tour?: string }[] = can("jobs_view") ? [
    { key: "jobs", label: t("Jobs"), page: { name: "jobs" }, tour: "ws-tab-jobs" },
    { key: "estimates", label: t("Estimates"), page: { name: "jobs", tab: "ESTIMATE" } as WsPage, tour: "ws-tab-quotes" },
    { key: "vehicles", label: t("Vehicles"), page: { name: "vehicles" }, tour: "ws-tab-vehicles" },
    ...(can("customers_view") ? [{ key: "customers", label: t("Customers"), page: { name: "customers" } as WsPage }] : []),
    { key: "due", label: t("Service due"), page: { name: "due" } },
    ...(can("bills_view") ? [{ key: "invoices", label: t("Bills"), page: { name: "invoices" } as WsPage, tour: "ws-tab-invoices" }] : []),
    ...(can("reports") ? [{ key: "report", label: t("Business reports"), page: { name: "report" } as WsPage, tour: "ws-tab-report" }] : []),
    ...(can("messages") ? [{ key: "messages", label: t("Messages"), page: { name: "messages" } as WsPage }] : []),
    ...(can("alerts") ? [{ key: "alerts", label: t("Alerts"), page: { name: "alerts" } as WsPage }] : []),
    ...(owner ? [{ key: "archive", label: t("Archive"), page: { name: "archive" } as WsPage, tour: "ws-tab-archive" }] : []),
  ] : [];
  const pickNav = (key: View | "settings" | "tour") => { if (key === "tour") { setMenuOpen(false); setChooser(true); } else if (key === "settings") { setMenuOpen(false); openWorkshop({ name: "settings" }); } else if (key === "workshop") openWorkshop({ name: "home" }); else navigate(key); };
  const moreActive = view === "stock" || view === "activity" || view === "analysis" || view === "suppliers" || view === "orders" || view === "prices" || view === "shelf";
  return (
    <div className="stock-shell" data-dock={dockHidden ? "hidden" : "shown"} data-hdr={hdrHidden ? "hidden" : "shown"}>
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
            <Fragment key={n.key}>
            <button
              data-tour={n.key === "settings" && isDesk ? "ws-tab-settings" : "nav-" + n.key}
              disabled={busy}
              className={((n.key === "settings" ? view === "workshop" && wsNow === "settings" : n.key === "workshop" ? view === "workshop" && wsNow !== "settings" : view === n.key) ? "chosen" : "") + (n.main ? "" : " nav-more")}
              title={n.sub || undefined}
              onClick={() => pickNav(n.key)}
            >
              <n.Icon size={19} />
              <span className="nav-text">
                <span className="nav-full">{n.full}</span>
                {n.sub && <small className="nav-sub">{n.sub}</small>}
              </span>
              <span className="nav-short">{n.short}</span>
            </button>
            {n.key === "workshop" && view === "workshop" && wsNow !== "settings" && isDesk && wsSubs.length > 0 && (
              <div className="nav-subs" role="group" aria-label={t("Jobs & Invoices")}>
                {wsSubs.map((x) => (
                  <button key={x.key} data-tour={x.tour} disabled={busy} className={wsNow === x.key ? "chosen" : ""} onClick={() => openWorkshop(x.page)}>{x.label}</button>
                ))}
              </div>
            )}
            </Fragment>
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
            <div className={"menu-sheet-foot" + (owner ? " biz-link" : "")}
              {...(owner ? { role: "button", tabIndex: 0, title: t("Open business settings"), onClick: () => { setMenuOpen(false); openWorkshop({ name: "settings" }); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMenuOpen(false); openWorkshop({ name: "settings" }); } } } : {})}>
              <span className="menu-biz-logo"><BizLogo name={businessName} size={56} /></span>
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
        <OfflineBar />
        <NumPadHost />
      {roomBatch && (
        <div className="stock-modal-shade" onClick={() => setRoomBatch(false)}>
          <section className="stock-modal room-batch" role="dialog" aria-modal="true" aria-label="Parts came in" onClick={(e) => e.stopPropagation()}>
            <header className="sm-look-top"><h2>Parts came in</h2><button type="button" className="button secondary small" onClick={() => setRoomBatch(false)}>Close</button></header>
            <BatchIn manual items={items as never} photo={(p) => <ItemPhoto item={p as Item} peek />} onChanged={() => void refresh()} />
          </section>
        </div>
      )}
      {roomBatchOut && (
        <div className="stock-modal-shade" onClick={() => setRoomBatchOut(false)}>
          <section className="stock-modal room-batch" role="dialog" aria-modal="true" aria-label="Parts went out" onClick={(e) => e.stopPropagation()}>
            <header className="sm-look-top"><h2>Parts went out</h2><button type="button" className="button secondary small" onClick={() => setRoomBatchOut(false)}>Close</button></header>
            <BatchOut manual items={items as never} photo={(p) => <ItemPhoto item={p as Item} peek />} onChanged={() => void refresh()} />
          </section>
        </div>
      )}
      {quick && <QuickMove key={quick.part.id + quick.mode} part={quick.part} mode={quick.mode} onClose={() => setQuick(null)} onChanged={() => void refresh()} />}
        <header className="stock-header">
          <a className="m-brand" href="#" onClick={(e) => { e.preventDefault(); navigate("home"); }}>
            <Logo size={30} /> <b>Lifta<span>.</span></b>
          </a>
          <div className={"biz" + (owner ? " biz-link" : "")} aria-label={businessName}
            {...(owner ? { role: "button", tabIndex: 0, title: t("Open business settings"), onClick: () => openWorkshop({ name: "settings" }), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openWorkshop({ name: "settings" }); } } } : {})}>
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
            {sinhalaOn && <div className="lang-toggle" role="group" aria-label="Language">
              <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
              <button className={lang === "si" ? "on" : ""} onClick={() => setLang("si")}>සිං</button>
            </div>}
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
          <MechanicHome disabled={busy} low={can("orders") || can("stock_count") ? lowItems.slice(0, 8) : undefined} lowTotal={lowItems.length} onOrder={can("orders") ? () => navigate("orders") : undefined} onCount={roomOn && can("stock_count") ? () => navigate("shelf") : undefined} onLow={(id) => { setSelected(id); navigate("find"); }} onFind={() => navigate("find")} onIn={can("stock_in") ? () => goFind("receive") : undefined} onOut={can("stock_out") ? () => goFind("give") : undefined} onJob={can("jobs") ? () => openWorkshop({ name: "new" }) : undefined} />
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
                { done: printerConnected(), title: t("Connect a receipt printer"), optional: true, sub: t("Optional. Bills then print straight to it."), go: () => openWorkshop({ name: "settings" }) },
                { done: started.jobs, title: t("Start your first job"), sub: t("One vehicle, its repairs, parts and labour."), go: () => openWorkshop({ name: "new" }) },
                { done: started.invoices, title: t("Make your first invoice"), sub: t("Open a job and press Create invoice."), go: () => openWorkshop({ name: "jobs" }) },
              ];
              const left = steps.filter((x) => !x.done && !("optional" in x)).length;
              if (!left) return null;
              const next = steps.findIndex((x) => !x.done && !("optional" in x));
              return (
                <section className="start-card" aria-label="Get started">
                  <div className="start-head">
                    <div>
                      <p className="eyebrow">{t("GET STARTED")}</p>
                      <h2>{t("{done} of {total} done", { done: steps.filter((x) => x.done).length, total: steps.length })}</h2>
                    </div>
                    <button className="stock-link" onClick={() => { try { localStorage.setItem("lifta.start", "done"); } catch { /* private mode */ } setStartHidden(true); }}>{t("Hide")}</button>
                  </div>
                  <div className="start-bar" aria-hidden="true"><span style={{ width: (steps.filter((x) => x.done).length / steps.length) * 100 + "%" }} /></div>
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
              {can("bill") && can("job_stock") && can("jobs") && (
                <button className="counter-tile bill" disabled={!session || busy} onClick={() => openWorkshop({ name: "quickbill" })}>
                  <FileText size={30} />
                  <span>
                    <strong>{t("Quick bill")}</strong>
                    <small>{t("Sell a part or a small job, no repair job needed")}</small>
                  </span>
                </button>
              )}
            </div>
            <p className="home-label">{t("STOCK")}</p>
            <div className="counter-tiles">
              <button
                className="counter-tile receive"
                disabled={!session || busy}
                onClick={() => goFind("receive")}
              >
                <ArrowDownLeft size={30} />
                <span>
                  <strong>{t("Part came in")}</strong>
                  <small>{t("Find the part, then say how many")}</small>
                </span>
              </button>
              <button
                className="counter-tile give"
                disabled={!session || busy}
                onClick={() => goFind("give")}
              >
                <ArrowUpRight size={30} />
                <span>
                  <strong>{t("Part went out")}</strong>
                  <small>{t("Find the part, then say how many")}</small>
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
                    ? (intent ? (intent === "receive" ? "Pick the part that came in." : "Pick the part that went out.") : isDesk && !counterOn ? "Type the name, part number or shelf." : "Search by part number, scan a QR or identify a photo.")
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
                          {!(isDesk && !counterOn) && <>
                          <button type="button" className="button primary find-scan" disabled={busy} onClick={() => setScanner(true)} aria-label="Scan QR label"><ScanLine size={20} /> <span>{t("Scan")}</span></button>
                          <button type="button" className="button secondary find-scan" disabled={busy} onClick={() => { markNativePick(); file.current?.click(); }} aria-label="Identify from photo"><Camera size={20} /> <span>{t("Photo")}</span></button>
                          </>}
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
                        <strong>{t("Scan QR label")}</strong>
                        <small>{t("Use your phone camera")}</small>
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
                        {active.location ? (
                          <button type="button" className="shelf-chip" title={t("Show on map")} onClick={() => { try { sessionStorage.setItem(SHELF_FOCUS, active.location || ""); } catch { /* ignore */ } navigate("shelf"); }}>
                            {active.location} · {t("Show on map")}
                          </button>
                        ) : (
                          <span className="shelf-chip">{"Shelf not set"}</span>
                        )}
                      </div>
                    </div>
                    <div className="available-stock">
                      <span>{t("Available now")}</span>
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
                            type="number" inputMode="decimal"
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
                          {can("stock_in") && <button
                            className="button primary"
                            onClick={() => setQuick({ part: active, mode: "receive" })}
                          >
                            Receive this item
                          </button>}
                          {can("stock_out") && <button
                            className="button secondary"
                            onClick={() => setQuick({ part: active, mode: "give" })}
                          >
                            Give this item
                          </button>}
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
                      <h3>{t("Your list starts here")}</h3>
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
                <h1>{t("Parts list")}</h1>
                <p>
                  Find exact parts. Keep their labels and shelf details
                  together.
                </p>
              </div>
              {can("item_add") && <button
                className="button primary"
                onClick={() => {
                  resetIdentification();
                  setNewItem(true);
                }}
              >
                <Plus size={18} /> {t("Register item")}
              </button>}
              {canAny("item_add", "price_edit") && <button className="button secondary" onClick={() => setBulkOpen(true)}>{t("Bulk tools")}</button>}
              {can("stock_in") && <button className="button secondary" onClick={() => window.dispatchEvent(new Event("lifta:batch-in"))}>{t("Several came in")}</button>}
              {can("stock_out") && <button className="button secondary" onClick={() => window.dispatchEvent(new Event("lifta:batch-out"))}>{t("Take out several")}</button>}
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
                {can("item_edit") && (
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
                {filtered(showArchived ? archived : items, query).slice(0, partsShown).map((p) => (
                  <article className="catalogue-row" key={p.id}>
                    <ItemPhoto item={p} peek />
                    <div className="catalogue-description">
                      <strong>{p.name}</strong>
                      <small>
                        {p.brand} · Part no. {p.part_number || "Not set"} · System no. {p.sku}
                      </small>
                      <span className="cat-chip">
                        {p.category} · {p.location || "Shelf not set"}{Number(p.selling_price) > 0 ? " · " + Number(p.selling_price).toLocaleString() : ""}
                      </span>
                    </div>
                    <div className="catalogue-quantity">
                      <span className="cq-line">
                        <b>{number(p.quantity)}</b>
                        <small>{p.unit === "LITRE" ? "litres" : "units"}</small>
                        {Number(p.quantity) <= Number(p.reorder_level) &&
                          !p.archived && (
                            <span className="low-stock">{t("Low stock")}</span>
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
                      {can("item_edit") && (
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
              {filtered(showArchived ? archived : items, query).length > partsShown && (
                <p className="list-more"><button type="button" className="button secondary" onClick={() => setPartsShown((n) => n + 50)}>{t("Show more")} ({filtered(showArchived ? archived : items, query).length - partsShown})</button></p>
              )}
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
              owner={owner} photo={(p) => <ItemPhoto item={p as Item} peek />} onChanged={() => void refresh()} />
          </>
        )}
        {view === "analysis" && can("reports") && <StockReport />}
        {view === "suppliers" && can("suppliers_view") && <Suppliers />}
        {view === "shelf" && <StoreMap items={items as never} />}
        {view === "orders" && can("orders") && <Orders />}
        {view === "prices" && can("see_cost") && can("price_edit") && <PriceReview />}
        {view === "workshop" && session && <Workshop key={wsStart.n} owner={owner} start={wsStart.page} />}
        {view === "counter" && session && (
          <Counter
            key={counterKey}
            items={items}
            moves={moves}
            photo={(p) => <ItemPhoto item={p} peek />}
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
                <h1>{t("Stock activity")}</h1>
                <p>
                  A clear history of what changed, when and who recorded it.
                  Asia/Colombo.
                </p>
              </div>
            </div>
            <details className="filters-fold" open={activityKind !== "ALL" || !!activitySearch}><summary>{t("Filter")}{activityKind !== "ALL" || activitySearch ? " •" : ""}</summary>
            <section className="activity-filters" aria-label="Activity filters">
              <label className="stock-field">
                Search activity
                <input value={activitySearch} placeholder="Part, number or email" onChange={(event) => setActivitySearch(event.target.value)} />
              </label>
              <label className="stock-field">
                Movement
                <select value={activityKind} onChange={(event) => setActivityKind(event.target.value)}>
                  <option value="ALL">{t("All movements")}</option>
                  <option value="RECEIVED">{t("Received")}</option>
                  <option value="ISSUED">{t("Issued to workshop")}</option>
                  <option value="RETURNED">{t("Returned from job")}</option>
                  <option value="GIVEN">{t("Given out")}</option>
                  <option value="COUNTED">{t("Counted")}</option>
                  <option value="IN">{t("All coming in")}</option>
                  <option value="OUT">{t("All going out")}</option>
                </select>
              </label>
              <button className="button secondary small" onClick={() => { setActivitySearch(""); setActivityKind("ALL"); setActivityRange(ALL); }}>{t("Clear filters")}</button>
            </section></details>
            <DateChips value={activityRange} onChange={setActivityRange} />
            {owner && <MovementPdf range={bounds(activityRange)} />}
            <SummaryBar text={"Movements: " + visibleMoves.length} file="stock-history"
              rows={visibleMoves.map((m) => ({ Time: when(m.created_at), Item: m.name, SKU: m.sku, Direction: movementDirection(m.kind), Movement: m.kind, Quantity: m.quantity, "Recorded by": actorEmail(m) }))} />
            <section className="stock-panel stock-table-wrap">
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Item</th>
                    <th>{t("In / Out")}</th>
                    <th>{t("Movement")}</th>
                    <th>{t("Quantity")}</th>
                    <th>{t("Recorded by email")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMoves.slice(0, movesShown).map((m) => (
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
                            (["STOCK_OUT", "ISSUE", "COUNT_OUT", "SUPPLIER_RETURN"].includes(m.kind)
                              ? "out"
                              : "in")
                          }
                        >
                          {m.kind === "SHELF_MOVE" ? t("Moved to another shelf") : m.kind === "SUPPLIER_RETURN" ? t("Sent back to supplier") : m.kind === "COUNT_IN" ? t("Count: found extra") : m.kind === "COUNT_OUT" ? t("Count: found missing") : m.kind === "STOCK_OUT" || m.kind === "ISSUE"
                            ? m.kind === "ISSUE"
                              ? "Issued to workshop"
                              : "Given out"
                            : m.kind === "RECEIPT" || m.kind === "OPENING"
                              ? "Received"
                              : m.kind === "RETURN"
                                ? "Returned from job"
                                : m.kind}
                        </span>
                        {m.doc_no && (
                          <button type="button" className="doc-link" title={t("Print this note")} onClick={() => void openPdf("/api/inventory/movements/" + m.id + "/note.pdf", m.doc_no + ".pdf").catch((e) => toast((e as Error).message, { bad: true }))}>{m.doc_no}</button>
                        )}
                        {(m.kind === "RECEIPT" || m.kind === "SUPPLIER_RETURN") && (m.supplier || m.reference) && <small>{[m.supplier, m.reference, m.terms === "CREDIT" ? t("On credit") : ""].filter(Boolean).join(" · ")}</small>}
                        {m.kind === "SHELF_MOVE" && m.note && <small>{m.note}</small>}
                        {(m.kind === "RETURN" || m.kind === "ISSUE") && (m.reference || (m.note && !m.note.startsWith("Undo"))) && <small>{m.reference || m.note}</small>}
                        {can("cost_edit") && m.kind === "RECEIPT" && !(m.note || "").startsWith("Undo") && (costEdit?.id === m.id ? (
                          <small className="cost-edit">
                            <input aria-label={t("Cost price per unit (LKR)")} inputMode="decimal" maxLength={12} autoFocus value={costEdit.value} disabled={costEdit.busy} onChange={(e) => setCostEdit({ id: m.id, value: e.target.value.replace(/[^0-9.]/g, "") })} />
                            <button type="button" className="doc-link" disabled={costEdit.busy || !costEdit.value.trim()} onClick={() => void saveCost(m.id, costEdit.value)}>{t("Save")}</button>
                            <button type="button" className="doc-link" disabled={costEdit.busy} onClick={() => setCostEdit(null)}>{t("Cancel")}</button>
                          </small>
                        ) : (
                          <small>
                            <button type="button" className="doc-link" onClick={() => setCostEdit({ id: m.id, value: m.unit_cost != null ? String(m.unit_cost) : "" })}>{m.unit_cost != null ? t("Cost") + " LKR " + Number(m.unit_cost).toLocaleString("en", { minimumFractionDigits: 2 }) + " " + t("per unit") : t("Add cost price")}</button>
                            {m.unit_cost != null && m.doc_no && <button type="button" className="doc-link" onClick={() => void openPdf("/api/inventory/movements/" + m.id + "/note.pdf?cost=1", m.doc_no + "-cost.pdf").catch((e) => toast((e as Error).message, { bad: true }))}>{t("GRN with cost")}</button>}
                          </small>
                        ))}
                        {m.kind === "STOCK_OUT" && m.receiver_name && <small>{m.receiver_name}</small>}
                      </td>
                      <td>{number(m.quantity)}</td>
                      <td>
                        <strong>{actorEmail(m)}</strong>
                        {!m.actor_email && !m.actor?.includes("@") && <small>{t("Shows the email after this person signs in once")}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleMoves.length > movesShown && <p className="list-more"><button type="button" className="button secondary" onClick={() => setMovesShown((n) => n + 50)}>{t("Show more")} ({visibleMoves.length - movesShown})</button></p>}
              {!visibleMoves.length && (
                <div className="stock-empty"><h3>{t("No history yet")}</h3><p>{t("Every part you receive or give out will be listed here, with who did it and when.")}</p></div>
              )}
            </section>
          </>
        )}
      </main>
      {bulkOpen && <BulkTools items={items} onClose={() => setBulkOpen(false)} onChanged={() => void refresh()} />}
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
          owner={owner}
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
applyTheme(getTheme());
// A job card QR opens /?job=<id>. Keep the id before sign-in can redirect away, then open that job once the session is ready.
try { const jobId = new URLSearchParams(location.search).get("job"); if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) { sessionStorage.setItem("lifta.deeplink", jobId); history.replaceState(null, "", location.pathname); } } catch { /* ignore */ }
createRoot(document.getElementById("root")!).render(/^\/t\/[A-Za-z0-9~_-]+\/?$/.test(location.pathname) ? <Track /> : <><Crash><App /></Crash><ToastHost /><ConfirmHost /></>);
