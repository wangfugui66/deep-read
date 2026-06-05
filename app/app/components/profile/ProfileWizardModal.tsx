"use client";

import { useReaderStore } from "@/lib/stores/readerStore";
import ProfileWizard from "@/app/components/profile/ProfileWizard";

interface Props {
  bookName: string;
  onProfileComplete: () => void;
}

export default function ProfileWizardModal({ bookName, onProfileComplete }: Props) {
  const wizardOpen = useReaderStore((s) => s.wizardOpen);
  const setWizardOpen = useReaderStore((s) => s.setWizardOpen);
  const setTocOpen = useReaderStore((s) => s.setTocOpen);

  if (!wizardOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center"
      onClick={() => setWizardOpen(false)}
    >
      <div
        className="bg-white rounded-xl w-[520px] max-w-[95vw] h-[560px] max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileWizard
          bookName={bookName}
          onComplete={() => {
            setWizardOpen(false);
            setTocOpen(true);
          }}
          onProfileComplete={onProfileComplete}
        />
      </div>
    </div>
  );
}
