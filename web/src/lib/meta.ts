import { useEffect } from "react";

/** Set the document title and description (and their Open Graph copies). */
export function useDocumentMeta(title: string, description?: string, image?: string): void {
  useEffect(() => {
    document.title = title ? `${title} | Aftershock` : "Aftershock";
    const set = (selector: string, attr: string, key: string, value?: string) => {
      if (!value) return;
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.content = value;
    };
    set('meta[name="description"]', "name", "description", description);
    set('meta[property="og:title"]', "property", "og:title", title);
    set('meta[property="og:description"]', "property", "og:description", description);
    set('meta[property="og:image"]', "property", "og:image", image);
    set(
      'meta[name="twitter:card"]',
      "name",
      "twitter:card",
      image ? "summary_large_image" : "summary",
    );
  }, [title, description, image]);
}
