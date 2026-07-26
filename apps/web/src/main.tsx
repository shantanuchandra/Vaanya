import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono";
import App from "./App";
import { AuthGate } from "./AuthGate";
import { createSupabaseAuth } from "./auth";
import { ReviewPage } from "./ReviewPage";
import { EvidencePage } from "./EvidencePage";
import { RecordingsRoute } from "./RecordingsRoute";

const auth = createSupabaseAuth();
const page = window.location.pathname.startsWith("/review") ? (
  <ReviewPage />
) : window.location.pathname.startsWith("/evidence") ? (
  <EvidencePage />
) : window.location.pathname.startsWith("/recordings") ? (
  <RecordingsRoute />
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate auth={auth}>
      {page}
    </AuthGate>
  </React.StrictMode>
);
