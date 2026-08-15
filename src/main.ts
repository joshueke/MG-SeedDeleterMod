// src/main.ts
import { installPageWebSocketHook } from "./hooks/wsHook";
import { mountSeedDeleterUI } from "./ui/panel";

(function () {
  "use strict";

  installPageWebSocketHook();
  mountSeedDeleterUI();
})();
