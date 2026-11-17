import React, { useEffect, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { api, shrink, type Match, type Draft } from "./api";
import { getDefaultReorder } from "./businessName";
import { t } from "./i18n";
import { suggestFields, type Field, type Suggestion } from "./suggestions";
import { Item, uid, prettyModel, useCommand, Photo } from "./partsShared";
import { ListPick } from "./ListPick";
const LiveCam = React.lazy(() => import("./Camera").then((m) => ({ default: m.Camera })));

export function ProductEditor({
  item,
  draft,
  aiNote = "",
  imageId,
  inTask = false,
  products,
  onClose,
  onSaved,
  onAddedAnother,
  owner = false,
}: {
  owner?: boolean;
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
    [supplierName, setSupplierName] = useState(item?.supplier || ""),
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
  const [shootPhoto, setShootPhoto] = useState(false);
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
  // the shop's own shelf and category lists (Settings); while there are none the two boxes stay free text
  type Stores = { racks: { name: string; levels: string[] }[]; categories: string[]; shelves: string[] };
  const [stores, setStores] = useState<Stores>({ racks: [], categories: [], shelves: [] });
  useEffect(() => { api<Stores>("/api/inventory/stores").then(setStores).catch(() => { /* free text */ }); }, []);
  const addStore = async (body: Record<string, unknown>) => setStores(await api<Stores>("/api/inventory/stores/add", { method: "POST", body: JSON.stringify(body) }, crypto.randomUUID()));
  const addCategory = async (name: string) => { await addStore({ kind: "category", name }); return name; };
  const addShelf = async (text: string) => {
    const m = /^(.*?)\s*-\s*([^-]+)$/.exec(text), rackName = (m ? m[1] : text).trim(), level = m ? m[2].trim() : "";
    const rack = stores.racks.find((r) => r.name.toLowerCase() === rackName.toLowerCase());
    if (rack && level) await addStore({ kind: "level", rack: rack.name, level });
    else if (rack) throw new Error(t("{rack} is already there. Add a level, like {rack}-A", { rack: rack.name }));
    else await addStore({ kind: "rack", name: rackName, levels: level ? [level] : [] });
    return level ? (rack ? rack.name : rackName) + "-" + level : rackName;
  };
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
        supplier: supplierName.trim(),
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
            <button type="button" className="button secondary" disabled={photoBusy || busy} onClick={() => setShootPhoto(true)}>
              <Camera size={18} /> {photoBusy ? t("Uploading…") : photoId ? t("Retake photo") : t("Take photo")}
            </button>{" "}
            <label className={"button secondary" + (photoBusy || busy ? " disabled" : "")}>
              {t("Upload photo")}
              <input type="file" accept="image/*" hidden disabled={photoBusy || busy} onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <small>{t("Optional. Helps Lifta recognise this part later.")}</small>
          </div>
        )}
        {shootPhoto && (
          <React.Suspense fallback={null}>
            <LiveCam onQR={() => {}} onPhoto={(f) => { setShootPhoto(false); void pickPhoto(f); }} onClose={() => setShootPhoto(false)} />
          </React.Suspense>
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
                <span className="input-wrap">{(field === "category" && stores.categories.length > 0) || (field === "location" && stores.shelves.length > 0) ? (
                  <ListPick label={t(label)} value={value} required={required} maxLength={field === "category" ? 80 : 180}
                    options={field === "category" ? stores.categories : stores.shelves} onChange={(v) => edit(field, v)}
                    onAdd={owner ? (field === "category" ? addCategory : addShelf) : undefined} placeholder={field === "location" ? t("Pick a shelf") : t("Pick a category")} />
                ) : <input
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
                />}{badge(field)}</span>
                {hint(field)}
              </label>
            ))}
            <datalist id="category-options">
              {[...new Set(products.filter((p) => !p.archived).map((p) => (p.category || "").trim()).filter(Boolean))].sort().map((c) => <option key={c} value={c} />)}
            </datalist>
            <datalist id="supplier-options">
              {[...new Set(products.map((p) => (p.supplier || "").trim()).filter(Boolean))].sort().map((s) => <option key={s} value={s} />)}
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
                    <option value="LITRE">{t("Measured litres")}</option>
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
              <label className="stock-field">
                {t("Usual supplier")} <small>({t("optional")})</small>
                <span className="input-wrap"><input value={supplierName} maxLength={100} list="supplier-options" autoComplete="off" placeholder="Lanka Spares" onChange={(e) => setSupplierName(e.target.value)} /></span>
                <small className="stock-help">{t("Part came in fills this in for you.")}</small>
              </label>
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
