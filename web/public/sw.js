// Aftershock service worker: shows tremor alerts and opens them on click.
self.addEventListener("push", (event) => {
  let data = { title: "Aftershock", body: "A big tremor just hit.", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // Keep the defaults for an empty or malformed payload.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.svg",
      data: { url: data.url },
      tag: data.url,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
