// src/store/atoms.ts
// Trimmed down to only the atoms the seed-deleter feature touches: the active
// modal (to drive the fake inventory panel), the raw inventory/seed atoms,
// and the selection atoms the game's own inventory UI writes to when the
// player clicks an item.
import { makeAtom, makeAliasedAtom } from "./hub";

export type SeedItem = {
  species: string;
  itemType: "Seed";
  quantity: number;
};
export type SeedInventoryState = SeedItem[] | null;

export const myData = makeAtom<any>("myDataAtom");
export const myInventory = makeAtom<any>("myInventoryAtom");
export const mySeedInventory = makeAtom<SeedInventoryState>("mySeedInventoryAtom");

export const mySelectedItemName = makeAtom<any>("mySelectedItemNameAtom");
export const mySelectedItemId = makeAtom<any>("mySelectedItemIdAtom");
export const myValidatedSelectedItemIndex = makeAtom<number | null>("myValidatedSelectedItemIndexAtom");
export const myPossiblyNoLongerValidSelectedItemIndex = makeAtom<number | null>("myPossiblyNoLongerValidSelectedItemIndexAtom");

// Renamed `activeModalAtom` -> `activeModalStateAtom` game-side at some point;
// same shape (`string | null`). Keeping both as a fallback survives cached
// bundles / rollbacks the same way the original mod does.
export const activeModal = makeAliasedAtom<string | null>([
  "activeModalStateAtom",
  "activeModalAtom",
]);
export const inventoryModalIsActive = makeAtom<boolean>("inventoryModalIsActiveAtom");

export const Atoms = {
  ui: { activeModal, inventoryModalIsActive },
  data: { myData },
  inventory: {
    myInventory,
    mySeedInventory,
    mySelectedItemId,
    mySelectedItemName,
    myPossiblyNoLongerValidSelectedItemIndex,
    myValidatedSelectedItemIndex,
  },
} as const;
