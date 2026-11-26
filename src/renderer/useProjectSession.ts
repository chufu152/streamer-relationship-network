import { useEffect, useRef, useState } from 'react';
import { createEmptyProject, type NetworkProject } from '../shared/project';
import type { DesktopFileApi } from '../shared/file-contracts';

type Session = { project: NetworkProject; revision: number; savedRevision: number; path: string };

export function useProjectSession(api: DesktopFileApi | undefined, report: (message: string) => void, editingBusy: boolean) {
  const [state, setState] = useState<Session>(() => ({ project: createEmptyProject(), revision: 0, savedRevision: 0, path: '' }));
  const session = useRef(state);
  const savingLock = useRef(false);
  const transitionLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  function publish(next: Session) { session.current = next; setState(next); }

  function updateProject(updater: (current: NetworkProject) => NetworkProject) {
    if (transitionLock.current) return;
    const current = session.current;
    publish({ ...current, project: { ...updater(current.project), updatedAt: new Date().toISOString() }, revision: current.revision + 1 });
  }

  async function saveProject(saveAs = false): Promise<boolean> {
    if (!api) { report('本地文件功能需要桌面应用，请在 Windows 应用中保存'); return false; }
    if (savingLock.current || editingBusy) { report('正在处理，请稍后再保存'); return false; }
    savingLock.current = true; setSaving(true);
    const snapshot = session.current;
    try {
      const result = await api.saveProject(snapshot.project, saveAs);
      if (result.status === 'cancelled') { report('已取消保存，修改仍保留在当前画布'); return false; }
      if (result.status === 'error') { report(result.message); return false; }
      const latest = session.current;
      publish({ ...latest, savedRevision: snapshot.revision, path: result.value.path });
      const current = latest.revision === snapshot.revision;
      report(current ? '已保存到本地文件' : '早先版本已保存，当前仍有较新的未保存修改');
      return current;
    } catch (error) { report(`保存失败：${(error as Error).message}`); return false; }
    finally { savingLock.current = false; setSaving(false); }
  }

  async function changeProject(action: 'new' | 'open' | 'close'): Promise<boolean> {
    if (!api) { report('请在桌面应用中使用本地文件功能'); return false; }
    if (savingLock.current || transitionLock.current || editingBusy) { report('正在处理，请完成后再切换或关闭项目'); return false; }
    transitionLock.current = true; setTransitioning(true);
    try {
      if (session.current.revision !== session.current.savedRevision) {
        const answer = await api.confirmUnsaved();
        if (answer === 'cancel') return false;
        if (answer === 'save' && !(await saveProject())) return false;
      }
      if (action === 'close') { await api.approveClose(); return true; }
      if (action === 'open') {
        const result = await api.openProject();
        if (result.status === 'cancelled') return false;
        if (result.status === 'error') { report(result.message); return false; }
        publish({ project: result.value.project, revision: 0, savedRevision: 0, path: result.value.path });
        report(result.value.path.toLowerCase().endsWith('.bak') ? '已打开备份，下次保存将选择新路径，不覆盖备份' : '项目已打开');
      } else {
        const result = await api.resetProject();
        if (result.status === 'error') { report(result.message); return false; }
        if (result.status === 'cancelled') return false;
        publish({ project: createEmptyProject(), revision: 0, savedRevision: 0, path: '' }); report('');
      }
      return true;
    } catch (error) { report(`文件操作失败：${(error as Error).message}`); return false; }
    finally { transitionLock.current = false; setTransitioning(false); }
  }

  useEffect(() => api?.onCloseRequested(() => { void changeProject('close'); }));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!transitionLock.current && !document.querySelector('dialog[open]')) void saveProject(event.shiftKey);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return { ...state, saving, transitioning, updateProject, saveProject, changeProject };
}
