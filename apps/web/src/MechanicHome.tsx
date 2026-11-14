import { ArrowDownLeft, ArrowUpRight, PlusCircle, Search } from "lucide-react";
import { t, useLang } from "./i18n";

/** The mechanic's Home: four big buttons, nothing else. */
export function MechanicHome({ onFind, onIn, onOut, onJob, disabled }: { onFind: () => void; onIn: () => void; onOut: () => void; onJob: () => void; disabled: boolean }) {
  useLang();
  const tiles = [
    { cls: "find", Icon: Search, title: t("Find a part"), sub: t("Look up a part, photo or shelf."), go: onFind },
    { cls: "in", Icon: ArrowDownLeft, title: t("Part came in"), sub: t("Scan or photo what came in"), go: onIn },
    { cls: "out", Icon: ArrowUpRight, title: t("Part went out"), sub: t("Scan the part and confirm the quantity"), go: onOut },
    { cls: "job", Icon: PlusCircle, title: t("Start a job"), sub: t("A vehicle comes in for work"), go: onJob },
  ];
  return (
    <section className="mh" aria-label={t("What are we doing today?")}>
      <h1>{t("What are we doing today?")}</h1>
      <div className="mh-grid">
        {tiles.map((x) => (
          <button key={x.cls} className={"mh-tile " + x.cls} disabled={disabled} onClick={x.go}>
            <span className="mh-ico"><x.Icon size={34} strokeWidth={1.8} /></span>
            <strong>{x.title}</strong>
            <small>{x.sub}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
