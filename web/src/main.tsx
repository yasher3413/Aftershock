import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import "./index.css";
import { queryClient } from "./api/client";
import { router } from "./routes";

// After a deploy, a page that was open (or cached) can ask for code files the
// new deploy no longer has. Reload once to pick up the current version; the
// timestamp stops a loop if the files are missing for some other reason.
window.addEventListener("vite:preloadError", (event) => {
  const key = "aftershock.reloadedForDeploy";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key) ?? 0);
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: reload anyway, at most once per page load.
  }
  if (Date.now() - last > 60_000) {
    event.preventDefault();
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
