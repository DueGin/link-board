import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  ConnectionMode, SelectionMode, applyNodeChanges, useReactFlow,
  type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import type { Board, Person, Relation } from '../shared/types';
import { api, uid } from './api';
import { PersonNode, tagColor, type PersonFlowNode } from './PersonNode';
import { FloatingEdge, FloatingConnectionLine } from './FloatingEdge';
import { PersonPanel, RelationPanel } from './Panels';
import { SettingsDialog } from './SettingsDialog';
import { forceLayout, groupLayout, NODE_H, NODE_W } from './layout';

const nodeTypes = { person: PersonNode };
const edgeTypes = { floating: FloatingEdge };

// 与服务端 searchPeople 一致的简易匹配，用于画布高亮
function matches(p: Person, q: string) {
  const hay = [p.name, p.title, p.org, p.strengths, p.notes, ...p.tags, ...p.traits].join(' ').toLowerCase();
  return q.toLowerCase().split(/[\s,，、]+/).filter(Boolean).some((w) => hay.includes(w));
}

// 工具栏图标（描边小图标）
const ICONS = {
  add: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
  ),
  search: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" strokeLinecap="round" /></svg>
  ),
  json: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2h-5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8z" strokeLinejoin="round" /><path d="M9.5 2v3h3" strokeLinejoin="round" /></svg>
  ),
  doc: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2h-5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8z" strokeLinejoin="round" /><path d="M9.5 2v3h3" strokeLinejoin="round" /><path d="M6 8.5h4M6 11h4" strokeLinecap="round" /></svg>
  ),
  upload: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2m0 0L5 5m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 10v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" strokeLinecap="round" /></svg>
  ),
  gear: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" strokeLinecap="round" /></svg>
  ),
  collapse: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4 4.5-4 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  expand: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3.5-4 4.5 4 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  people: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.5" r="2.5" /><path d="M1.5 13.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4" strokeLinecap="round" /><circle cx="11.5" cy="6.5" r="2" /><path d="M11 9.7c1.7.3 3 1.7 3.4 3.8" strokeLinecap="round" /></svg>
  ),
  layout: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
  ),
};

