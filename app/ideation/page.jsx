"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import ScrollStack, { ScrollStackItem } from "../components/ScrollStack";
import TextPressure from "../components/TextPressure";

// Enhanced UI tokens for the Ideiuda design
const ui = {
  bg: "#0f0f12",
  pane: "#141416", 
  ink: "#ffffff",
  faint: "#6b6b6b",
  accent: "#8B5CF6",
  border: 160,
  maxDim: 2048,
  stroke: 3,
};

export default function IdeationPad() {
  const [baseImg, setBaseImg] = useState(null);        // ImageBitmap of the site photo
  const [refsImgs, setRefsImgs] = useState([]);        // array of ImageBitmap refs
  const [prompt, setPrompt] = useState("");
  const [resultURL, setResultURL] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("pen");             // "pen" | "eraser"
  const [isDragging, setIsDragging] = useState(false);  // drag-and-drop visual state
  const [isDraggingOverCanvas, setIsDraggingOverCanvas] = useState(false); // drag over canvas center
  const [elapsedMs, setElapsedMs] = useState(0);        // timer for generation
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // sidebar collapse state
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false); // right panel collapse state
  const timerRef = useRef(null);
  const [refsFiles, setRefsFiles] = useState([]);        // original File objects for refs
  const [refsPositions, setRefsPositions] = useState([]); // positions for reference images
  const [dragState, setDragState] = useState({ isDragging: false, dragIndex: -1, offset: { x: 0, y: 0 } });
  const [hoverState, setHoverState] = useState({ isHovering: false, hoverIndex: -1 });
  const [drawColor, setDrawColor] = useState("#ffffff"); // Drawing color
  const [showColorPicker, setShowColorPicker] = useState(false); // Color picker visibility
  const [strokeWidth, setStrokeWidth] = useState(3); // Stroke width
  const [colorHsv, setColorHsv] = useState({ h: 240, s: 100, v: 100 }); // HSV values for advanced picker
  const [colorOpacity, setColorOpacity] = useState(100); // Opacity percentage
  
  // Image stack for iterative editing
  const [imageStack, setImageStack] = useState([]);     // Array of {bitmap, url, timestamp} objects
  const [activeImageIndex, setActiveImageIndex] = useState(0); // Index of currently active image

  // canvases
  const viewCanvasRef = useRef(null);     // shows current composition
  const drawCanvasRef = useRef(null);     // sketch layer
  const offscreenRef = useRef(null);      // for flatten/export
  const containerRef = useRef(null);      // container to scale preview to fit

  // drawing state
  const drawing = useRef(false);
  const lastPt = useRef({ x: 0, y: 0 });

  // Handle photo input (camera or file)
  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const bmp = await fileToBitmap(file, ui.maxDim);
    const url = URL.createObjectURL(file);
    
    // Initialize the image stack with the first image
    const initialImage = {
      bitmap: bmp,
      url: url,
      timestamp: Date.now(),
      isOriginal: true
    };
    
    setBaseImg(bmp);
    setImageStack([initialImage]);
    setActiveImageIndex(0);
  }

  // Handle ref images (multi)
  async function handleRefs(e) {
    const files = [...(e.target.files || [])];
    const bitmaps = await Promise.all(files.map(f => fileToBitmap(f, 512)));
    setRefsImgs((prev) => [...prev, ...bitmaps]);
    setRefsFiles((prev) => [...prev, ...files]);
    
    // Initialize default positions for new reference images
    setRefsPositions((prev) => {
      const newPositions = [...prev];
      const startIndex = prev.length;
      for (let i = 0; i < bitmaps.length; i++) {
        newPositions.push(getDefaultPosition(startIndex + i));
      }
      return newPositions;
    });
  }

  // Get default position for reference image based on index
  function getDefaultPosition(index) {
    const pad = 8, thumb = 120, gap = 10;
    
    if (index < 3) {
      // Top row
      return { x: pad + index * (thumb + gap), y: pad };
    } else {
      // Right column
      return { x: 0, y: ui.border + gap + (index - 3) * (thumb + gap) }; // x will be set in placeRefs
    }
  }

  // Drag and drop support
  function onDragOver(e) {
    e.preventDefault();
    // Check if dragging over canvas center and update state
    if (baseImg && isDropInCanvasCenter(e)) {
      setIsDraggingOverCanvas(true);
    } else {
      setIsDraggingOverCanvas(false);
    }
  }
  function onDragEnter(e) {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave() {
    setIsDragging(false);
    setIsDraggingOverCanvas(false);
  }
  // Helper function to check if drop is in canvas center area
  function isDropInCanvasCenter(e) {
    if (!baseImg || !containerRef.current) return false;
    
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    // Get drop coordinates relative to the container
    const dropX = e.clientX - containerRect.left;
    const dropY = e.clientY - containerRect.top;
    
    // Calculate the actual canvas dimensions and border
    const canvasW = baseImg.width + ui.border * 2;
    const canvasH = baseImg.height + ui.border * 2;
    
    // Get the scale factor used to fit the canvas in viewport (mobile-responsive)
    const isMobile = window.innerWidth < 768;
    const viewportW = window.innerWidth - (isMobile ? 24 : 100);
    const viewportH = window.innerHeight - (isMobile ? 140 : 200);
    const scaleW = viewportW / canvasW;
    const scaleH = viewportH / canvasH;
    const cssScale = Math.min(1, scaleW, scaleH);
    
    const displayW = canvasW * cssScale;
    const displayH = canvasH * cssScale;
    
    // Calculate the center area (base image area, not the border)
    const borderScaled = ui.border * cssScale;
    const centerX = borderScaled;
    const centerY = borderScaled;
    const centerW = baseImg.width * cssScale;
    const centerH = baseImg.height * cssScale;
    
    // Check if drop is within the center canvas area
    return dropX >= centerX && dropX <= centerX + centerW && 
           dropY >= centerY && dropY <= centerY + centerH;
  }

  async function onDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    setIsDraggingOverCanvas(false);
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type?.startsWith("image/"));
    if (!files.length) return;

    if (!baseImg) {
      // No base image yet - set first file as base image
      const [first, ...rest] = files;
      const base = await fileToBitmap(first, ui.maxDim);
      const url = URL.createObjectURL(first);
      
      // Initialize the image stack with the first image
      const initialImage = {
        bitmap: base,
        url: url,
        timestamp: Date.now(),
        isOriginal: true
      };
      
      setBaseImg(base);
      setImageStack([initialImage]);
      setActiveImageIndex(0);
      setRefsFiles((prev) => [...prev, ...rest]);
      if (rest.length) {
        const refs = await Promise.all(rest.map(f => fileToBitmap(f, 512)));
        setRefsImgs(prev => [...prev, ...refs]);
        // Initialize positions for dropped refs
        setRefsPositions((prev) => {
          const newPositions = [...prev];
          const startIndex = prev.length;
          for (let i = 0; i < refs.length; i++) {
            newPositions.push(getDefaultPosition(startIndex + i));
          }
          return newPositions;
        });
      }
    } else if (isDropInCanvasCenter(e)) {
      // Drop in canvas center - create new version with first file
      const [first, ...rest] = files;
      const newBase = await fileToBitmap(first, ui.maxDim);
      const url = URL.createObjectURL(first);
      
      // Create new version in image stack
      const newImage = {
        bitmap: newBase,
        url: url,
        timestamp: Date.now(),
        isOriginal: false,
        isDroppedVersion: true
      };
      
      // Add to front of stack (most recent first)
      setImageStack(prev => [newImage, ...prev]);
      setActiveImageIndex(0);
      
      // Update the base image to the new dropped image
      setBaseImg(newBase);
      
      // Clear the sketch layer for the new image
      clearSketch();
      
      // Handle remaining files as references if any
      if (rest.length) {
        const refs = await Promise.all(rest.map(f => fileToBitmap(f, 512)));
        setRefsImgs(prev => [...prev, ...refs]);
        setRefsFiles(prev => [...prev, ...rest]);
        // Initialize positions for dropped refs
        setRefsPositions((prev) => {
          const newPositions = [...prev];
          const startIndex = prev.length;
          for (let i = 0; i < refs.length; i++) {
            newPositions.push(getDefaultPosition(startIndex + i));
          }
          return newPositions;
        });
      }
    } else {
      // Drop outside canvas center - add as reference images
      const refs = await Promise.all(files.map(f => fileToBitmap(f, 512)));
      setRefsImgs(prev => [...prev, ...refs]);
      setRefsFiles(prev => [...prev, ...files]);
      // Initialize positions for dropped refs
      setRefsPositions((prev) => {
        const newPositions = [...prev];
        const startIndex = prev.length;
        for (let i = 0; i < refs.length; i++) {
          newPositions.push(getDefaultPosition(startIndex + i));
        }
        return newPositions;
      });
    }
  }

  // Draw loop: render base + border + refs onto the view canvas
  useEffect(() => {
    redraw();
  }, [baseImg, refsImgs, refsPositions, dragState, hoverState]);

  function redraw() {
    const view = viewCanvasRef.current;
    if (!view || !baseImg) return;

    const ctx = view.getContext("2d");
    const scale = devicePixelRatio || 1;

    // Compute composition canvas size: base image plus border
    const W = Math.round(baseImg.width + ui.border * 2);
    const H = Math.round(baseImg.height + ui.border * 2);

    // Get viewport dimensions, accounting for UI elements (mobile-responsive)
    const isMobile = window.innerWidth < 768;
    const viewportW = window.innerWidth - (isMobile ? 24 : 100); // Account for sidebar padding
    const viewportH = window.innerHeight - (isMobile ? 140 : 200); // Account for prompt bar/footer UI (no header on mobile)
    
    // compute CSS scale to fit viewport while maintaining aspect ratio (don't upscale)
    const scaleW = viewportW / W;
    const scaleH = viewportH / H;
    const cssScale = Math.min(1, scaleW, scaleH);
    const displayW = Math.round(W * cssScale);
    const displayH = Math.round(H * cssScale);

    // Set container size to fit the scaled canvas
    const container = containerRef.current;
    if (container) {
      container.style.width = `${displayW}px`;
      container.style.height = `${displayH}px`;
    }

    // resize canvases to device pixels (full resolution)
    view.width = Math.round(W * scale);
    view.height = Math.round(H * scale);
    // set displayed size (CSS) scaled to fit viewport
    view.style.width = `${displayW}px`;
    view.style.height = `${displayH}px`;

    const draw = drawCanvasRef.current;
    
    // Preserve existing drawing before resizing
    const preservedDrawing = (draw.width !== view.width || draw.height !== view.height) ? preserveDrawing() : null;
    
    draw.width = view.width;
    draw.height = view.height;
    draw.style.width = `${displayW}px`;
    draw.style.height = `${displayH}px`;
    // Position draw canvas exactly over view canvas
    draw.style.left = `0px`;
    draw.style.top = `0px`;
    draw.style.zIndex = 1;
    
    // Restore drawing if it was preserved
    if (preservedDrawing) {
      restoreDrawing(preservedDrawing);
    }

    // paint background + border
    ctx.scale(scale, scale);
    ctx.fillStyle = ui.pane;
    ctx.fillRect(0, 0, W, H);

    // inner mat (subtle)
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(ui.border - 4, ui.border - 4, baseImg.width + 8, baseImg.height + 8);

    // base photo centered within border
    ctx.drawImage(baseImg, ui.border, ui.border);

    // refs positioned around the border
    placeRefs(ctx, refsImgs, W, H, baseImg, refsPositions);

    // outline
    ctx.strokeStyle = "#2a2a2d";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // reset scaling for future draws
    ctx.setTransform(1,0,0,1,0,0);
  }

  // Place refs using stored positions
  function placeRefs(ctx, imgs, W, H, base, positions) {
    const thumb = 120;
    
    imgs.forEach((img, i) => {
      if (i >= positions.length) return;
      
      let { x, y } = positions[i];
      
      // For right column items, calculate x position dynamically
      if (i >= 3) {
        x = W - ui.border + 10; // 10px gap from border
      }
      
      // Ensure positions are within bounds
      x = Math.max(8, Math.min(x, W - thumb - 8));
      y = Math.max(8, Math.min(y, H - thumb - 8));
      
      drawThumb(ctx, img, x, y, thumb, i);
    });
  }

  function drawThumb(ctx, im, x, y, size, index = -1) {
    const r = size / Math.max(im.width, im.height);
    const w = Math.round(im.width * r);
    const h = Math.round(im.height * r);
    const ox = x + Math.round((size - w) / 2);
    const oy = y + Math.round((size - h) / 2);

    // tile box
    ctx.fillStyle = "#101012";
    ctx.fillRect(x, y, size, size);
    ctx.drawImage(im, ox, oy, w, h);
    
    // Check states
    const isDragging = dragState.isDragging && dragState.dragIndex === index;
    const isHovering = hoverState.isHovering && hoverState.hoverIndex === index;
    
    // Border styling and overlay
    if (isDragging) {
      ctx.strokeStyle = "#8B5CF6";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(139, 92, 246, 0.3)";
      ctx.fillRect(x, y, size, size);
    } else if (isHovering) {
      ctx.strokeStyle = "#8B5CF6";
      ctx.lineWidth = 2;
      // Show entire area as draggable with more visible overlay
      ctx.fillStyle = "rgba(139, 92, 246, 0.15)";
      ctx.fillRect(x, y, size, size);
    } else {
      ctx.strokeStyle = "#2a2a2d";
      ctx.lineWidth = 1;
    }
    
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }

  // Check if point is within a reference image (entire area is draggable)
  function getRefAtPoint(x, y) {
    const thumb = 120;
    const tolerance = 2; // Add small tolerance for easier detection
    const view = viewCanvasRef.current;
    if (!view || !baseImg) return -1;
    
    const W = Math.round(baseImg.width + ui.border * 2);
    const H = Math.round(baseImg.height + ui.border * 2);
    
    // Check from last to first to prioritize recently added/moved references
    for (let i = refsImgs.length - 1; i >= 0; i--) {
      if (i >= refsPositions.length) continue;
      
      let { x: refX, y: refY } = refsPositions[i];
      
      // For right column items, calculate x position dynamically
      if (i >= 3) {
        refX = W - ui.border + 10;
      }
      
      // Ensure positions are within bounds
      refX = Math.max(8, Math.min(refX, W - thumb - 8));
      refY = Math.max(8, Math.min(refY, H - thumb - 8));
      
      // Check if point is within the reference image with tolerance
      if (x >= refX - tolerance && x <= refX + thumb + tolerance && 
          y >= refY - tolerance && y <= refY + thumb + tolerance) {
        return i;
      }
    }
    return -1;
  }

  // Pointer events for sketching and dragging (on drawCanvasRef)
  function onPointerDown(e) {
    if (!baseImg) return;
    const c = drawCanvasRef.current;
    const { x, y } = clientToCanvas(e, c);
    
    // Check if clicking on a reference image
    const refIndex = getRefAtPoint(x, y);
    if (refIndex !== -1) {
      // Start dragging reference image
      c.setPointerCapture(e.pointerId);
      const refPos = refsPositions[refIndex];
      let refX = refPos.x;
      if (refIndex >= 3) {
        const W = Math.round(baseImg.width + ui.border * 2);
        refX = W - ui.border + 10;
      }
      
      // Clear hover state and set drag state
      setHoverState({ isHovering: false, hoverIndex: -1 });
      setDragState({
        isDragging: true,
        dragIndex: refIndex,
        offset: { x: x - refX, y: y - refPos.y }
      });
      return;
    }
    
    // Regular drawing
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPt.current = { x, y };
    drawStroke(lastPt.current, lastPt.current, true);
  }
  function onPointerMove(e) {
    const c = drawCanvasRef.current;
    const pt = clientToCanvas(e, c);
    
    // Handle reference image dragging
    if (dragState.isDragging) {
      const newX = pt.x - dragState.offset.x;
      const newY = pt.y - dragState.offset.y;
      
      // Update position
      setRefsPositions(prev => {
        const newPositions = [...prev];
        newPositions[dragState.dragIndex] = { x: newX, y: newY };
        return newPositions;
      });
      return;
    }
    
    // Check for hover on references (only when not drawing and not dragging)
    if (!drawing.current && !dragState.isDragging) {
      const refIndex = getRefAtPoint(pt.x, pt.y);
      
      if (refIndex !== -1) {
        // Mouse is over a reference image
        if (!hoverState.isHovering || hoverState.hoverIndex !== refIndex) {
          setHoverState({ isHovering: true, hoverIndex: refIndex });
        }
        c.style.cursor = 'move';
      } else {
        // Mouse is not over any reference image
        if (hoverState.isHovering) {
          setHoverState({ isHovering: false, hoverIndex: -1 });
        }
        c.style.cursor = 'crosshair';
      }
    }
    
    // Regular drawing
    if (!drawing.current) return;
    drawStroke(lastPt.current, pt);
    lastPt.current = pt;
  }
  function onPointerUp(e) {
    const c = drawCanvasRef.current;
    
    // End dragging and check for immediate hover state
    if (dragState.isDragging) {
      setDragState({ isDragging: false, dragIndex: -1, offset: { x: 0, y: 0 } });
      
      // Check if mouse is still over a reference after drag ends
      const pt = clientToCanvas(e, c);
      const refIndex = getRefAtPoint(pt.x, pt.y);
      if (refIndex !== -1) {
        setHoverState({ isHovering: true, hoverIndex: refIndex });
        c.style.cursor = 'move';
      } else {
        setHoverState({ isHovering: false, hoverIndex: -1 });
        c.style.cursor = 'crosshair';
      }
    }
    
    drawing.current = false;
    c.releasePointerCapture?.(e.pointerId);
  }

  function drawStroke(a, b, dot = false) {
    const ctx = drawCanvasRef.current.getContext("2d");
    const s = strokeWidth * (devicePixelRatio || 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = s;
    ctx.globalCompositeOperation = (mode === "eraser") ? "destination-out" : "source-over";
    
    // Apply opacity to color
    const opacity = colorOpacity / 100;
    if (mode === "eraser") {
      ctx.strokeStyle = ui.ink;
    } else {
      const r = parseInt(drawColor.slice(1, 3), 16);
      const g = parseInt(drawColor.slice(3, 5), 16);
      const b = parseInt(drawColor.slice(5, 7), 16);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    if (dot) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, s / 2, 0, Math.PI * 2);
      if (mode === "eraser") {
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.globalCompositeOperation = "destination-out";
      } else {
        const r = parseInt(drawColor.slice(1, 3), 16);
        const g = parseInt(drawColor.slice(3, 5), 16);
        const b = parseInt(drawColor.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
      ctx.fill();
    }
  }

  // Reset page zoom to 100%
  function resetPageZoom() {
    try {
      // Reset zoom on mobile browsers
      if (typeof document !== 'undefined') {
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
          // Force reflow
          setTimeout(() => {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
          }, 100);
        }
        
        // For desktop browsers that support zoom
        if (document.body && document.body.style) {
          document.body.style.zoom = '1';
          document.documentElement.style.zoom = '1';
        }
      }
    } catch (error) {
      console.log('Zoom reset not supported on this browser');
    }
  }

  // Flatten both canvases and POST to /api/generate-image
  async function onGenerate() {
    if (!baseImg || !prompt) return;
    
    // Reset page zoom before generation
    resetPageZoom();
    
    setLoading(true);
    setResultURL(null);
    setElapsedMs(0);
    const start = performance.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedMs(performance.now() - start);
    }, 100);

    const { blob } = flatten();
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("image", blob, "composite.png");
    // attach reference files
    for (const f of refsFiles) {
      try { form.append("refs", f, f.name || "ref.png"); } catch {}
    }

    try {
      console.log("[ideation] POST /api/generate-image with:", { promptLen: prompt.length, blobSize: blob.size, blobType: blob.type });
      const res = await fetch("/api/generate-image", { method: "POST", body: form });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          errMsg = j?.error || errMsg;
          console.log("[ideation] server error payload:", j);
        } catch {}
        throw new Error(errMsg);
      }
      const out = await res.blob();
      console.log("[ideation] received image blob:", { size: out.size, type: out.type });
      
      // Convert blob to bitmap and crop the border
      const rawBitmap = await createImageBitmap(out);
      const croppedBitmap = await cropBorder(rawBitmap);
      
      // Create URL from cropped image
      const croppedCanvas = document.createElement("canvas");
      croppedCanvas.width = croppedBitmap.width;
      croppedCanvas.height = croppedBitmap.height;
      const croppedCtx = croppedCanvas.getContext("2d");
      croppedCtx.drawImage(croppedBitmap, 0, 0);
      const croppedBlob = await new Promise(resolve => croppedCanvas.toBlob(resolve, "image/png"));
      const newUrl = URL.createObjectURL(croppedBlob);
      
      const newImage = {
        bitmap: croppedBitmap,
        url: newUrl,
        timestamp: Date.now(),
        isOriginal: false,
        prompt: prompt
      };
      
      // Add to front of stack (most recent first)
      setImageStack(prev => [newImage, ...prev]);
      setActiveImageIndex(0);
      
      // Update the base image to the new generation
      setBaseImg(croppedBitmap);
      
      // Clear the sketch layer for the new image
      clearSketch();
    } catch (e) {
      console.error("[ideation] generate error:", e);
      alert(e.message || "Failed");
    } finally {
      setLoading(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  function flatten() {
    const view = viewCanvasRef.current;
    const draw = drawCanvasRef.current;
    const scale = devicePixelRatio || 1;

    // Create a canvas at 1x pixels (avoid double-scaling when exporting)
    const W = view.width / scale;
    const H = view.height / scale;

    let c = offscreenRef.current;
    if (!c) {
      c = document.createElement("canvas");
      offscreenRef.current = c;
    }
    c.width = Math.round(W);
    c.height = Math.round(H);

    const ctx = c.getContext("2d");
    // paint the view (already has base + border + refs)
    ctx.drawImage(view, 0, 0, view.width, view.height, 0, 0, W, H);
    // paint the sketch layer
    ctx.drawImage(draw, 0, 0, draw.width, draw.height, 0, 0, W, H);

    const blob = dataURLtoBlob(c.toDataURL("image/png"));
    return { canvas: c, blob };
  }

  function clearSketch() {
    const d = drawCanvasRef.current;
    if (!d) return; // Exit if canvas doesn't exist yet
    const ctx = d.getContext("2d");
    ctx.clearRect(0, 0, d.width, d.height);
  }

  // Preserve drawing when canvas is resized
  function preserveDrawing() {
    const d = drawCanvasRef.current;
    if (!d) return null;
    
    // Create a temporary canvas to store the current drawing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = d.width;
    tempCanvas.height = d.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(d, 0, 0);
    return tempCanvas;
  }

  function restoreDrawing(tempCanvas) {
    const d = drawCanvasRef.current;
    if (!d || !tempCanvas) return;
    
    const ctx = d.getContext('2d');
    ctx.drawImage(tempCanvas, 0, 0);
  }

  function startOver() {
    // Reset all state to start fresh
    setBaseImg(null);
    setRefsImgs([]);
    setRefsFiles([]);
    setRefsPositions([]);
    setPrompt("");
    setResultURL(null);
    setLoading(false);
    setDragState({ isDragging: false, dragIndex: -1, offset: { x: 0, y: 0 } });
    setHoverState({ isHovering: false, hoverIndex: -1 });
    setShowColorPicker(false);
    setDrawColor("#ffffff");
    setStrokeWidth(3);
    setColorHsv({ h: 240, s: 100, v: 100 });
    setColorOpacity(100);
    
    // Reset image stack
    setImageStack([]);
    setActiveImageIndex(0);
    
    // Clear any existing sketches
    clearSketch();
    
    // Reset canvas container styling
    if (containerRef.current) {
      containerRef.current.style.width = '';
      containerRef.current.style.height = '';
    }
    
    // Reset canvas styling
    if (viewCanvasRef.current) {
      viewCanvasRef.current.style.width = '';
      viewCanvasRef.current.style.height = '';
    }
    
    if (drawCanvasRef.current) {
      drawCanvasRef.current.style.width = '';
      drawCanvasRef.current.style.height = '';
      drawCanvasRef.current.style.left = '';
      drawCanvasRef.current.style.top = '';
    }
    
    // Clear any running timers
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMs(0);
  }

  // Color conversion helpers
  function hsvToHex(h, s, v) {
    const c = v * s / 10000;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v / 100 - c;
    
    let r, g, b;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    
    let h = 0;
    if (diff !== 0) {
      if (max === r) h = ((g - b) / diff) % 6;
      else if (max === g) h = (b - r) / diff + 2;
      else h = (r - g) / diff + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    
    const s = max === 0 ? 0 : Math.round((diff / max) * 100);
    const v = Math.round(max * 100);
    
    return { h, s, v };
  }

  // Update color when HSV changes
  function updateColorFromHsv(newHsv) {
    setColorHsv(newHsv);
    const hexColor = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setDrawColor(hexColor);
  }

  // Update HSV when hex changes
  function updateColorFromHex(hex) {
    setDrawColor(hex);
    const hsv = hexToHsv(hex);
    setColorHsv(hsv);
  }

  // Helpers
  function clientToCanvas(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  // Keep preview fit in sync on window resize
  useEffect(() => {
    function onResize() {
      redraw();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [baseImg, refsImgs]);

  // Close color picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (showColorPicker && !event.target.closest('.color-picker-container')) {
        setShowColorPicker(false);
      }
    }
    
    if (showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showColorPicker]);

  // Prevent browser from navigating on accidental drop outside zones
  useEffect(() => {
    function prevent(e) { e.preventDefault(); }
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  async function fileToBitmap(file, maxDim) {
    const imgURL = URL.createObjectURL(file);
    const img = await createImageBitmap(await fetch(imgURL).then(r => r.blob()));
    URL.revokeObjectURL(imgURL);

    // downscale if needed (iPad memory safety)
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (ratio === 1) return img;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, "image/png", 0.92));
    return await createImageBitmap(blob);
  }

  function dataURLtoBlob(dataUrl) {
    const [hdr, data] = dataUrl.split(",");
    const mime = hdr.match(/:(.*?);/)[1];
    const bin = atob(data);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // Crop the border from a generated image
  async function cropBorder(imageBitmap) {
    if (!baseImg) return imageBitmap;
    
    // Log dimensions for debugging
    console.log("[cropBorder] baseImg dimensions:", baseImg.width, "x", baseImg.height);
    console.log("[cropBorder] generated image dimensions:", imageBitmap.width, "x", imageBitmap.height);
    console.log("[cropBorder] expected composite dimensions:", baseImg.width + ui.border * 2, "x", baseImg.height + ui.border * 2);
    
    // Calculate the expected dimensions with border
    const expectedW = baseImg.width + ui.border * 2;
    const expectedH = baseImg.height + ui.border * 2;
    
    // Check if the generated image matches our expected composite size
    if (imageBitmap.width !== expectedW || imageBitmap.height !== expectedH) {
      console.log("[cropBorder] Size mismatch! Generated image doesn't match expected composite size.");
      
      // Calculate scaling factors
      const scaleX = imageBitmap.width / expectedW;
      const scaleY = imageBitmap.height / expectedH;
      
      // Create a canvas to crop the image with scaling
      const canvas = document.createElement("canvas");
      canvas.width = baseImg.width;
      canvas.height = baseImg.height;
      const ctx = canvas.getContext("2d");
      
      // Calculate scaled border and dimensions
      const scaledBorderX = ui.border * scaleX;
      const scaledBorderY = ui.border * scaleY;
      const scaledWidth = baseImg.width * scaleX;
      const scaledHeight = baseImg.height * scaleY;
      
      console.log("[cropBorder] Using scaled crop:", scaledBorderX, scaledBorderY, scaledWidth, scaledHeight);
      
      // Draw the scaled crop
      ctx.drawImage(
        imageBitmap,
        scaledBorderX, scaledBorderY, scaledWidth, scaledHeight, // source: scaled crop area
        0, 0, baseImg.width, baseImg.height // destination: original base image size
      );
      
      // Convert back to ImageBitmap
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return await createImageBitmap(blob);
    } else {
      // Perfect size match, use original logic
      const canvas = document.createElement("canvas");
      canvas.width = baseImg.width;
      canvas.height = baseImg.height;
      const ctx = canvas.getContext("2d");
      
      // Draw only the center part (without border) from the generated image
      ctx.drawImage(
        imageBitmap,
        ui.border, ui.border, baseImg.width, baseImg.height, // source: crop from border to center
        0, 0, baseImg.width, baseImg.height // destination: fill entire canvas
      );
      
      // Convert back to ImageBitmap
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return await createImageBitmap(blob);
    }
  }

  // Function to switch to a different image in the stack
  function switchToImage(index) {
    if (index >= 0 && index < imageStack.length) {
      setActiveImageIndex(index);
      setBaseImg(imageStack[index].bitmap);
      clearSketch(); // Clear any existing sketches when switching images
    }
  }

  // Show scroll stack modal
  const [showScrollStack, setShowScrollStack] = useState(false);
  
  // Show welcome modal
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  // Camera capture state
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // 'user' for front, 'environment' for back
  const videoRef = useRef(null);
  const captureCanvasRef = useRef(null);

  // Camera functions
  async function startCamera() {
    try {
      setCameraError(null);
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setCameraError(error.message || 'Unable to access camera');
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }

  async function switchCamera() {
    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newFacingMode);
    
    if (cameraStream) {
      stopCamera();
      // Small delay to ensure camera is released
      setTimeout(() => {
        startCamera();
      }, 100);
    }
  }

  async function capturePhoto() {
    if (!videoRef.current || !captureCanvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw the current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert canvas to blob
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
    
    // Create a File object from the blob
    const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    
    // Process the captured image the same way as file input
    const bmp = await fileToBitmap(file, ui.maxDim);
    const url = URL.createObjectURL(file);
    
    // Initialize the image stack with the captured image
    const initialImage = {
      bitmap: bmp,
      url: url,
      timestamp: Date.now(),
      isOriginal: true,
      isCameraCapture: true
    };
    
    setBaseImg(bmp);
    setImageStack([initialImage]);
    setActiveImageIndex(0);
    
    // Close camera modal and stop camera
    setShowCameraModal(false);
    stopCamera();
  }

  function openCamera() {
    setShowCameraModal(true);
    startCamera();
  }

  function closeCameraModal() {
    setShowCameraModal(false);
    stopCamera();
  }

  // Cleanup camera stream on component unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Export functionality - downloads current canvas composition
  function handleExport() {
    if (!baseImg) return;
    
    const { canvas } = flatten();
    const link = document.createElement('a');
    link.download = `ideiuda-design-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // Share functionality - copies image to clipboard or creates shareable link
  async function handleShare() {
    if (!baseImg) return;
    
    try {
      const { canvas } = flatten();
      
      // Convert canvas to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png');
      });
      
      // Try to use the Clipboard API to copy the image
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        
        // Show success feedback
        alert('Design copied to clipboard!');
      } else {
        // Fallback: create a temporary download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ideiuda-design-${Date.now()}.png`;
        link.click();
        URL.revokeObjectURL(url);
        
        alert('Design downloaded! You can share the file.');
      }
    } catch (error) {
      console.error('Share failed:', error);
      alert('Unable to share. Please try the export option instead.');
    }
  }

  // Image Scroll Stack Component using proper ScrollStack
  function ImageScrollStack() {
    if (imageStack.length === 0) return null;
    
    return (
      <div 
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999]" 
        style={{
          zIndex: 9999, 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0,
          pointerEvents: 'auto',
          visibility: 'visible',
          opacity: 1
        }}
      >
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-50">
          <button 
            onClick={() => setShowScrollStack(false)}
            className="w-10 h-10 sm:w-12 sm:h-12 bg-black/60 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center hover:bg-black/80 transition-all"
          >
            <i className="fa-solid fa-times text-sm sm:text-lg"></i>
          </button>
        </div>
        
        <ScrollStack
          key={`scroll-stack-${imageStack.length}`}
          className="w-full h-full relative z-10"
          itemDistance={80}
          itemScale={0.05}
          itemStackDistance={40}
          stackPosition="20%"
          scaleEndPosition="10%"
          baseScale={0.85}
          rotationAmount={0}
          blurAmount={1}
        >
          {imageStack.map((image, index) => (
            <ScrollStackItem key={image.timestamp} itemClassName="bg-gradient-to-br from-gray-900 via-[#0F0F12] to-black border border-white/10">
              <div className="w-full h-full flex flex-col lg:flex-row items-stretch gap-4 sm:gap-6">
                {/* Image Section - Full Dimension */}
                <div className="relative flex-shrink-0 w-full lg:w-1/2 lg:max-w-md rounded-xl sm:rounded-2xl overflow-hidden shadow-2xl" style={{aspectRatio: '16/9'}}>
                  <img 
                    src={image.url} 
                    alt={`Generation ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {image.isOriginal && (
                    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-green-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium">
                      Original
                    </div>
                  )}
                  {!image.isOriginal && !image.isDroppedVersion && (
                    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-violet-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium">
                      Generation {imageStack.length - index}
                    </div>
                  )}
                  {image.isDroppedVersion && (
                    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 bg-blue-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium">
                      Input {imageStack.length - index}
                    </div>
                  )}
                </div>
                
                {/* Text and Actions Section */}
                <div className="flex-1 flex flex-col justify-between w-full py-2 sm:py-4 px-1 sm:px-2">
                  <div className="text-center lg:text-left text-white mb-3 sm:mb-4">
                    <h3 className="text-lg sm:text-xl lg:text-2xl font-light mb-1 sm:mb-2 lg:mb-3">
                      {image.isOriginal ? 'Original Input' : 
                       image.isDroppedVersion ? `Input ${imageStack.length - index}` : 
                       `Generation ${imageStack.length - index}`}
                    </h3>
                    {image.prompt && (
                      <p className="text-gray-400 text-xs sm:text-sm lg:text-base mb-1 sm:mb-2 lg:mb-3 leading-relaxed line-clamp-3">
                        "{image.prompt}"
                      </p>
                    )}
                    <p className="text-gray-500 text-xs lg:text-sm">
                      {new Date(image.timestamp).toLocaleString()}
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2 lg:gap-3 mt-auto">
                    <button 
                      onClick={() => {
                        switchToImage(index);
                        setShowScrollStack(false);
                      }}
                      className="bg-violet-600 hover:bg-violet-700 text-white px-3 sm:px-4 lg:px-6 py-2 rounded-lg transition-all font-medium text-xs sm:text-sm"
                    >
                      Edit This Version
                    </button>
                    <button 
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = image.url;
                        link.download = `generation-${image.timestamp}.png`;
                        link.click();
                      }}
                      className="bg-white/10 hover:bg-white/20 text-white px-3 sm:px-4 lg:px-6 py-2 rounded-lg border border-white/20 transition-all font-medium text-xs sm:text-sm"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </div>
            </ScrollStackItem>
          ))}
        </ScrollStack>
      </div>
    );
  }

  // UI - Redesigned with floating panels ArchIdea style
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-[#0F0F12] to-black text-gray-200 overflow-hidden">
      {/* Main Canvas Area - Background */}
      <main className="absolute inset-0">
        {!baseImg ? (
          <div 
            className="absolute inset-0 flex items-center justify-center z-0"
            onDragOver={onDragOver} 
            onDragEnter={onDragEnter} 
            onDragLeave={onDragLeave} 
            onDrop={onDrop}
          >
            <div className="text-center px-4 sm:px-0">
              <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl sm:rounded-3xl flex items-center justify-center mb-6 sm:mb-8 mx-auto bg-black/20 border border-white/10 backdrop-blur-lg">
                <i className="fa-solid fa-camera text-3xl sm:text-5xl text-gray-400"></i>
              </div>
              <h2 className="text-2xl sm:text-4xl font-light text-white mb-2 sm:mb-3 tracking-wide">Capture Vision</h2>
              <p className="text-gray-400 mb-8 sm:mb-12 font-light text-base sm:text-lg px-4">Begin your ideation journey</p>
              <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6 justify-center max-w-md mx-auto sm:max-w-none">
                <button 
                  className="bg-gradient-to-r from-violet-600 to-purple-400 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-light hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 flex items-center justify-center space-x-3 shadow-lg shadow-violet-600/20 w-full sm:w-auto"
                  onClick={openCamera}
                >
                  <i className="fa-solid fa-camera text-base sm:text-lg"></i>
                  <span>Capture</span>
                </button>
                <button 
                  className="bg-white/5 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-light border border-white/10 hover:bg-white/10 hover:shadow-lg transition-all flex items-center justify-center space-x-3 w-full sm:w-auto"
                  onClick={() => document.getElementById("import-input").click()}
                >
                  <i className="fa-solid fa-upload text-base sm:text-lg"></i>
                  <span>Import</span>
                </button>
              </div>
              <input id="capture-input" type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
              <input id="import-input" type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            </div>
          </div>
        ) : (
          <div 
            className="absolute inset-0 flex items-center justify-center overflow-auto"
            onDragOver={onDragOver} 
            onDragEnter={onDragEnter} 
            onDragLeave={onDragLeave} 
            onDrop={onDrop}
          >
            <div className="relative flex-shrink-0" ref={containerRef}>
              <canvas ref={viewCanvasRef} className="block" style={{ display: "block", margin: "0 auto" }} />
              <canvas
                ref={drawCanvasRef}
                className="absolute top-0 cursor-crosshair"
                style={{ position: "absolute", touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerEnter={(e) => {
                  // Immediately check for hover when entering canvas
                  if (!drawing.current && !dragState.isDragging) {
                    const c = drawCanvasRef.current;
                    const pt = clientToCanvas(e, c);
                    const refIndex = getRefAtPoint(pt.x, pt.y);
                    if (refIndex !== -1) {
                      setHoverState({ isHovering: true, hoverIndex: refIndex });
                      c.style.cursor = 'move';
                    }
                  }
                }}
                onPointerLeave={() => {
                  if (hoverState.isHovering) {
                    setHoverState({ isHovering: false, hoverIndex: -1 });
                    if (drawCanvasRef.current) {
                      drawCanvasRef.current.style.cursor = 'crosshair';
                    }
                  }
                }}
              />
              {/* Canvas center drop overlay */}
              {isDraggingOverCanvas && (
                <div className="absolute inset-0 bg-blue-500/20 border-2 border-blue-400 border-dashed rounded-lg flex items-center justify-center pointer-events-none">
                  <div className="bg-blue-600/90 backdrop-blur-sm text-white px-6 py-3 rounded-xl shadow-lg">
                    <div className="flex items-center space-x-3">
                      <i className="fa-solid fa-plus text-lg"></i>
                      <span className="font-medium">Drop to create new version</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating Header - Desktop Only */}
      <header className="hidden sm:block fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-3 shadow-lg max-w-[calc(100vw-24px)] w-auto">
        <div className="flex items-center justify-between space-x-16">
          <div className="flex items-center space-x-3">
            {/* <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-md">
              <img src="/logo_ideiuda_sm.png" alt="Ideiuda Logo" className="w-8 h-8" />
            </div> */}
            <h1 className="text-lg font-light text-white tracking-wide">Ideiuda</h1>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all"
              onClick={() => setShowWelcomeModal(true)}
            >
              <i className="fa-solid fa-question-circle text-xs"></i>
            </button>
            {baseImg && (
              <button 
                className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all" 
                onClick={startOver}
                title="Start Over"
              >
                <i className="fa-solid fa-rotate-left text-xs"></i>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Floating Left Sidebar - References */}
      <aside 
        className={`fixed z-40 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-5 overflow-y-auto shadow-lg transition-all duration-300 ease-in-out
          ${sidebarCollapsed 
            ? 'left-[-280px] sm:left-[-260px]' 
            : 'left-3 sm:left-6'
          }
          w-72 sm:w-64
          top-20 sm:top-1/2 sm:transform sm:-translate-y-1/2
          bottom-32 sm:bottom-auto
          max-h-[calc(100vh-180px)] sm:max-h-[calc(100vh-100px)]
        `}
      >
        <div className="mb-5">
          <h3 className="text-sm font-medium text-white mb-1 tracking-wide">Reference Library</h3>
          <p className="text-xs text-gray-400 font-light">Contextual inspiration</p>
        </div>
        <div 
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border border-dashed rounded-xl p-6 text-center mb-4 flex flex-col items-center justify-center transition-all duration-300 ${
            isDragging 
              ? "border-violet-400/80 bg-violet-400/10" 
              : "border-white/20 bg-white/5"
          }`}
        >
          <i className="fa-solid fa-cloud-arrow-up text-xl text-gray-400 mb-2"></i>
          <p className="text-xs text-gray-300 font-light mb-1">Drop references</p>
          <label className="text-xs text-violet-400 hover:text-violet-300 transition-colors font-light cursor-pointer">
            or browse
            <input type="file" accept="image/*" multiple onChange={handleRefs} className="hidden" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {refsImgs.map((img, i) => (
            <div key={i} className="relative group cursor-pointer aspect-square">
              <canvas 
                ref={el => {
                  if (el && img) {
                    const ctx = el.getContext('2d');
                    const size = 120;
                    el.width = size;
                    el.height = size;
                    
                    // Fill background
                    ctx.fillStyle = "#101012";
                    ctx.fillRect(0, 0, size, size);
                    
                    // Calculate aspect ratio preserving dimensions
                    const scale = size / Math.max(img.width, img.height);
                    const w = Math.round(img.width * scale);
                    const h = Math.round(img.height * scale);
                    const x = Math.round((size - w) / 2);
                    const y = Math.round((size - h) / 2);
                    
                    // Draw image centered and aspect-ratio preserved
                    ctx.drawImage(img, x, y, w, h);
                  }
                }}
                className="w-full h-full rounded-md"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button 
                  className="w-6 h-6 bg-red-600 text-white rounded-full text-xs flex items-center justify-center"
                  onClick={() => {
                    setRefsImgs(prev => prev.filter((_, idx) => idx !== i));
                    setRefsFiles(prev => prev.filter((_, idx) => idx !== i));
                    setRefsPositions(prev => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        
        {/* Collapse Button - Inside Sidebar */}
        <button
          onClick={() => setSidebarCollapsed(true)}
          className="absolute top-1/2 -right-1 transform -translate-y-1/2 w-6 h-12  rounded-r-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-black/80 transition-all duration-200 shadow-lg"
        >
          <i className="fa-solid fa-chevron-left text-xs"></i>
        </button>
      </aside>

      {/* Expand Trigger - When Collapsed */}
      {sidebarCollapsed && (
        <div 
          className="fixed left-0 z-50 w-8 group cursor-pointer
            top-1/2 transform -translate-y-1/2 h-16 sm:h-24"
          onMouseEnter={() => {}}
          onClick={() => setSidebarCollapsed(false)}
        >
          {/* Hover Area */}
          <div className="absolute inset-0 bg-transparent"></div>
          
          {/* Expand Button */}
          <div className="absolute top-1/2 left-0 transform -translate-y-1/2 w-6 h-12 bg-black/60 backdrop-blur-md rounded-r-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-black/80 transition-all duration-200 shadow-lg group-hover:opacity-100">
            <i className="fa-solid fa-chevron-right text-xs"></i>
          </div>
        </div>
      )}

      {/* Mobile Prompt Bar - Top of Screen */}
      <SignedIn>
      <div className="block sm:hidden fixed top-3 left-3 right-3 z-40 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-lg">
        <div className="flex gap-2 items-center">
          <h1 className="text-sm font-light text-white tracking-wide whitespace-nowrap">Ideiuda</h1>
          <textarea 
            placeholder="Describe your vision..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 h-10 p-2 bg-black/20 border border-white/10 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent text-sm font-light placeholder-gray-500 text-white"
            rows="1"
          />
          
            <button 
              disabled={!baseImg || !prompt || loading}
              onClick={onGenerate}
              className="w-10 h-10 bg-gradient-to-r from-violet-600 to-purple-400 text-white rounded-lg font-light shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center relative overflow-hidden"
            >
              {loading ? (
                <>
                  <i className="fa-solid fa-spinner text-sm animate-spin"></i>
                  {/* Loading progress ring */}
                  <div className="absolute inset-0 rounded-lg">
                    <div className="absolute inset-0 bg-gradient-to-r from-violet-400/20 to-purple-300/20 rounded-lg animate-pulse"></div>
                  </div>
                </>
              ) : (
                <i className="fa-solid fa-wand-magic-sparkles text-sm"></i>
              )}
            </button>
          
       
        </div>
      </div>
      </SignedIn>
                   <SignedOut>
             <div className="h-24 text-white rounded-lg flex items-center justify-left">
               <div className="w-full h-32  sm:hidden px-2">
                 <TextPressure
                   text="IDEIUDA"
                   flex={true}
                   alpha={false}
                   stroke={false}
                   width={true}
                   weight={true}
                   italic={true}
                   textColor="#8B5CF6"
                   strokeColor="#ff0000"
                   minFontSize={16}
                 />
               </div>
             </div>
            </SignedOut>

      {/* Desktop Floating Right Panel - Prompt */}
      <aside 
        className={`hidden sm:block fixed z-40 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col shadow-lg transition-all duration-300 ease-in-out
          ${rightPanelCollapsed 
            ? 'right-[-310px]' 
            : 'right-6'
          }
          w-80
          top-1/2 transform -translate-y-1/2
          max-h-[calc(100vh-100px)]
        `}
      >
        <div className="mb-5">
          <h3 className="text-lg font-light text-white mb-1 tracking-wide">Design Intent</h3>
          <p className="text-sm text-gray-400 font-light">Articulate your vision</p>
        </div>
        <div className="flex-grow overflow-y-auto pr-1">
          <textarea 
            placeholder="Describe architectural concepts, materials, lighting..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-36 p-4 bg-black/20 border border-white/10 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent text-sm font-light placeholder-gray-500 text-white"
          />
        </div>

        <div className="pt-6 border-white/10">
          <SignedIn>
            <button 
              disabled={!baseImg || !prompt || loading}
              onClick={onGenerate}
              className="w-full bg-gradient-to-r from-violet-600 to-purple-400 text-white py-4 rounded-xl font-light text-md shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              <i className="fa-solid fa-wand-magic-sparkles mr-2"></i>
              {loading ? `Generating… ${(elapsedMs/1000).toFixed(1)}s` : "Generate Concepts"}
            </button>
          </SignedIn>
          <SignedOut>
            <div className="w-full bg-white/5 border border-purple-400 text-gray-300 py-4 rounded-xl font-light text-md text-center">
              <i className="fa-solid fa-lock mr-2"></i>
              Sign in to generate concepts
            </div>
          </SignedOut>
          <div className="flex space-x-3 mt-4">
            <button 
              onClick={handleExport}
              className="flex-1 bg-white/5 text-gray-300 py-2 px-3 rounded-lg text-xs hover:bg-white/10 transition-all font-light border border-white/10"
            >
              <i className="fa-solid fa-download mr-1.5"></i>
              Export
            </button>
            <button 
              onClick={handleShare}
              className="flex-1 bg-white/5 text-gray-300 py-2 px-3 rounded-lg text-xs hover:bg-white/10 transition-all font-light border border-white/10"
            >
              <i className="fa-solid fa-share mr-1.5"></i>
              Share
            </button>
          </div>
        </div>
        
        {/* Collapse Button - Inside Right Panel */}
        <button
          onClick={() => setRightPanelCollapsed(true)}
          className="absolute top-1/2 -left-0 transform -translate-y-1/2 w-6 h-12  backdrop-blur-md rounded-l-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-black/80 transition-all duration-200 shadow-lg"
        >
          <i className="fa-solid fa-chevron-right text-xs"></i>
        </button>
      </aside>

      {/* Expand Trigger - When Right Panel Collapsed (Desktop Only) */}
      {rightPanelCollapsed && (
        <div 
          className="hidden sm:block fixed right-0 z-50 w-8 group cursor-pointer top-1/2 transform -translate-y-1/2 h-24"
          onMouseEnter={() => {}}
          onClick={() => setRightPanelCollapsed(false)}
        >
          {/* Hover Area */}
          <div className="absolute inset-0 bg-transparent"></div>
          
          {/* Expand Button */}
          <div className="absolute top-1/2 right-0 transform -translate-y-1/2 w-6 h-12 bg-black/60 backdrop-blur-md rounded-l-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-black/80 transition-all duration-200 shadow-lg group-hover:opacity-100">
            <i className="fa-solid fa-chevron-left text-xs"></i>
          </div>
        </div>
      )}

      {/* Floating Drawing Tools */}
      {baseImg && (
        <div className="fixed bottom-3 sm:bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl sm:rounded-2xl shadow-xl p-2 sm:p-2.5 flex items-center space-x-2 sm:space-x-3 max-w-[calc(100vw-24px)] overflow-x-auto">
          <div className="relative color-picker-container">
            <button 
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-md sm:rounded-lg flex items-center justify-center transition-all ${
                mode === "pen" 
                  ? "bg-violet-400 text-white" 
                  : "bg-white/10 text-gray-300 hover:bg-white/20"
              }`}
              onClick={() => {
                if (mode === "pen") {
                  setShowColorPicker(!showColorPicker);
                } else {
                  setMode("pen");
                  setShowColorPicker(false);
                }
              }}
            >
              <i 
                className="fa-solid fa-pen text-xs sm:text-sm" 
                style={{ color: mode === "pen" ? drawColor : undefined }}
              ></i>
            </button>
            
            {/* Advanced Color Picker Popup */}
            {showColorPicker && (
              <div className="absolute bottom-12 left-0 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-2xl z-10 w-72 sm:w-80 max-w-[calc(100vw-48px)]" style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
                {/* Gradient Type Selector */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-white">Linear</span>
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Main Color Area */}
                <div className="relative mb-3 sm:mb-4">
                  <div 
                    className="w-full h-40 sm:h-48 rounded-lg sm:rounded-xl cursor-crosshair relative overflow-hidden"
                    style={{
                      background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${colorHsv.h}, 100%, 50%))`
                    }}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;
                      const s = Math.round((x / rect.width) * 100);
                      const v = Math.round(100 - (y / rect.height) * 100);
                      updateColorFromHsv({ ...colorHsv, s, v });
                    }}
                  >
                    {/* Color Picker Circle */}
                    <div 
                      className="absolute w-4 h-4 border-2 border-white rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                      style={{
                        left: `${colorHsv.s}%`,
                        top: `${100 - colorHsv.v}%`
                      }}
                    />
                  </div>
                </div>

                {/* Hue Slider */}
                <div className="mb-4">
                  <div className="relative h-3 rounded-full overflow-hidden" style={{
                    background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
                  }}>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={colorHsv.h}
                      onChange={(e) => updateColorFromHsv({ ...colorHsv, h: parseInt(e.target.value) })}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div 
                      className="absolute top-1/2 w-5 h-5 bg-white border-2 border-gray-300 rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ left: `${(colorHsv.h / 360) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Opacity Slider */}
                <div className="mb-4">
                  <div className="relative h-3 rounded-full overflow-hidden" style={{
                    background: `linear-gradient(to right, transparent, ${drawColor}), url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3cdefs%3e%3cpattern id='checkerboard' patternUnits='userSpaceOnUse' width='8' height='8'%3e%3crect width='4' height='4' fill='%23f0f0f0'/%3e%3crect x='4' y='4' width='4' height='4' fill='%23f0f0f0'/%3e%3c/pattern%3e%3c/defs%3e%3crect width='100%25' height='100%25' fill='url(%23checkerboard)'/%3e%3c/svg%3e")`
                  }}>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={colorOpacity}
                      onChange={(e) => setColorOpacity(parseInt(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div 
                      className="absolute top-1/2 w-5 h-5 bg-white border-2 border-gray-300 rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ left: `${colorOpacity}%` }}
                    />
                  </div>
                </div>

                {/* Color Info */}
                <div className="flex space-x-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={drawColor.toUpperCase()}
                      onChange={(e) => {
                        const hex = e.target.value;
                        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                          updateColorFromHex(hex);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm font-mono bg-white/10 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="#0B37FF" 
                    />
                  </div>
                  <div className="flex-1">
                    <div className="px-3 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-center font-medium">
                      {colorOpacity}%
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="px-3 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-center font-medium">
                      HEX
                    </div>
                  </div>
                </div>

                {/* Eyedropper Tool */}
                <div className="absolute top-4 right-4">
                  <button className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors">
                    <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
          <button 
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-md sm:rounded-lg flex items-center justify-center transition-all ${
              mode === "eraser" 
                ? "bg-violet-400 text-white" 
                : "bg-white/10 text-gray-300 hover:bg-white/20"
            }`}
            onClick={() => setMode("eraser")}
          >
            <i className="fa-solid fa-eraser text-xs sm:text-sm"></i>
          </button>
          <div className="w-px h-5 sm:h-6 bg-white/10"></div>
          <div className="flex items-center space-x-1 sm:space-x-2">
            <input 
              type="range" 
              min="1" 
              max="10" 
              value={strokeWidth} 
              onChange={(e) => {
                setStrokeWidth(parseInt(e.target.value));
              }}
              className="w-16 sm:w-24 accent-violet-400"
            />
          </div>
          <div className="w-px h-5 sm:h-6 bg-white/10"></div>
          <button 
            onClick={clearSketch}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 text-white rounded-md sm:rounded-lg flex items-center justify-center hover:bg-red-900/60 transition-all"
          >
            <i className="fa-solid fa-trash text-xs sm:text-sm"></i>
          </button>
        </div>
      )}

      {/* Mobile Avatar - Aligned with Drawing Tools */}
      <div className="block sm:hidden fixed bottom-6 left-4 z-40">
        <SignedIn>
          <div className="w-9 h-9 bg-black/60 backdrop-blur-md  rounded-xl flex items-center justify-center shadow-xl">
            <UserButton 
              appearance={{
                elements: {
                  avatarBox: "w-6 h-6",
                  userButtonPopoverCard: "bg-black/90 border border-white/10",
                  userButtonPopoverActionButton: "text-black hover:bg-white/10"
                }
              }}
            />
          </div>
        </SignedIn>

      </div>

      {/* Image Stack Button */}
      {imageStack.length > 0 && (
        <div className="fixed bottom-6 sm:bottom-6 right-3 sm:right-6 z-40">
          <button
            onClick={() => setShowScrollStack(true)}
            className="relative bg-black/60 backdrop-blur-md  text-white rounded-xl sm:rounded-2xl hover:bg-black/80 transition-all shadow-xl hover:bg-gray-400/20 w-9 h-9 sm:w-auto sm:h-auto sm:p-4 flex items-center justify-center"
          >
            <div className="flex items-center space-x-0 sm:space-x-3">
              <i className="fa-solid fa-layer-group text-sm sm:text-lg"></i>
            </div>
            {imageStack.length > 1 && (
              <div className="absolute -top-1 sm:-top-2 -right-1 sm:-right-2 bg-violet-500 text-white text-xs rounded-full w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center">
                {imageStack.length}
              </div>
            )}
          </button>
        </div>
      )}

      {/* Image Stack Modal */}
      {showScrollStack && typeof document !== 'undefined' && createPortal(<ImageScrollStack />, document.body)}

      {/* Welcome Modal */}
      {showWelcomeModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 z-[9999]">
          <div className="relative w-full max-w-4xl h-full max-h-[90vh] sm:max-h-[80vh] bg-black rounded-2xl sm:rounded-3xl border border-white/10 overflow-hidden">
            {/* Close Button */}
            <button 
              onClick={() => setShowWelcomeModal(false)}
              className="absolute top-4 right-4 sm:top-8 sm:right-8 z-10 w-10 h-10 sm:w-12 sm:h-12 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-all"
            >
              <i className="fa-solid fa-times text-sm sm:text-lg"></i>
            </button>

            {/* Modal Content */}
            <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-12 text-center overflow-y-auto">
              {/* Welcome Text */}
              <div className="mb-0">
                <h2 className="text-lg sm:text-xl font-light text-white mb-0 tracking-wide">
                  Hello! Welcome to
                </h2>
              </div>

              {/* IDEIUDA with TextPressure Effect */}
              <div className="w-full max-w-xl sm:max-w-2xl h-32 sm:h-48 mb-4 sm:mb-6">
                <TextPressure
                  text="IDEIUDA"
                  flex={true}
                  alpha={false}
                  stroke={false}
                  width={true}
                  weight={true}
                  italic={true}
                  textColor="#8B5CF6"
                  strokeColor="#ff0000"
                  minFontSize={24}
                />
              </div>

              {/* App Explanation */}
              <div className="max-w-3xl text-gray-300 text-sm sm:text-md leading-relaxed space-y-3 sm:space-y-4 px-4 sm:px-0">
                <p>
                  Your creative companion for architectural visualization and design exploration. 
                  Transform your ideas into stunning visual concepts with AI-powered generation.
                </p>
                <p>
                  <strong className="text-white">Start by:</strong> Capturing or importing a base image, 
                  sketch your ideas directly on the canvas, add reference materials, 
                  and describe your vision to generate new architectural concepts.
                </p>
                <p>
                  <strong className="text-white">Explore:</strong> Create multiple iterations, 
                  compare different versions, and refine your designs through an intuitive 
                  creative workflow designed for architects and designers.
                </p>
              </div>

              {/* Get Started Button */}
              <button 
                onClick={() => setShowWelcomeModal(false)}
                className="mt-4 sm:mt-6 bg-gradient-to-r from-violet-600 to-purple-400 text-white px-8 sm:px-12 py-3 rounded-xl sm:rounded-2xl font-light text-base sm:text-lg hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-violet-600/20"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Modal */}
      {showCameraModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-80 flex items-center justify-center">
          <div className="relative w-full h-full max-w-4xl max-h-[100vh] sm:max-h-[90vh] bg-black rounded-none sm:rounded-2xl border-0 sm:border border-white/10 overflow-hidden">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 bg-black/60 backdrop-blur-md border-b border-white/10 p-3 sm:p-4 safe-area-inset-top">
              <div className="flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-light text-white">Camera Capture</h3>
                <div className="flex items-center space-x-2 sm:space-x-3">
                  {/* Switch Camera Button */}
                  <button
                    onClick={switchCamera}
                    className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-all"
                    title="Switch Camera"
                  >
                    <i className="fa-solid fa-camera-rotate text-xs sm:text-sm"></i>
                  </button>
                  {/* Close Button */}
                  <button 
                    onClick={closeCameraModal}
                    className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-all"
                  >
                    <i className="fa-solid fa-times text-xs sm:text-sm"></i>
                  </button>
                </div>
              </div>
            </div>

            {/* Camera View */}
            <div className="relative w-full h-full flex items-center justify-center bg-black">
              {cameraError ? (
                <div className="text-center text-white p-8">
                  <i className="fa-solid fa-exclamation-triangle text-4xl text-red-400 mb-4"></i>
                  <h4 className="text-xl font-light mb-2">Camera Access Error</h4>
                  <p className="text-gray-400 mb-4">{cameraError}</p>
                  <button
                    onClick={startCamera}
                    className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2 rounded-lg transition-all"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
                  />
                  
                  {/* Capture Controls */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md border-t border-white/10 p-4 sm:p-6 safe-area-inset-bottom">
                    <div className="flex items-center justify-center">
                      <button
                        onClick={capturePhoto}
                        disabled={!cameraStream}
                        className="w-14 h-14 sm:w-16 sm:h-16 bg-white border-4 border-gray-300 rounded-full flex items-center justify-center hover:bg-gray-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                      >
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-full"></div>
                      </button>
                    </div>
                    <div className="text-center mt-2 sm:mt-3">
                      <p className="text-white text-xs sm:text-sm font-light">Tap to capture</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Hidden canvas for capture */}
            <canvas ref={captureCanvasRef} className="hidden" />
          </div>
        </div>
      )}

      {/* Font Awesome CDN */}
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    </div>
  );
}

