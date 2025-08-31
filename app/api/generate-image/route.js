// app/api/generate-image/route.js
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-2.5-flash-image-preview";

export async function POST(req) {
  try {
    const ct = req.headers.get("content-type") || "";
    console.log("[generate-image] content-type:", ct);
    if (!ct.includes("multipart/form-data"))
      return NextResponse.json({ error: "Send multipart/form-data" }, { status: 415 });

    const form = await req.formData();
    const prompt = String(form.get("prompt") || "").trim();
    const composite = form.get("image"); // the flattened canvas PNG
    const refs = form.getAll("refs");     // optional additional reference images
    console.log("[generate-image] prompt length:", prompt.length);
    if (composite) {
      try {
        // Log basic file metadata
        const name = composite.name || "(no-name)";
        const type = composite.type || "(no-type)";
        const size = typeof composite.size === "number" ? composite.size : "(no-size)";
        console.log("[generate-image] composite file:", { name, type, size });
      } catch (e) {
        console.log("[generate-image] error inspecting composite file:", e);
      }
    } else {
      console.log("[generate-image] composite file is missing in formData");
    }
    // Avoid referencing global File (may be undefined in some Node runtimes).
    // Accept any file-like object returned by formData (has arrayBuffer and type/name).
    const isFileLike = composite && typeof composite.arrayBuffer === "function";
    if (!prompt || !isFileLike)
      return NextResponse.json({ error: "Missing prompt or image" }, { status: 400 });

    // Send image inline to the model (avoid Files API issues around size/mimeType)
    console.log("[generate-image] preparing inline image payload...");
    const ab = await composite.arrayBuffer();
    const dataBytes = new Uint8Array(ab);
    const mimeType = composite.type || "image/png";
    const base64 = Buffer.from(dataBytes).toString("base64");
    console.log("[generate-image] inline payload:", { mimeType, bytes: dataBytes.byteLength, refsCount: refs?.length || 0 });

    // Build contents: prompt + composite + refs (if any)
    const contents = [{ text: prompt }, { inlineData: { mimeType, data: base64 } }];
    for (const r of refs) {
      try {
        if (!r || typeof r.arrayBuffer !== "function") continue;
        const rab = await r.arrayBuffer();
        const rbytes = new Uint8Array(rab);
        const rmime = r.type || "image/png";
        contents.push({ inlineData: { mimeType: rmime, data: Buffer.from(rbytes).toString("base64") } });
      } catch (err) {
        console.log("[generate-image] failed to add ref:", err);
      }
    }

    console.log("[generate-image] calling model:", MODEL, { hasPrompt: !!prompt, inline: true });
    const res = await ai.models.generateContent({ model: MODEL, contents });
    console.log("[generate-image] model response keys:", Object.keys(res || {}));

    const parts = res?.candidates?.[0]?.content?.parts || [];
    console.log("[generate-image] candidates:", (res?.candidates || []).length, "parts:", parts.length);
    const img = parts.find((p) => p.inlineData);
    if (!img) {
      const maybeText = parts.find((p) => p.text)?.text || res.text || "(no message)";
      console.log("[generate-image] no inline image returned. maybeText:", maybeText);
      return NextResponse.json({ error: "No image returned", message: maybeText }, { status: 502 });
    }

    const mime = img.inlineData.mimeType || "image/png";
    const buf = Buffer.from(img.inlineData.data, "base64");
    console.log("[generate-image] returning image buffer of bytes:", buf.length, "mime:", mime);
    return new NextResponse(buf, {
      headers: { "Content-Type": mime, "Cache-Control": "no-store" },
    });
  } catch (e) {
    const status = Number(e?.status) || 500;
    console.log("[generate-image] ERROR:", e);
    return NextResponse.json({ error: e?.message || "Generation failed" }, { status });
  }
}
