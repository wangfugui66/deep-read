"use client";

import { useGraphStore } from "@/lib/stores/graphStore";
import KnowledgeGraphViewer from "@/app/components/book/KnowledgeGraphViewer";

interface Props {
  bookName: string;
}

export default function GraphModal({ bookName }: Props) {
  const isModalOpen = useGraphStore((s) => s.isModalOpen);
  const closeModal = useGraphStore((s) => s.closeModal);

  if (!isModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center"
      onClick={closeModal}
    >
      <div
        className="bg-white rounded-xl w-[90vw] h-[85vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <KnowledgeGraphViewer bookName={bookName} />
      </div>
    </div>
  );
}
