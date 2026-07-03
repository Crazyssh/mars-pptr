import { runRelay } from "./relay.js";

runRelay().catch((e) => {
  console.error("[pptr-relay] fatal:", e);
  process.exit(1);
});
