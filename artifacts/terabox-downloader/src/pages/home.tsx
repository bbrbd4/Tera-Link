import { useState, useRef } from "react";
import { Download, Play, FileVideo, HardDrive, Clock, Link2, AlertCircle, Loader2, Copy, Check, Zap, Shield, Globe } from "lucide-react";

interface FileData {
  file_name: string;
  thumbnail: string;
  download_url: string;
  stream_url: string;
  new_stream_url: string;
  stream_final_url: string;
  file_size: string;
  file_size_bytes: number;
  share_url: string;
  duration: string;
  share_id: number;
  extension: string;
}

interface ApiResponse {
  success: boolean;
  data: FileData[];
  channel?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FileData | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValidTeraboxUrl = (u: string) => {
    try {
      const parsed = new URL(u);
      return parsed.hostname.includes("terabox") || parsed.hostname.includes("1024terabox") || parsed.hostname.includes("mirrobox") || u.includes("terabox");
    } catch {
      return false;
    }
  };

  const handleFetch = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a TeraBox URL.");
      return;
    }
    if (!isValidTeraboxUrl(trimmed)) {
      setError("That doesn't look like a valid TeraBox link. Try a URL from terabox.com or 1024terabox.com.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const apiUrl = `/api/terabox?url=${encodeURIComponent(trimmed)}`;
      const res = await fetch(apiUrl);
      if (!res.ok) {
        throw new Error(`Server responded with status ${res.status}`);
      }
      const json: ApiResponse = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        throw new Error("Could not fetch file data. The link may be invalid or expired.");
      }
      setResult(json.data[0]);
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Network error. Please check your connection and try again.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleFetch();
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // fallback
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getStreamUrl = (data: FileData) => {
    return data.stream_final_url || data.new_stream_url || data.stream_url || "";
  };

  const hasStream = (data: FileData) => {
    return !!(data.stream_final_url || data.new_stream_url || data.stream_url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Background gradient blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60%), transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.05]"
          style={{ background: "radial-gradient(circle, hsl(271 81% 56%), transparent 70%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60%), transparent 60%)" }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-3xl mx-auto px-4 py-12 flex-1">
        {/* Header */}
        <div className="text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            Free & Fast Downloads
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            <span className="text-foreground">TeraBox</span>{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, hsl(217 91% 60%), hsl(271 81% 56%))" }}
            >
              Downloader
            </span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto leading-relaxed">
            Paste any TeraBox share link and get instant download and stream access.
          </p>
        </div>

        {/* Input Card */}
        <div
          className="w-full rounded-2xl border border-card-border bg-card p-6 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5" />
              TeraBox Share URL
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="https://terabox.com/s/..."
                  className="w-full bg-muted/50 border border-input rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-200"
                />
                {url && (
                  <button
                    onClick={() => { setUrl(""); setError(null); setResult(null); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors text-xs px-1.5 py-0.5 rounded hover:bg-secondary"
                  >
                    Clear
                  </button>
                )}
              </div>
              <button
                onClick={handlePaste}
                className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground text-sm font-medium transition-all duration-200 flex items-center gap-2 shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                Paste
              </button>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <button
              onClick={handleFetch}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed glow-pulse"
              style={{
                background: loading
                  ? "hsl(217 91% 60% / 0.7)"
                  : "linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))",
                color: "hsl(222 47% 8%)",
                boxShadow: loading ? "none" : "0 4px 20px hsl(217 91% 60% / 0.35)",
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching file info...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Get Download Links
                </>
              )}
            </button>
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading && (
          <div className="w-full rounded-2xl border border-card-border bg-card p-6 animate-in fade-in duration-300" style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <div className="flex gap-4">
              <div className="w-32 h-20 rounded-xl shimmer shrink-0" />
              <div className="flex-1 flex flex-col gap-3">
                <div className="h-5 rounded-lg shimmer w-3/4" />
                <div className="h-4 rounded-lg shimmer w-1/2" />
                <div className="h-4 rounded-lg shimmer w-1/3" />
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="h-12 rounded-xl shimmer" />
              <div className="h-12 rounded-xl shimmer" />
            </div>
          </div>
        )}

        {/* Result Card */}
        {result && !loading && (
          <div
            className="w-full rounded-2xl border border-card-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-400"
            style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
          >
            {/* Thumbnail + Meta */}
            <div className="flex gap-4 p-6 border-b border-border">
              {result.thumbnail ? (
                <div className="w-36 h-24 rounded-xl overflow-hidden shrink-0 border border-border bg-muted relative">
                  <img
                    src={result.thumbnail}
                    alt={result.file_name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/50">
                    <FileVideo className="w-8 h-8 text-white" />
                  </div>
                </div>
              ) : (
                <div className="w-36 h-24 rounded-xl shrink-0 border border-border bg-muted flex items-center justify-center">
                  <FileVideo className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-foreground text-base leading-snug mb-3 truncate" title={result.file_name}>
                  {result.file_name}
                </h2>
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <HardDrive className="w-3.5 h-3.5 text-primary/70" />
                    <span>{result.file_size || formatBytes(result.file_size_bytes)}</span>
                  </div>
                  {result.duration && result.duration !== "00:00" && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="w-3.5 h-3.5 text-primary/70" />
                      <span>{result.duration}</span>
                    </div>
                  )}
                  {result.extension && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <FileVideo className="w-3.5 h-3.5 text-primary/70" />
                      <span className="uppercase">{result.extension.replace(".", "")}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-6 flex flex-col gap-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Available Links</p>

              {/* Download Link */}
              {result.download_url && (
                <div className="flex gap-2">
                  <a
                    href={result.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
                    style={{
                      background: "linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))",
                      color: "hsl(222 47% 8%)",
                      boxShadow: "0 4px 16px hsl(217 91% 60% / 0.3)",
                    }}
                  >
                    <Download className="w-4 h-4" />
                    Download File
                  </a>
                  <button
                    onClick={() => handleCopy(result.download_url)}
                    className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 flex items-center gap-1.5 text-sm"
                    title="Copy download URL"
                  >
                    {copiedUrl === result.download_url ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}

              {/* Stream Link */}
              {hasStream(result) && (
                <div className="flex gap-2">
                  <a
                    href={getStreamUrl(result)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border border-border bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 hover:border-primary/30 active:scale-[0.98]"
                  >
                    <Play className="w-4 h-4" />
                    Stream Online
                  </a>
                  <button
                    onClick={() => handleCopy(getStreamUrl(result))}
                    className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 flex items-center gap-1.5 text-sm"
                    title="Copy stream URL"
                  >
                    {copiedUrl === getStreamUrl(result) ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}

              {/* Share URL */}
              {result.share_url && (
                <div className="flex gap-2">
                  <a
                    href={result.share_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border border-border bg-muted/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-[0.98]"
                  >
                    <Globe className="w-4 h-4" />
                    Original Share Page
                  </a>
                  <button
                    onClick={() => handleCopy(result.share_url)}
                    className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 flex items-center gap-1.5 text-sm"
                    title="Copy share URL"
                  >
                    {copiedUrl === result.share_url ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Feature Badges */}
        {!result && !loading && (
          <div className="flex flex-wrap justify-center gap-3 mt-4 animate-in fade-in duration-500 delay-200">
            {[
              { icon: <Zap className="w-3.5 h-3.5" />, label: "Instant fetch" },
              { icon: <Shield className="w-3.5 h-3.5" />, label: "No login required" },
              { icon: <Globe className="w-3.5 h-3.5" />, label: "Any TeraBox link" },
              { icon: <Play className="w-3.5 h-3.5" />, label: "Stream support" },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-card-border rounded-full px-3 py-1.5"
              >
                <span className="text-primary/70">{icon}</span>
                {label}
              </div>
            ))}
          </div>
        )}

        {/* How it works */}
        {!result && !loading && (
          <div className="mt-14 w-full animate-in fade-in duration-500 delay-300">
            <p className="text-center text-xs text-muted-foreground font-medium uppercase tracking-wider mb-6">How it works</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { step: "1", title: "Copy link", desc: "Grab a TeraBox share URL from any device" },
                { step: "2", title: "Paste & fetch", desc: "Paste the URL above and click the button" },
                { step: "3", title: "Download", desc: "Get direct download or stream links instantly" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="text-center">
                  <div
                    className="w-9 h-9 rounded-xl mx-auto mb-3 flex items-center justify-center text-sm font-bold"
                    style={{
                      background: "linear-gradient(135deg, hsl(217 91% 60% / 0.2), hsl(271 81% 56% / 0.1))",
                      border: "1px solid hsl(217 91% 60% / 0.3)",
                      color: "hsl(217 91% 65%)",
                    }}
                  >
                    {step}
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">{title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 px-4 border-t border-border/50 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Powered by</span>
          <a
            href="https://t.me/bb8_bd"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-semibold px-3 py-1 rounded-full transition-all duration-200 hover:opacity-90 active:scale-95"
            style={{
              background: "linear-gradient(135deg, hsl(217 91% 60%), hsl(271 81% 56%))",
              color: "hsl(222 47% 8%)",
              boxShadow: "0 2px 12px hsl(217 91% 60% / 0.35)",
            }}
          >
            bb8_bd
          </a>
        </div>
        <div className="flex items-start gap-1.5 text-xs text-amber-400/90 max-w-md">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Warning &mdash; এই শুধু মাত্র ১৯/২০ দেখার জন্য তৈরি করা হয়েছে।
          </span>
        </div>
      </footer>
    </div>
  );
}
