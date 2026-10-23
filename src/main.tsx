// First: settles which collective the window is in before anything reads storage.
import { app } from "./edition";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./host/App";
import { IdentityProvider } from "./identity/useIdentity";
import { BRAND_PRESETS, logoUrl, SkinProvider } from "./host/useSkin";
import "./styles.css";

document.title = app.productName;

// The tab icon is the build's mark, where its brand preset has one.
const mark = BRAND_PRESETS.find((p) => p.id === app.defaultSkin)?.skin.logo;
if (mark) {
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = logoUrl(mark);
  document.head.appendChild(icon);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SkinProvider>
      <IdentityProvider>
        <App />
      </IdentityProvider>
    </SkinProvider>
  </StrictMode>,
);
