import React from "react";
import { t } from "./i18n";

/** A screen that fails to draw must never leave a blank page: say so and offer the way back. Nothing saved is lost. */
export class Crash extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Lifta screen error", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-crash" role="alert">
        <h1>{t("Something went wrong on this screen")}</h1>
        <p>{t("Your saved work is safe. Reload to carry on.")}</p>
        <button className="button primary" onClick={() => location.reload()}>{t("Reload")}</button>
      </div>
    );
  }
}
