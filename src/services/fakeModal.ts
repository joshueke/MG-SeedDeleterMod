// src/services/fakeModal.ts
// Trimmed from the full mod's services/fakeModal.ts: only the generic modal
// open/close helpers and the inventory-specific fakes are kept (the seed
// deleter never touches the journal/stats/activity-log modals).

import { fakeShow, fakeHide, type FakeConfig } from "./fakeAtoms";
import { Atoms } from "../store/atoms";

export type ModalId = string;
export type InvPayload = { items?: any[]; favoritedItemIds?: string[] } | any;

/* ------------------------------- Modal I/O ------------------------------- */

export async function openModal(modalId: ModalId) {
  try {
    const current = await Atoms.ui.activeModal.get();
    if (current && current !== modalId) {
      await Atoms.ui.activeModal.set(null);
      await Atoms.ui.inventoryModalIsActive.set(false);
      await new Promise(r => requestAnimationFrame(r));
    }
    await Atoms.ui.activeModal.set(modalId);
    await Atoms.ui.inventoryModalIsActive.set(modalId === "inventory");
  } catch {}
}

export async function closeModal(modalId?: ModalId) {
  try {
    if (modalId) {
      const current = await Atoms.ui.activeModal.get();
      if (current !== modalId) return;
    }
    await Atoms.ui.activeModal.set(null);
    if (modalId === "inventory" || !modalId) {
      await Atoms.ui.inventoryModalIsActive.set(false);
    }
  } catch {}
}

export function isModalOpen(value: any, modalId: ModalId) {
  return value === modalId;
}

export async function isModalOpenAsync(modalId: ModalId): Promise<boolean> {
  try {
    const v = await Atoms.ui.activeModal.get();
    return isModalOpen(v, modalId);
  } catch {
    return false;
  }
}

export async function waitModalClosed(modalId: ModalId, timeoutMs = 120000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      const v = await Atoms.ui.activeModal.get();
      if (!isModalOpen(v, modalId)) return true;
    } catch {
      return true;
    }
    await new Promise(r => setTimeout(r, 80));
  }
  return false;
}

/* --------------------------- Gate helper ---------------------------- */

function gateForModal(modalId: ModalId) {
  return {
    label: Atoms.ui.activeModal.label,
    isOpen: (v: any) => isModalOpen(v, modalId),
    openAction: () => openModal(modalId),
    closeAction: () => closeModal(modalId),
    autoDisableOnClose: true,
  };
}

/* ============================ Patches: inventory ============================ */

const mergeMyData = (real: any, patch: any) => {
  const base = real && typeof real === "object" ? real : {};
  const add = patch && typeof patch === "object" ? patch : {};
  return { ...base, ...add };
};

/** Shared patch on myData: merges { inventory: payload }, gated on the inventory modal. */
const SHARED_MYDATA_PATCH: FakeConfig<any> = {
  label: Atoms.data.myData.label,
  merge: mergeMyData,
  gate: gateForModal("inventory"),
};

/** Specific patch on myInventoryAtom (used directly by the inventory UI). */
const INVENTORY_ATOM_PATCH: FakeConfig<any> = {
  label: Atoms.inventory.myInventory.label,
  merge: (_real: any, fake: any) => fake,
  gate: gateForModal("inventory"),
};

const INVENTORY_MODAL_ID: ModalId = "inventory";

export async function openInventoryPanel() {
  return openModal(INVENTORY_MODAL_ID);
}

export async function closeInventoryPanel() {
  return closeModal(INVENTORY_MODAL_ID);
}

export async function isInventoryPanelOpen(): Promise<boolean> {
  return isModalOpenAsync(INVENTORY_MODAL_ID);
}

export async function waitInventoryPanelClosed(timeoutMs = 120000): Promise<boolean> {
  return waitModalClosed(INVENTORY_MODAL_ID, timeoutMs);
}

/** Activates the inventory fakes and opens the modal if requested. */
export async function fakeInventoryShow(
  payload: InvPayload,
  opts?: { open?: boolean; autoRestoreMs?: number }
) {
  const shouldOpen = opts?.open !== false;

  await fakeShow(SHARED_MYDATA_PATCH, { inventory: payload }, {
    openGate: false,
    autoRestoreMs: opts?.autoRestoreMs,
  });

  await fakeShow(INVENTORY_ATOM_PATCH, payload, {
    openGate: false,
    autoRestoreMs: opts?.autoRestoreMs,
  });

  if (shouldOpen) await openInventoryPanel();
}

/** Deactivates the inventory fakes. */
export async function fakeInventoryHide() {
  await fakeHide(INVENTORY_ATOM_PATCH.label);
  await fakeHide(SHARED_MYDATA_PATCH.label);
  await closeInventoryPanel();
}
