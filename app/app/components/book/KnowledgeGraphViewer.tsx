"use client";

/** KnowledgeGraphViewer — Force-directed interactive graph with industrial features.

 * Features:
 * - Node size proportional to degree (connected edge count)
 * - Edge weight → thickness + opacity
 * - Hover: highlight node + neighbors, dim rest, show edge weights
 * - Click: focus camera on node
 * - Zoom controls (+/−/reset)
 * - Legend overlay (color → type mapping)
 * - Position caching in graph.json (persist layout)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchGraphData, startPipeline, fetchPipelineStatus, fetchChapterContent } from "@/lib/api_client";
import { useReaderStore } from "@/lib/stores/readerStore";
import { useGraphStore } from "@/lib/stores/graphStore";
import { Loader2, AlertCircle, GitGraph, Play, Plus, Minus, RotateCcw, ExternalLink } from "lucide-react";
import type { PipelineStatus } from "@/lib/types";

// ── Types ──

interface GraphNode {
  id: string;
  label: string;
  type?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  degree: number;
  isDragging?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
}

interface RawNode {
  id: string;
  label: string;
  type?: string;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
}

interface RawEdge {
  source: string;
  target: string;
  weight?: number;
}

interface Props { bookName: string }

// ── Color palette by type ──

const TYPE_COLORS: Record<string, string> = {
  concept: "#3b82f6",
  term: "#8b5cf6",
  person: "#f59e0b",
  event: "#ef4444",
  default: "#6b7280",
};

const TYPE_LABELS: Record<string, string> = {
  concept: "概念",
  term: "术语",
  person: "人物",
  event: "事件",
  default: "其他",
};

// ── Force simulation ──

const REPULSION = 8000;
const ATTRACTION = 0.005;
const DAMPING = 0.88;
const MAX_SPEED = 5;

export default function KnowledgeGraphViewer({ bookName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animFrameRef = useRef<number>(0);
  const posDirtyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1, targetX: 0, targetY: 0, targetScale: 1 });
  const hoveredNode = useRef<string | null>(null);
  const draggedNodeRef = useRef<string | null>(null);
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef<{ id: string; label: string; type: string; degree: number; x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ id: string; label: string; type: string; degree: number } | null>(null);
  const zoomLevelRef = useRef(1);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  // ── Knowledge card state ──
  const [knowledgeCard, setKnowledgeCard] = useState<{ nodeId: string; title: string; content: string } | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const { setChapter, setHighlightQuery } = useReaderStore();
  const { closeModal } = useGraphStore();

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const loadGraph = useCallback(() => {
    if (!bookName) return;
    setLoading(true);
    setError(null);
    setEmpty(false);

    fetchGraphData(bookName)
      .then((data) => {
        if (!mountedRef.current) return;
        const rawNodes: RawNode[] = data?.nodes ?? [];
        const rawEdges: RawEdge[] = data?.edges ?? [];

        if (rawNodes.length === 0) {
          setEmpty(true);
          setLoading(false);
          return;
        }

        // Compute degree
        const degreeMap = new Map<string, number>();
        for (const n of rawNodes) degreeMap.set(n.id, 0);
        for (const e of rawEdges) {
          degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
          degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
        }

        const maxDegree = Math.max(1, ...Array.from(degreeMap.values()));
        const W = 900, H = 600, margin = 60;

        const nodes: GraphNode[] = rawNodes.map((n) => {
          const deg = degreeMap.get(n.id) ?? 1;
          const sizeFromDegree = 4 + (deg / maxDegree) * 18;
          return {
            id: n.id,
            label: n.label ?? "",
            type: n.type ?? "default",
            x: n.x ?? margin + Math.random() * (W - margin * 2),
            y: n.y ?? margin + Math.random() * (H - margin * 2),
            vx: 0,
            vy: 0,
            size: n.size ?? sizeFromDegree,
            color: n.color ?? TYPE_COLORS[n.type ?? "default"] ?? TYPE_COLORS.default,
            degree: deg,
          };
        });

        const edges: GraphEdge[] = rawEdges.map((e) => ({
          source: e.source,
          target: e.target,
          weight: e.weight ?? 1,
        }));

        nodesRef.current = nodes;
        edgesRef.current = edges;
        setLoading(false);

        cameraRef.current = { x: 0, y: 0, scale: 1, targetX: 0, targetY: 0, targetScale: 1 };
        posDirtyRef.current = true;
        startAnimation();
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err.message ?? "Failed to load graph");
        setLoading(false);
      });
  }, [bookName]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const handleStartPipeline = async () => {
    setPipelineRunning(true);
    setEmpty(false);
    try {
      await startPipeline(bookName);
      pollRef.current = setInterval(async () => {
        if (!mountedRef.current) return;
        const status = await fetchPipelineStatus(bookName);
        if (!mountedRef.current) return;
        setPipelineStatus(status);
        if (status.status === "completed" || status.graph_built) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPipelineRunning(false);
          setPipelineStatus(null);
          loadGraph();
        }
      }, 2000);
    } catch {
      if (mountedRef.current) {
        setPipelineRunning(false);
        setError("Pipeline start failed");
      }
    }
  };

  const startAnimation = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    let stableFrames = 0;

    const step = () => {
      if (!mountedRef.current) return;
      const energy = simulate();
      if (energy < 0.15) stableFrames++;
      else stableFrames = 0;
      if (stableFrames > 30 && posDirtyRef.current) {
        posDirtyRef.current = false;
      }
      render();
      animFrameRef.current = requestAnimationFrame(step);
    };
    animFrameRef.current = requestAnimationFrame(step);
  };

  const simulate = (): number => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const distSq = dx * dx + dy * dy + 1;
        const force = REPULSION / distSq;
        const dir = 1 / Math.sqrt(distSq);
        a.vx += dx * dir * force;
        a.vy += dy * dir * force;
        b.vx -= dx * dir * force;
        b.vy -= dy * dir * force;
      }
    }

    const maxWeight = Math.max(1, ...edges.map((e) => e.weight ?? 1));
    for (const e of edges) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const w = (e.weight ?? 1) / maxWeight;
      const targetDist = 120 + 60 * w;
      const force = (dist - targetDist) * ATTRACTION;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }

    for (const n of nodes) {
      if (n.isDragging) continue; // Dragged nodes are hand-positioned
      n.vx -= n.x * 0.0005;
      n.vy -= n.y * 0.0005;
    }

    let totalEnergy = 0;
    for (const n of nodes) {
      if (n.isDragging) continue;
      n.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vx)) * DAMPING;
      n.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vy)) * DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      totalEnergy += Math.abs(n.vx) + Math.abs(n.vy);
    }
    return totalEnergy / nodes.length;
  };

  const render = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cam = cameraRef.current;
    cam.x += (cam.targetX - cam.x) * 0.1;
    cam.y += (cam.targetY - cam.y) * 0.1;
    cam.scale += (cam.targetScale - cam.scale) * 0.1;
    zoomLevelRef.current = Math.round(cam.scale * 100) / 100;
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(zoomLevelRef.current * 100)}%`;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-W / 2 + cam.x, -H / 2 + cam.y);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const hovered = hoveredNode.current;
    const hoveredNeighbors = new Set<string>();
    if (hovered) {
      hoveredNeighbors.add(hovered);
      for (const e of edges) {
        if (e.source === hovered) hoveredNeighbors.add(e.target);
        if (e.target === hovered) hoveredNeighbors.add(e.source);
      }
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    const dataW = maxX - minX || 1, dataH = maxY - minY || 1;
    const baseScale = Math.min(W / dataW, H / dataH, 1.5) * 0.8;
    const ox = (W - dataW * baseScale) / 2 - minX * baseScale;
    const oy = (H - dataH * baseScale) / 2 - minY * baseScale;
    const tx = (x: number) => x * baseScale + ox;
    const ty = (y: number) => y * baseScale + oy;

    const maxWeight = Math.max(1, ...edges.map((e) => e.weight ?? 1));

    for (const e of edges) {
      const src = nodeMap.get(e.source), tgt = nodeMap.get(e.target);
      if (!src || !tgt) continue;
      const dim = hovered && !(hoveredNeighbors.has(e.source) && hoveredNeighbors.has(e.target));
      const wNorm = (e.weight ?? 1) / maxWeight;
      const alpha = dim ? 0.08 : 0.15 + wNorm * 0.55;
      ctx.strokeStyle = `rgba(107,114,128,${alpha})`;
      ctx.lineWidth = dim ? 0.2 : 0.4 + wNorm * 2.5;
      ctx.beginPath();
      ctx.moveTo(tx(src.x), ty(src.y));
      ctx.lineTo(tx(tgt.x), ty(tgt.y));
      ctx.stroke();
    }

    for (const n of nodes) {
      const cx = tx(n.x), cy = ty(n.y);
      const r = Math.max(2.5, n.size * baseScale * 0.9);
      const dim = hovered && !hoveredNeighbors.has(n.id);

      ctx.save();
      if (dim) ctx.globalAlpha = 0.18;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = dim ? "rgba(255,255,255,0.3)" : "#fff";
      ctx.lineWidth = dim ? 0.5 : 1.5;
      ctx.stroke();

      const fontSize = Math.max(7, 10 * baseScale * cam.scale);
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";

      const displayLabel = n.label.length > 16 ? n.label.slice(0, 14) + "…" : n.label;
      const labelY = cy + r + fontSize + 2;

      if (!dim) {
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillRect(cx - ctx.measureText(displayLabel).width / 2 - 3, labelY - fontSize + 1,
          ctx.measureText(displayLabel).width + 6, fontSize + 2);
      }
      ctx.fillStyle = dim ? "rgba(55,65,81,0.20)" : "rgba(55,65,81,0.85)";
      ctx.fillText(displayLabel, cx, labelY);

      ctx.restore();
    }

    ctx.restore();

    if (tooltipRef.current) {
      setTooltip({
        id: tooltipRef.current.id,
        label: tooltipRef.current.label,
        type: tooltipRef.current.type,
        degree: tooltipRef.current.degree,
      });
    } else {
      setTooltip(null);
    }
  };

  const getNodeAt = (mx: number, my: number): string | null => {
    const world = screenToWorld(mx, my);
    if (!world) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const cam = cameraRef.current;
    const nodes = nodesRef.current;

    // baseScale (without camera zoom) for converting screen-space padding to data-space
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    const dataW = maxX - minX || 1, dataH = maxY - minY || 1;
    const baseScale = Math.min(W / dataW, H / dataH, 1.5) * 0.8;

    for (const n of nodes) {
      const dx = world.x - n.x;
      const dy = world.y - n.y;
      // Visual radius in data-space: n.size * 0.45, plus 10px screen padding → data-space
      const hitR = n.size * 0.45 + 10 / (baseScale * cam.scale);
      if (dx * dx + dy * dy < hitR * hitR) return n.id;
    }
    return null;
  };

  // ── Convert screen coordinates → world (data-space) coordinates ──
  // Matches the inverse of render(): dataX = ((screenX-W/2)/cam.scale + W/2 - cam.x - ox) / baseScale
  const screenToWorld = (mx: number, my: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const cam = cameraRef.current;
    const nodes = nodesRef.current;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    const dataW = maxX - minX || 1, dataH = maxY - minY || 1;
    const baseScale = Math.min(W / dataW, H / dataH, 1.5) * 0.8;
    const ox = (W - dataW * baseScale) / 2 - minX * baseScale;
    const oy = (H - dataH * baseScale) / 2 - minY * baseScale;

    // Undo canvas transform, then undo data-space transform
    const canvasX = (mx - W / 2) / cam.scale + W / 2 - cam.x;
    const canvasY = (my - H / 2) / cam.scale + H / 2 - cam.y;
    return { x: (canvasX - ox) / baseScale, y: (canvasY - oy) / baseScale };
  };

  // ── Drag: mouseDown / mouseMove / mouseUp ──
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const id = getNodeAt(mx, my);
    if (id) {
      // ── Node drag ──
      draggedNodeRef.current = id;
      const node = nodesRef.current.find((n) => n.id === id);
      if (node) {
        node.isDragging = true;
        node.vx = 0;
        node.vy = 0;
      }
    } else {
      // ── Canvas pan ──
      isPanningRef.current = true;
      lastPanPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
    if (draggedNodeRef.current) {
      const node = nodesRef.current.find((n) => n.id === draggedNodeRef.current);
      if (node) node.isDragging = false;
      draggedNodeRef.current = null;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    // ── Canvas panning ──
    if (isPanningRef.current) {
      const dx = e.clientX - lastPanPosRef.current.x;
      const dy = e.clientY - lastPanPosRef.current.y;
      lastPanPosRef.current = { x: e.clientX, y: e.clientY };
      const cam = cameraRef.current;
      cam.targetX += dx / cam.scale;
      cam.targetY += dy / cam.scale;
      cam.x = cam.targetX;
      cam.y = cam.targetY;
      canvas.style.cursor = "grabbing";
      return;
    }

    // ── Node drag ──
    if (draggedNodeRef.current) {
      const world = screenToWorld(mx, my);
      if (world) {
        const node = nodesRef.current.find((n) => n.id === draggedNodeRef.current);
        if (node) { node.x = world.x; node.y = world.y; }
      }
      canvas.style.cursor = "grabbing";
      return;
    }

    const id = getNodeAt(mx, my);
    hoveredNode.current = id;
    canvas.style.cursor = id ? "pointer" : "grab";

    if (id) {
      const n = nodesRef.current.find((n) => n.id === id);
      if (n) {
        tooltipRef.current = { id: n.id, label: n.label, type: n.type ?? "default", degree: n.degree, x: e.clientX, y: e.clientY };
        return;
      }
    }
    tooltipRef.current = null;
  };

  const handleClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const id = getNodeAt(mx, my);
    if (id) {
      const node = nodesRef.current.find((n) => n.id === id);
      console.log("🔍 Node clicked:", { id: node?.id, label: node?.label, type: node?.type, degree: node?.degree });
      if (node) {
        cameraRef.current.targetScale = 2.5;
      }

      // Fetch chapter content for knowledge card
      const filePath = id + ".md"; // node IDs are stem names
      setCardLoading(true);
      setKnowledgeCard(null);
      try {
        const res = await fetchChapterContent(bookName, filePath);
        setKnowledgeCard({
          nodeId: id,
          title: node?.label || id,
          content: res.content.slice(0, 600),
        });
      } catch {
        // Node might not have a corresponding chapter — show summary only
        setKnowledgeCard({
          nodeId: id,
          title: node?.label || id,
          content: `概念节点: ${node?.label || id}\n类型: ${node?.type || "未分类"}\n关联数: ${node?.degree || 0}`,
        });
      } finally {
        setCardLoading(false);
      }
    } else {
      // Deselect knowledge card; do NOT reset zoom/pan so the user's viewport stays
      setKnowledgeCard(null);
    }
  };

  // ── Navigate to chapter from knowledge card ──
  // Graph node IDs are synthetic (e.g. "concept-系统科学"), NOT real file paths.
  // We MUST find the actual chapter by matching the concept label against chapter titles.
  const handleNavigateToSource = () => {
    if (!knowledgeCard) return;

    const conceptLabel = knowledgeCard.title;
    const chapters = useReaderStore.getState().chapters;

    // Search for the source chapter by matching concept label against chapter titles
    const match = chapters.find((ch) => {
      const cleanTitle = ch.title.replace(/^\d+_/, "");
      return ch.title.includes(conceptLabel) || conceptLabel.includes(cleanTitle);
    });

    if (match) {
      useReaderStore.getState().setChapter(match.path, match.title);
    }

    useReaderStore.getState().setHighlightQuery(conceptLabel);
    closeModal();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleMouseLeave = () => {
    hoveredNode.current = null;
    tooltipRef.current = null;
    isPanningRef.current = false;
    // Release any dragged node
    if (draggedNodeRef.current) {
      const node = nodesRef.current.find((n) => n.id === draggedNodeRef.current);
      if (node) node.isDragging = false;
      draggedNodeRef.current = null;
    }
  };

  // ── Wheel zoom with pointer compensation ──
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = rect.width, H = rect.height;

    const cam = cameraRef.current;
    const oldScale = cam.scale;
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newScale = Math.max(0.2, Math.min(4, oldScale * zoomFactor));
    if (newScale === oldScale) return;

    // Compute pan offset in screenX = worldX * scale + panX convention
    const panOldX = W / 2 + (cam.x - W / 2) * oldScale;
    const panOldY = H / 2 + (cam.y - H / 2) * oldScale;

    // Zoom-to-pointer formula
    const panNewX = mx - (mx - panOldX) * (newScale / oldScale);
    const panNewY = my - (my - panOldY) * (newScale / oldScale);

    // Convert back to camera x/y
    cam.targetX = (panNewX - W / 2) / newScale + W / 2;
    cam.targetY = (panNewY - H / 2) / newScale + H / 2;
    cam.targetScale = newScale;
    // Snap immediately for responsive wheel feel (no lerp lag)
    cam.x = cam.targetX;
    cam.y = cam.targetY;
    cam.scale = newScale;
  };

  const zoomIn = () => {
    cameraRef.current.targetScale = Math.min(cameraRef.current.targetScale * 1.4, 4);
  };
  const zoomOut = () => {
    cameraRef.current.targetScale = Math.max(cameraRef.current.targetScale * 0.7, 0.3);
  };
  const zoomReset = () => {
    cameraRef.current.targetScale = 1;
    cameraRef.current.targetX = 0;
    cameraRef.current.targetY = 0;
  };

  // ── Legend types ──
  const legendTypes = Object.keys(TYPE_COLORS).filter((k) => k !== "default");

  // ── Loading ──
  if (loading && !pipelineRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 size={28} className="animate-spin text-neutral-300" />
        <p className="text-sm text-neutral-400">图谱加载中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle size={28} className="text-red-300" />
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (pipelineRunning) {
    const total = pipelineStatus?.total_chapters ?? 0;
    const done = pipelineStatus?.completed_chapters?.length ?? 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <Loader2 size={32} className="animate-spin text-neutral-400" />
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-neutral-500">正在提取概念实体…</span>
            <span className="text-xs font-mono text-neutral-500">{done} / {total}</span>
          </div>
          <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div className="h-full bg-neutral-700 rounded-full transition-all duration-500 ease-out" style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
          <p className="text-[10px] text-neutral-400 mt-1.5 text-center">
            {pct > 0 ? `${pct}% — 大模型正在扫描章节提取概念节点` : "任务已启动…"}
          </p>
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <GitGraph size={36} className="text-neutral-300" />
        <p className="text-sm text-neutral-500 mb-1">图谱生成中或暂无数据</p>
        <p className="text-xs text-neutral-400 mb-4">让大模型自动提炼知识网络</p>
        <button
          onClick={handleStartPipeline}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-neutral-800 text-white hover:bg-neutral-700 active:scale-95 transition-all"
        >
          <Play size={16} />
          立刻让大模型开始提炼知识网络
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[75vh]">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onWheel={handleWheel}
      />

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-white/90 backdrop-blur border border-neutral-200 rounded-lg shadow-sm p-1">
        <button onClick={zoomIn} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors" title="放大">
          <Plus size={14} className="text-neutral-600" />
        </button>
        <span ref={zoomLabelRef} className="text-[10px] text-neutral-400 w-10 text-center tabular-nums select-none">100%</span>
        <button onClick={zoomOut} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors" title="缩小">
          <Minus size={14} className="text-neutral-600" />
        </button>
        <button onClick={zoomReset} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors border-l border-neutral-200 ml-0.5 pl-2" title="重置">
          <RotateCcw size={12} className="text-neutral-500" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur border border-neutral-200 rounded-lg shadow-sm p-3 text-xs">
        <h5 className="font-medium text-neutral-600 mb-2">图例</h5>
        <div className="space-y-1.5">
          {legendTypes.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLORS[t] }} />
              <span className="text-neutral-500">{TYPE_LABELS[t] ?? t}</span>
            </div>
          ))}
          <div className="border-t border-neutral-150 my-1 pt-1">
            <div className="flex items-center gap-2 text-neutral-400 text-[10px]">
              <span>○ 大小 = 关联数</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur border border-neutral-200 rounded-lg shadow-md px-3 py-2 text-xs z-10 pointer-events-none">
          <span className="font-semibold text-neutral-700">{tooltip.label}</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[tooltip.type] ?? TYPE_COLORS.default }} />
            <span className="text-neutral-500">{TYPE_LABELS[tooltip.type] ?? tooltip.type}</span>
            <span className="text-neutral-300">·</span>
            <span className="text-neutral-500">{tooltip.degree} 条关联</span>
          </div>
        </div>
      )}

      {/* Knowledge Card Overlay */}
      {knowledgeCard && (
        <div className="absolute top-3 left-3 right-3 max-w-sm bg-white/95 backdrop-blur border border-neutral-200 rounded-xl shadow-lg p-4 z-20">
          {cardLoading && (
            <div className="flex items-center gap-2 text-xs text-neutral-400 py-2">
              <Loader2 size={12} className="animate-spin" />
              加载中…
            </div>
          )}
          {!cardLoading && (
            <>
              <h4 className="text-sm font-semibold text-neutral-800 mb-1">{knowledgeCard.title}</h4>
              <p className="text-xs text-neutral-500 leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                {knowledgeCard.content}
                {knowledgeCard.content.length >= 600 && "…"}
              </p>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-neutral-100">
                <button
                  onClick={() => setKnowledgeCard(null)}
                  className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  关闭
                </button>
                <button
                  onClick={handleNavigateToSource}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
                >
                  <ExternalLink size={12} />
                  导航至原文
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
