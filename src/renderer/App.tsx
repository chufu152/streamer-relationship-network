import { useEffect, useState } from 'react';
import { createEmptyProject } from '../shared/project';

type Connection = 'preview' | 'connecting' | 'connected' | 'failed';

function NetworkMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="m8 7 8 4M7 9l2 8m7-4-5 5" />
      <circle cx="6" cy="6" r="3" /><circle cx="18" cy="12" r="3" /><circle cx="10" cy="20" r="2.5" />
    </svg>
  );
}

export function App() {
  const [project] = useState(createEmptyProject);
  const [name, setName] = useState('');
  const [connection, setConnection] = useState<Connection>(window.desktop ? 'connecting' : 'preview');

  useEffect(() => {
    let active = true;
    if (window.desktop) {
      void window.desktop.getAppInfo().then(
        () => { if (active) setConnection('connected'); },
        () => { if (active) setConnection('failed'); },
      );
    }
    return () => { active = false; };
  }, []);

  const connectionLabel = {
    preview: '浏览器预览',
    connecting: '正在连接桌面环境…',
    connected: '桌面环境已连接',
    failed: '桌面连接失败，请重新启动应用',
  }[connection];

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="identity">
          <span className="brand-mark"><NetworkMark /></span>
          <span className="brand-name">人物交际网</span>
          <span className="toolbar-divider" aria-hidden="true" />
          <div className="project-heading">
            <span className="project-title">{project.title}</span>
            <span className="project-state">尚未创建</span>
          </div>
        </div>
        <nav className="file-actions" aria-label="项目文件">
          <button type="button" disabled title="本地项目操作将在 M5 启用">新建</button>
          <button type="button" disabled title="本地项目操作将在 M5 启用">打开</button>
          <button type="button" disabled title="本地项目操作将在 M5 启用">另存为</button>
          <button className="save-button" type="button" disabled title="本地项目操作将在 M5 启用">
            保存<span className="shortcut" aria-hidden="true">Ctrl S</span>
          </button>
        </nav>
      </header>

      <main className="workspace" aria-label="人物关系画布">
        <div className="empty-state">
          <h1>从第一个人物开始</h1>
          <p>在下方输入名字，添加第一个人物。</p>
          <span className="empty-note">当前为界面预览，人物编辑将在下一阶段启用。</span>
        </div>
        <div className="canvas-footer">
          <p className="graph-count" aria-label="画布统计">
            <span>{project.people.length} 人物</span><span className="count-divider" aria-hidden="true" />
            <span>{project.relationships.length} 关系</span>
          </p>
          <div className="zoom-controls" role="group" aria-label="画布视图">
            <button type="button" disabled aria-label="缩小" title="画布导航将在 M3 启用">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
            </button>
            <span className="zoom-value">100%</span>
            <button type="button" disabled aria-label="放大" title="画布导航将在 M3 启用">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
            </button>
            <span className="zoom-divider" aria-hidden="true" />
            <button type="button" disabled className="fit-button" title="画布导航将在 M3 启用">适应全部</button>
          </div>
        </div>
      </main>

      <footer className="bottom-bar">
        <div className="environment" role={connection === 'failed' ? 'alert' : 'status'}>
          <span className={`connection-dot ${connection}`} aria-hidden="true" />
          <span>{connectionLabel}</span>
        </div>
        <form className="person-form" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="person-name" className="sr-only">人物姓名</label>
          <input
            id="person-name"
            name="person-name"
            type="text"
            placeholder="输入人物姓名"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-describedby="stage-notice"
            autoComplete="off"
          />
          <button type="submit" className="add-button" disabled title="人物添加将在 M2 启用">添加人物</button>
        </form>
        <span id="stage-notice" className="stage-notice">M1 工程预览 · 尚未开放编辑与保存</span>
      </footer>
    </div>
  );
}
