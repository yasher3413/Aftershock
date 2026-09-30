import type { Schema } from "../api/types.gen";

/** Every WebSocket message, discriminated by `type`. */
export type LiveMessage = Schema["message"];
export type LiveMessageType = LiveMessage["type"];
