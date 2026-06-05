import { create } from "zustand";

// ====================================================================
// Graph Store — knowledge graph modal + selected node
// ====================================================================

interface GraphState {
  isModalOpen: boolean;
  selectedNode: string | null;

  openModal: () => void;
  closeModal: () => void;
  selectNode: (nodeId: string | null) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  isModalOpen: false,
  selectedNode: null,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),
  selectNode: (nodeId) => set({ selectedNode: nodeId }),
}));
