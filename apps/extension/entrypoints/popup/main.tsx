import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "../../style.css";
import "./popup.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
