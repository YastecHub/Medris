import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";

/**
 * React entry. It runs as a module script, i.e. after the legacy document has
 * been parsed and its scripts have run, and mounts into #medris-root, which
 * the build appends at the end of the document. Importing no CSS here is
 * deliberate: the legacy stylesheets fully define the current look.
 */
const container = document.getElementById("medris-root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
