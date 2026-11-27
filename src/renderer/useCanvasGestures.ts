import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { insidePerson, toWorld, zoomAt, type Point, type Viewport } from '../shared/geometry';
import type { NetworkProject } from '../shared/project';

type Gesture = { kind: 'press' | 'drag' | 'pan'; pointerId: number; start: Point; origin: Point; pointer?: Point; personId?: string; viewport: Viewport };

export function useCanvasGestures(surface: RefObject<HTMLDivElement | null>, project: NetworkProject, onMove: (id: string, point: Point) => void, onViewport: (view: Viewport) => void, onSelect: (id: string | null) => void, onConnect?: (source: string, target: string) => void) {
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const space = useRef(false);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ id: string; point: Point } | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    const active = gesture.current;
    if (active && surface.current?.hasPointerCapture(active.pointerId)) surface.current.releasePointerCapture(active.pointerId);
    gesture.current = null; setPreview(null); setTargetId(null); setPanning(false);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { clear(); space.current = false; }
      if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,select,dialog') || event.target.isContentEditable)) return;
      if (event.code === 'Space') { event.preventDefault(); space.current = true; }
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false; };
    const blur = () => { clear(); space.current = false; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  });

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (gesture.current) { event.preventDefault(); return; }
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (event.ctrlKey) onViewport(zoomAt(project.viewport, project.viewport.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
      else onViewport({ ...project.viewport, panX: project.viewport.panX - (event.shiftKey ? event.deltaY : event.deltaX), panY: project.viewport.panY - (event.shiftKey ? 0 : event.deltaY) });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [surface, project.viewport, onViewport]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); cancelAnimationFrame(frame.current); }, []);

  function point(event: PointerEvent): Point {
    const rect = surface.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const id = (event.target as HTMLElement).closest('[data-person-id]')?.getAttribute('data-person-id');
    const start = point(event);
    suppressClick.current = false;
    if (event.button === 1 || (space.current && !id)) {
      event.preventDefault(); gesture.current = { kind: 'pan', pointerId: event.pointerId, start, origin: start, viewport: project.viewport }; setPanning(true);
    } else if (id) {
      onSelect(id);
      const person = project.people.find((item) => item.id === id)!;
      gesture.current = { kind: 'press', pointerId: event.pointerId, start, origin: { x: person.x, y: person.y }, personId: id, viewport: project.viewport };
      timer.current = setTimeout(() => {
        const current = gesture.current;
        if (current?.kind === 'press') { current.kind = 'drag'; surface.current?.setPointerCapture(current.pointerId); suppressClick.current = true; setPreview({ id, point: dragPoint(current, current.pointer ?? current.start) }); }
      }, 300);
    } else { onSelect(null); return; }
    if (gesture.current?.kind === 'pan') surface.current!.setPointerCapture(event.pointerId);
  }

  function dragPoint(current: Gesture, pointer: Point): Point {
    return { x: current.origin.x + (pointer.x - current.start.x) / current.viewport.zoom, y: current.origin.y + (pointer.y - current.start.y) / current.viewport.zoom };
  }

  function targetAt(pointer: Point, current: Gesture) {
    if (!onConnect) return undefined;
    const world = toWorld(pointer, current.viewport);
    return [...project.people].reverse().find((person) => person.id !== current.personId && insidePerson(world, person))?.id;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const pointer = point(event);
    if (current.kind === 'press') {
      // Movement during the hold does not cancel the gesture (user decision, 2026-11-27): the drag
      // activates from wherever the pointer is, keeping the original grab offset.
      current.pointer = pointer;
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (current.kind === 'pan') onViewport({ ...current.viewport, panX: current.viewport.panX + pointer.x - current.start.x, panY: current.viewport.panY + pointer.y - current.start.y });
      else { setPreview({ id: current.personId!, point: dragPoint(current, pointer) }); setTargetId(targetAt(pointer, current) ?? null); }
    });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) return;
    const pointer = point(event);
    const rect = surface.current!.getBoundingClientRect();
    const releasedOn = document.elementFromPoint(event.clientX, event.clientY);
    if (releasedOn && surface.current!.contains(releasedOn) && pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height) {
      if (current.kind === 'drag') {
        const target = targetAt(pointer, current);
        if (target) onConnect?.(current.personId!, target);
        else onMove(current.personId!, dragPoint(current, pointer));
      } else if (current.kind === 'pan') onViewport({ ...current.viewport, panX: current.viewport.panX + pointer.x - current.start.x, panY: current.viewport.panY + pointer.y - current.start.y });
    }
    clear();
  }

  return { preview, targetId, panning, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: clear, onLostPointerCapture: () => { if (gesture.current) clear(); },
    onClickCapture: (event: React.MouseEvent) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
  } };
}