function BoardApp() {
  const [board, setBoard] = useState<Board | null>(null);
  // 选中集合：交给 React Flow 多选，面板按数量分别显示
  const [selPeople, setSelPeople] = useState<ReadonlySet<string>>(new Set());
  const [selEdges, setSelEdges] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [layoutMenu, setLayoutMenu] = useState(false);
  // 最近一次整理前的坐标，用于撤销
  const [layoutUndo, setLayoutUndo] = useState<Map<string, { x: number; y: number }> | null>(null);
  const saveTimer = useRef<number>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getBoard().then(setBoard).catch((e) => setStatus('加载失败：' + e.message));
  }, []);

  // 所有修改都走这里：更新状态 + 600ms 防抖自动保存
  const update = useCallback((fn: (b: Board) => Board) => {
    setBoard((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      window.clearTimeout(saveTimer.current);
      setStatus('未保存…');
      saveTimer.current = window.setTimeout(() => {
        api.saveBoard(next)
          .then(() => setStatus('已保存 ' + new Date().toLocaleTimeString()))
          .catch((e) => setStatus('保存失败：' + e.message));
      }, 600);
      return next;
    });
  }, []);

  const hits = useMemo(
    () => new Set(query.trim() && board ? board.people.filter((p) => matches(p, query)).map((p) => p.id) : []),
    [board, query],
  );
  const searching = !!query.trim();

  const boardNodes: PersonFlowNode[] = useMemo(
    () =>
      (board?.people ?? []).map((p) => ({
        id: p.id,
        type: 'person',
        position: { x: p.x, y: p.y },
        selected: selPeople.has(p.id),
        data: { ...p, hit: hits.has(p.id), dim: searching && !hits.has(p.id) },
      })),
    [board, selPeople, hits, searching],
  );

  // 点击关系标签：普通点击只选这一条，按住修饰键时追加/取消
  const selectRelation = useCallback((id: string, additive: boolean) => {
    if (additive) {
      setSelEdges((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setSelPeople(new Set());
    setSelEdges(new Set([id]));
  }, []);

  const edges: Edge[] = useMemo(
    () =>
      (board?.relations ?? []).map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        type: 'floating',
        selected: selEdges.has(r.id),
        data: {
          label: r.label || undefined,
          strength: r.strength,
          dim: searching && !hits.has(r.source) && !hits.has(r.target),
          onSelect: selectRelation,
        },
      })),
    [board, selEdges, searching, hits, selectRelation],
  );

  // 拖动中跟随的本地节点状态，拖拽结束才写回 board
  const [flowNodes, setFlowNodes] = useState<PersonFlowNode[]>([]);
  // 镜像一份最新节点，供按目标坐标算视口时读取实测尺寸
  const flowNodesRef = useRef<PersonFlowNode[]>(flowNodes);
  flowNodesRef.current = flowNodes;
  const dragging = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    // 保留 React Flow 已量好的尺寸：整体替换会让节点变回“未测量”，连线要等重新测量后才画，会闪一下
    setFlowNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return boardNodes.map((n) => {
        const m = measured.get(n.id);
        return m ? { ...n, measured: m } : n;
      });
    });
  }, [boardNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<PersonFlowNode>[]) => {
      const hasDrag = changes.some((c) => c.type === 'position' && c.dragging);
      if (hasDrag) dragging.current = true;
      setFlowNodes((prev) => applyNodeChanges(changes, prev));
      for (const c of changes) {
        if (c.type === 'select') {
          // 同步进选中集合；取消选中只清掉自己，避免同一批事件里冲掉刚选中的另一项
          setSelPeople((prev) => {
            const next = new Set(prev);
            if (c.selected) next.add(c.id); else next.delete(c.id);
            return next;
          });
        } else if (c.type === 'remove') {
          // 删除人物，级联删掉相关关系
          update((b) => ({
            ...b,
            people: b.people.filter((p) => p.id !== c.id),
            relations: b.relations.filter((r) => r.source !== c.id && r.target !== c.id),
          }));
          setSelPeople((prev) => {
            if (!prev.has(c.id)) return prev;
            const next = new Set(prev);
            next.delete(c.id);
            return next;
          });
        } else if (c.type === 'position' && !c.dragging && c.position) {
          // 拖拽结束时每个被移动节点都会收到一条这样的变化，逐个写回 board
          dragging.current = false;
          const { x, y } = c.position;
          update((b) => ({ ...b, people: b.people.map((p) => (p.id === c.id ? { ...p, x, y } : p)) }));
        }
      }
    },
    [update],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'select') {
          // 同步进选中集合；取消选中只清掉自己
          setSelEdges((prev) => {
            const next = new Set(prev);
            if (c.selected) next.add(c.id); else next.delete(c.id);
            return next;
          });
        } else if (c.type === 'remove') {
          update((b) => ({ ...b, relations: b.relations.filter((r) => r.id !== c.id) }));
          setSelEdges((prev) => {
            if (!prev.has(c.id)) return prev;
            const next = new Set(prev);
            next.delete(c.id);
            return next;
          });
        }
      }
    },
    [update],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const rel: Relation = { id: uid(), source: conn.source, target: conn.target, label: '', strength: 3 };
      update((b) => {
        const exists = b.relations.some(
          (r) => (r.source === rel.source && r.target === rel.target) || (r.source === rel.target && r.target === rel.source),
        );
        return exists ? b : { ...b, relations: [...b.relations, rel] };
      });
      setSelEdges(new Set([rel.id]));
    },
    [update],
  );

  const { screenToFlowPosition, setViewport } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const addPerson = () => {
    const pos = screenToFlowPosition({
      x: Math.max(160, window.innerWidth / 2 - 180),
      y: window.innerHeight / 2,
    });
    const person: Person = {
      id: uid(),
      name: '新人物',
      tags: [],
      traits: [],
      strengths: '',
      closeness: 3,
      x: pos.x - 100 + Math.round(Math.random() * 60 - 30),
      y: pos.y - 60 + Math.round(Math.random() * 60 - 30),
      updatedAt: new Date().toISOString(),
    };
    update((b) => ({ ...b, people: [...b.people, person] }));
    setSelPeople(new Set([person.id]));
    setPanelOpen(true);
  };

  const download = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Partial<Board>;
      if (!Array.isArray(data.people) || !Array.isArray(data.relations)) {
        setStatus('导入失败：文件里缺少 people / relations 数组');
        return;
      }
      if (!window.confirm(`导入将覆盖当前板子（${data.people.length} 人、${data.relations.length} 条关系），确定继续？`)) return;
      window.clearTimeout(saveTimer.current);
      const next: Board = {
        version: 1,
        people: data.people as Person[],
        relations: data.relations as Relation[],
        updatedAt: new Date().toISOString(),
      };
      setBoard(next);
      setSelPeople(new Set());
      setSelEdges(new Set());
      setLayoutUndo(null);
      setStatus('导入中…');
      await api.saveBoard(next);
      setStatus('已导入并保存 ' + new Date().toLocaleTimeString());
    } catch (err) {
      setStatus('导入失败：' + (err as Error).message);
    }
  };

  // 单选面板取唯一选中的那个人 / 那条关系
  const singlePerson = selPeople.size === 1 ? board?.people.find((p) => selPeople.has(p.id)) : undefined;
  const selectedRelation = selEdges.size === 1 ? board?.relations.find((r) => selEdges.has(r.id)) : undefined;
  const isMac = window.desktop?.platform === 'darwin';

  // ===== 一键整理 =====

  // 多选时只整理选中的人（至少 2 个才算多选），否则整理全部
  const tidyTargets = useMemo(
    () => (selPeople.size >= 2 ? board?.people.filter((p) => selPeople.has(p.id)) ?? [] : board?.people ?? []),
    [board, selPeople],
  );

  // 计算目标位置：返回每个节点的新坐标（左上角）
  const computeLayout = useCallback(
    (targets: Person[], kind: 'force' | 'group') => {
      const items = targets.map((p) => ({
        id: p.id,
        cx: p.x + NODE_W / 2,
        cy: p.y + NODE_H / 2,
        closeness: p.closeness,
        tag: p.tags[0],
      }));
      const centers = kind === 'force' ? forceLayout(items, board!) : groupLayout(items);
      const map = new Map<string, { x: number; y: number }>();
      for (const c of centers) map.set(c.id, { x: Math.round(c.x - NODE_W / 2), y: Math.round(c.y - NODE_H / 2) });
      return map;
    },
    [board],
  );

  // 按整理后的目标坐标直接算视口：fitView 会在同一帧读到尚未提交的旧坐标，
  // 整理前节点挤在一起时会被 maxZoom 夹住，只看得见两三个头像。
  const fitToTargets = useCallback(
    (targets: Map<string, { x: number; y: number }>) => {
      const wrap = canvasRef.current;
      if (!wrap || targets.size === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of flowNodesRef.current) {
        const t = targets.get(n.id);
        if (!t) continue;
        // measured 是节点实测尺寸，拿不到就用节点默认宽高兜底
        const w = n.measured?.width ?? 140;
        const h = n.measured?.height ?? 120;
        minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x + w); maxY = Math.max(maxY, t.y + h);
      }
      if (!Number.isFinite(minX)) return;
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
      const zoom = Math.min(2.5, Math.max(0.2, Math.min(cw / bw, ch / bh) * 0.88));
      const cx = minX + bw / 2, cy = minY + bh / 2;
      void setViewport({ x: cw / 2 - cx * zoom, y: ch / 2 - cy * zoom, zoom }, { duration: 300 });
    },
    [setViewport],
  );

  const rafRef = useRef<number>(0);

  // 平滑过渡到目标位置（约 400ms rAF 插值），结束后保存
  const animateTo = useCallback(
    (targets: Map<string, { x: number; y: number }>, done?: () => void) => {
      // 先记下每个节点的起始位置，动画从当前位置平滑走到目标
      const froms = new Map<string, { x: number; y: number }>();
      setFlowNodes((prev) => {
        for (const n of prev) if (targets.has(n.id)) froms.set(n.id, { ...n.position });
        return prev;
      });
      dragging.current = true; // 动画期间阻断 boardNodes 同步
      const t0 = performance.now();
      const dur = 400;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - k, 3);
        setFlowNodes((prev) =>
          prev.map((n) => {
            const from = froms.get(n.id);
            const to = targets.get(n.id);
            if (!from || !to) return n;
            return {
              ...n,
              position: {
                x: from.x + (to.x - from.x) * ease,
                y: from.y + (to.y - from.y) * ease,
              },
            };
          }),
        );
        if (k < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          dragging.current = false;
          done?.();
        }
      };
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(step);
    },
    [],
  );

  const runLayout = useCallback(
    (kind: 'force' | 'group') => {
      if (!board || tidyTargets.length === 0) return;
      setLayoutMenu(false);
      // 记录整理前坐标，供撤销
      const before = new Map<string, { x: number; y: number }>();
      for (const p of tidyTargets) before.set(p.id, { x: p.x, y: p.y });
      const targets = computeLayout(tidyTargets, kind);
      animateTo(targets, () => {
        update((b) => ({
          ...b,
          people: b.people.map((p) => {
            const t = targets.get(p.id);
            return t ? { ...p, x: t.x, y: t.y, updatedAt: new Date().toISOString() } : p;
          }),
        }));
        fitToTargets(targets);
      });
      setLayoutUndo(before);
      setStatus(kind === 'force' ? '已按关系整理' : '已按领域分组');
    },
    [board, tidyTargets, computeLayout, animateTo, update, fitToTargets],
  );

  // 撤销最近一次整理
  const undoLayout = useCallback(() => {
    const prev = layoutUndoRef.current;
    if (!prev || prev.size === 0) return;
    layoutUndoRef.current = null;
    setLayoutUndo(null);
    animateTo(prev, () => {
      update((b) => ({
        ...b,
        people: b.people.map((p) => {
          const t = prev.get(p.id);
          return t ? { ...p, x: t.x, y: t.y, updatedAt: new Date().toISOString() } : p;
        }),
      }));
    });
    setStatus('已撤销整理');
  }, [animateTo, update]);

  // Cmd/Ctrl+Z 撤销最近一次整理；焦点在输入框时不拦截
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      undoLayout();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoLayout]);
  const layoutUndoRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  layoutUndoRef.current = layoutUndo;

  // 批量删除多选的人
  const deleteSelected = useCallback(() => {
    const ids = [...selPeople];
    if (ids.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 个人物？相关关系会一并删除。`)) return;
    update((b) => ({
      ...b,
      people: b.people.filter((p) => !selPeople.has(p.id)),
      relations: b.relations.filter((r) => !selPeople.has(r.source) && !selPeople.has(r.target)),
    }));
    setSelPeople(new Set());
  }, [selPeople, update]);

  const selectedPerson = singlePerson;

  if (!board) {
    return <div className="loading-state">{status || '人脉图谱加载中…'}</div>;
  }

  return (
    <div className="app">
      <header className={`toolbar${isMac ? ' mac-inset' : ''}`}>
        <h1 className="app-title">人脉图谱</h1>
        <button type="button" className="primary" onClick={addPerson} title="新增人物">
          {ICONS.add}<span>新增人物</span>
        </button>
        <label className="search-label" htmlFor="board-search">
          {ICONS.search}
          <span className="sr-only">搜索人物</span>
          <input
            id="board-search"
            type="search"
            value={query}
            placeholder="搜索姓名 / 标签 / 优势…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {searching && <span className="hit-count" role="status">命中 {hits.size} 人</span>}
        <div className="toolbar-spacer" />
        <span className="save-status" role="status">{status}</span>
        <div className="toolbar-group layout-menu">
          <button
            type="button"
            title="一键整理画布"
            aria-expanded={layoutMenu}
            onClick={() => setLayoutMenu((v) => !v)}
          >
            {ICONS.layout}<span>整理</span>
          </button>
          {layoutMenu && (
            <div className="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => runLayout('force')}>
                <strong>关系布局</strong>
                <span>有关系的人靠近，按亲密度聚拢，整理 {tidyTargets.length} 人</span>
              </button>
              <div className="menu-divider" />
              <button type="button" role="menuitem" onClick={() => runLayout('group')}>
                <strong>按领域分组</strong>
                <span>相同领域标签的人围成一圈，整理 {tidyTargets.length} 人</span>
              </button>
            </div>
          )}
        </div>
        <div className="toolbar-group">
          <button type="button" title="导出 JSON" onClick={() => download('/api/export.json', 'link-board.json')}>{ICONS.json}<span>JSON</span></button>
          <button type="button" title="导出 Markdown" onClick={() => download('/api/export.md', 'link-board.md')}>{ICONS.doc}<span>MD</span></button>
          <button type="button" title="导入 JSON" onClick={() => fileInput.current?.click()}>{ICONS.upload}<span>导入</span></button>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void onImportFile(e)} />
        <button type="button" aria-label="打开设置" title="设置" onClick={() => setShowSettings(true)}>{ICONS.gear}</button>
        <button
          type="button"
          className="panel-toggle"
          aria-label={panelOpen ? '收起右侧面板' : '展开右侧面板'}
          title={panelOpen ? '收起右侧面板' : '展开右侧面板'}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? ICONS.collapse : ICONS.expand}
        </button>
      </header>
      <main className="workspace">
        <div className="canvas" ref={canvasRef}>
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={64}
            connectionLineComponent={FloatingConnectionLine}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => { setSelPeople(new Set()); setSelEdges(new Set()); }}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            deleteKeyCode={['Backspace', 'Delete']}
            minZoom={0.2}
            maxZoom={2.5}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => tagColor((n.data as PersonFlowNode['data']).tags?.[0])}
              nodeStrokeWidth={0}
              nodeBorderRadius={24}
            />
          </ReactFlow>
          {layoutUndo && (
            <div className="layout-toast" role="status">
              <span>已整理</span>
              <button type="button" onClick={undoLayout}>撤销（{isMac ? '⌘Z' : 'Ctrl+Z'}）</button>
            </div>
          )}
          {board.people.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">{ICONS.people}</div>
              <h2>还没有人物</h2>
              <p>把重要的人放到图谱里，再用连线记下他们的关系。</p>
              <button type="button" className="primary" onClick={addPerson}>{ICONS.add}添加第一个人</button>
            </div>
          )}
        </div>
        {panelOpen && (
          <aside className="side-panel">
            {selPeople.size >= 2 ? (
              <div className="panel-content multi-panel">
                <div className="panel-heading">
                  <span className="eyebrow">多选</span>
                  <h2>已选 {selPeople.size} 人</h2>
                  <p>拖动任意一个选中的人，其余人会一起移动；也可用「整理」只对选中的人重新布局。</p>
                </div>
                <button type="button" className="danger" onClick={deleteSelected}>
                  批量删除 {selPeople.size} 人
                </button>
              </div>
            ) : selectedPerson ? (
              <PersonPanel
                person={selectedPerson}
                people={board.people}
                relations={board.relations}
                onChange={(patch) =>
                  update((b) => ({
                    ...b,
                    people: b.people.map((p) =>
                      p.id === selectedPerson.id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
                    ),
                  }))
                }
                onSelectRelation={(id) => setSelEdges(new Set([id]))}
                onDelete={() =>
                  onNodesChange([{ type: 'remove', id: selectedPerson.id }])
                }
              />
            ) : selectedRelation ? (
              <RelationPanel
                relation={selectedRelation}
                people={board.people}
                onChange={(patch) =>
                  update((b) => ({
                    ...b,
                    relations: b.relations.map((r) => (r.id === selectedRelation.id ? { ...r, ...patch } : r)),
                  }))
                }
                onDelete={() =>
                  onEdgesChange([{ type: 'remove', id: selectedRelation.id }])
                }
              />
            ) : (
              <div className="panel-content panel-empty">
                <div className="panel-heading">
                  <span className="eyebrow">使用提示</span>
                  <h2>如何维护人脉图谱</h2>
                </div>
                <ul className="tips">
                  <li>点「新增人物」创建头像，拖动头像摆放位置。</li>
                  <li>悬停头像出现圆环，从环上拖向另一人即可建立关系。</li>
                  <li>点头像或连线，在这里编辑详情；Delete 键删除。</li>
                  <li>搜索框可按姓名、标签、优势高亮相关人物。</li>
                </ul>
                <dl className="stats">
                  <div><dt>人物</dt><dd>{board.people.length}</dd></div>
                  <div><dt>关系</dt><dd>{board.relations.length}</dd></div>
                </dl>
              </div>
            )}
          </aside>
        )}
      </main>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <BoardApp />
    </ReactFlowProvider>
  );
}
