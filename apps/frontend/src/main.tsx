import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const unauthorizedEvent = "vibe:auth-unauthorized";
const authDeviceKey = "vibe_auth_device";

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
};

const shouldIgnoreUnauthorized = (url: string): boolean => {
  return url.includes("/auth/login") || url.includes("/auth/session");
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const mergedInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? "include",
  };

  const response = await nativeFetch(input, {
    ...mergedInit,
  });

  if (response.status === 401) {
    const requestUrl = toRequestUrl(input);
    if (!shouldIgnoreUnauthorized(requestUrl)) {
      window.localStorage.removeItem(authDeviceKey);
      window.dispatchEvent(new CustomEvent(unauthorizedEvent));
    }
  }

  return response;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
