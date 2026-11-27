import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    // React strips the autofocus attribute, so showModal's own focusing lands on the first focusable
    // element (the close button). Put the focus on the dialog's primary field instead.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="modal-heading"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="关闭窗口">关闭</button></div>
      {children}
    </dialog>
  );
}
