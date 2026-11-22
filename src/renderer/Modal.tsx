import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="modal-heading"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="关闭窗口">关闭</button></div>
      {children}
    </dialog>
  );
}
